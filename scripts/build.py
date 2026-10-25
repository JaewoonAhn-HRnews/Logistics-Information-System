"""누적 데이터 → 일·주·월·연 집계, 자동 브리핑, 추이·연계망 생성.

출력
  data/index.json    전체 목록(월 파일 목록, 일자별 건수, 갱신 시각)
  data/periods.json  일·주·월·연 단위 정리(건수, 주제, 키워드, 대표 기사, 부상 키워드, 브리핑)
  data/trends.json   월·주 추이, 키워드 연계망(온톨로지), 매체·개체 통계

선택: 환경변수 ANTHROPIC_API_KEY가 있으면 최신 일·주·월·연 브리핑을 Claude로 작성(data/ai_briefs.json에 캐시).
"""
import hashlib
import itertools
import json
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import taxonomy as T  # noqa: E402
from common import DATA, DB, NEWS, classify, full_classify, is_noise, load_json, relevance, same_story, now_kst, save_json, to_date, week_key, week_range  # noqa: E402

CAT_NAME = {c["id"]: c["name"] for c in T.CATEGORIES}
AXIS_NAME = {a["id"]: a["name"] for a in T.PROJECT_AXES}
SRC_REGION = {s["id"]: s["region"] for s in load_json(DATA / "sources.json", {"sources": []})["sources"]}
ENT_TYPE = {e: t for e, t, _ in T.ENTITIES}


def load_all():
    arts, files = [], []
    stores = {}
    for p in sorted(NEWS.glob("*.json")):
        stores[p] = load_json(p, {})
        files.append(p.name)
    # 1) 분류 소급 적용 + 제외어 기사 삭제
    changed = set()
    pool = []
    for p, d in stores.items():
        keep = []
        for a in d.get("articles", []):
            text = f"{a.get('title', '')} {a.get('summary', '')}"
            if is_noise(text):
                changed.add(p)
                continue
            c = full_classify(text, a.get("lang", "ko"), a.get("hint") or SRC_REGION.get(a.get("src")))
            if a.get("src") in ("samgov", "d2b-api"):
                c["kind"] = "contract"
            c["score"] = relevance(text)[0]
            if any(a.get(k) != v for k, v in c.items()):
                a.update(c)
                changed.add(p)
            keep.append(a)
            pool.append((p, a))
        d["articles"] = keep
    # 2) 같은 사건 기사 묶기(먼저 나온 기사에 '함께 보도한 매체'로 합침)
    pool.sort(key=lambda x: x[1].get("ts", x[1]["date"]))
    heads, drop = [], set()
    for p, a in pool:
        h = next((h for h in reversed(heads[-80:]) if abs((to_date(h[1]["date"]) - to_date(a["date"])).days) <= 3
                  and h[1].get("region") == a.get("region") and same_story(h[1], a)), None)
        if h:
            hb = h[1]
            if a["source"] != hb["source"] and all(x["source"] != a["source"] for x in hb.get("also", [])):
                hb.setdefault("also", []).append({"source": a["source"], "url": a["url"], "title": a["title"]})
            for x in a.get("also", []):
                if all(y["source"] != x["source"] for y in hb.get("also", [])) and x["source"] != hb["source"]:
                    hb["also"].append(x)
            hb["score"] = max(hb.get("score", 0), a.get("score", 0))
            drop.add(id(a))
            changed.add(p)
            changed.add(h[0])
        else:
            heads.append((p, a))
    for p, d in stores.items():
        d["articles"] = [a for a in d["articles"] if id(a) not in drop]
        if p in changed:
            save_json(p, d)
        arts += [dict(a) for a in d["articles"]]
    added = load_json(DB / "added.json", {"articles": []}).get("articles", [])
    for a in added:
        a.setdefault("origin", "manual")
        c = full_classify(f"{a.get('title', '')} {a.get('summary', '')}", a.get("lang", "ko"), a.get("hint"))
        for k, v in c.items():
            if k == "region" and a.get("region"):
                continue  # 직접 입력한 지역 유지
            a[k] = v
        a.setdefault("also", [])
        a.setdefault("score", 5.0)
        a.setdefault("ts", a["date"] + "T09:00")
    arts += added
    ov = load_json(DB / "overrides.json", {"hidden": [], "pinned": [], "notes": {}, "edits": {}})
    hidden = set(ov.get("hidden", []))
    pinned = set(ov.get("pinned", []))
    edits = ov.get("edits", {})
    out = []
    for a in arts:
        if a["id"] in hidden:
            continue
        if a["id"] in edits:
            a = dict(a, **edits[a["id"]])
        a["pin"] = a["id"] in pinned
        out.append(a)
    out.sort(key=lambda a: a.get("ts", a["date"]), reverse=True)
    return out, files


