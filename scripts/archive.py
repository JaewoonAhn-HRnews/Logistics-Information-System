"""아카이브 연계(온톨로지 기반 관련 기사 추적).

수집 기사 + 국방 AI 뉴스레터 아카이브(77개 호, 900여 건)를 한 말뭉치로 보고,
기사마다 '같은 기관·기업·사업·체계·정책'을 공유하는 과거 기사를 찾아 시간순 흐름을 만듭니다.

- 개념(온톨로지): taxonomy.LINK_ENTITIES(직접 정리) + 뉴스레터 기사 키워드(2회 이상 등장)
- 연결 점수: 공유 개념의 희소도(idf) 합. 흔한 개념(국방부·육군·AI 등)은 점수가 낮아 혼자서는 연결되지 않음
- 결과: data/archive_links.json  {기사id: {"l": [과거 연계 기사], "n": 누적 관련 수, "since": 최초일, "terms": 핵심 개념}}
        data/archive_index.json  아카이브 화면용(호 목록, 개념 스레드)
"""
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, timedelta

import taxonomy as T
from common import DATA, load_json, save_json

STOP = {
    "ai", "인공지능", "국방부", "미국방부", "육군", "해군", "공군", "해병대", "미군", "미육군", "국방", "군", "자동화", "드론", "중국",
    "우크라이나", "러시아", "미국", "사이버보안", "클라우드", "거버넌스", "디지털전환", "국가안보", "aidoption", "ai도입", "cio", "llm",
    "fy2026", "fy2027", "fy2025", "생성형ai", "ai거버넌스", "데이터", "보안", "예산", "획득", "연방정부", "ai활용", "기술", "전략",
    "혁신", "국방예산", "공급망", "supplychain", "물류", "군수", "정비", "logistics", "maintenance", "정책", "인력", "교육", "훈련", "dod", "pentagon", "펜타곤", "ai전략", "ai인프라", "it현대화", "ai보안",
}
WEAK_ENT = {"국방부", "육군", "해군", "공군", "해병대", "미 국방부", "미 육군", "미 해병대", "영국 국방부", "국정감사", "KT"}
MIN_SCORE = 4.5      # 연결 최소 점수(idf 합)
MAX_LINKS = 5
TARGET_DAYS = 75     # 연계를 계산할 최근 기사 범위(일)


def nkey(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    return re.sub(r"[\s\-·_./'’\"()]+", "", s)


def _rx(term):
    t = term.strip()
    if re.search(r"[가-힣]", t):
        return None  # 한글은 공백 제거 부분일치
    flags = 0 if (t.isupper() and len(t) <= 5) else re.I
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])", flags)


class Onto:
    def __init__(self, nl_articles):
        self.terms = {}      # canonical -> [(regex|None, nkey)]
        self.alias = {}      # nkey -> canonical
        self.kind = {}
        for name, typ, syn in T.LINK_ENTITIES:
            self._add(name, typ, [name] + syn)
        for name, typ, syn in T.ENTITIES:
            if name in WEAK_ENT:
                continue
            self._add(name, {"해외기관": "기관", "무기체계": "체계", "행사": "키워드"}.get(typ, typ), [name] + syn)
        # 뉴스레터 키워드 사전(2회 이상)
        cnt = Counter()
        disp = {}
        for a in nl_articles:
            for k in set(a.get("kw", [])):
                nk = nkey(k)
                if len(nk) < 2 or nk in STOP:
                    continue
                cnt[nk] += 1
                disp.setdefault(nk, k.strip())
        for nk, c in cnt.items():
            if c < 2 or nk in self.alias:
                continue
            k = disp[nk]
            if len(nk) < 3 and not (k.isupper() and len(k) >= 2):
                continue
            self._add(k, "키워드", [k])

    def _add(self, name, typ, syns):
        canon = self.alias.get(nkey(name), name)
        self.kind.setdefault(canon, typ)
        lst = self.terms.setdefault(canon, [])
        for s in syns:
            nk = nkey(s)
            if not nk:
                continue
            self.alias.setdefault(nk, canon)
            lst.append((_rx(s), nk))

    def match(self, text, kws=()):
        flat = nkey(text)
        out = set()
        for canon, pats in self.terms.items():
            for rx, nk in pats:
                if rx is None:
                    if len(nk) >= 2 and nk in flat:
                        out.add(canon)
                        break
                elif rx.search(text):
                    out.add(canon)
                    break
        for k in kws:
            c = self.alias.get(nkey(k))
            if c:
                out.add(c)
        out = {t for t in out if nkey(t) not in STOP}
        ks = {t: nkey(t) for t in out}
        # 다른 개념에 포함되는 짧은 표기(이란전 ⊂ 이란전쟁)는 하나로
        return {t for t in out if not any(o != t and ks[t] != ks[o] and ks[t] in ks[o] for o in out)}


