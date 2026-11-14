"""국방기술 지식베이스(국방기술기획서·전력지원체계 소요기획서) 연계.

data/kb/kb.json(첨부 문서에서 추출한 세부기술 300·핵심기술 과제 404·전력지원체계 분야 17·주요과제 36)을
기사와 비교해 '기술 연계성·과제 연계성'을 찾습니다.
- 방식: 한글 2글자 조각 + 영문 단어 TF-IDF 코사인 유사도(영문 기사는 군수 용어를 한글로 보강)
- 결과: data/kb_links.json {기사id: [{"id": 항목id, "s": 점수}]}  (최근 120일 기사)
"""
import math
import re
from collections import Counter, defaultdict
from datetime import timedelta

from common import DATA, load_json, save_json

EN2KO = {
    "predictive maintenance": "예지정비 예측정비 고장 예측", "condition-based": "상태기반 정비 CBM+", "cbm": "상태기반 정비 예지정비",
    "phm": "예지정비 고장 예측", "digital twin": "디지털 트윈", "spare part": "수리부속 부품", "parts": "부품 수리부속",
    "supply chain": "공급망 군수", "demand": "소요예측 수요 예측", "forecast": "예측", "inventory": "재고 관리", "logistics": "군수 군수지원",
    "maintenance": "정비", "sustainment": "군수지원 정비 유지", "readiness": "가동률 준비태세", "munition": "탄약", "ammunition": "탄약",
    "additive manufacturing": "적층제조 3D 프린팅", "3d print": "3D 프린팅 적층제조", "autonomous": "자율 무인", "drone": "드론 무인기",
    "unmanned": "무인", "uas": "무인기", "ugv": "무인지상차량 지상로봇", "robot": "로봇", "convoy": "수송 보급", "resupply": "보급 수송",
    "transport": "수송", "fuel": "유류 연료", "battery": "전지 배터리", "energy": "에너지 전원", "hydrogen": "수소",
    "data": "데이터", "cloud": "클라우드", "edge": "엣지", "artificial intelligence": "인공지능", " ai ": " 인공지능 AI ",
    "machine learning": "기계학습 인공지능", "large language model": "거대언어모델", "llm": "거대언어모델", "agent": "에이전트",
    "decision": "의사결정 결심", "command and control": "지휘통제", "cyber": "사이버 보안", "zero trust": "제로트러스트 보안",
    "quantum": "양자", "satellite": "위성", "space": "우주", "sensor": "센서", "radar": "레이더", "workforce": "인력 인재",
    "personnel": "인사 인력", "training": "교육훈련", "medical": "의무 의료", "erp": "전사적자원관리 ERP 군수정보체계",
    "helicopter": "헬기 항공기", "aircraft": "항공기", "ship": "함정", "shipyard": "함정 정비", "vehicle": "차량", "tank": "전차 궤도차량",
    "simulation": "모의 시뮬레이션", "virtual reality": "가상현실 VR", "augmented reality": "증강현실 AR", "wearable": "웨어러블 착용형",
    "exoskeleton": "근력보조 웨어러블 로봇", "counter-drone": "대드론", "c-uas": "대드론",
}
STOP = set("기술 개발 하는 위한 위해 있는 통한 대한 으로 에서 이를 및 등 과제 연구 사업 체계 확보 가능 기반 활용 적용 관련 필요 성능 운용 다양 요구 하여 하고 되는 대응 군의 우리 해당 방안 수행 따라 통해 이며 이다 했다 한다 있다 밝혔 지난 올해 이번 국방 무기 무기체 기체 전력".split())
MIN = 0.16


def toks(text):
    t = " " + (text or "").lower() + " "
    for en, ko in EN2KO.items():
        if en in t:
            t += " " + ko
    out = []
    for w in re.findall(r"[a-z][a-z0-9+\-]{2,}", t):
        out.append("w:" + w)
    for seg in re.findall(r"[가-힣]+", t):
        for i in range(len(seg) - 1):
            bg = seg[i:i + 2]
            if bg not in STOP:
                out.append(bg)
    return out


def entries(kb):
    E = []
    for t in kb["tech"]:
        E.append((t["id"], "tech", f"{t['area']} {t['mid']} {t['name']} {t['name']} {t['desc']}"))
    for t in kb["tasks"]:
        E.append((t["id"], "task", f"{t['name']} {t['name']} {t['sub']} {t['summary']} {t['items']}"))
    for t in kb["stasks"]:
        E.append((t["id"], "stask", f"{t['field']} {t['name']} {t['name']} {t['summary']} {t['need']}"))
    for f in kb["sfields"]:
        for j, x in enumerate(f["tech"]):
            E.append((f"{f['id']}-{j + 1}", "sfield", f"{f['field']} {x['t']} {x['t']} {x['d']}"))
    return E


