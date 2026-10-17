"""주제 분류·키워드·개체 사전.

이 파일만 고치면 수집 범위와 분류가 바뀝니다.
- QUERIES_KO / QUERIES_EN : Google News RSS 검색어
- CATEGORIES : 주제 분류(기사 제목+요약에 키워드가 하나라도 있으면 해당 주제)
- KEYWORDS   : 추이·연계망 분석에 쓰는 표준 키워드(동의어 → 표준어)
- ENTITIES   : 기관·체계·기업 개체(온톨로지 노드)
- PROJECT_AXES : 과제 연계 분석 축(RAM·수리부속·정비인력)
"""

QUERIES_KO = [
    "군수통합정보체계",
    "군수정보체계",
    "국방 군수 AI",
    "국방 정비 인공지능",
    "수리부속 수요예측",
    "국방 예지정비",
    "국방 MRO",
    "군 정비 디지털트윈",
    "국방 물류 스마트",
    "성과기반군수지원 PBL",
    "국방 데이터 플랫폼 군수",
    "군 정비인력 부족",
    "국방부 군수 혁신",
    "무기체계 가동률 정비",
    "국방 AX 인공지능 전환",
]

QUERIES_EN = [
    "military logistics AI",
    "defense predictive maintenance",
    "Defense Logistics Agency AI",
    "military supply chain artificial intelligence",
    "F-35 ODIN logistics",
    "GCSS-Army",
    "military sustainment digital twin",
    "condition-based maintenance military",
    "military spare parts demand forecasting",
    "aircraft readiness maintenance data military",
]

# 관련성 판정: 국방 맥락어 1개 이상 + 주제어 1개 이상
DEFENSE_CONTEXT = [
    "국방", "군수", "육군", "해군", "공군", "해병", "합참", "방위사업청", "방사청", "방산", "무기체계", "전력지원",
    "장병", "부대", "군 ", "軍", "전투", "함정", "전투기", "전차",
    "military", "defense", "defence", "army", "navy", "air force", "marine corps", "pentagon", "dod", "dla",
    "transcom", "warfighter", "sustainment", "f-35", "nato", "armed forces", "department of war",
]

CATEGORIES = [
    {"id": "sys", "name": "군수정보체계·정보화", "color": 0,
     "kw": ["군수통합정보체계", "군수정보체계", "정보체계", "정보시스템", "정보화", "클라우드", "ERP", "전산", "플랫폼",
            "ALIS", "ODIN", "GCSS", "Vantage", "data platform", "cloud", "information system", "enterprise system", "IT system",
            "데이터 허브", "데이터 플랫폼"]},
    {"id": "ai", "name": "AI·데이터 분석", "color": 1,
     "kw": ["AI", "인공지능", "빅데이터", "머신러닝", "딥러닝", "생성형", "LLM", "에이전트", "AX", "디지털 트윈", "디지털트윈",
            "artificial intelligence", "machine learning", "digital twin", "analytics", "algorithm", "agent", "predictive model"]},
    {"id": "ram", "name": "예측정비·신뢰도(RAM)", "color": 2,
     "kw": ["예지정비", "예측정비", "PHM", "CBM", "상태기반", "신뢰도", "가용도", "정비도", "RAM", "가동률", "고장", "수명 예측", "수명예측",
            "predictive maintenance", "condition-based", "reliability", "availability", "readiness", "failure", "prognostic"]},
    {"id": "parts", "name": "수리부속·수요예측", "color": 3,
     "kw": ["수리부속", "부품", "수요예측", "재고", "단종", "DMSMS", "상호융통", "국산화",
            "spare part", "spare parts", "demand forecast", "forecasting", "inventory", "obsolescence", "parts"]},
    {"id": "mro", "name": "정비·MRO·인력", "color": 4,
     "kw": ["정비", "MRO", "창정비", "야전정비", "정비인력", "정비사", "숙련", "정비창",
            "maintenance", "repair", "overhaul", "depot", "maintainer", "technician", "workforce"]},
    {"id": "log", "name": "물류·보급·공급망", "color": 5,
     "kw": ["물류", "보급", "공급망", "수송", "탄약", "급양", "보급창", "물류센터", "PBL", "성과기반",
            "logistics", "supply chain", "supply", "transport", "distribution", "warehouse", "fuel", "contested logistics"]},
    {"id": "policy", "name": "정책·예산·획득", "color": 6,
     "kw": ["예산", "국정감사", "국감", "방위사업청", "방사청", "획득", "법안", "정책", "업무보고", "계획", "로드맵", "국방부 장관",
            "budget", "policy", "acquisition", "congress", "strategy", "roadmap", "GAO"]},
    {"id": "ind", "name": "산업·기업·계약", "color": 7,
     "kw": ["계약", "수주", "투자", "스타트업", "기업", "시장", "협약", "MOU", "업체",
            "contract", "awarded", "raises", "funding", "startup", "market", "partnership", "Series"]},
]