def _doc_ours(a, sums):
    s = sums.get(a["id"], {})
    return {
        "id": a["id"], "date": a["date"], "t": s.get("h") or a["title"], "s": a.get("source", ""), "u": a.get("url", ""),
        "nl": None, "text": " ".join([a.get("title", ""), a.get("summary", ""), a.get("ai_sum", "") or s.get("s", ""),
                                      " ".join(a.get("kw", [])), " ".join(a.get("ents", []))]),
        "kws": a.get("ents", []), "origin": a.get("origin", ""),
    }


def _doc_nl(a):
    return {
        "id": a["id"], "date": a["date"], "t": a.get("title_kr") or a["title"], "s": a.get("source", ""), "u": a.get("url", ""),
        "nl": a.get("nl"), "text": " ".join([a.get("title", ""), a.get("title_kr", ""), a.get("topic", ""), a.get("summary", "")]),
        "kws": a.get("kw", []), "origin": "nl", "topic": a.get("topic", ""),
    }


def build(arts, today, sums=None):
    sums = sums or {}
    nl = load_json(DATA / "nl_archive.json", {"issues": [], "articles": []})
    onto = Onto(nl["articles"])
    nl_urls = {a["url"] for a in nl["articles"]}
    docs = [_doc_nl(a) for a in nl["articles"]]
    # 뉴스레터에서 들여온 기사(origin=nl)는 원본과 중복이므로 말뭉치에는 원본만
    docs += [_doc_ours(a, sums) for a in arts if a.get("origin") not in ("api",) and not (a.get("origin") == "nl" and a.get("url") in nl_urls)]
    for d in docs:
        d["terms"] = onto.match(d["text"], d["kws"])
        # 같은 보도 주기(3일 이내)는 '과거 흐름'이 아니라 동시 보도로 보고 제외
        d["cut"] = (date.fromisoformat(d["date"]) - timedelta(days=3)).isoformat()
    first_seen = {}
    for d in docs:
        for t in d["terms"]:
            if t not in first_seen or d["date"] < first_seen[t]:
                first_seen[t] = d["date"]
    df = Counter(t for d in docs for t in d["terms"])
    N = len(docs)
    idf = {t: math.log((N + 1) / (c + 0.5)) for t, c in df.items()}
    inv = defaultdict(list)
    for i, d in enumerate(docs):
        for t in d["terms"]:
            inv[t].append(i)

    def strong(t):
        return onto.kind.get(t) in ("기관", "조직", "체계", "사업", "기업", "인물", "제도", "정책")

    def related(d, before_only=True):
        sc = Counter()
        shared = defaultdict(list)
        for t in d["terms"]:
            if df[t] > N * 0.08:
                continue
            for j in inv[t]:
                o = docs[j]
                if o["id"] == d["id"] or (before_only and o["date"] >= d["cut"]):
                    continue
                sc[j] += idf[t]
                shared[j].append(t)
        res = []
        for j, s in sc.items():
            o = docs[j]
            if o["u"] and o["u"] == d["u"]:
                continue
            has_strong = any(strong(t) for t in shared[j])
            if not ((has_strong and s >= 3.0) or (len(shared[j]) >= 2 and s >= MIN_SCORE)):
                continue
            res.append((s, o, sorted(shared[j], key=lambda t: -idf[t])))
        return res

    cut = (today - timedelta(days=TARGET_DAYS)).isoformat()
    links = {}
    for d in docs:
        if d["origin"] == "nl" or d["date"] < cut:
            continue
        res = related(d)
        if not res:
            # 핵심 개념이 모두 이번 보도 주기에 처음 나온 경우만 '최초 등장'
            new = bool(d["terms"]) and all(first_seen[t] >= d["cut"] for t in d["terms"])
            links[d["id"]] = {"n": 0, "first": new, "terms": sorted(d["terms"], key=lambda t: -idf.get(t, 0))[:4]}
            continue
        # 같은 출처 URL/같은 날 중복 제거 후 상위 점수
        res.sort(key=lambda x: -x[0])
        pick, seen = [], set()
        for s, o, sh in res:
            k = o["t"][:30]
            if k in seen or (o["u"] and o["u"] in seen):
                continue
            seen.update({k, o["u"]})
            pick.append((s, o, sh))
            if len(pick) >= MAX_LINKS:
                break
        pick.sort(key=lambda x: x[1]["date"])
        top = Counter(t for _, _, sh in res for t in sh[:2])
        links[d["id"]] = {
            "n": len(res), "since": min(o["date"] for _, o, _ in res),
            "terms": [t for t, _ in top.most_common(3)],
            "l": [{"d": o["date"], "t": o["t"][:90], "s": o["s"], "u": o["u"], "nl": o["nl"], "id": o["id"] if o["origin"] != "nl" else None,
                   "k": sh[:3]} for _, o, sh in pick],
        }
    save_json(DATA / "archive_links.json", links, compact=True)

    # ---------- 아카이브 화면: 개념 스레드 ----------
    recent = (today - timedelta(days=120)).isoformat()
    hot = Counter()
    for d in docs:
        if d["date"] >= recent:
            for t in d["terms"]:
                if 2 <= df[t] <= N * 0.12 and onto.kind.get(t) != "키워드":
                    hot[t] += 1
    threads = []
    for t, c in hot.most_common(40):
        ds, su = [], set()
        for o in sorted((docs[j] for j in inv[t]), key=lambda o: (o["date"], o["origin"] != "nl")):
            if o["u"] and o["u"] in su:
                continue
            su.add(o["u"])
            ds.append(o)
        months = Counter(o["date"][:7] for o in ds)
        y, m = int(ds[0]["date"][:4]), int(ds[0]["date"][5:7])
        while (y, m) <= (today.year, today.month):
            months.setdefault(f"{y}-{m:02d}", 0)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        show = ds if len(ds) <= 16 else ds[:2] + ds[-14:]
        threads.append({
            "t": t, "type": onto.kind.get(t, "키워드"), "n": len(ds), "recent": c, "since": ds[0]["date"], "last": ds[-1]["date"],
            "m": dict(sorted(months.items())),
            "items": [{"d": o["date"], "t": o["t"][:90], "s": o["s"], "u": o["u"], "nl": o["nl"],
                       "id": o["id"] if o["origin"] != "nl" else None} for o in show], "gap": len(ds) - len(show),
        })
    nl_terms = Counter(t for d in docs if d["origin"] == "nl" for t in d["terms"])
    issues = []
    for i in nl["issues"]:
        arts_i = [d for d in docs if d["origin"] == "nl" and d["nl"] == i["id"]]
        issues.append({
            "id": i["id"], "period": i["period"], "date": i["date"], "theme": i["theme"], "insights": i["insights"],
            "items": [{"d": d["date"], "t": d["t"][:80], "s": d["s"], "u": d["u"]} for d in arts_i],
        })
    save_json(DATA / "archive_index.json", {
        "site": nl.get("site"), "repo": nl.get("repo"), "n_docs": N, "n_nl": len(nl["articles"]), "n_issues": len(nl["issues"]),
        "n_terms": len(df), "threads": threads, "issues": issues,
    }, compact=True)
    print(f"- 아카이브 연계: 말뭉치 {N}건, 개념 {len(df)}개, 연계 계산 {len(links)}건(연결 {sum(1 for v in links.values() if v['n'])}건), 스레드 {len(threads)}개")
    return links, {"onto": onto, "docs": docs, "idf": idf, "related": related}


def theme_chain(ids, links, k=5):
    """주간 브리핑 주제(여러 기사)의 과거 연계를 합쳐 시간순 상위 k개."""
    pool = {}
    n = 0
    since = None
    terms = Counter()
    for i in ids:
        v = links.get(i)
        if not v:
            continue
        n = max(n, v.get("n", 0))
        if v.get("since"):
            since = min(since or v["since"], v["since"])
        for t in v.get("terms", []):
            terms[t] += 1
        for x in v.get("l", []):
            key = x["t"][:30]
            if key not in pool:
                pool[key] = x
    items = sorted(pool.values(), key=lambda x: x["d"])
    # 다양한 시점이 보이도록: 가장 오래된 것 + 최근 것 위주
    if len(items) > k:
        items = [items[0]] + items[-(k - 1):]
    return {"l": items, "n": n, "since": since, "terms": [t for t, _ in terms.most_common(3)]}
