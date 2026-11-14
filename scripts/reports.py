"""주간 보고서 게시판: 매주 보고서를 확정본으로 쌓아 둡니다.

- data/reports/YYYY-Www.json : 그 주 보고서 스냅숏(화면·PPT를 다시 그릴 수 있는 전체 내용)
- data/reports/index.json    : 게시판 목록(번호·제목·기간·기사 수·작성/확정 시각)
- reports/YYYY-Www.md        : GitHub에서 바로 읽는 보고서 본문
- reports/README.md          : GitHub 게시판(표)

진행 중인 주는 실행마다 갱신하고, 주가 끝난 뒤 첫 실행에서 '확정'으로 고정합니다(이후 덮어쓰지 않음).
"""
from datetime import date, timedelta

from common import DATA, ROOT, load_json, save_json, now_kst
import kb as KB

RDIR = DATA / "reports"
MDIR = ROOT / "reports"
SITE = "https://jaewoonahn-hrnews.github.io/Logistics-Information-System/"


def _model(key, wk, per, by, sums):
    v2 = wk.get("v2") or {}
    gv = {g.get("g"): g for g in v2.get("groups", [])}
    seen, no, groups = {}, 0, []
    for i, t in enumerate(wk.get("themes", [])[:6]):
        g = gv.get(i + 1, {})
        iv = {x.get("id"): x for x in g.get("items", [])}
        order = [x for x in (x.get("id") for x in g.get("items", [])) if x in t.get("ids", [])]
        order += [x for x in t.get("ids", []) if x not in order]
        items = []
        for aid in order:
            a = by.get(aid)
            if not a:
                continue
            if aid not in seen:
                no += 1
                seen[aid] = no
            c, x = sums.get(aid, {}), iv.get(aid, {})
            items.append({"no": seen[aid], "id": aid, "h": x.get("h") or c.get("h") or a["title"][:22],
                          "d": x.get("d") or (c.get("p") or [""])[0] or (c.get("s") or a.get("summary") or "")[:40],
                          "s": c.get("s") or a.get("summary") or "", "src": a.get("source", ""), "date": a["date"], "url": a.get("url", "")})
        groups.append({"i": i, "icon": t.get("icon", "gear"), "title": g.get("title") or t.get("cat") or t.get("head", ""),
                       "sub": g.get("sub") or t.get("head", ""), "points": t.get("points", []), "items": items,
                       "tr": t.get("tr", ""), "im": t.get("im", ""), "arch": t.get("arch")})
    imps = (v2.get("imps") or wk.get("recs") or [])[:4]
    flow = None
    if wk.get("flow"):
        kbd = load_json(DATA / "kb" / "kb.json", {"tech": [], "tasks": [], "stasks": [], "sfields": []})
        f = wk["flow"]
        flow = {"ov": f.get("ov", ""), "flows": f.get("flows", []),
                "tech": [dict(x, desc=KB.describe(kbd, x["id"]) or "") for x in f.get("tech", [])],
                "tasks": [dict(x, desc=KB.describe(kbd, x["id"]) or "") for x in f.get("tasks", [])]}
    return {"key": key, "start": per["start"], "end": per["end"], "week": key.replace("-W", "년 ") + "주차",
            "tag": v2.get("tag") or wk.get("core", ""), "core": wk.get("core", ""), "groups": groups, "imps": imps,
            "recs": wk.get("recs", []), "flow": flow, "n": no, "total": wk.get("n") or per.get("n", 0), "at": v2.get("at") or wk.get("at", "")}


