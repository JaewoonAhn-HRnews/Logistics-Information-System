"""공통 유틸: 경로, 키워드 매칭, 분류, 중복 판정."""
import hashlib
import json
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import taxonomy as T

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
NEWS = DATA / "news"
DB = DATA / "db"
KST = timezone(timedelta(hours=9))


def load_json(p, default=None):
    p = Path(p)
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_json(p, obj, compact=False):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


# ---------- 키워드 매칭 ----------
_cache = {}


def _pattern(term):
    if term in _cache:
        return _cache[term]
    if re.search(r"[A-Za-z]", term) and not re.search(r"[가-힣]", term):
        esc = re.escape(term.strip())
        # 짧은 대문자 약어(AI, KT, RAM…)는 대소문자 구분, 나머지는 무시
        flags = 0 if (term.isupper() and len(term) <= 5) else re.IGNORECASE
        pat = re.compile(r"(?<![A-Za-z0-9])" + esc + r"(?![A-Za-z0-9])", flags)
    else:
        pat = re.compile(re.escape(term))
    _cache[term] = pat
    return pat


def has(text, term):
    return bool(_pattern(term).search(text))


def any_has(text, terms):
    return [t for t in terms if has(text, t)]


def classify(text):
    """주제·키워드·개체·과제축 판정."""
    cats = [c["id"] for c in T.CATEGORIES if any_has(text, c["kw"])]
    kws = [k for k, syn in T.KEYWORDS if any_has(text, syn)]
    ents = [e for e, _typ, syn in T.ENTITIES if any_has(text, syn)]
    axes = [a["id"] for a in T.PROJECT_AXES if any_has(text, a["kw"])]
    return cats, kws, ents, axes


_KR_STRIP = re.compile(r"미\s?(육군|해군|공군|해병대|국방부|군)|주한미군|북한|North Korea[n]?")


def classify_region(text, lang="ko", hint=None):
    """지역 하나를 고릅니다: (id, {id: 점수})."""
    sc = {}
    for rid, _name, terms in T.REGIONS:
        t = _KR_STRIP.sub(" ", text) if rid == "kr" else text
        sc[rid] = sum(w for term, w in terms if has(t, term))
    if lang == "ko":
        sc["kr"] += 1.5
    if hint in sc:
        sc[hint] += 2.5
    best = max(sc, key=lambda k: (sc[k], k == hint, k == "us"))
    if sc[best] <= 0:
        best = hint or ("kr" if lang == "ko" else "etc")
    return best, sc


def classify_domains(text):
    hits = []
    for d in T.DOMAINS:
        n = len(any_has(text, d["kw"]))
        if n:
            hits.append((n, d["id"]))
    hits.sort(key=lambda x: -x[0])
    return [h[1] for h in hits]


def classify_kind(text):
    for kid, _n, terms in T.KINDS:
        if any_has(text, terms):
            return kid
    return "news"


def full_classify(text, lang="ko", hint=None):
    cats, kws, ents, axes = classify(text)
    region, _ = classify_region(text, lang, hint)
    return {"cats": cats, "kw": kws, "ents": ents, "axes": axes, "region": region,
            "domains": classify_domains(text), "kind": classify_kind(text)}


def relevance(text):
    """국방 맥락 + 주제 키워드 기반 관련성 점수(0~10)."""
    ctx = len(any_has(text, T.DEFENSE_CONTEXT))
    cats, kws, ents, axes = classify(text)
    core = {"sys", "ram", "parts", "mro", "log"}
    s = 0.0
    s += min(ctx, 3) * 1.0
    s += len(set(cats) & core) * 1.5
    s += 0.5 * min(len(kws), 6)
    s += 1.0 * len(axes)
    if "군수통합정보체계" in kws or "군수정보체계" in kws:
        s += 3
    return round(min(s, 10.0), 1), ctx


def is_relevant(text, ctx_assumed=False, min_score=4.0):
    """국방 맥락(또는 국방 전문 수집원) + 핵심 주제 + 분야 1개 이상 + 점수 기준."""
    s, ctx = relevance(text)
    if ctx_assumed:
        s += 1.0
    cats, _, _, _ = classify(text)
    core = {"sys", "ram", "parts", "mro", "log"}
    return (ctx > 0 or ctx_assumed) and bool(set(cats) & core) and bool(classify_domains(text)) and s >= min_score


# ---------- 정규화·중복 ----------
def norm_title(t):
    t = unicodedata.normalize("NFKC", t or "")
    t = re.sub(r"\s+-\s+[^-]{1,40}$", "", t)  # " - 언론사" 꼬리 제거
    t = re.sub(r"[\[\(【<].{0,12}?[\]\)】>]", " ", t)  # [단독] (종합) 등
    t = re.sub(r"[^0-9A-Za-z가-힣]+", "", t).lower()
    return t


def grams(s, n=3):
    return {s[i:i + n] for i in range(max(len(s) - n + 1, 1))}


def similar(a, b, th=0.55):
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return False
    return len(ga & gb) / len(ga | gb) >= th


def make_id(title, url=""):
    return hashlib.sha1((norm_title(title) or url).encode("utf-8")).hexdigest()[:12]


# ---------- 기간 키 ----------
def week_key(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_range(key):
    y, w = key.split("-W")
    start = date.fromisocalendar(int(y), int(w), 1)
    return start, start + timedelta(days=6)


def to_date(s):
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def now_kst():
    return datetime.now(KST)
