"""초기 데이터(웹 검색으로 확인한 실제 기사)를 월별 파일에 넣습니다. 여러 번 실행해도 중복되지 않습니다."""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from collect import merge, to_article  # noqa: E402
from common import KST, load_json  # noqa: E402

items = load_json(os.path.join(os.path.dirname(__file__), "seed_articles.json"), [])
arts = []
for s in items:
    dt = datetime.strptime(s["date"] + " 09:00", "%Y-%m-%d %H:%M").replace(tzinfo=KST)
    a = to_article(dict(s, dt=dt, query="seed"), origin="seed")
    arts.append(a)
print("seed", len(arts), "→ 신규", merge(arts))
