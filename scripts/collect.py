"""뉴스 수집기: Google News RSS(국문·영문) → 관련성 필터 → 분류 → 월별 파일(data/news/YYYY-MM.json)에 누적.

사용법
  python scripts/collect.py              # 최근 3일 기사 수집
  python scripts/collect.py --days 7     # 최근 7일
  python scripts/collect.py --rss a.xml  # 로컬 RSS 파일로 시험
표준 라이브러리만 사용하므로 별도 설치가 필요 없습니다.
"""
import argparse
import html
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import timedelta
from email.utils import parsedate_to_datetime

sys.path.insert(0, __import__("os").path.dirname(__file__))
import taxonomy as T  # noqa: E402
from common import (KST, NEWS, classify, is_relevant, load_json, make_id, norm_title, now_kst,  # noqa: E402
                    relevance, save_json, similar, to_date)

UA = "Mozilla/5.0 (compatible; LogisticsNewsBot/1.0; +https://github.com/JaewoonAhn-HRnews/Logistics-Information-System)"


def gnews_url(q, lang):
    if lang == "ko":
        return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
            {"q": q + " when:7d", "hl": "ko", "gl": "KR", "ceid": "KR:ko"})
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q + " when:7d", "hl": "en-US", "gl": "US", "ceid": "US:en"})


def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print(f"  ! {e} ({i + 1}/{tries})", file=sys.stderr)
            time.sleep(2 * (i + 1))
    return None


def strip_tags(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_rss(xml_bytes, lang, query):
    out = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f"  ! parse error: {e}", file=sys.stderr)
        return out
    for it in root.iter("item"):
        title = strip_tags(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None else ""
        if not source and " - " in title:
            source = title.rsplit(" - ", 1)[1].strip()
        if source and title.endswith(" - " + source):
            title = title[: -len(" - " + source)].strip()
        desc = strip_tags(it.findtext("description"))
        if norm_title(desc).startswith(norm_title(title)[:20]):
            desc = ""  # Google News 설명은 보통 제목 반복
        pub = it.findtext("pubDate")
        try:
            dt = parsedate_to_datetime(pub).astimezone(KST)
        except Exception:  # noqa: BLE001
            dt = now_kst()
        out.append({"title": title, "url": link, "source": source, "summary": desc[:400],
                    "dt": dt, "lang": lang, "query": query})
    return out


def to_article(raw, origin="rss"):
    text = f"{raw['title']} {raw.get('summary', '')}"
    cats, kws, ents, axes = classify(text)
    score, _ = relevance(text)
    dt = raw["dt"]
    return {
        "id": make_id(raw["title"], raw["url"]),
        "date": dt.strftime("%Y-%m-%d"),
        "ts": dt.strftime("%Y-%m-%dT%H:%M"),
        "title": raw["title"],
        "source": raw["source"],
        "url": raw["url"],
        "lang": raw["lang"],
        "summary": raw.get("summary", ""),
        "cats": cats, "kw": kws, "ents": ents, "axes": axes,
        "score": score,
        "also": [],
        "origin": origin,
        "q": raw.get("query", ""),
    }


def month_file(m):
    return NEWS / f"{m}.json"


def merge(articles):
    """월별 파일에 병합. 같은 기사(제목 유사)는 하나로 묶고 보도 매체를 also에 누적."""
    by_month = {}
    for a in articles:
        by_month.setdefault(a["date"][:7], []).append(a)
    added = 0
    touched = set(by_month)
    # 경계일 중복 판정을 위해 이전·다음 달도 참조
    stores = {}

    def store(m):
        if m not in stores:
            stores[m] = load_json(month_file(m), {"month": m, "articles": []})
        return stores[m]

    for m, items in sorted(by_month.items()):
        st = store(m)
        pool = st["articles"]
        ids = {a["id"] for a in pool}
        for a in sorted(items, key=lambda x: x["ts"]):
            if a["id"] in ids:
                continue
            na = norm_title(a["title"])
            d0 = to_date(a["date"])
            dup = None
            for b in pool:
                if abs((to_date(b["date"]) - d0).days) <= 2 and similar(na, norm_title(b["title"])):
                    dup = b
                    break
            if dup:
                if a["source"] != dup["source"] and all(x["source"] != a["source"] for x in dup.get("also", [])):
                    dup.setdefault("also", []).append({"source": a["source"], "url": a["url"], "title": a["title"]})
                continue
            pool.append(a)
            ids.add(a["id"])
            added += 1
        pool.sort(key=lambda x: x["ts"], reverse=True)
    for m in touched:
        save_json(month_file(m), stores[m], compact=False)
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--rss", nargs="*", help="로컬 RSS 파일(시험용)")
    args = ap.parse_args()

    raws = []
    if args.rss:
        for p in args.rss:
            with open(p, "rb") as f:
                raws += parse_rss(f.read(), "ko" if "ko" in p else "en", p)
    else:
        jobs = [(q, "ko") for q in T.QUERIES_KO] + [(q, "en") for q in T.QUERIES_EN]
        for q, lang in jobs:
            print(f"- [{lang}] {q}")
            b = fetch(gnews_url(q, lang))
            if b:
                got = parse_rss(b, lang, q)
                print(f"  {len(got)}건")
                raws += got
            time.sleep(1.0)

    cutoff = (now_kst() - timedelta(days=args.days)).date()
    seen, cand = set(), []
    for r in raws:
        if r["dt"].date() < cutoff:
            continue
        text = f"{r['title']} {r['summary']}"
        if not is_relevant(text):
            continue
        k = norm_title(r["title"])
        if k in seen:
            continue
        seen.add(k)
        cand.append(to_article(r))
    n = merge(cand)
    print(f"원자료 {len(raws)}건 → 관련 {len(cand)}건 → 신규 {n}건 저장")


if __name__ == "__main__":
    main()