def _md(M, final):
    L = [f"# 국방 군수·AI 주간 보고서 — {M['week']}", "",
         f"**기간** {M['start']} ~ {M['end']} · **주제** {len(M['groups'])}개 · **기사** {M['n']}건 · "
         f"**상태** {'확정' if final else '진행 중(매 수집 때 갱신)'} · AI 정리 {M['at']}", "",
         f"> **3분 브리핑** {M['tag']}", "",
         f"[사이트에서 보기·PPT 다운로드]({SITE}#reports/{M['key']})", ""]
    for g in M["groups"]:
        L += [f"## {g['i'] + 1}. {g['title']} — {g['sub']}", ""]
        for x in g["items"]:
            L.append(f"{x['no']}. **[{x['h']}]({x['url']})** — {x['d']}  ")
            L.append(f"   <sub>{x['src']} · {x['date']}</sub>")
        if g.get("tr"):
            L += ["", f"- 추이: {g['tr']}"]
        if g.get("im"):
            L.append(f"- 우리 군 시사점: {g['im']}")
        L.append("")
    if M.get("flow"):
        f = M["flow"]
        L += ["## 주간 흐름 분석", "", f["ov"], ""] + [f"- **{x.get('t', '')}**({x.get('dir', '')}) — {x.get('d', '')}" for x in f["flows"]] + [""]
        if f["tech"] or f["tasks"]:
            L += ["**기술·과제 연계(국방기술기획서·전력지원체계 소요기획서)**", ""] + [f"- {x['desc'].split(':')[0]} — {x.get('why', '')}" for x in f["tech"] + f["tasks"]] + [""]
    if M["imps"]:
        L += ["## 이번 주 핵심 시사점", ""] + [f"{i + 1}. **{r.get('t', '')}** — {r.get('d', '')}" for i, r in enumerate(M["imps"])] + [""]
    L += ["---", "군수정보 인텔리전스 자동 수집·정리. 원문은 각 기사 링크 참고."]
    return "\n".join(L) + "\n"


def save(wb, periods, arts, sums, today=None):
    today = today or now_kst().date()
    RDIR.mkdir(parents=True, exist_ok=True)
    MDIR.mkdir(parents=True, exist_ok=True)
    idx = {r["key"]: r for r in load_json(RDIR / "index.json", {"items": []})["items"]}
    by = {a["id"]: a for a in arts}
    now = now_kst().strftime("%Y-%m-%d %H:%M")
    changed = 0
    for key in sorted(wb):
        wk, per = wb[key], periods["week"].get(key)
        if not per or not wk.get("themes"):
            continue
        old = idx.get(key)
        if old and old.get("final"):
            continue
        end = date.fromisoformat(per["end"])
        # 주가 끝나고 3분 브리핑 문구(v2)까지 만들어졌으면 확정. 문구가 없으면 일주일 더 기다렸다가 확정
        final = end < today and (bool(wk.get("v2")) or end < today - timedelta(days=7))
        M = _model(key, wk, per, by, sums)
        if not M["n"]:
            continue
        M.update(final=final, created=(old or {}).get("created", now), updated=now)
        save_json(RDIR / f"{key}.json", M, compact=True)
        (MDIR / f"{key}.md").write_text(_md(M, final), encoding="utf-8")
        idx[key] = {"key": key, "week": M["week"], "start": M["start"], "end": M["end"], "tag": M["tag"], "core": M["core"],
                    "titles": [g["title"] for g in M["groups"]], "n": M["n"], "total": M["total"], "groups": len(M["groups"]),
                    "created": M["created"], "updated": now, "final": final, "at": M["at"]}
        changed += 1
    items = sorted(idx.values(), key=lambda r: r["key"])
    for i, r in enumerate(items):
        r["no"] = i + 1
    items.reverse()
    save_json(RDIR / "index.json", {"updated": now, "items": items})
    rows = ["| 번호 | 보고서 | 기간 | 3분 브리핑 | 기사 | 상태 | 작성 |", "|---:|---|---|---|---:|---|---|"]
    for r in items:
        rows.append(f"| {r['no']} | [{r['week']}]({r['key']}.md) | {r['start']} ~ {r['end'][5:]} | {r['tag']} | {r['n']} | "
                    f"{'확정' if r['final'] else '진행 중'} | {r['created'][:10]} |")
    (MDIR / "README.md").write_text(
        "# 주간 보고서 게시판\n\n매주 자동 수집 기사로 만든 ‘국방 군수·AI 주간 보고서’를 쌓아 둡니다. "
        "주가 끝나면 확정본으로 고정되고, 진행 중인 주는 수집 때마다 갱신됩니다.\n\n"
        f"- 사이트 게시판(PPT 다운로드): {SITE}#reports\n\n" + "\n".join(rows) + "\n", encoding="utf-8")
    print(f"- 주간 보고서 게시판: {len(items)}건(이번에 갱신 {changed}건, 확정 {sum(1 for r in items if r['final'])}건)")
