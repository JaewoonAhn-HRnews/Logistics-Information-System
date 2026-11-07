"""국방 AI(AI+IT) 뉴스레터 아카이브 연계.

공개 저장소(crayon-sim/defense-ai-newsletter)의 호별 데이터(data/newsletter-N.js)를 읽어
data/nl_archive.json 으로 누적합니다. 기사·핵심 인사이트는 아카이브 연계(과거 관련 기사 추적)와
'아카이브' 화면에 쓰이고, 군수 관련 기사는 뉴스 DB에도 '뉴스레터 제N호' 출처로 들어갑니다.

로컬 테스트: python scripts/newsletter.py --dir <클론 경로>
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

from common import DATA, load_json, save_json

REPO = "crayon-sim/defense-ai-newsletter"
RAW = f"https://raw.githubusercontent.com/{REPO}/main/"
SITE = "https://crayon-sim.github.io/defense-ai-newsletter/"
OUT = DATA / "nl_archive.json"
UA = {"User-Agent": "Mozilla/5.0 (LogisticsIntel archive-sync)"}

# 기사 출처 → 지역 힌트
SRC_REGION = {
    "gov.uk": "eu", "uk parliament": "eu", "nato": "eu", "cepa": "eu", "the guardian": "eu", "unherd": "eu",
    "nikkei": "etc", "south china morning post": "etc", "риа": "etc", "the defense post": "etc",
    "연합": "kr", "국방일보": "kr", "전자신문": "kr",
}


def _get(path):
    req = urllib.request.Request(RAW + path, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8")


def js_to_obj(src):
    """window.NEWSLETTERS.push({...}); 형태의 JS 객체 리터럴을 JSON으로 변환."""
    i = src.find("push(")
    j = src.rfind(");")
    if i < 0 or j < 0:
        raise ValueError("push(...) 없음")
    body = src[i + 5:j]
    out, k, n = [], 0, len(body)
    # 문자열 밖에서만 키 따옴표·주석·후행 콤마 처리
    while k < n:
        c = body[k]
        if c in "\"'`":
            q = c
            s = k + 1
            buf = []
            while s < n and body[s] != q:
                if body[s] == "\\" and s + 1 < n:
                    buf.append(body[s:s + 2])
                    s += 2
                    continue
                buf.append(body[s])
                s += 1
            txt = "".join(buf)
            if q != '"':
                txt = txt.replace('\\' + q, q).replace('"', '\\"')
            txt = txt.replace("\n", "\\n").replace("\t", " ")
            out.append('"' + txt + '"')
            k = s + 1
            continue
        if body.startswith("//", k):
            e = body.find("\n", k)
            k = n if e < 0 else e
            continue
        if body.startswith("/*", k):
            e = body.find("*/", k)
            k = n if e < 0 else e + 2
            continue
        m = re.match(r"([A-Za-z_$][\w$]*)\s*:", body[k:])
        if m and (not out or out[-1].rstrip()[-1:] in "{,"):
            out.append('"' + m.group(1) + '":')
            k += m.end()
            continue
        out.append(c)
        k += 1
    txt = "".join(out)
    txt = re.sub(r",(\s*[}\]])", r"\1", txt)
    return json.JSONDecoder().raw_decode(txt.strip())[0]


def _clean(o):
    s = o.get("source", "")
    return {
        "id": "nl" + str(o.get("id", "")), "nl": o.get("newsletter_id"), "date": o.get("date", ""),
        "source": s, "url": o.get("url", ""), "title": o.get("title", ""), "title_kr": o.get("title_kr", ""),
        "topic": o.get("topic_kr", ""), "kw": o.get("keywords", []) or [], "summary": o.get("summary", ""),
    }


def sync(local_dir=None):
    """아카이브 전체를 읽어 nl_archive.json 갱신. 실패해도 기존 파일 유지."""
    prev = load_json(OUT, {"issues": [], "articles": []})
    try:
        if local_dir:
            rd = lambda p: (Path(local_dir) / p).read_text(encoding="utf-8")
        else:
            rd = _get
        cfg = rd("config.js")
        files = re.findall(r'"(data/newsletter-\d+\.js)"', cfg)
        if not files:
            raise ValueError("config.js 파일 목록 없음")
        have = {i["id"] for i in prev["issues"]}
        issues = {i["id"]: i for i in prev["issues"]}
        arts = {a["id"]: a for a in prev["articles"]}
        latest = sorted(files, key=lambda f: -int(re.search(r"(\d+)", f).group(1)))
        fetched = 0
        for f in latest:
            no = int(re.search(r"(\d+)", f).group(1))
            # 이미 받은 호는 최근 3개 호만 다시 확인(수정 반영)
            if no in have and no < max(have) - 2:
                continue
            try:
                o = js_to_obj(rd(f))
            except Exception as e:  # noqa: BLE001
                print(f"  ! {f}: {e}")
                continue
            fetched += 1
            issues[no] = {
                "id": no, "title": o.get("title", ""), "period": o.get("period", ""), "date": o.get("date", ""),
                "theme": o.get("key_theme", ""),
                "insights": [{"t": x.get("title", ""), "b": x.get("body", "")} for x in o.get("insights", [])],
                "n": len(o.get("articles", [])),
            }
            for a in o.get("articles", []):
                c = _clean(a)
                if c["date"] and c["title"]:
                    arts[c["id"]] = c
        res = {
            "repo": REPO, "site": SITE,
            "issues": sorted(issues.values(), key=lambda x: -x["id"]),
            "articles": sorted(arts.values(), key=lambda x: (x["date"], x["id"]), reverse=True),
        }
        save_json(OUT, res, compact=True)
        print(f"- 뉴스레터 아카이브: {len(res['issues'])}개 호, 기사 {len(res['articles'])}건 (이번에 {fetched}개 호 확인)")
        return res, {"id": "nlarchive", "ok": True, "mode": "github", "n": fetched}
    except Exception as e:  # noqa: BLE001
        print(f"- 뉴스레터 아카이브 동기화 실패: {e}")
        return prev, {"id": "nlarchive", "ok": False, "mode": "github", "n": 0, "err": str(e)[:160]}


def region_hint(source):
    s = (source or "").lower()
    for k, v in SRC_REGION.items():
        if k in s:
            return v
    return "us"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir")
    a = ap.parse_args()
    r, st = sync(a.dir)
    sys.exit(0 if st["ok"] else 1)
