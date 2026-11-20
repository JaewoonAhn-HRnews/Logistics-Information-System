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


def is_noise(text):
    return bool(any_has(text, getattr(T, "NEGATIVE", [])))


def bigrams(s):
    return {s[i:i + 2] for i in range(max(len(s) - 1, 1))}


def same_story(a, b):
    """같은 사건을 다룬 기사인지(제목 2-gram 유사도 + 공통 개체)."""
    na, nb = norm_title(a["title"]), norm_title(b["title"])
    if similar(na, nb):
        return True
    common = set(a.get("ents", [])) & set(b.get("ents", []))
    if re.search(r"[가-힣]", a["title"]) and re.search(r"[가-힣]", b["title"]):
        ga, gb = bigrams(na), bigrams(nb)
        th, th_c = 0.42, 0.25
    else:
        stop = {"the", "and", "for", "with", "to", "of", "in", "on", "a", "an", "its", "new", "us", "u.s.", "army", "navy", "air", "force"}
        tok = lambda t: {w for w in re.findall(r"[a-z0-9$.\-]+", t.lower()) if len(w) > 2 and w not in stop}
        ga, gb = tok(a["title"]), tok(b["title"])
        th, th_c = 0.5, 0.3
    if not ga or not gb:
        return False
    inter = len(ga & gb)
    j = inter / len(ga | gb)
    contain = inter / min(len(ga), len(gb))  # 짧은 제목이 긴 제목에 거의 포함되면 같은 기사
    return j >= th or (bool(common) and j >= th_c) or (min(len(ga), len(gb)) >= 8 and contain >= 0.8)


def is_relevant(text, ctx_assumed=False, min_score=4.0):
    """국방 맥락(또는 국방 전문 수집원) + 핵심 주제 + 분야 1개 이상 + 점수 기준."""
    if is_noise(text):
        return False
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


# ---------- 출처·분류 신뢰도 ----------
_OFFICIAL = re.compile(r"\.mil\b|\.gov\b|Army\.mil|DLA|GAO|CRS|Congress|Department of|Dept Of|SAM\.gov|D2B|국방전자조달|국방부|방위사업청|국방일보|정책브리핑|합참|육군|해군|공군|해병대|국방기술진흥연구소|국방과학연구소|KIDA|한국국방연구원|NATO|NSPA|European Defence Agency|Ministry of Defence|MoD\b", re.I)
_SPECIAL = re.compile(r"Defense News|Breaking Defense|DefenseScoop|Defense One|Janes|Federal News Network|Military\.com|Military Times|Army Times|Air & Space Forces|National Defense|GovCon|Nextgov|MeriTalk|C4ISRNET|Naval News|UK Defence Journal|Defence Industry Europe|Defense Post|defenceWeb|Army Technology|Shephard|Aviation Week|Flight ?Global|CSIS|RAND|SCSP|Next Gen Defense|뉴스레터|디펜스|국방신문|국방저널|밀리터리|전자신문|아시아투데이 국방|뉴스투데이 국방", re.I)
SRC_TYPE_TIER = {"정부·군": "A", "조달·계약": "A", "감사·연구": "A", "전문지": "B", "싱크탱크": "B", "뉴스레터": "B", "언론": "C"}
TIER_NAME = {"A": "공식 기관", "B": "전문 매체", "C": "일반 언론"}


def source_tier(a, src_types):
    t = src_types.get(a.get("src") or "")
    if t in SRC_TYPE_TIER and a.get("src") not in ("gnews",):
        return SRC_TYPE_TIER[t]
    s = a.get("source", "")
    if _OFFICIAL.search(s):
        return "A"
    if _SPECIAL.search(s):
        return "B"
    return "C"


def class_confidence(a, text):
    """분류 신뢰도: 지역 점수차·분야 근거 키워드 수·관련도 점수로 높음/중간/낮음."""
    _, sc = classify_region(text, a.get("lang", "ko"), a.get("hint"))
    vals = sorted(sc.values(), reverse=True)
    margin = round(vals[0] - (vals[1] if len(vals) > 1 else 0), 1)
    dh = 0
    for d in T.DOMAINS:
        if a.get("domains") and d["id"] == a["domains"][0]:
            dh = len(any_has(text, d["kw"]))
    rel = a.get("score", 0)
    if a.get("origin") == "api":
        margin = max(margin, 5)  # 조달 API는 기관·국가가 구조화된 값
    lv_r = 2 if margin >= 3 else 1 if margin >= 1.5 else 0
    lv_d = 2 if dh >= 2 else 1 if dh == 1 else 0
    lv_s = 2 if rel >= 6 else 1 if rel >= 4 else 0
    lv = min(lv_r, lv_d, lv_s) if lv_d else 0
    if lv == 0 and lv_r + lv_d + lv_s >= 4:
        lv = 1
    return {"lv": ["낮음", "중간", "높음"][lv], "r": margin, "dh": dh, "rel": rel}
