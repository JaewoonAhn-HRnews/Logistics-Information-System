"""뉴스 수집기.

수집원
  1) data/sources.json 의 개별 사이트: RSS/Atom 우선, 실패하거나 비면 Google News 'site:' 검색으로 대체
  2) taxonomy.py 의 검색어(국문·영문·지역×분야별) → Google News RSS
  3) (선택) SAM.gov 입찰공고 API — 환경변수 SAM_API_KEY 가 있을 때만

관련성 필터 → 지역·분야·유형 분류 → 제목 유사 기사 묶기 → data/news/YYYY-MM.json 에 누적.
수집원별 결과는 data/feeds_status.json 에 기록(사이트의 '모니터링 소스' 화면에서 확인).

  python scripts/collect.py              # 최근 3일
  python scripts/collect.py --days 30    # 최근 30일(Google News 검색 기간도 30일)
표준 라이브러리만 사용합니다.
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(__file__))
import taxonomy as T  # noqa: E402
from common import (DATA, KST, NEWS, full_classify, is_relevant, load_json, make_id, norm_title, now_kst,  # noqa: E402
                    relevance, save_json, similar, to_date)

UA = "Mozilla/5.0 (compatible; LogisticsNewsBot/1.1; +https://github.com/JaewoonAhn-HRnews/Logistics-Information-System)"
SOURCES = {s["id"]: s for s in load_json(DATA / "sources.json", {"sources": []})["sources"]}


def gnews_url(q, lang, days):
    w = f" when:{min(max(days, 1), 30)}d"
    if lang == "ko":
        return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q + w, "hl": "ko", "gl": "KR", "ceid": "KR:ko"})
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q + w, "hl": "en-US", "gl": "US", "ceid": "US:en"})


def fetch(url, tries=2):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read(), None
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"[:160]
            time.sleep(1.5 * (i + 1))
    return None, err


def strip_tags(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_dt(s):
    if not s:
        return None
    s = s.strip()
    try:
        return parsedate_to_datetime(s).astimezone(KST)
    except Exception:  # noqa: BLE001
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(KST)
    except Exception:  # noqa: BLE001
        return None


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(xml_bytes, lang_default, meta):
    """RSS 2.0 / Atom 공용 파서. meta: {src, hint, min, ctx, name}"""
    out = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        # 흔한 오류(이스케이프 안 된 &, 제어문자) 보정 후 재시도
        txt = xml_bytes.decode("utf-8", "replace")
        txt = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", txt)
        txt = re.sub(r"&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)", "&amp;", txt)
        try:
            root = ET.fromstring(txt.encode("utf-8"))
        except ET.ParseError as e:
            raise ValueError(f"XML 파싱 실패: {e}") from e
    items = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    for it in items:
        f = {}
        link = ""
        src_name = ""
        for ch in it:
            t = _local(ch.tag)
            if t == "link":
                link = ch.get("href") or (ch.text or "").strip() or link
            elif t == "source":
                src_name = (ch.text or "").strip()
            elif t in ("title", "description", "summary", "content", "encoded", "pubDate", "published", "updated", "date") and t not in f:
                f[t] = ch.text or ""
        title = strip_tags(f.get("title"))
        if not title:
            continue
        source = src_name or meta.get("name", "")
        if meta.get("gnews"):
            if not src_name and " - " in title:
                source = title.rsplit(" - ", 1)[1].strip()
            if source and title.endswith(" - " + source):
                title = title[: -len(" - " + source)].strip()
        desc = strip_tags(f.get("description") or f.get("summary") or f.get("encoded") or f.get("content"))
        if meta.get("gnews") or norm_title(desc).startswith(norm_title(title)[:20]):
            desc = "" if meta.get("gnews") else desc
        dt = parse_dt(f.get("pubDate") or f.get("published") or f.get("updated") or f.get("date")) or now_kst()
        lang = "ko" if re.search(r"[가-힣]", title) else "en"
        out.append(dict(title=title, url=link.strip(), source=source, summary=desc[:450], dt=dt, lang=lang, **meta))
    return out


def to_article(raw, origin="rss"):
    text = f"{raw['title']} {raw.get('summary', '')}"
    c = full_classify(text, raw["lang"], raw.get("hint"))
    score, _ = relevance(text)
    dt = raw["dt"]
    a = {
        "id": make_id(raw["title"], raw["url"]),
        "date": dt.strftime("%Y-%m-%d"), "ts": dt.strftime("%Y-%m-%dT%H:%M"),
        "title": raw["title"], "source": raw["source"], "url": raw["url"], "lang": raw["lang"],
        "summary": raw.get("summary", ""), "score": score, "also": [], "origin": origin,
        "src": raw.get("src", ""), "hint": raw.get("hint"), "q": raw.get("query", ""),
    }
    a.update(c)
    if raw.get("kind"):
        a["kind"] = raw["kind"]
    return a


def month_file(m):
    return NEWS / f"{m}.json"


def merge(articles):
    """월별 파일에 병합. 같은 기사(제목 유사)는 하나로 묶고 보도 매체를 also에 누적."""
    by_month = {}
    for a in articles:
        by_month.setdefault(a["date"][:7], []).append(a)
    added = 0
    stores = {}
    for m, items in sorted(by_month.items()):
        st = stores.setdefault(m, load_json(month_file(m), {"month": m, "articles": []}))
        pool = st["articles"]
        ids = {a["id"] for a in pool}
        for a in sorted(items, key=lambda x: x["ts"]):
            if a["id"] in ids:
                continue
            na, d0 = norm_title(a["title"]), to_date(a["date"])
            dup = next((b for b in pool if abs((to_date(b["date"]) - d0).days) <= 2 and similar(na, norm_title(b["title"]))), None)
            if dup:
                if a["source"] != dup["source"] and all(x["source"] != a["source"] for x in dup.get("also", [])):
                    dup.setdefault("also", []).append({"source": a["source"], "url": a["url"], "title": a["title"]})
                continue
            pool.append(a)
            ids.add(a["id"])
            added += 1
        pool.sort(key=lambda x: x["ts"], reverse=True)
    for m, st in stores.items():
        save_json(month_file(m), st)
    return added


# ---------- SAM.gov ----------
SAM_TERMS = ["logistics", "sustainment", "spare parts", "maintenance", "supply chain", "predictive", "depot", "ERP", "readiness"]


def collect_sam(days, status):
    key = os.environ.get("SAM_API_KEY")
    st = {"id": "samgov", "mode": "api", "ok": False, "n": 0, "kept": 0}
    if not key:
        st["err"] = "SAM_API_KEY 미등록(선택 사항)"
        status["samgov"] = st
        return []
    today = now_kst().date()
    frm = (today - timedelta(days=min(days, 30))).strftime("%m/%d/%Y")
    to = today.strftime("%m/%d/%Y")
    raws, seen = [], set()
    for term in SAM_TERMS:
        q = urllib.parse.urlencode({"api_key": key, "postedFrom": frm, "postedTo": to, "limit": 100, "title": term})
        b, err = fetch("https://api.sam.gov/opportunities/v2/search?" + q, tries=1)
        if not b:
            st["err"] = err
            continue
        try:
            data = json.loads(b)
        except Exception as e:  # noqa: BLE001
            st["err"] = str(e)[:120]
            continue
        st["ok"] = True
        for o in data.get("opportunitiesData") or []:
            path = (o.get("fullParentPathName") or "").upper()
            if "DEFENSE" not in path or o.get("noticeId") in seen:
                continue
            seen.add(o.get("noticeId"))
            st["n"] += 1
            dept = (o.get("fullParentPathName") or "").split(".")
            dt = parse_dt((o.get("postedDate") or "")[:10] + "T09:00:00+09:00") or now_kst()
            summ = " · ".join(x for x in [o.get("type"), o.get("solicitationNumber"), " > ".join(dept[1:3]),
                                          ("마감 " + o["responseDeadLine"][:10]) if o.get("responseDeadLine") else ""] if x)
            raws.append(dict(title=(o.get("title") or "").strip().title(), url=o.get("uiLink") or "https://sam.gov/",
                             source="SAM.gov · " + (dept[1].title() if len(dept) > 1 else "DoD"), summary=summ, dt=dt, lang="en",
                             src="samgov", hint="us", min=0, ctx=True, kind="contract", query="sam:" + term))
        time.sleep(1)
    raws = raws[:60]
    st["kept"] = len(raws)
    status["samgov"] = st
    return raws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3)
    args = ap.parse_args()
    status = {}
    raws = []

    # 1) 개별 사이트
    for sid, s in SOURCES.items():
        au = s.get("auto") or {}
        if not (au.get("rss") or au.get("gnews")):
            continue
        meta = {"src": sid, "hint": s["region"], "min": au.get("min", 4.5), "ctx": au.get("ctx", False), "name": s["name"]}
        st = {"id": sid, "ok": False, "n": 0, "mode": None}
        got = []
        if au.get("rss"):
            b, err = fetch(au["rss"])
            if b:
                try:
                    got = parse_feed(b, "ko" if s["region"] == "kr" else "en", meta)
                    st.update(ok=True, mode="rss")
                except ValueError as e:
                    err = str(e)[:160]
            if not got:
                st["rss_err"] = err or "항목 없음"
        if not got and au.get("gnews"):
            lang = "ko" if s["region"] == "kr" else "en"
            b, err = fetch(gnews_url(au["gnews"], lang, args.days))
            if b:
                try:
                    got = parse_feed(b, lang, dict(meta, gnews=True, name=""))
                    st.update(ok=True, mode="gnews")
                except ValueError as e:
                    st["err"] = str(e)[:160]
            else:
                st["err"] = err
        st["n"] = len(got)
        status[sid] = st
        print(f"- [{sid}] {st.get('mode')} {len(got)}건 {st.get('rss_err', '') or st.get('err', '')}")
        raws += got
        time.sleep(0.8)

    # 2) 검색어
    jobs = [(q, "ko", None) for q in T.QUERIES_KO] + [(q, "en", None) for q in T.QUERIES_EN] + list(T.REGION_QUERIES)
    qok = qn = 0
    for q, lang, hint in jobs:
        b, err = fetch(gnews_url(q, lang, args.days))
        if b:
            try:
                got = parse_feed(b, lang, {"src": "gnews", "hint": hint, "min": 4.0, "ctx": False, "gnews": True, "name": "", "query": q})
                raws += got
                qok += 1
                qn += len(got)
            except ValueError:
                pass
        time.sleep(0.8)
    status["gnews-queries"] = {"id": "gnews-queries", "ok": qok > 0, "mode": "gnews", "n": qn, "queries": len(jobs), "queries_ok": qok}
    print(f"- 검색어 {qok}/{len(jobs)} 성공, {qn}건")

    # 3) SAM.gov
    raws += collect_sam(args.days, status)

    cutoff = (now_kst() - timedelta(days=args.days)).date()
    seen, cand = set(), []
    kept_by = {}
    for r in raws:
        if r["dt"].date() < cutoff:
            continue
        text = f"{r['title']} {r.get('summary', '')}"
        if r.get("src") != "samgov" and not is_relevant(text, r.get("ctx", False), r.get("min", 4.0)):
            continue
        k = norm_title(r["title"])
        if k in seen:
            continue
        seen.add(k)
        cand.append(to_article(r, origin="api" if r.get("src") == "samgov" else "rss"))
        kept_by[r.get("src", "")] = kept_by.get(r.get("src", ""), 0) + 1
    n = merge(cand)

    # 수집원 상태 누적 기록
    prev = load_json(DATA / "feeds_status.json", {"sources": {}})
    now = now_kst().strftime("%Y-%m-%d %H:%M")
    for sid, st in status.items():
        p = prev["sources"].get(sid, {})
        st["kept"] = kept_by.get(sid if sid != "gnews-queries" else "gnews", st.get("kept", 0))
        st["at"] = now
        st["total_kept"] = p.get("total_kept", 0) + st["kept"]
        st["last_ok"] = now if st.get("ok") else p.get("last_ok")
        prev["sources"][sid] = st
    prev["updated"] = now
    prev["last_run"] = {"raw": len(raws), "relevant": len(cand), "new": n, "days": args.days}
    save_json(DATA / "feeds_status.json", prev)
    print(f"원자료 {len(raws)}건 → 관련 {len(cand)}건 → 신규 {n}건 저장")


if __name__ == "__main__":
    main()