def weight(a):
    return a.get("score", 0) + 1.5 * len(a.get("also", [])) + (5 if a.get("pin") else 0)


def first_line(a, n=150):
    sm = (a.get("summary") or "").strip()
    if sm:
        m = re.split(r"(?<=[.!?。])\s+|(?<=다\.)\s*", sm)
        line = (m[0] if m and m[0] else sm).strip()
        return line[:n] + ("…" if len(line) > n else "")
    return ""


def digest(items, k):
    """대표 기사를 분야가 겹치지 않게 고른 요약 목록."""
    ranked = sorted(items, key=weight, reverse=True)
    out, used = [], set()
    for d in ("lis", "wpn", "fcst"):
        a = next((x for x in ranked if d in x.get("domains", []) and x["id"] not in used), None)
        if a and len(out) < k:
            out.append(a)
            used.add(a["id"])
    for a in ranked:
        if len(out) >= k:
            break
        if a["id"] not in used:
            out.append(a)
            used.add(a["id"])
    out.sort(key=weight, reverse=True)
    return [{"id": a["id"], "t": a["title"], "s": first_line(a), "r": a.get("region", "etc"),
             "d": (a.get("domains") or [""])[0], "k": a.get("kind", "news"), "src": a.get("source", ""),
             "also": len(a.get("also", []))} for a in out]


def summarize(items):
    cats = Counter(c for a in items for c in a.get("cats", []))
    kw = Counter(k for a in items for k in a.get("kw", []))
    ents = Counter(e for a in items for e in a.get("ents", []))
    axes = Counter(x for a in items for x in a.get("axes", []))
    srcs = Counter(a.get("source", "") for a in items)
    regions = Counter(a.get("region", "etc") for a in items)
    doms = Counter(d for a in items for d in a.get("domains", []))
    kinds = Counter(a.get("kind", "news") for a in items)
    rd = Counter(f"{a.get('region', 'etc')}:{d}" for a in items for d in a.get("domains", []))
    top = sorted(items, key=weight, reverse=True)[:8]
    return {
        "n": len(items),
        "ko": sum(1 for a in items if a.get("lang") == "ko"),
        "en": sum(1 for a in items if a.get("lang") != "ko"),
        "cats": dict(cats.most_common()),
        "kw": kw.most_common(15),
        "ents": ents.most_common(12),
        "axes": dict(axes),
        "sources": srcs.most_common(8),
        "top": [a["id"] for a in top],
        "digest": digest(items, 6),
        "regions": dict(regions), "domains": dict(doms), "kinds": dict(kinds), "rd": dict(rd),
    }


def rising(cur, prev):
    pk = dict(prev.get("kw", [])) if prev else {}
    out = []
    for k, n in cur.get("kw", []):
        d = n - pk.get(k, 0)
        if d > 0:
            out.append([k, d, pk.get(k, 0) == 0])
    out.sort(key=lambda x: (-x[1], x[0]))
    return out[:6]