# 표준 키워드: (표준어, [동의어...])
KEYWORDS = [
    ("군수통합정보체계", ["군수통합정보체계", "국방군수통합정보체계"]),
    ("군수정보체계", ["군수정보체계", "logistics information system"]),
    ("AI", ["AI", "인공지능", "artificial intelligence"]),
    ("생성형 AI·에이전트", ["생성형", "LLM", "에이전트", "AI agent", "generative"]),
    ("빅데이터", ["빅데이터", "big data", "데이터 분석", "analytics"]),
    ("머신러닝", ["머신러닝", "딥러닝", "machine learning"]),
    ("디지털 트윈", ["디지털 트윈", "디지털트윈", "digital twin"]),
    ("예측정비", ["예지정비", "예측정비", "predictive maintenance", "PHM", "prognostic"]),
    ("상태기반정비", ["CBM", "상태기반", "condition-based"]),
    ("신뢰도·가용도", ["신뢰도", "가용도", "RAM", "reliability", "availability"]),
    ("가동률·준비태세", ["가동률", "준비태세", "readiness"]),
    ("수리부속", ["수리부속", "spare part", "spare parts"]),
    ("수요예측", ["수요예측", "demand forecast", "forecasting", "예측 분석"]),
    ("재고관리", ["재고", "inventory"]),
    ("단종관리", ["단종", "DMSMS", "obsolescence"]),
    ("MRO", ["MRO", "maintenance, repair", "overhaul"]),
    ("창정비", ["창정비", "depot"]),
    ("정비인력", ["정비인력", "정비사", "숙련", "maintainer", "technician", "workforce"]),
    ("병력 감소", ["병력 감소", "병력감소", "인구절벽", "병력 반토막"]),
    ("스마트 물류", ["스마트 물류", "스마트물류", "물류센터", "AGV", "무인지게차", "warehouse"]),
    ("공급망", ["공급망", "supply chain"]),
    ("성과기반군수지원", ["성과기반", "PBL"]),
    ("클라우드", ["클라우드", "cloud"]),
    ("국방 AX", ["AX", "AI 전환", "AX 스프린트"]),
    ("유무인 복합", ["유무인", "유·무인", "manned-unmanned", "드론", "drone"]),
    ("사이버보안", ["사이버", "보안", "cyber"]),
    ("자율주행 보급", ["자율주행", "autonomous", "무인 수송"]),
    ("3D 프린팅", ["3D 프린팅", "3D프린팅", "적층제조", "additive manufacturing", "3D-printed", "3D printing"]),
    ("ALIS·ODIN", ["ALIS", "ODIN"]),
    ("국산화", ["국산화", "localization"]),
]

# 개체(온톨로지 노드): (표준명, 유형, [표기...])
ENTITIES = [
    ("국방부", "기관", ["국방부", "Ministry of National Defense", "MND"]),
    ("방위사업청", "기관", ["방위사업청", "방사청", "DAPA"]),
    ("육군", "군", ["육군", "육군종합보급창", "육군군수사령부"]),
    ("해군", "군", ["해군"]),
    ("공군", "군", ["공군", "공군군수사령부"]),
    ("해병대", "군", ["해병대"]),
    ("국방기술품질원", "기관", ["국방기술품질원", "기품원"]),
    ("국방전산정보원", "기관", ["국방전산정보원"]),
    ("미 국방부", "해외기관", ["Pentagon", "Department of War", "DoD", "Department of Defense", "DoW"]),
    ("DLA", "해외기관", ["Defense Logistics Agency", "DLA"]),
    ("TRANSCOM", "해외기관", ["TRANSCOM", "Transportation Command"]),
    ("미 육군", "해외기관", ["U.S. Army", "US Army", "Army Futures Command", "CECOM", "Tobyhanna", "미 육군"]),
    ("미 해병대", "해외기관", ["Marine Corps", "USMC"]),
    ("영국 국방부", "해외기관", ["UK Ministry of Defence", "UK MoD", "British Army", "MoD"]),
    ("DIU", "해외기관", ["Defense Innovation Unit", "DIU"]),
    ("KAI", "기업", ["KAI", "한국항공우주", "Korea Aerospace"]),
    ("한화", "기업", ["한화", "Hanwha"]),
    ("LIG", "기업", ["LIG"]),
    ("대한항공", "기업", ["대한항공", "Korean Air"]),
    ("현대로템", "기업", ["현대로템", "Hyundai Rotem"]),
    ("KT", "기업", ["KT"]),
    ("SK텔레콤", "기업", ["SK텔레콤", "SKT"]),
    ("카카오", "기업", ["카카오", "Kakao"]),
    ("삼성SDS", "기업", ["삼성SDS"]),
    ("KCC정보통신", "기업", ["KCC정보통신"]),
    ("Lockheed Martin", "기업", ["Lockheed Martin", "록히드"]),
    ("Leidos", "기업", ["Leidos"]),
    ("Palantir", "기업", ["Palantir", "팔란티어"]),
    ("Gallatin AI", "기업", ["Gallatin"]),
    ("DX KOREA", "행사", ["DX KOREA", "DX코리아"]),
    ("국정감사", "행사", ["국정감사", "국감"]),
    ("F-35", "무기체계", ["F-35"]),
    ("KF-21", "무기체계", ["KF-21"]),
    ("K2 전차", "무기체계", ["K2 전차", "K2전차"]),
]

# 과제 연계 분석 축(국방 AI 과제: 무기체계 RAM 기반 수리부속 예측 + 정비소요인력 예측)
PROJECT_AXES = [
    {"id": "ram", "name": "무기체계 신뢰도(RAM) 분석",
     "kw": ["신뢰도", "가용도", "RAM", "가동률", "고장", "예지정비", "예측정비", "PHM", "CBM", "수명",
            "reliability", "availability", "readiness", "predictive maintenance", "failure", "condition-based"]},
    {"id": "parts", "name": "수리부속 수요예측",
     "kw": ["수리부속", "부품", "수요예측", "재고", "단종", "상호융통",
            "spare part", "demand forecast", "forecasting", "inventory", "obsolescence"]},
    {"id": "manpower", "name": "정비소요인력 예측",
     "kw": ["정비인력", "정비 인력", "정비사", "숙련", "기술인력", "기술 인력", "병력 감소", "병력감소", "병역자원", "병력",
            "maintainer", "maintainers", "workforce", "technician", "manpower"]},
]

PALETTE = ["#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#475569", "#db2777"]
