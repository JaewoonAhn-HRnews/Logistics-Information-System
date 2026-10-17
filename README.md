# 군수정보 인텔리전스

국방군수통합정보체계, 군수 AI, 예측정비, 수리부속 수요예측, 정비인력, 스마트 물류 관련 국내외 뉴스를 **매일 자동 수집**하고 **일·주·월·연 단위로 누적 정리·분석**하는 정적 웹사이트입니다. 서버 없이 GitHub Pages + GitHub Actions로 돌아갑니다.

## 화면 구성

| 메뉴 | 내용 |
|---|---|
| 첫 화면 | 회전 지구본·보급선·HUD 첨단 이미지, 누적 지표, 최신 기사 티커, 오늘의 브리핑, 3대 과제 축 |
| 일간 뉴스 | 날짜 선택(달력 열지도), 그날 기사·자동 브리핑·주제·키워드·대표 기사 |
| 주간 / 월간 / 연간 정리 | 기간별 건수·직전 대비 증감, 새로 등장한 키워드, 주제 분포, 일자·월별 추이, 대표 기사, 기관·매체 |
| 주제·키워드 추이 | 8개 주제·표준 키워드의 월별(24개월)·주별(26주) 추이, 국내·해외 비중, 기관·매체 순위 |
| 키워드 연계망 | 주제·키워드·기관·기업·체계 동시출현 네트워크(온톨로지). 노드 클릭 시 관련 기사 |
| 과제 연계 분석 | 무기체계 신뢰도(RAM)·수리부속 수요예측·정비소요인력 예측 축별 기사·추이·시사점 |
| 체계 이해 | 국방군수통합정보체계 통합 구조(6개 체계→단일체계), 연혁, 해외 사례, AI 확장 방향 |
| 기사 검색 | 검색·주제·과제축·기간 필터, CSV 내려받기 |
| 데이터 관리 | 기사 직접 추가, 중요 표시·메모·숨김, GitHub에 저장, ‘지금 수집 실행’ |

## 배포 (GitHub Pages)

1. **Settings → Pages → Source: Deploy from a branch**, Branch `main` / `/ (root)` 저장
2. `https://jaewoonahn-hrnews.github.io/Logistics-Information-System/` 에서 확인
3. **Settings → Actions → General → Workflow permissions → Read and write permissions** 선택(자동 커밋용)

로컬 확인: `python3 -m http.server` 후 `http://localhost:8000`

## 자동 수집·누적 흐름

`.github/workflows/update-news.yml`이 매일 06:40·17:40(KST) 실행됩니다. Actions 탭에서 **Run workflow**로 언제든 수동 실행할 수 있습니다.

1. `scripts/collect.py` — Google News RSS(국문 15개·영문 10개 검색어) 수집 → 관련성 필터(국방 맥락어 + 핵심 주제어) → 제목 유사 기사 묶기(‘외 N개 매체’) → `data/news/YYYY-MM.json`에 누적
2. `scripts/build.py` — 일·주(ISO)·월·연 집계, 직전 기간 대비 부상 키워드, 규칙 기반 브리핑, 추이·연계망 → `data/index.json`, `periods.json`, `trends.json`
3. 변경분을 자동 커밋 → 사이트에 반영

**AI 브리핑(선택)**: 저장소 **Settings → Secrets and variables → Actions**에 `ANTHROPIC_API_KEY`를 등록하면 최신 일·주·월·연 브리핑을 Claude가 작성합니다(모델은 Variables의 `ANTHROPIC_MODEL`로 변경 가능). 등록하지 않으면 규칙 기반 브리핑만 표시합니다.

## 데이터 관리

화면에서 고친 내용은 원본 수집 파일을 덮어쓰지 않고 `data/db/`에 따로 쌓입니다.

| 파일 | 내용 |
|---|---|
| `data/db/added.json` | 직접 추가한 기사 |
| `data/db/overrides.json` | 중요 표시(pinned)·숨김(hidden)·메모(notes)·수정(edits) |
| `data/db/changelog.json` | 변경 이력 |

GitHub 저장에는 Fine-grained 토큰(이 저장소만, **Contents: Read and write**, ‘지금 수집 실행’까지 쓰려면 **Actions: Read and write**)이 필요합니다. 저장하면 Actions가 다시 정리해 집계에도 반영합니다.

## 수집 범위·분류 바꾸기

`scripts/taxonomy.py` 한 파일에서 검색어, 8개 주제 분류, 표준 키워드, 기관·기업·체계 개체, 과제 축 키워드를 고칩니다. 고치면 다음 정리 때 과거 기사에도 소급 적용됩니다.

## 한계

- Google News 검색 결과에 의존하므로 일부 기사가 빠질 수 있습니다(직접 추가로 보완).
- RSS에는 본문이 없어 자동 수집 기사의 요약이 비어 있을 수 있으며, 분류는 제목·요약 기준입니다.
- 초기 데이터(2014·2020·2025~2026년 기사 27건)는 웹 검색으로 확인한 실제 기사를 정리한 것입니다(`scripts/seed_articles.json`).