def brief_text(unit_label, s, prev, by_id):
    """규칙 기반 자동 브리핑(한국어)."""
    if s["n"] == 0:
        return f"{unit_label} 수집된 관련 기사가 없습니다."
    parts = []
    head = f"{unit_label} 관련 기사 {s['n']}건(국내 {s['ko']}·해외 {s['en']})"
    if prev and prev.get("n"):
        diff = s["n"] - prev["n"]
        pct = round(diff / prev["n"] * 100)
        head += f", 직전 대비 {'+' if diff >= 0 else ''}{diff}건({'+' if pct >= 0 else ''}{pct}%)"
    parts.append(head + ".")
    rg = s.get("regions", {})
    if rg:
        parts.append("지역별 " + " · ".join(f"{T.REGION_NAME[r]} {rg[r]}" for r in ("us", "eu", "kr", "etc") if rg.get(r)) + "건.")
    if s.get("kinds", {}).get("contract"):
        parts.append(f"신규 사업·계약 관련 {s['kinds']['contract']}건.")
    cats = list(s["cats"].items())[:3]
    if cats:
        parts.append("주요 주제는 " + ", ".join(f"{CAT_NAME.get(c, c)}({n})" for c, n in cats) + ".")
    kws = [k for k, _ in s["kw"][:5]]
    if kws:
        parts.append("핵심어: " + "·".join(kws) + ".")
    r = s.get("rising") or []
    new = [k for k, _, isnew in r if isnew][:3]
    if new:
        parts.append("새로 등장한 키워드: " + "·".join(new) + ".")
    ax = s.get("axes", {})
    if ax:
        parts.append("과제 연계: " + ", ".join(f"{AXIS_NAME[x]} {n}건" for x, n in sorted(ax.items(), key=lambda t: -t[1])) + ".")
    if s["top"]:
        a = by_id[s["top"][0]]
        parts.append(f"대표 기사: 「{a['title']}」({a.get('source', '')}).")
    return " ".join(parts)