class Index:
    def __init__(self, kb):
        self.E = entries(kb)
        docs = [Counter(toks(x[2])) for x in self.E]
        df = Counter(t for d in docs for t in d)
        N = len(docs)
        self.idf = {t: math.log((N + 1) / (c + 1)) + 1 for t, c in df.items()}
        self.vec = []
        self.inv = defaultdict(list)
        for i, d in enumerate(docs):
            v = {t: (1 + math.log(c)) * self.idf[t] for t, c in d.items()}
            n = math.sqrt(sum(x * x for x in v.values())) or 1
            v = {t: x / n for t, x in v.items()}
            self.vec.append(v)
            for t, x in v.items():
                self.inv[t].append((i, x))

    def query(self, text, k=8):
        d = Counter(toks(text))
        v = {t: (1 + math.log(c)) * self.idf[t] for t, c in d.items() if t in self.idf}
        n = math.sqrt(sum(x * x for x in v.values())) or 1
        sc = Counter()
        for t, x in v.items():
            for i, y in self.inv[t]:
                sc[i] += x / n * y
        return [(self.E[i][0], self.E[i][1], s) for i, s in sc.most_common(k)]


def art_text(a, sums):
    s = sums.get(a["id"], {})
    return " ".join([a.get("title", ""), s.get("h", ""), s.get("s", ""), " ".join(s.get("p", []) or []), a.get("ai_sum", ""), a.get("summary", "")[:600]])


def build(arts, today, sums):
    kb = load_json(DATA / "kb" / "kb.json", None)
    if not kb:
        return {}, None
    ix = Index(kb)
    cut = (today - timedelta(days=120)).isoformat()
    links = {}
    for a in arts:
        if a["date"] < cut or a.get("origin") == "api":
            continue
        res, per = [], Counter()
        for eid, typ, s in ix.query(art_text(a, sums), 10):
            if s < MIN or per[typ] >= 2:
                continue
            per[typ] += 1
            res.append({"id": eid, "s": round(s, 3)})
            if len(res) >= 4:
                break
        if res:
            links[a["id"]] = res
    lite = {"docs": kb["docs"],
            "tech": [dict(t, desc=t["desc"][:160]) for t in kb["tech"]],
            "tasks": [{k: (v[:160] if k in ("summary", "items") else v) for k, v in t.items()} for t in kb["tasks"]],
            "stasks": [dict(t, summary=t["summary"][:180], need=t["need"][:160]) for t in kb["stasks"]],
            "sfields": [{"id": f["id"], "field": f["field"], "intro": f["intro"][:240], "tech": [{"t": x["t"], "d": x["d"][:150]} for x in f["tech"]], "dir": f["dir"][:300]} for f in kb["sfields"]]}
    save_json(DATA / "kb" / "kb_lite.json", lite, compact=True)
    print(f"- 국방기술 지식베이스 연계: 기사 {len(links)}건에 연결")
    return links, ix


def describe(kb, eid):
    """프롬프트·화면용 한 줄 설명."""
    p = eid.split("-")
    if eid.startswith("T-"):
        t = next((x for x in kb["tech"] if x["id"] == eid), None)
        return t and f"[국방기술기획서·{t['area']}] {t['mid']} > {t['code']} {t['name']}: {t['desc'][:90]}"
    if eid.startswith("K-"):
        t = next((x for x in kb["tasks"] if x["id"] == eid), None)
        return t and f"[국방기술 과제 {t['no']}·{t['sec']}] {t['name']} ({t['period']}, {t['budget']}억원, {t['org']}): {t['summary'][:80]}"
    if eid.startswith("S-"):
        t = next((x for x in kb["stasks"] if x["id"] == eid), None)
        return t and f"[전력지원체계 소요·{t['field']}] {t['name']}({t['kind']}): {t['summary'][:90]}"
    if eid.startswith("F-") and len(p) == 3:
        f = next((x for x in kb["sfields"] if x["id"] == f"F-{p[1]}"), None)
        if f and int(p[2]) <= len(f["tech"]):
            x = f["tech"][int(p[2]) - 1]
            return f"[전력지원체계 주요기술·{f['field']}] {x['t']}: {x['d'][:90]}"
    return None