# ---------- 선택: Claude 브리핑 ----------
def ai_brief(kind, label, items):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not items:
        return None
    model = os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5-5"
    lines = [f"- [{a['date']}] {a['title']} ({a.get('source', '')}) {a.get('summary', '')[:200]}" for a in items[:40]]
    prompt = (
        f"다음은 '{label}' 동안 수집한 국방 군수정보체계·군수 AI·정비·물류 관련 기사 목록입니다.\n"
        "국방군수통합정보체계 관점에서 핵심 동향을 한국어 개조식 4~6줄로 정리하고, "
        "마지막 줄에 '시사점:'으로 무기체계 신뢰도(RAM)·수리부속 수요예측·정비인력 예측 과제에 주는 의미를 1~2문장 쓰세요. "
        "기사에 없는 사실은 쓰지 마세요.\n\n" + "\n".join(lines))
    body = json.dumps({"model": model, "max_tokens": 700,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            res = json.loads(r.read())
        return "".join(b.get("text", "") for b in res.get("content", [])).strip()
    except Exception as e:  # noqa: BLE001
        print(f"  ! AI 브리핑 실패({kind} {label}): {e}", file=sys.stderr)
        return None


def main():
    arts, files = load_all()
    by_id = {a["id"]: a for a in arts}
    now = now_kst()
    today = now.date()

    groups = {"day": defaultdict(list), "week": defaultdict(list), "month": defaultdict(list), "year": defaultdict(list)}
    for a in arts:
        d = to_date(a["date"])
        groups["day"][a["date"]].append(a)
        groups["week"][week_key(d)].append(a)
        groups["month"][a["date"][:7]].append(a)
        groups["year"][a["date"][:4]].append(a)

    def label(kind, k):
        if kind == "day":
            d = to_date(k)
            return f"{d.year}년 {d.month}월 {d.day}일"
        if kind == "week":
            s, e = week_range(k)
            return f"{s.year}년 {k.split('-W')[1]}주차({s.month}.{s.day}~{e.month}.{e.day})"
        if kind == "month":
            return f"{k[:4]}년 {int(k[5:])}월"
        return f"{k}년"

    def prev_key(kind, k):
        if kind == "day":
            return (to_date(k) - timedelta(days=1)).isoformat()
        if kind == "week":
            s, _ = week_range(k)
            return week_key(s - timedelta(days=7))
        if kind == "month":
            y, m = int(k[:4]), int(k[5:])
            y, m = (y - 1, 12) if m == 1 else (y, m - 1)
            return f"{y}-{m:02d}"
        return str(int(k) - 1)

    periods = {}
    unit_word = {"day": "이날", "week": "이번 주", "month": "이번 달", "year": "올해"}
    for kind, g in groups.items():
        out = {}
        sums = {k: summarize(v) for k, v in g.items()}
        for k in sorted(g):
            s = sums[k]
            pk = prev_key(kind, k)
            prev = sums.get(pk)
            s["rising"] = rising(s, prev)
            s["prev_n"] = prev["n"] if prev else 0
            s["label"] = label(kind, k)
            if kind == "week":
                a0, a1 = week_range(k)
                s["start"], s["end"] = a0.isoformat(), a1.isoformat()
            word = unit_word[kind] if k in (today.isoformat(), week_key(today), today.strftime("%Y-%m"), str(today.year)) else s["label"]
            s["brief"] = brief_text(word if word != s["label"] else s["label"] + "에", s, prev, by_id)
            out[k] = s
        periods[kind] = out

    # 선택: AI 브리핑(최신 기간만, 기사 구성이 바뀐 경우에만 다시 생성)
    cache = load_json(DATA / "ai_briefs.json", {})
    if os.environ.get("ANTHROPIC_API_KEY"):
        for kind, recent in (("day", 7), ("week", 4), ("month", 1), ("year", 1)):
            for k in sorted(periods[kind])[-recent:]:
                items = sorted(groups[kind][k], key=weight, reverse=True)
                h = hashlib.sha1("|".join(sorted(a["id"] for a in items)).encode()).hexdigest()[:10]
                ck = f"{kind}:{k}"
                if cache.get(ck, {}).get("h") != h and not cache.get(ck, {}).get("manual"):
                    txt = ai_brief(kind, periods[kind][k]["label"], items)
                    if txt:
                        cache[ck] = {"h": h, "text": txt, "at": now.strftime("%Y-%m-%d %H:%M")}
        save_json(DATA / "ai_briefs.json", cache)
    for ck, v in cache.items():
        kind, k = ck.split(":", 1)
        if k in periods.get(kind, {}):
            periods[kind][k]["ai"] = v["text"]
            periods[kind][k]["ai_by"] = v.get("by", "Claude")

    # ---------- 추이 ----------
    months = sorted(groups["month"])
    # 최근 24개월 연속 축
    last = today.replace(day=1)
    axis_m = []
    y, m = last.year, last.month
    for _ in range(24):
        axis_m.append(f"{y}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    axis_m.reverse()
    axis_w = []
    d0 = today - timedelta(days=today.weekday())
    for i in range(25, -1, -1):
        axis_w.append(week_key(d0 - timedelta(days=7 * i)))

    def series(axis, kind, fn):
        return [fn(periods[kind].get(k)) for k in axis]

    top_kw = [k for k, _ in Counter(k for a in arts for k in a.get("kw", [])).most_common(24)]
    kw_by_month = {k: [0] * len(axis_m) for k in top_kw}
    kw_by_week = {k: [0] * len(axis_w) for k in top_kw}
    im = {k: i for i, k in enumerate(axis_m)}
    iw = {k: i for i, k in enumerate(axis_w)}
    for a in arts:
        mi, wi = im.get(a["date"][:7]), iw.get(week_key(to_date(a["date"])))
        for k in a.get("kw", []):
            if k in kw_by_month and mi is not None:
                kw_by_month[k][mi] += 1
            if k in kw_by_week and wi is not None:
                kw_by_week[k][wi] += 1

    # 연계망: 키워드·개체 동시출현
    node_c = Counter()
    edge_c = Counter()
    for a in arts:
        nodes = [("k:" + k) for k in a.get("kw", [])] + [("e:" + e) for e in a.get("ents", [])] + [("c:" + c) for c in a.get("cats", [])]
        nodes = sorted(set(nodes))
        node_c.update(nodes)
        for x, y2 in itertools.combinations(nodes, 2):
            edge_c[(x, y2)] += 1
    keep = {n for n, _ in node_c.most_common(70)}
    net_nodes = [{"id": n, "name": n[2:] if not n.startswith("c:") else CAT_NAME.get(n[2:], n[2:]),
                  "type": {"k": "키워드", "e": ENT_TYPE.get(n[2:], "개체"), "c": "주제"}[n[0]], "n": c}
                 for n, c in node_c.items() if n in keep]
    net_links = [{"s": a_, "t": b_, "w": w} for (a_, b_), w in edge_c.items() if a_ in keep and b_ in keep and w >= 1]

    srcs = Counter(a.get("source", "") for a in arts)
    trends = {
        "months": axis_m,
        "weeks": axis_w,
        "weeks_label": [f"{week_range(k)[0].month}/{week_range(k)[0].day}" for k in axis_w],
        "m_total": series(axis_m, "month", lambda s: s["n"] if s else 0),
        "m_ko": series(axis_m, "month", lambda s: s["ko"] if s else 0),
        "m_en": series(axis_m, "month", lambda s: s["en"] if s else 0),
        "w_total": series(axis_w, "week", lambda s: s["n"] if s else 0),
        "m_cats": {c["id"]: series(axis_m, "month", lambda s, cid=c["id"]: (s or {}).get("cats", {}).get(cid, 0)) for c in T.CATEGORIES},
        "w_cats": {c["id"]: series(axis_w, "week", lambda s, cid=c["id"]: (s or {}).get("cats", {}).get(cid, 0)) for c in T.CATEGORIES},
        "m_regions": {r[0]: series(axis_m, "month", lambda s, rid=r[0]: (s or {}).get("regions", {}).get(rid, 0)) for r in T.REGIONS},
        "m_rd": {f"{r[0]}:{d['id']}": series(axis_m, "month", lambda s, k=f"{r[0]}:{d['id']}": (s or {}).get("rd", {}).get(k, 0))
                 for r in T.REGIONS for d in T.DOMAINS},
        "m_axes": {x["id"]: series(axis_m, "month", lambda s, xid=x["id"]: (s or {}).get("axes", {}).get(xid, 0)) for x in T.PROJECT_AXES},
        "kw_month": kw_by_month,
        "kw_week": kw_by_week,
        "net": {"nodes": net_nodes, "links": net_links},
        "sources": srcs.most_common(30),
        "ents": [[e, n, ENT_TYPE.get(e, "")] for e, n in Counter(e for a in arts for e in a.get("ents", [])).most_common(40)],
        "years": sorted(groups["year"]),
    }

    index = {
        "updated": now.strftime("%Y-%m-%d %H:%M"),
        "total": len(arts),
        "first": arts[-1]["date"] if arts else None,
        "last": arts[0]["date"] if arts else None,
        "files": files,
        "months": [[m_, len(groups["month"][m_])] for m_ in months],
        "days": {d: len(v) for d, v in sorted(groups["day"].items())},
        "sources_n": len(srcs),
        "ai": bool(cache),
        "taxonomy": {
            "cats": [{"id": c["id"], "name": c["name"], "color": T.PALETTE[c["color"]], "kw": c["kw"]} for c in T.CATEGORIES],
            "axes": [{"id": a["id"], "name": a["name"], "kw": a["kw"]} for a in T.PROJECT_AXES],
            "keywords": [[k, syn] for k, syn in T.KEYWORDS],
            "regions": [{"id": r[0], "name": r[1], "terms": [t for t, _ in r[2]]} for r in T.REGIONS],
            "domains": [{"id": d["id"], "name": d["name"], "desc": d["desc"], "kw": d["kw"]} for d in T.DOMAINS],
            "kinds": [{"id": k, "name": n, "kw": kw} for k, n, kw in T.KINDS],
            "entities": [[e, t, syn] for e, t, syn in T.ENTITIES],
            "queries": {"ko": T.QUERIES_KO, "en": T.QUERIES_EN},
        },
    }
    save_json(DATA / "index.json", index)
    save_json(DATA / "periods.json", periods, compact=True)
    save_json(DATA / "trends.json", trends, compact=True)
    print(f"기사 {len(arts)}건 · 일 {len(periods['day'])} · 주 {len(periods['week'])} · 월 {len(periods['month'])} · 연 {len(periods['year'])}")


if __name__ == "__main__":
    main()
