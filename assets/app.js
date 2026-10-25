/* 군수정보 인텔리전스 — 정적 사이트 앱 (데이터: data/*.json) */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => (n ?? 0).toLocaleString("ko-KR");
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
  };
  const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600); };

  let IDX, PER, TR, TAX, CAT = {}, AX = {}, RG = {}, DM = {};
  let SRCS = [], FST = { sources: {} }, CASES = [], SUMS = {}, WB = {};
  let BASE = [];          // 서버 기사(월 파일)
  let ARTS = [];          // DB 반영 후 기사
  let BYID = {};
  let DBS = { added: { articles: [] }, overrides: { hidden: [], pinned: [], notes: {}, edits: {} }, changelog: { log: [] } }; // 서버 DB
  let DBW = null;         // 작업본(로컬)
  const charts = {};

  // ---------- theme ----------
  const themeKey = "lis-theme";
  function applyTheme(t) { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
  applyTheme(store.get(themeKey, null));
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const nx = cur === "dark" ? "light" : "dark"; applyTheme(nx); store.set(themeKey, nx); rerender();
  });
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // ---------- data ----------
  async function j(p, d) { try { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); } catch { return d; } }
  async function load() {
    [IDX, PER, TR] = await Promise.all([j("data/index.json"), j("data/periods.json"), j("data/trends.json")]);
    if (!IDX) { $("#boot").textContent = "데이터를 불러오지 못했습니다. (로컬에서는 python3 -m http.server로 여세요)"; return false; }
    TAX = IDX.taxonomy;
    TAX.cats.forEach(c => (CAT[c.id] = c));
    TAX.axes.forEach(a => (AX[a.id] = a));
    (TAX.regions || []).forEach(r => (RG[r.id] = r));
    (TAX.domains || []).forEach(d => (DM[d.id] = d));
    const [sj, fj] = await Promise.all([j("data/sources.json", { sources: [] }), j("data/feeds_status.json", { sources: {} })]);
    SRCS = sj.sources || []; FST = fj || { sources: {} };
    CASES = (await j("data/cases.json", { cases: [] })).cases || [];
    SUMS = await j("data/article_sums.json", {});
    WB = await j("data/weekly_briefs.json", {});
    const files = await Promise.all(IDX.files.map(f => j("data/news/" + f, { articles: [] })));
    BASE = files.flatMap(f => f.articles || []);
    const [ad, ov, cl] = await Promise.all([j("data/db/added.json", null), j("data/db/overrides.json", null), j("data/db/changelog.json", null)]);
    if (ad) DBS.added = ad; if (ov) DBS.overrides = Object.assign({ hidden: [], pinned: [], notes: {}, edits: {} }, ov); if (cl) DBS.changelog = cl;
    DBW = store.get("lis-db-work", null);
    applyDB();
    return true;
  }
  const db = () => DBW || DBS;
  function applyDB() {
    const d = db(), ov = d.overrides, hid = new Set(ov.hidden), pin = new Set(ov.pinned);
    const added = (d.added.articles || []).map(a => Object.assign({ origin: "manual", also: [], score: 5 }, a));
    const ids = new Set(BASE.map(a => a.id));
    ARTS = BASE.concat(added.filter(a => !ids.has(a.id))).map(a => {
      const e = ov.edits?.[a.id]; const x = e ? Object.assign({}, a, e) : Object.assign({}, a);
      x.pin = pin.has(a.id); x.hidden = hid.has(a.id); x.note = ov.notes?.[a.id] || "";
      const sm = SUMS[a.id]; if (sm) { x.ai_sum = sm.s; x.ai_basis = sm.b || ""; } return x;
    });
    BYID = {}; ARTS.forEach(a => (BYID[a.id] = a));
    ARTS = ARTS.filter(a => !a.hidden).sort((a, b) => (b.ts || b.date).localeCompare(a.ts || a.date));
    const n = pendingCount(); $("#nav-db-n").textContent = n ? ` ·${n}` : "";
  }
  function pendingCount() { if (!DBW) return 0; return (DBW._pending || 0); }

  // ---------- classify (수동 추가용) ----------
  function pat(term) {
    if (/[A-Za-z]/.test(term) && !/[가-힣]/.test(term)) {
      const e = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cs = term === term.toUpperCase() && term.length <= 5;
      return new RegExp("(?<![A-Za-z0-9])" + e + "(?![A-Za-z0-9])", cs ? "" : "i");
    }
    return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  const hasAny = (t, arr) => arr.some(k => pat(k).test(t));
  function guessRegion(text) {
    let best = "", bs = 0;
    for (const r of TAX.regions || []) { const n = r.terms.filter(t => pat(t).test(text)).length; if (n > bs) { bs = n; best = r.id; } }
    return best || "etc";
  }
  function classify(text) {
    return {
      cats: TAX.cats.filter(c => hasAny(text, c.kw)).map(c => c.id),
      kw: TAX.keywords.filter(([, s]) => hasAny(text, s)).map(([k]) => k),
      ents: TAX.entities.filter(([, , s]) => hasAny(text, s)).map(([e]) => e),
      axes: TAX.axes.filter(a => hasAny(text, a.kw)).map(a => a.id),
      domains: (TAX.domains || []).map(d => [d.id, d.kw.filter(k => pat(k).test(text)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(x => x[0]),
      kind: (TAX.kinds || []).find(k => hasAny(text, k.kw))?.id || "news",
      region: guessRegion(text),
    };
  }

  // ---------- charts ----------
  function chart(id, opt) {
    const el = document.getElementById(id); if (!el || !window.echarts) return null;
    if (charts[id]) { charts[id].dispose(); }
    const c = echarts.init(el, null, { renderer: "canvas" });
    const ink = css("--ink-2"), line = css("--line"), mut = css("--muted");
    const base = {
      textStyle: { fontFamily: css("--font-body"), color: ink },
      grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", backgroundColor: css("--surface"), borderColor: line, textStyle: { color: css("--ink"), fontSize: 12 }, confine: true },
      legend: { top: 0, textStyle: { color: ink, fontSize: 12 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
    };
    const ax = a => Object.assign({ axisLine: { lineStyle: { color: line } }, axisLabel: { color: mut, fontSize: 11 }, splitLine: { lineStyle: { color: css("--grid") === "" ? line : line, opacity: .5 } }, axisTick: { show: false } }, a);
    if (opt.xAxis) opt.xAxis = Array.isArray(opt.xAxis) ? opt.xAxis.map(ax) : ax(opt.xAxis);
    if (opt.yAxis) opt.yAxis = Array.isArray(opt.yAxis) ? opt.yAxis.map(ax) : ax(opt.yAxis);
    c.setOption(Object.assign(base, opt));
    charts[id] = c; return c;
  }
  window.addEventListener("resize", () => Object.values(charts).forEach(c => c && !c.isDisposed() && c.resize()));
  const catColor = id => CAT[id]?.color || "#64748b";
  const accent = () => css("--accent"), teal = () => css("--teal");
  function hbar(id, pairs, color, onClick) {
    const data = pairs.slice().reverse();
    const c = chart(id, {
      tooltip: { trigger: "item" }, legend: { show: false },
      grid: { left: 8, right: 34, top: 6, bottom: 4, containLabel: true },
      xAxis: { type: "value", minInterval: 1 }, yAxis: { type: "category", data: data.map(d => d[0]), axisLabel: { color: css("--ink-2"), fontSize: 12, width: 130, overflow: "truncate" } },
      series: [{ type: "bar", data: data.map(d => ({ value: d[1], itemStyle: { color: typeof color === "function" ? color(d[0]) : color, borderRadius: [0, 3, 3, 0] } })), barMaxWidth: 16, label: { show: true, position: "right", color: css("--muted"), fontSize: 11, fontFamily: css("--font-mono") } }],
    });
    if (c && onClick) c.on("click", p => onClick(data[p.dataIndex][0]));
    return c;
  }

  // ---------- cards ----------
  function card(a, o = {}) {
    if (!a) return "";
    const doms = (a.domains || []).map(d => `<span class="tag-d">${esc(DM[d]?.name || d)}</span>`).join("");
    const kindT = a.kind === "contract" ? '<span class="tag-kind">사업·계약</span>' : a.kind === "policy" ? '<span class="tag-kind" style="color:var(--accent);background:var(--accent-soft)">정책·보고서</span>' : "";
    const cats = kindT + doms + (a.cats || []).slice(0, 2).map(c => `<span class="tag-c" style="background:${catColor(c)}">${esc(CAT[c]?.name || c)}</span>`).join("");
    const axes = (a.axes || []).map(x => `<span class="tag-a">${esc(AX[x]?.name || x)}</span>`).join("");
    const also = (a.also || []).length ? `<div class="also">외 ${a.also.length}개 매체: ${a.also.slice(0, 4).map(x => esc(x.source)).join(", ")}${a.also.length > 4 ? " …" : ""}</div>` : "";
    return `<article class="card${a.pin ? " pin" : ""}${o.compact ? " compact" : ""}" data-id="${a.id}">
      <div class="card-top">${a.region ? `<span class="rbadge ${a.region}">${esc(RG[a.region]?.name || a.region)}</span>` : ""}<span class="lang ${a.lang === "ko" ? "" : "en"}">${a.lang === "ko" ? "국문" : "영문"}</span><span class="src">${esc(a.source || "")}</span><span class="mono">${esc(a.date)}</span>${a.origin === "manual" ? '<span class="pill">직접 추가</span>' : ""}</div>
      <a class="card-title" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>
      ${!o.compact ? (a.ai_sum && !/[가-힣]{8,}/.test(a.summary || "") ? `<p class="card-sum">${esc(a.ai_sum)} <span class="ai-tag" title="${a.ai_basis === "제목" ? "원문 발췌가 없어 제목을 바탕으로 정리" : "원문 발췌를 바탕으로 정리"}">AI 요약${a.ai_basis === "제목" ? "·제목 기준" : ""}</span></p>` : a.summary ? `<p class="card-sum">${esc(a.summary)}</p>` : "") : ""}
      ${o.compact ? "" : `<div class="tags">${cats}${axes}</div>`}
      ${a.note ? `<div class="memo">메모: ${esc(a.note)}</div>` : ""}${o.compact ? "" : also}
      <div class="card-act"><button class="ibtn${a.pin ? " on" : ""}" data-act="pin" title="중요 표시" aria-label="중요 표시">★</button><button class="ibtn" data-act="more" title="상세" aria-label="상세">⋯</button></div>
    </article>`;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".card .ibtn"); if (!b) return;
    const id = b.closest(".card").dataset.id;
    if (b.dataset.act === "pin") togglePin(id); else openDrawer(id);
  });

  // ---------- drawer ----------
  function openDrawer(id) {
    const a = BYID[id]; if (!a) return;
    const d = $("#drawer");
    const rel = ARTS.filter(x => x.id !== id).map(x => [x, (x.kw || []).filter(k => (a.kw || []).includes(k)).length + (x.ents || []).filter(k => (a.ents || []).includes(k)).length]).filter(x => x[1] >= 2).sort((p, q) => q[1] - p[1]).slice(0, 5);
    d.innerHTML = `<button class="ibtn x" id="dx" aria-label="닫기">✕</button>
      <div class="eyebrow">${a.lang === "ko" ? "국내" : "해외"} · ${esc(a.source)} · ${esc(a.date)}</div>
      <h2 style="font-size:20px">${esc(a.title)}</h2>
      ${SUMS[id]?.p ? `<div>${newsCard(a, 1, true)}<div class="ig-actions" style="margin-top:6px"><button class="btn ghost" type="button" id="nc-save">뉴스 카드 이미지로 저장</button></div></div>` : ""}
      ${a.ai_sum ? `<div><h3>AI 요약 <span class="ai-tag">${a.ai_basis === "제목" ? "제목 기준" : "원문 발췌 기준"}</span></h3><p class="card-sum" style="font-size:14.5px">${esc(a.ai_sum)}</p></div>` : ""}
      ${a.summary ? `<div><h3>원문 발췌</h3><p class="card-sum" style="font-size:14px">${esc(a.summary)}</p></div>` : (a.ai_sum ? "" : '<p class="note">요약 없음(원문 발췌를 못 가져온 기사). 다음 정리 때 AI 요약이 추가됩니다.</p>')}
      <div class="tags">${a.region ? `<span class="rbadge ${a.region}">${esc(RG[a.region]?.name)}</span>` : ""}${(a.domains || []).map(d => `<span class="tag-d">${esc(DM[d]?.name)}</span>`).join("")}${(a.cats || []).map(c => `<span class="tag-c" style="background:${catColor(c)}">${esc(CAT[c]?.name)}</span>`).join("")}${(a.axes || []).map(x => `<span class="tag-a">${esc(AX[x]?.name)}</span>`).join("")}</div>
      <div class="note">키워드: ${(a.kw || []).map(esc).join(" · ") || "—"}<br>기관·기업·체계: ${(a.ents || []).map(esc).join(" · ") || "—"}<br>관련도 점수: <span class="mono">${a.score ?? "—"}</span></div>
      ${(a.also || []).length ? `<div><h3>같은 내용을 보도한 매체</h3><ul class="plain">${a.also.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a></li>`).join("")}</ul></div>` : ""}
      <div class="controls" style="margin-top:0"><a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener">원문 열기</a><button class="btn ghost" id="d-pin">${a.pin ? "중요 해제" : "중요 표시"}</button><button class="btn ghost" id="d-hide">이 기사 숨기기</button></div>
      <div class="field"><label for="d-note">메모</label><textarea id="d-note" rows="3" placeholder="과제 활용 메모 등">${esc(a.note)}</textarea></div>
      <div><button class="btn ghost" id="d-save">메모 저장</button></div>
      ${rel.length ? `<div><h3>관련 기사</h3><div class="cards">${rel.map(r => card(r[0], { compact: true })).join("")}</div></div>` : ""}`;
    d.hidden = false; $("#scrim").hidden = false;
    $("#dx").onclick = closeDrawer;
    const ncs = $("#nc-save"); if (ncs) ncs.onclick = () => savePNG("#nc-card", `뉴스카드_${a.date}_${id}.png`, "#ffffff");
    $("#d-pin").onclick = () => { togglePin(id); openDrawer(id); };
    $("#d-hide").onclick = () => { mutate(w => { if (!w.overrides.hidden.includes(id)) w.overrides.hidden.push(id); }, "숨김", id, a.title); closeDrawer(); toast("숨겼습니다. 데이터 관리에서 되돌릴 수 있습니다."); };
    $("#d-save").onclick = () => { const v = $("#d-note").value.trim(); mutate(w => { if (v) w.overrides.notes[id] = v; else delete w.overrides.notes[id]; }, v ? "메모" : "메모 삭제", id, a.title); toast("메모를 저장했습니다(로컬)."); openDrawer(id); };
  }
  function closeDrawer() { $("#drawer").hidden = true; $("#scrim").hidden = true; }
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

  // ---------- DB mutate ----------
  function work() { if (!DBW) { DBW = JSON.parse(JSON.stringify(DBS)); DBW._pending = 0; } return DBW; }
  function mutate(fn, act, id, title) {
    const w = work(); fn(w); w._pending = (w._pending || 0) + 1;
    w.changelog.log.unshift({ at: new Date().toISOString().slice(0, 16).replace("T", " "), act, id, title: (title || "").slice(0, 80) });
    store.set("lis-db-work", w); applyDB(); rerender(true);
  }
  function togglePin(id) {
    const a = BYID[id];
    mutate(w => { const p = w.overrides.pinned, i = p.indexOf(id); if (i >= 0) p.splice(i, 1); else p.push(id); }, a?.pin ? "중요 해제" : "중요 표시", id, a?.title);
  }

  // ---------- router ----------
  const VIEWS = ["home", "daily", "weekly", "monthly", "yearly", "us", "eu", "kr", "etc", "compare", "sources", "topics", "network", "project", "system", "search", "db", "about"];
  const rendered = {};
  let cur = "home";
  function route() {
    const h = (location.hash || "#home").slice(1).split("/");
    const v = VIEWS.includes(h[0]) ? h[0] : "home";
    cur = v;
    $$(".view").forEach(s => (s.hidden = s.id !== "v-" + v));
    $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.v === v));
    $("#rail").classList.remove("open");
    render(v, h[1]);
    if (v === "home") window.HeroFX?.start(); else window.HeroFX?.stop();
    window.scrollTo(0, 0);
    setTimeout(() => Object.values(charts).forEach(c => c && !c.isDisposed() && c.resize()), 30);
  }
  function render(v, arg) {
    const fn = { home: rHome, daily: () => rPeriod("day", arg), weekly: () => rPeriod("week", arg), monthly: () => rPeriod("month", arg), yearly: () => rPeriod("year", arg), us: () => rRegion("us", arg), eu: () => rRegion("eu", arg), kr: () => rRegion("kr", arg), etc: () => rRegion("etc", arg), compare: rCompare, sources: rSources, topics: rTopics, network: rNetwork, project: rProject, system: rSystem, search: rSearch, db: rDB, about: rAbout }[v];
    fn && fn();
    rendered[v] = true;
  }
  function rerender(soft) { if (soft && ["network", "topics"].includes(cur)) return; render(cur, (location.hash.split("/")[1])); }
  window.addEventListener("hashchange", route);
  $("#menuBtn").addEventListener("click", () => $("#rail").classList.toggle("open"));

  // ---------- helpers ----------
  const today = () => { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10); };
  function isoWeek(ds) {
    const d = new Date(ds + "T00:00:00Z"); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
    const y = d.getUTCFullYear(), f = new Date(Date.UTC(y, 0, 4)); const w = 1 + Math.round(((d - f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7);
    return `${y}-W${String(w).padStart(2, "0")}`;
  }
  const keyOf = (kind, ds) => kind === "day" ? ds : kind === "week" ? isoWeek(ds) : kind === "month" ? ds.slice(0, 7) : ds.slice(0, 4);
  const artsIn = (kind, key) => ARTS.filter(a => keyOf(kind, a.date) === key);
  const catName = id => CAT[id]?.name || id;

  // ---------- HOME ----------
  function rHome() {
    const t = today(), wk = isoWeek(t);
    const lastDay = IDX.last;
    const nToday = ARTS.filter(a => a.date === t).length;
    const nWeek = ARTS.filter(a => isoWeek(a.date) === wk).length;
    $("#heroStats").innerHTML = [
      [fmt(ARTS.length), "누적 기사"],
      [fmt(nToday || ARTS.filter(a => a.date === lastDay).length), nToday ? "오늘 수집" : `최근 수집일(${(lastDay || "").slice(5).replace("-", ".")})`],
      [fmt(nWeek), "이번 주"],
      [fmt(IDX.sources_n), "보도 매체"],
    ].map(([v, l]) => `<div class="hs"><b>${v}</b><span>${esc(l)}</span></div>`).join("");
    const lat = ARTS.filter(a => a.origin !== "api").slice(0, 14);
    const tk = lat.map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener"><span class="src">${esc(a.source)}</span>${esc(a.title)}</a>`).join("");
    $("#ticker").innerHTML = tk + tk;
    for (const ax of TAX.axes) { const el = $("#capn-" + ax.id); if (el) el.textContent = `관련 기사 ${fmt(ARTS.filter(a => (a.axes || []).includes(ax.id)).length)}건 →`; }
    // 브리핑: 가장 최근 일자
    const dk = Object.keys(PER.day).sort().pop();
    const p = PER.day[dk];
    const wkey = Object.keys(PER.week).sort().pop();
    $("#homeBrief").innerHTML = p ? `<div class="note mono">${esc(p.label)}</div>${p.ai ? `<p class="brief ai">${esc(p.ai)}</p>` : `<p class="brief">${esc(p.brief)}</p>`}
      <div class="brief-head">이번 주 흐름</div><p class="brief">${esc(PER.week[wkey]?.brief || "")}</p>
      <div class="toplist" style="margin-top:12px">${p.top.slice(0, 3).map(id => card(BYID[id], { compact: true })).join("")}</div>` : '<div class="empty">아직 수집된 기사가 없습니다.</div>';
    const m = TR.months.slice(-12);
    chart("c-home-trend", {
      xAxis: { type: "category", data: m.map(x => x.slice(2).replace("-", ".")) }, yAxis: { type: "value", minInterval: 1 },
      series: [{ name: "국내", type: "bar", stack: "a", data: TR.m_ko.slice(-12), itemStyle: { color: accent() }, barMaxWidth: 22 },
        { name: "해외", type: "bar", stack: "a", data: TR.m_en.slice(-12), itemStyle: { color: teal(), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 }],
    });
    $("#homeLatest").innerHTML = ARTS.filter(a => a.origin !== "api").slice(0, 6).map(a => card(a)).join("");
    $("#homeDaily").innerHTML = dailyFeed(7);
    $("#homeRegions").innerHTML = REGION_IDS.map(r => {
      const L = ARTS.filter(a => a.region === r), mx = Math.max(1, ...DOM_IDS.map(d => L.filter(a => (a.domains || []).includes(d)).length));
      return `<a class="rtile" href="#${r}" style="--rc:${rc(r)}"><div class="code">${r.toUpperCase()}</div><h3>${esc(RG[r]?.name)}</h3><div class="v">${fmt(L.length)}<span class="note"> 건</span></div>
        <div class="bars">${DOM_IDS.map(d => { const n = L.filter(a => (a.domains || []).includes(d)).length; return `<div class="bar"><span>${esc(DM[d].name)}</span><i style="width:${Math.max(3, n / mx * 100)}%"></i><b>${n}</b></div>`; }).join("")}</div></a>`;
    }).join("");
  }

  // ---------- PERIOD ----------
  const PMETA = {
    day: { v: "daily", no: "01", en: "Daily", h: "일간 뉴스", lede: "날짜를 고르면 그날 수집한 기사와 자동 브리핑을 보여 줍니다. 달력의 색이 진할수록 기사가 많은 날입니다." },
    week: { v: "weekly", no: "02", en: "Weekly digest", h: "주간 정리", lede: "월요일부터 일요일까지 한 주의 기사를 묶어 주제·키워드·대표 기사와 직전 주 대비 변화를 정리합니다." },
    month: { v: "monthly", no: "03", en: "Monthly digest", h: "월간 정리", lede: "한 달 동안 쌓인 기사를 주제별로 정리하고, 일자별 흐름과 새로 떠오른 키워드를 봅니다." },
    year: { v: "yearly", no: "04", en: "Annual archive", h: "연간 정리", lede: "연도별 누적 기사를 월별 추이와 주제 구성으로 정리합니다." },
  };
  const pstate = {};
  function rPeriod(kind, arg) {
    const M = PMETA[kind], P = PER[kind] || {};
    const keys = Object.keys(P).sort().reverse();
    const sec = $("#v-" + M.v);
    let key = arg && P[arg] ? arg : (pstate[kind] && P[pstate[kind]] ? pstate[kind] : null);
    if (!key) { const now = keyOf(kind, today()); key = P[now] ? now : keys[0]; }
    pstate[kind] = key;
    if (!key) { sec.innerHTML = `<div class="vhead"><div class="eyebrow">${M.no} · ${M.en}</div><h1>${M.h}</h1></div><div class="empty">데이터가 없습니다.</div>`; return; }
    const s = P[key], i = keys.indexOf(key);
    const items = artsIn(kind, key);
    const delta = s.prev_n ? s.n - s.prev_n : null;
    const pctTxt = s.prev_n ? ` (${delta >= 0 ? "+" : ""}${Math.round(delta / s.prev_n * 100)}%)` : "";
    const filt = pstate[kind + ":cat"] || "";
    const subLabel = { day: "이날", week: "이번 주", month: "이번 달", year: "올해" }[kind];
    sec.innerHTML = `
      <div class="vhead"><div class="eyebrow">${M.no} · ${M.en}</div><h1>${M.h}</h1><p class="lede">${M.lede}</p></div>
      <div class="pbar">
        <button class="navbtn" id="p-prev" ${i >= keys.length - 1 ? "disabled" : ""} aria-label="이전">‹</button>
        <select id="p-sel" aria-label="기간 선택">${keys.map(k => `<option value="${k}" ${k === key ? "selected" : ""}>${esc(P[k].label)} · ${P[k].n}건</option>`).join("")}</select>
        <button class="navbtn" id="p-next" ${i <= 0 ? "disabled" : ""} aria-label="다음">›</button>
        <span class="note">기록이 있는 기간만 표시 · 전체 ${keys.length}개</span>
      </div>
      ${kind === "week" ? briefHTML(key, s) + igHTML(key, s) : ""}
      <div class="grid-2">
        <div class="panel">
          <h2>${esc(s.label)}</h2>
          <div class="kpis" style="margin-top:10px">
            <div class="kpi"><div class="v">${fmt(s.n)}</div><div class="l">기사</div>${delta == null ? "" : `<div class="d ${delta >= 0 ? "up" : "down"}">직전 대비 ${delta >= 0 ? "+" : ""}${delta}${pctTxt}</div>`}</div>
            <div class="kpi"><div class="v">${fmt(s.ko)}</div><div class="l">국내</div></div>
            <div class="kpi"><div class="v">${fmt(s.en)}</div><div class="l">해외</div></div>
          </div>
          ${s.ai ? `<div class="brief-head"><span class="pill ai">AI 브리핑</span>Claude가 기사 목록만 보고 작성</div><p class="brief ai">${esc(s.ai)}</p>` : ""}
          <div class="brief-head"><span class="pill">자동 정리</span>규칙 기반</div><p class="brief">${esc(s.brief)}</p>
          ${s.regions ? `<div class="brief-head">지역별</div><div class="chips small" style="margin-top:6px">${REGION_IDS.map(r => `<a class="chip" href="#${r}"><span class="rbadge ${r}">${r.toUpperCase()}</span> ${esc(RG[r]?.name)}<span class="n">${s.regions[r] || 0}</span></a>`).join("")}</div>` : ""}
          ${s.rising?.length ? `<div class="brief-head">직전 기간보다 늘어난 키워드</div><div class="rise">${s.rising.map(([k, d, nw]) => `<span class="${nw ? "new" : ""}">${esc(k)} +${d}</span>`).join("")}</div>` : ""}
        </div>
        <div class="panel"><h2>${kind === "day" ? "달력" : kind === "year" ? "월별 기사 수" : "일자별 기사 수"}</h2>${kind === "day" ? `<div id="p-cal"></div>` : `<div class="chart" id="c-p-sub"></div>`}</div>
      </div>
      <div class="grid-2">
        <div class="panel"><h2>주제 분포</h2><p class="note">막대를 누르면 아래 기사 목록을 그 주제로 거릅니다.</p><div class="chart" id="c-p-cat"></div></div>
        <div class="panel"><h2>핵심 키워드</h2><div class="chart" id="c-p-kw"></div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><h2>대표 기사</h2><p class="note">관련도 + 함께 보도한 매체 수 + 중요 표시 기준</p><div class="toplist" style="margin-top:10px">${s.top.slice(0, 5).map(id => card(BYID[id], { compact: true })).join("") || '<div class="empty">—</div>'}</div></div>
        <div class="panel"><h2>${subLabel} 많이 나온 기관·기업·체계</h2><div class="chips" style="margin-top:10px">${(s.ents || []).map(([e, n]) => `<span class="chip">${esc(e)}<span class="n">${n}</span></span>`).join("") || '<span class="note">—</span>'}</div>
          <h3 style="margin-top:16px">과제 축 연계</h3><div class="chips" style="margin-top:8px">${TAX.axes.map(a => `<a class="chip" href="#project">${esc(a.name)}<span class="n">${s.axes?.[a.id] || 0}</span></a>`).join("")}</div>
          <h3 style="margin-top:16px">주요 매체</h3><div class="chips small" style="margin-top:8px">${(s.sources || []).map(([x, n]) => `<span class="chip">${esc(x)}<span class="n">${n}</span></span>`).join("")}</div></div>
      </div>
      ${(() => { const cards = items.filter(x => x.origin !== "api" && SUMS[x.id]?.p).sort((x, y) => (y.score || 0) - (x.score || 0)).slice(0, kind === "day" ? 12 : 9); return cards.length ? `<div class="panel"><div class="sec-head"><h2>뉴스 카드 <span class="note mono">${cards.length}건</span></h2><span class="note">기사별 핵심을 한 장으로 · AI 정리</span></div><div class="nc-grid">${cards.map((x, i) => newsCard(x, i + 1)).join("")}</div></div>` : ""; })()}
      <div class="panel">
        <div class="sec-head"><h2>기사 목록 <span class="note mono">${items.length}건</span></h2>
          <div class="chips small" id="p-filt"><button class="chip ${filt ? "" : "on"}" data-c="">전체</button>${Object.keys(s.cats).map(c => `<button class="chip ${filt === c ? "on" : ""}" data-c="${c}">${esc(catName(c))}<span class="n">${s.cats[c]}</span></button>`).join("")}</div></div>
        <div class="cards" id="p-list"></div>
      </div>`;
    const go = k => { location.hash = `#${M.v}/${k}`; };
    const igb = $("#ig-save", sec); if (igb) igb.onclick = () => saveIG(key);
    const wbb = $("#wb-save", sec); if (wbb) wbb.onclick = () => savePNG("#wb-card", `주간브리핑_${key}.png`, "#ffffff");
    $("#p-sel", sec).onchange = e => go(e.target.value);
    $("#p-prev", sec).onclick = () => go(keys[i + 1]);
    $("#p-next", sec).onclick = () => go(keys[i - 1]);
    const drawList = () => {
      const f = pstate[kind + ":cat"] || "";
      const L = items.filter(a => !f || (a.cats || []).includes(f));
      $("#p-list", sec).innerHTML = L.map(a => card(a)).join("") || '<div class="empty">해당 기사가 없습니다.</div>';
      $$("#p-filt .chip", sec).forEach(b => b.classList.toggle("on", b.dataset.c === f));
    };
    $("#p-filt", sec).onclick = e => { const b = e.target.closest(".chip"); if (!b) return; pstate[kind + ":cat"] = b.dataset.c; drawList(); };
    drawList();
    hbar("c-p-cat", Object.entries(s.cats).map(([c, n]) => [catName(c), n]), name => catColor(TAX.cats.find(c => c.name === name)?.id), name => { pstate[kind + ":cat"] = TAX.cats.find(c => c.name === name)?.id || ""; drawList(); $("#p-list", sec).scrollIntoView({ behavior: "smooth", block: "start" }); });
    hbar("c-p-kw", (s.kw || []).slice(0, 12), accent());
    if (kind === "day") drawCal(key, sec);
    else drawSub(kind, key, s);
  }
  function drawCal(key, sec) {
    const [y, m] = key.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const off = (first.getUTCDay() + 6) % 7;
    const counts = IDX.days || {};
    const max = Math.max(1, ...Object.entries(counts).filter(([d]) => d.startsWith(key.slice(0, 7))).map(([, n]) => n));
    let h = `<div class="pbar" style="justify-content:space-between"><button class="navbtn" id="cal-p">‹</button><b class="mono">${y}.${String(m).padStart(2, "0")}</b><button class="navbtn" id="cal-n">›</button></div><div class="cal">${"월화수목금토일".split("").map(d => `<div class="dw">${d}</div>`).join("")}`;
    for (let i = 0; i < off; i++) h += `<button class="blank" tabindex="-1"></button>`;
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, n = PER.day[ds]?.n || 0;
      h += `<button class="${n ? "has" : ""} ${ds === key ? "sel" : ""}" style="--lv:${n ? 18 + Math.round(n / max * 62) : 0}" ${n ? `data-d="${ds}" title="${n}건"` : "disabled"}>${d}</button>`;
    }
    h += `</div><p class="note">색이 진할수록 기사가 많은 날. 기사가 있는 날만 누를 수 있습니다.</p>`;
    $("#p-cal", sec).innerHTML = h;
    $("#p-cal", sec).onclick = e => { const b = e.target.closest("button[data-d]"); if (b) location.hash = "#daily/" + b.dataset.d; };
    const ks = Object.keys(PER.day).sort();
    const prevM = ks.filter(k => k < key.slice(0, 7)).pop(), nextM = ks.find(k => k.slice(0, 7) > key.slice(0, 7));
    $("#cal-p", sec).disabled = !prevM; $("#cal-n", sec).disabled = !nextM;
    $("#cal-p", sec).onclick = () => prevM && (location.hash = "#daily/" + prevM);
    $("#cal-n", sec).onclick = () => nextM && (location.hash = "#daily/" + nextM);
  }
  function drawSub(kind, key, s) {
    let labels = [], data = [];
    if (kind === "week") {
      const st = new Date(s.start + "T00:00:00Z");
      for (let i = 0; i < 7; i++) { const d = new Date(st.getTime() + i * 864e5).toISOString().slice(0, 10); labels.push(d.slice(5).replace("-", ".") + " " + "월화수목금토일"[i]); data.push(PER.day[d]?.n || 0); }
      chart("c-p-sub", { legend: { show: false }, xAxis: { type: "category", data: labels }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data, itemStyle: { color: accent(), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 28 }] });
    } else if (kind === "month") {
      const [y, m] = key.split("-").map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let d = 1; d <= n; d++) { const ds = `${key}-${String(d).padStart(2, "0")}`; labels.push(String(d)); data.push(PER.day[ds]?.n || 0); }
      chart("c-p-sub", { legend: { show: false }, xAxis: { type: "category", data: labels }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data, itemStyle: { color: accent(), borderRadius: [2, 2, 0, 0] }, barMaxWidth: 14 }] });
    } else {
      labels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
      const series = TAX.cats.map(c => ({ name: c.name, type: "bar", stack: "c", barMaxWidth: 26, itemStyle: { color: c.color }, data: labels.map((_, i) => PER.month[`${key}-${String(i + 1).padStart(2, "0")}`]?.cats?.[c.id] || 0) }));
      const tot = labels.map((_, i) => PER.month[`${key}-${String(i + 1).padStart(2, "0")}`]?.n || 0);
      series.push({ name: "기사 수", type: "line", data: tot, symbol: "circle", symbolSize: 6, itemStyle: { color: css("--ink") }, lineStyle: { width: 1.5 }, z: 5 });
      chart("c-p-sub", { legend: { type: "scroll", top: 0 }, grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true }, xAxis: { type: "category", data: labels }, yAxis: { type: "value", minInterval: 1 }, series });
    }
  }




  // ---------- NEWS CARDS / WEEKLY BRIEFING (light infographic) ----------
  const NI = {"org": "<circle cx=\"12\" cy=\"4.5\" r=\"2.2\"/><path d=\"M8.5 10.5c0-2 1.6-3.4 3.5-3.4s3.5 1.4 3.5 3.4\"/><path d=\"M12 10.5v2.5M5 16v-2.5h14V16\"/><circle cx=\"5\" cy=\"18\" r=\"1.8\"/><circle cx=\"19\" cy=\"18\" r=\"1.8\"/><circle cx=\"12\" cy=\"18\" r=\"2.4\"/><path d=\"M12 15.6v-1M12 20.4v1M9.6 18h-1M15.4 18h-1\"/>", "network": "<path d=\"M3 7l9-4 9 4-9 4z\"/><path d=\"M3 11l9 4 4-1.8\"/><path d=\"M3 15l9 4 3-1.3\"/><circle cx=\"19\" cy=\"14\" r=\"1.8\"/><circle cx=\"19\" cy=\"20\" r=\"1.8\"/><circle cx=\"15.5\" cy=\"17\" r=\"1.8\"/><path d=\"M17.2 14.9l-.6.9M17.2 19.1l-.6-.9\"/>", "target": "<path d=\"M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4\"/><circle cx=\"12\" cy=\"12\" r=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"1.6\" fill=\"currentColor\"/><path d=\"M12 5v2.5M12 16.5V19M5 12h2.5M16.5 12H19\"/>", "learn": "<circle cx=\"12\" cy=\"5\" r=\"2.6\"/><path d=\"M7.5 12.5c0-2.4 2-4.2 4.5-4.2s4.5 1.8 4.5 4.2\"/><path d=\"M3 13.5c3-.8 6 0 9 2 3-2 6-2.8 9-2v7c-3-.8-6 0-9 2-3-2-6-2.8-9-2z\"/><path d=\"M12 15.5v7\"/>", "policy": "<path d=\"M6 3h9l4 4v8\"/><path d=\"M15 3v4h4\"/><path d=\"M6 3v18h7\"/><path d=\"M9 9h6M9 12h6M9 15h3\"/><path d=\"M17 14l4 1.5v3c0 2-1.8 3.2-4 4-2.2-.8-4-2-4-4v-3z\"/><path d=\"M15.4 18.4l1.2 1.2 2.2-2.4\"/>", "shield": "<path d=\"M12 2.5l8 3v6c0 5-3.6 8.6-8 10-4.4-1.4-8-5-8-10v-6z\"/><rect x=\"8.5\" y=\"11\" width=\"7\" height=\"5.5\" rx=\"1\"/><path d=\"M10 11V9.5a2 2 0 014 0V11\"/>", "gear": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1\"/>", "chart": "<path d=\"M3 21h18\"/><rect x=\"5\" y=\"12\" width=\"3\" height=\"6\"/><rect x=\"10.5\" y=\"8\" width=\"3\" height=\"10\"/><rect x=\"16\" y=\"4\" width=\"3\" height=\"14\"/><path d=\"M4 9l5-4 4 2 7-5\"/>", "truck": "<path d=\"M2 6h11v10H2zM13 9h5l3 3.5V16h-8\"/><circle cx=\"6\" cy=\"17.5\" r=\"1.8\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.8\"/>", "plane": "<path d=\"M12 2c.8 0 1.4.8 1.4 2v5l7.6 4.5v2l-7.6-2.2V18l2.2 1.8V21L12 20l-3.6 1v-1.2l2.2-1.8v-4.7L3 15.5v-2L10.6 9V4c0-1.2.6-2 1.4-2z\"/>", "ship": "<path d=\"M3 15l2 5h14l2-5z\"/><path d=\"M6 15V10h12v5\"/><path d=\"M9 10V6h6v4M12 3v3\"/><path d=\"M2 21.5c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1\"/>", "data": "<ellipse cx=\"12\" cy=\"5\" rx=\"8\" ry=\"2.6\"/><path d=\"M4 5v14c0 1.4 3.6 2.6 8 2.6s8-1.2 8-2.6V5\"/><path d=\"M4 12c0 1.4 3.6 2.6 8 2.6s8-1.2 8-2.6\"/>", "money": "<rect x=\"2.5\" y=\"6\" width=\"19\" height=\"12\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M6 9v.01M18 15v.01\"/>", "robot": "<rect x=\"5\" y=\"8\" width=\"14\" height=\"11\" rx=\"2.5\"/><circle cx=\"9.5\" cy=\"13\" r=\"1.4\"/><circle cx=\"14.5\" cy=\"13\" r=\"1.4\"/><path d=\"M12 8V4.5M10 4.5h4M9.5 16.5h5M3 12v3M21 12v3\"/>", "tank": "<path d=\"M3 14h18l-1.5 3.5h-15z\"/><circle cx=\"6.5\" cy=\"17.5\" r=\"1.4\"/><circle cx=\"12\" cy=\"17.5\" r=\"1.4\"/><circle cx=\"17.5\" cy=\"17.5\" r=\"1.4\"/><path d=\"M6 14v-3h9v3M10 11V9h4M14 10h7\"/>", "parts": "<circle cx=\"9\" cy=\"9\" r=\"4\"/><circle cx=\"9\" cy=\"9\" r=\"1.4\"/><path d=\"M9 3.5v1.5M9 13v1.5M3.5 9H5M13 9h1.5\"/><path d=\"M14 14l6.5 6.5M16 18.5l2.5-2.5\"/><circle cx=\"18\" cy=\"6\" r=\"2.5\"/>"};
  const nIcon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${NI[k] || NI.gear}</svg>`;
  function newsCard(a, no, big) {
    const c = SUMS[a.id];
    if (!c || !c.p) return "";
    return `<div class="nc ${big ? "big" : ""}" ${big ? 'id="nc-card"' : ""}>
      <div class="nc-top"><span class="nc-no">${String(no || 1).padStart(2, "0")}</span><span class="nc-cat">${esc(c.c || "")}</span><span class="nc-ico">${nIcon(c.i)}</span></div>
      <div class="nc-h">${esc(c.h || a.title)}</div>
      <ul class="nc-p">${(c.p || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="nc-f"><span class="rbadge ${a.region}">${esc(RG[a.region]?.name || "")}</span><span>${esc(a.source || "")} · ${esc(a.date)}</span>${big ? "" : `<a href="#" data-nc="${a.id}">자세히</a>`}</div>
    </div>`;
  }
  document.addEventListener("click", e => { const x = e.target.closest("[data-nc]"); if (x) { e.preventDefault(); openDrawer(x.dataset.nc); } });
  function briefHTML(key, s) {
    const b = WB[key];
    if (!b || !b.themes) return "";
    const circ = n => "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"[n - 1] || n;
    const nmap = {}; let nn = 0;
    b.themes.forEach(t => (t.ids || []).forEach(id => { if (!nmap[id]) nmap[id] = ++nn; }));
    return `<div class="wb-wrap"><div class="wb" id="wb-card">
      <div class="wb-head"><h2>국방 군수·AI 주간 브리핑</h2><div class="wb-meta">${esc(s.start.replace(/-/g, ". "))}.–${esc(s.end.slice(5).replace("-", ". "))}. | ${esc(key.replace("-W", "년 ") + "주차")} · ${b.themes.length}개 주제 · ${b.n || s.n}개 기사</div></div>
      <div class="wb-core"><span>이번 주 핵심</span><b>${esc(b.core || "")}</b></div>
      <div class="wb-grid">${b.themes.map((t, i) => `<div class="wb-t"><div class="wb-t-top"><span class="wb-no">${String(i + 1).padStart(2, "0")}</span><span class="wb-cat">${esc(t.cat || "")}</span></div>
        <div class="wb-t-body"><div><div class="wb-h">${esc(t.head || "")}</div><ul>${(t.points || []).map(p => `<li>${esc(p)}</li>`).join("")}</ul></div><div class="wb-ico">${nIcon(t.icon)}</div></div>
        <div class="wb-refs">관련 기사 ${(t.ids || []).slice(0, 6).map(id => `<a href="#" data-nc="${id}" title="${esc(BYID[id]?.title || "")}">${circ(nmap[id])}</a>`).join("")}${(t.ids || []).length > 6 ? ` 외 ${(t.ids || []).length - 6}건` : ""}</div></div>`).join("")}</div>
      ${(b.recs || []).length ? `<div class="wb-recs"><div class="wb-recs-h">우리 군의 의사결정 과제 | 정책적 제언</div><div class="wb-recs-b">${b.recs.map((r, i) => `<div class="wb-r"><span>${i + 1}</span><div><b>${esc(r.t)}</b><p>${esc(r.d)}</p></div></div>`).join("")}</div></div>` : ""}
      <div class="wb-src">출처: 군수정보 인텔리전스 자동 수집 기사 ${b.n || s.n}건 · AI 정리(${esc(b.at || "")}) · 관련 기사 번호를 누르면 원문 정보가 열립니다</div>
    </div><div class="ig-actions"><button class="btn ghost" type="button" id="wb-save">주간 브리핑 이미지로 저장(PNG)</button></div></div>`;
  }
  async function savePNG(sel, name, bg) {
    const el = $(sel);
    if (!el || !window.html2canvas) { toast("이미지 저장 도구를 불러오지 못했습니다."); return; }
    const c = await html2canvas(el, { scale: 2, backgroundColor: bg || "#ffffff", useCORS: true });
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = name; a.click();
  }

  // ---------- DAILY FEED / INFOGRAPHIC / CASES ----------
  const DOW = "일월화수목금토";
  function digestList(dg, n) {
    return `<ul class="dlist">${(dg || []).slice(0, n).map(x => { const a = BYID[x.id]; return `<li><span class="rbadge ${x.r}">${x.r.toUpperCase()}</span><div><a href="${esc(a?.url || "#")}" target="_blank" rel="noopener">${esc(x.t)}</a><span class="also">${esc(x.src)}${x.also ? ` 외 ${x.also}개 매체` : ""}</span>${x.s ? `<p>${esc(x.s)}</p>` : ""}</div></li>`; }).join("")}</ul>`;
  }
  function dailyFeed(n) {
    const days = Object.keys(PER.day).sort().reverse().filter(d => PER.day[d].n > 0).slice(0, n);
    if (!days.length) return '<div class="empty">아직 수집된 기사가 없습니다.</div>';
    return days.map(d => {
      const p = PER.day[d], dt = new Date(d + "T00:00:00Z");
      const body = p.ai ? `<p class="dsum">${esc(p.ai)}</p><div class="dsum-by">AI 요약 · ${esc(p.ai_by || "Claude")} · 대표 기사 아래</div>${digestList(p.digest, 3)}` : digestList(p.digest, 4);
      return `<div class="dday"><div class="dd"><b>${d.slice(5).replace("-", ".")}</b><span>${DOW[dt.getUTCDay()]}요일 · ${p.n}건</span>
        <div class="rg">${REGION_IDS.filter(r => p.regions?.[r]).map(r => `<span class="rbadge ${r}">${r.toUpperCase()} ${p.regions[r]}</span>`).join("")}</div><a href="#daily/${d}">이날 기사 →</a></div><div>${body}</div></div>`;
    }).join("");
  }
  const IG_ICON = {"lis": "<path d=\"M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3\"/>", "wpn": "<path d=\"M12 2l2.2 6.6H21l-5.4 4 2 6.6L12 15.3 6.4 19.2l2-6.6L3 8.6h6.8z\"/>", "fcst": "<path d=\"M3 20h18M5 16l4-5 4 3 6-8\"/><path d=\"M15 6h4v4\"/>"};
  function igHTML(key, s) {
    const d0 = new Date(s.start + "T00:00:00Z");
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(d0.getTime() + i * 864e5).toISOString().slice(0, 10); return [d, PER.day[d]?.n || 0, "월화수목금토일"[i]]; });
    const dmax = Math.max(1, ...days.map(x => x[1]));
    const rtot = Math.max(1, s.n);
    const dcol = { lis: "#3b82f6", wpn: "#f59e0b", fcst: "#10b981" };
    const dsum = DOM_IDS.reduce((t, d) => t + (s.domains?.[d] || 0), 0) || 1;
    let acc = 0;
    const grad = DOM_IDS.map(d => { const a = acc; acc += (s.domains?.[d] || 0) / dsum * 360; return `${dcol[d]} ${a}deg ${acc}deg`; }).join(",");
    const kmax = Math.max(1, ...(s.kw || []).map(x => x[1]));
    const delta = s.prev_n ? s.n - s.prev_n : null;
    const sum = s.ai || s.brief;
    return `<div class="ig-wrap"><div class="ig" id="ig-card">
      <div class="ig-top"><div><div class="ig-eyebrow">WEEKLY INFOGRAPHIC · DEFENSE LOGISTICS AI</div><h2>${esc(s.label)}</h2><div class="ig-eyebrow" style="color:#8ea3bd;letter-spacing:.06em;margin-top:4px">군수통합정보체계 · 무기체계 · 소요예측 주간 동향</div></div>
        <div class="ig-big"><b>${s.n}</b><span>관련 기사${delta == null ? "" : ` · 전주 대비 <span class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta}</span>`}</span></div></div>
      <div class="ig-row">
        <div class="ig-card"><h3>REGION</h3>${REGION_IDS.map(r => { const n = s.regions?.[r] || 0; return `<div class="ig-reg"><span class="c" style="background:${rc(r)}">${r.toUpperCase()}</span><div class="bar"><i style="width:${n / rtot * 100}%;background:${rc(r)}"></i></div><b>${n}</b></div>`; }).join("")}
          <div class="ig-kinds"><span><b>${s.kinds?.contract || 0}</b>사업·계약</span><span><b>${s.kinds?.policy || 0}</b>정책·보고서</span><span><b>${s.ko}</b>국문 · <b>${s.en}</b>영문</span></div></div>
        <div class="ig-card"><h3>DOMAIN</h3><div class="ig-dom"><div class="ig-donut">${donutSVG(DOM_IDS.map(d => [s.domains?.[d] || 0, dcol[d]]), DOM_IDS.reduce((t, d) => t + (s.domains?.[d] || 0), 0))}</div>
          <div class="ig-leg">${DOM_IDS.map(d => `<div><i style="background:${dcol[d]}"></i>${esc(DM[d].name)} <b class="mono">${s.domains?.[d] || 0}</b></div>`).join("")}</div></div></div>
        <div class="ig-card"><h3>DAILY</h3><div class="ig-days">${days.map(([d, n, w]) => `<div><b>${n || ""}</b><i style="height:${n ? Math.max(6, n / dmax * 70) : 2}px"></i>${w}</div>`).join("")}</div></div>
      </div>
      <div class="ig-heads">${(s.digest || []).slice(0, 3).map((x, i) => { const a = BYID[x.id] || {}; const line = a.ai_sum || x.s || ""; return `<div class="ig-head" style="--rc:${rc(x.r)}"><div class="ig-head-top"><span class="ig-rank">${i + 1}</span><svg viewBox="0 0 24 24" class="ig-ico" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${IG_ICON[x.d] || IG_ICON.wpn}</svg><span class="rbadge ${x.r}">${x.r.toUpperCase()}</span>${x.d ? `<span class="ig-dn">${esc(DM[x.d]?.name || "")}</span>` : ""}</div><div class="ig-ht">${esc(x.t)}</div>${line ? `<div class="ig-hs">${esc(line)}</div>` : ""}<div class="ig-hm">${esc(x.src)}${x.also ? ` 외 ${x.also}개 매체` : ""}</div></div>`; }).join("")}</div>
      ${(s.rising || []).length ? `<div class="ig-rise"><span class="ig-rise-l">전주 대비 늘어난 키워드</span>${s.rising.slice(0, 6).map(([k, d, nw]) => `<span class="ig-rk">${esc(k)} <b>▲${d}</b>${nw ? '<em>NEW</em>' : ""}</span>`).join("")}</div>` : ""}
      <div class="ig-main">
        <div class="ig-card"><h3>TOP NEWS</h3><ol class="ig-top5">${(s.digest || []).slice(0, 5).map(x => `<li><div><div class="t">${esc(x.t)}</div><div class="m"><span class="rbadge ${x.r}">${x.r.toUpperCase()}</span>${x.d ? `<span>${esc(DM[x.d]?.name || "")}</span>` : ""}<span>${esc(x.src)}${x.also ? ` 외 ${x.also}개 매체` : ""}</span>${x.k === "contract" ? '<span style="color:#fbbf24">사업·계약</span>' : ""}</div></div></li>`).join("")}</ol></div>
        <div class="ig-card"><h3>KEYWORDS</h3><div class="ig-cloud">${(s.kw || []).slice(0, 14).map(([k, n]) => `<span style="font-size:${12 + Math.round(n / kmax * 14)}px;opacity:${.55 + n / kmax * .45}">${esc(k)}</span>`).join("")}</div>
          <h3 style="margin-top:6px">SUMMARY</h3><div class="ig-sum">${esc(sum)}</div></div>
      </div>
      <div class="ig-foot"><span>군수정보 인텔리전스 · 자동 수집·분류</span><span>${s.ai ? "요약: " + esc(s.ai_by || "Claude") + " · " : ""}갱신 ${esc(IDX.updated)}</span></div>
    </div><div class="ig-actions"><button class="btn ghost" type="button" id="ig-save">인포그래픽 이미지로 저장(PNG)</button></div></div>`;
  }
  function donutSVG(parts, total) {
    const R = 44, C = 2 * Math.PI * R, sum = parts.reduce((t, p) => t + p[0], 0) || 1;
    let off = 0;
    const segs = parts.filter(p => p[0]).map(([v, col]) => { const len = v / sum * C; const el = `<circle cx="56" cy="56" r="${R}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 56 56)"/>`; off += len; return el; }).join("");
    return `<svg viewBox="0 0 112 112" role="img" aria-label="분야 구성"><circle cx="56" cy="56" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="18"/>${segs}<text x="56" y="62" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="18" font-weight="600" fill="#f2f7ff">${total}</text></svg>`;
  }
  async function saveIG(key) {
    const el = $("#ig-card");
    if (!el || !window.html2canvas) { toast("이미지 저장 도구를 불러오지 못했습니다. 잠시 후 다시 시도하세요."); return; }
    const c = await html2canvas(el, { scale: 2, backgroundColor: "#06101e", useCORS: true });
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `주간인포그래픽_${key}.png`; a.click();
  }
  function caseHTML(c) {
    return `<div class="panel case">
      <div class="case-head"><div><div class="eyebrow">해외 사례 심층 · ${esc(RG[c.country]?.name || "")} · ${esc(c.org)}</div><h2>${esc(c.title)}</h2><p class="lede" style="margin-top:4px">${esc(c.summary)}</p></div>
        <div class="case-tags"><span class="ok">${esc(c.status)}</span>${c.tags.map((t, i) => `<span class="${i === 0 ? "ml" : ""}">${esc(t)}</span>`).join("")}<span>${esc(c.vendor)}</span></div></div>
      <div class="case-body">
        <div style="display:grid;gap:14px;align-content:start">
          <div><h3>목적 · 해결하려는 문제</h3><p class="note" style="font-size:14px;color:var(--ink-2)">${esc(c.problem)}</p></div>
          <div><h3>핵심 수치</h3><p class="note">초록 = 실적·계약, 주황 = 추정치(회사·시제 분석). 출처 번호는 아래 목록.</p>
            <div class="case-metrics" style="margin-top:8px">${c.metrics.map(m => `<div class="cm"><b>${esc(m.v)}</b><span>${esc(m.l)}</span><em class="${/추정/.test(m.t) ? "est" : ""}">${esc(m.t)} [${m.src + 1}]</em></div>`).join("")}</div></div>
          <div><h3>연혁</h3><ol class="timeline">${c.timeline.map(t => `<li><div class="when">${esc(t.when)}</div><p>${esc(t.what)}</p></li>`).join("")}</ol></div>
        </div>
        <div class="case-flow"><div class="note" style="color:#a9bcd6;text-align:center">작동 개념</div>${c.flow.map((f, i) => `${i ? '<div class="ar">▼</div>' : ""}<div class="st ${/AI/.test(f.k) ? "ai" : ""}"><small>${esc(f.k)}</small><b>${esc(f.v)}</b></div>`).join("")}</div>
      </div>
      <div class="case-cols">
        <div><h3>한계 · 감사 지적</h3><ul class="plain">${c.limits.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="case-imp"><h3>과제 · 한국 시사점</h3><ul class="plain">${c.implications.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <div><h3>출처</h3><ol class="plain" style="font-size:13px">${c.sources.map(x => `<li><a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a></li>`).join("")}</ol></div>
    </div>`;
  }

  // ---------- REGIONS ----------
  const REGION_IDS = ["us", "eu", "kr", "etc"];
  const DOM_IDS = ["lis", "wpn", "fcst"];
  const rc = r => css("--r-" + r) || "#2563eb";
  const REGION_INFO = {
    us: { en: "United States", lede: "이 분야에서 가장 빠르게 움직이는 지역입니다. 미 육군 AI 정비 도구(AIAM)의 Vantage 데이터 플랫폼 이전, F-35 ALIS→ODIN 클라우드 전환, DLA 수요예측 정확도 목표(85%), 국방부 공급망 위험 예측 도구(JDST)처럼 정보체계·예측 사업이 활발합니다." },
    eu: { en: "Europe · NATO", lede: "영국 DE&S·국방부, NATO 지원조달청(NSPA), EU 방위청(EDA)을 중심으로 공동조달, 군수 디지털화, 공급망 회복력 사업을 추적합니다." },
    kr: { en: "Republic of Korea", lede: "2020년 6개 체계를 통합한 국방군수통합정보체계를 기반으로, 국방 AX, 수리부속 상호융통 AI, 성과기반군수지원(PBL) 확대, 스마트 물류센터 등 미국을 따라잡으려는 움직임을 모읍니다." },
    etc: { en: "Rest of world · Global", lede: "호주·일본·인도·이스라엘·캐나다·싱가포르 등과, 특정 국가로 나누기 어려운 글로벌 시장·기술 기사를 모읍니다." },
  };
  const rstate = {};
  const inDom = (a, d) => d === "all" ? true : d === "none" ? !(a.domains || []).length : (a.domains || []).includes(d);
  function srcStatus(id) {
    const st = FST.sources?.[id];
    if (!st) return `<span class="stat"><i class="na"></i>다음 수집 때 확인</span>`;
    const how = st.mode === "rss" ? "RSS" : st.mode === "gnews" ? "검색 대체" : st.mode === "api" ? "API" : "";
    return st.ok ? `<span class="stat"><i class="ok"></i>정상 ${how} · 최근 ${st.n}건 중 관련 ${st.kept || 0}건 · 누적 ${st.total_kept || 0}건</span>`
      : `<span class="stat"><i class="bad"></i>${esc(st.err || st.rss_err || "실패")}</span>`;
  }
  function srcCard(s) {
    const sub = s.sub || {};
    const btn = sub.url ? `<a class="main" href="${esc(sub.url)}" target="_blank" rel="noopener">${esc(sub.label || "가입")}</a>` : "";
    const btn2 = sub.url2 ? `<a href="${esc(sub.url2)}" target="_blank" rel="noopener">${esc(sub.label2)}</a>` : "";
    const auto = s.auto && (s.auto.rss || s.auto.gnews || s.auto.api);
    const how = { newsletter: "뉴스레터 가입 권장", account: "계정·알림 설정 권장", api: "API 신청 시 자동 연결", paid: "유료", site: "사이트 방문", auto: "가입 불필요 · 자동 수집" }[sub.mode] || "";
    return `<div class="srcc" style="--rc:${rc(s.region)}"><h3>${esc(s.name)} <span class="pill">${esc(s.type)}</span><span class="stars" title="추천도">${"★".repeat(s.rec || 1)}${"☆".repeat(3 - (s.rec || 1))}</span></h3>
      <p>${esc(s.desc)}</p>
      <div class="tags"><span class="rbadge ${s.region}">${esc(RG[s.region]?.name)}</span>${(s.domains || []).map(d => `<span class="tag-d">${esc(DM[d]?.name)}</span>`).join("")}<span class="tag-k">${esc(how)}</span></div>
      ${auto ? srcStatus(s.id === "d2b" && FST.sources?.["d2b-api"]?.ok ? "d2b-api" : s.id) : `<span class="stat"><i class="na"></i>자동 수집 없음 — 직접 구독</span>`}
      <div class="acts">${btn}${btn2}<a href="${esc(s.url)}" target="_blank" rel="noopener">사이트</a></div></div>`;
  }
  function rRegion(rid, arg) {
    const st = rstate[rid] = rstate[rid] || { d: "all", page: 0 };
    if (arg && ["all", "lis", "wpn", "fcst", "none"].includes(arg) && arg !== st.d) { st.d = arg; st.page = 0; }
    const sec = $("#v-" + rid), info = REGION_INFO[rid];
    const L0 = ARTS.filter(a => a.region === rid);
    const L = L0.filter(a => inDom(a, st.d));
    const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const srcs = SRCS.filter(x => x.region === rid);
    const okSrc = srcs.filter(x => FST.sources?.[x.id]?.ok).length;
    const contracts = L.filter(a => a.kind === "contract");
    const tabs = [["all", "전체", "이 지역 모든 기사"]].concat(DOM_IDS.map(d => [d, DM[d].name, DM[d].desc]), [["none", "분야 미분류", "세 분야 키워드가 없는 기사"]]);
    const dn = st.d === "all" ? "전체" : st.d === "none" ? "분야 미분류" : DM[st.d].name;
    sec.style.setProperty("--rc", rc(rid));
    sec.innerHTML = `
      <div class="rhead"><div class="vhead"><div class="eyebrow" style="color:${rc(rid)}">REGION · ${esc(info.en)}</div><h1>${esc(RG[rid].name)}</h1><p class="lede">${esc(info.lede)}</p></div><div class="rcode">${rid.toUpperCase()}</div></div>
      <div class="dtabs" id="r-tabs">${tabs.map(([k, l, d]) => `<button class="dtab ${st.d === k ? "on" : ""}" data-d="${k}"><span class="n">${L0.filter(a => inDom(a, k)).length}</span><span class="l">${esc(l)}</span><span class="d">${esc(d)}</span></button>`).join("")}</div>
      ${CASES.filter(c => c.country === rid).map(c => `<a class="panel" href="#system" style="display:flex;gap:14px;align-items:center;color:var(--ink);text-decoration:none;border-left:4px solid ${rc(rid)}"><span class="pill" style="background:#15803d;color:#fff">대표 사례</span><span><b>${esc(c.title)}</b> <span class="note">· ${esc(c.org)} · ${esc(c.vendor)}</span><br><span class="note">${esc(c.summary)}</span></span><span class="more" style="margin-left:auto;white-space:nowrap">사례 보기 →</span></a>`).join("")}
      <div class="kpis">
        <div class="kpi"><div class="v">${fmt(L.length)}</div><div class="l">${esc(dn)} 기사</div></div>
        <div class="kpi"><div class="v">${fmt(L.filter(a => a.date >= d30).length)}</div><div class="l">최근 30일</div></div>
        <div class="kpi"><div class="v">${fmt(contracts.length)}</div><div class="l">사업·계약</div></div>
        <div class="kpi"><div class="v">${okSrc}<span class="note"> / ${srcs.length}</span></div><div class="l">자동 수집 중인 소스</div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><h2>월별 기사 수(분야별)</h2><div class="chart" id="c-r-trend"></div></div>
        <div class="panel"><h2>핵심 키워드 · ${esc(dn)}</h2><div class="chart" id="c-r-kw"></div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><h2>신규 사업·계약</h2><p class="note">계약·수주·입찰·투자 표현이 있는 기사</p><div class="cards" style="margin-top:10px">${contracts.slice(0, 8).map(a => card(a, { compact: true })).join("") || '<div class="empty">아직 없습니다.</div>'}</div></div>
        <div class="panel"><h2>자주 나온 기관·기업·체계</h2><div class="chips" style="margin-top:10px">${topCount(L.flatMap(a => a.ents || []), 18).map(([e, n]) => `<span class="chip">${esc(e)}<span class="n">${n}</span></span>`).join("") || '<span class="note">—</span>'}</div>
          <h3 style="margin-top:16px">주요 매체</h3><div class="chips small" style="margin-top:8px">${topCount(L.map(a => a.source), 10).map(([e, n]) => `<span class="chip">${esc(e)}<span class="n">${n}</span></span>`).join("")}</div></div>
      </div>
      <div class="panel"><div class="sec-head"><h2>${esc(RG[rid].name)} · ${esc(dn)} 기사 <span class="note mono">${L.length}건</span></h2><a class="more" href="#search">상세 검색 →</a></div><div class="cards" id="r-list"></div><div class="pager" id="r-pager"></div></div>
      <div class="panel"><div class="sec-head"><h2>${esc(RG[rid].name)} 모니터링 소스</h2><a class="more" href="#sources">전체 소스 →</a></div><div class="srcgrid">${srcs.map(srcCard).join("")}</div></div>`;
    $("#r-tabs", sec).onclick = e => { const b = e.target.closest(".dtab"); if (b) location.hash = `#${rid}/${b.dataset.d}`; };
    const per = 20, pages = Math.max(1, Math.ceil(L.length / per)); st.page = Math.min(st.page, pages - 1);
    const draw = () => {
      $("#r-list", sec).innerHTML = L.slice(st.page * per, st.page * per + per).map(a => card(a)).join("") || '<div class="empty">아직 수집된 기사가 없습니다. 매일 자동 수집으로 쌓입니다.</div>';
      $("#r-pager", sec).innerHTML = pages > 1 ? `<button class="navbtn" ${st.page ? "" : "disabled"} data-p="-1">‹</button><span class="mono">${st.page + 1} / ${pages}</span><button class="navbtn" ${st.page < pages - 1 ? "" : "disabled"} data-p="1">›</button>` : "";
    };
    $("#r-pager", sec).onclick = e => { const b = e.target.closest("button[data-p]"); if (b) { st.page += +b.dataset.p; draw(); } };
    draw();
    const ax = TR.months.map(m => m.slice(2).replace("-", "."));
    const dpal = { lis: "#2563eb", wpn: "#d97706", fcst: "#059669" };
    chart("c-r-trend", { xAxis: { type: "category", data: ax }, yAxis: { type: "value", minInterval: 1 },
      series: DOM_IDS.filter(d => st.d === "all" || st.d === d).map(d => ({ name: DM[d].name, type: "bar", stack: "d", barMaxWidth: 18, itemStyle: { color: dpal[d] }, data: TR.m_rd?.[`${rid}:${d}`] || [] })) });
    hbar("c-r-kw", topCount(L.flatMap(a => a.kw || []), 12), rc(rid));
  }
  function topCount(arr, n) { const c = {}; arr.forEach(x => { if (x) c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n); }

  // ---------- COMPARE ----------
  function rCompare() {
    const cnt = (r, d) => ARTS.filter(a => a.region === r && (d ? (a.domains || []).includes(d) : true)).length;
    let h = `<table><tr><th></th>${DOM_IDS.map(d => `<th>${esc(DM[d].name)}</th>`).join("")}<th>지역 전체</th></tr>`;
    for (const r of REGION_IDS) {
      const tot = cnt(r), mx = Math.max(1, ...DOM_IDS.map(d => cnt(r, d)));
      h += `<tr style="--rc:${rc(r)}"><th class="rl"><span class="rbadge ${r}">${r.toUpperCase()}</span> ${esc(RG[r].name)}</th>${DOM_IDS.map(d => { const n = cnt(r, d); return `<td style="--lv:${n ? 12 + Math.round(n / mx * 55) : 0}" data-go="${r}/${d}"><b>${n}</b><span>${tot ? Math.round(n / tot * 100) : 0}%</span></td>`; }).join("")}<td class="tot"><b>${tot}</b><span>건</span></td></tr>`;
    }
    h += `</table>`;
    $("#cmp-matrix").innerHTML = h;
    $("#cmp-matrix").onclick = e => { const td = e.target.closest("td[data-go]"); if (td) location.hash = "#" + td.dataset.go; };
    const ax = TR.months.map(m => m.slice(2).replace("-", "."));
    chart("c-cmp-trend", { xAxis: { type: "category", data: ax }, yAxis: { type: "value", minInterval: 1 },
      series: REGION_IDS.map(r => ({ name: RG[r].name, type: "line", smooth: true, symbolSize: 5, data: TR.m_regions?.[r] || [], itemStyle: { color: rc(r) } })) });
    const dpal = { lis: "#2563eb", wpn: "#d97706", fcst: "#059669" };
    chart("c-cmp-share", { tooltip: { trigger: "axis", valueFormatter: v => v + "%" }, xAxis: { type: "category", data: REGION_IDS.map(r => RG[r].name) }, yAxis: { type: "value", max: 100, axisLabel: { formatter: "{value}%" } },
      series: DOM_IDS.map(d => ({ name: DM[d].name, type: "bar", stack: "s", barMaxWidth: 46, itemStyle: { color: dpal[d] },
        data: REGION_IDS.map(r => { const t = DOM_IDS.reduce((s, x) => s + cnt(r, x), 0); return t ? Math.round(cnt(r, d) / t * 100) : 0; }) })) });
    // 키워드 비중 차이
    const share = r => { const L = ARTS.filter(a => a.region === r), c = {}; L.forEach(a => (a.kw || []).forEach(k => (c[k] = (c[k] || 0) + 1))); const n = Math.max(1, L.length); return [c, n]; };
    const [cu, nu] = share("us"), [ck, nk] = share("kr");
    const keys = [...new Set(Object.keys(cu).concat(Object.keys(ck)))];
    const diff = keys.map(k => [k, Math.round(((cu[k] || 0) / nu - (ck[k] || 0) / nk) * 100)]).filter(x => x[1] !== 0).sort((a, b) => a[1] - b[1]);
    const shown = diff.slice(0, 8).concat(diff.slice(-8)).filter((x, i, arr) => arr.findIndex(y => y[0] === x[0]) === i).sort((a, b) => a[1] - b[1]);
    chart("c-cmp-gap", { tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: v => (v > 0 ? "+" : "") + v + "%p" }, legend: { show: false },
      grid: { left: 8, right: 30, top: 10, bottom: 8, containLabel: true },
      xAxis: { type: "value", axisLabel: { formatter: v => (v > 0 ? "+" : "") + v + "%p" } }, yAxis: { type: "category", data: shown.map(x => x[0]), axisLabel: { color: css("--ink-2"), fontSize: 12 } },
      series: [{ type: "bar", barMaxWidth: 16, data: shown.map(x => ({ value: x[1], itemStyle: { color: x[1] > 0 ? rc("us") : rc("kr"), borderRadius: 3 } })), label: { show: true, position: "right", fontSize: 11, color: css("--muted"), formatter: p => (p.value > 0 ? "+" : "") + p.value } }] });
    const usMore = diff.filter(x => x[1] > 0).slice(-4).reverse().map(x => x[0]), krMore = diff.filter(x => x[1] < 0).slice(0, 4).map(x => x[0]);
    const ins = [];
    ins.push(`누적 기사: 미국 <b>${nu === 1 && !cnt("us") ? 0 : cnt("us")}건</b>, 한국 <b>${cnt("kr")}건</b>, 유럽 <b>${cnt("eu")}건</b>, 그외 <b>${cnt("etc")}건</b>.`);
    if (usMore.length) ins.push(`미국 기사에서 상대적으로 많이 다루는 주제: <b>${usMore.map(esc).join(", ")}</b>. 한국이 아직 덜 다루는 영역으로, 벤치마킹 후보입니다.`);
    if (krMore.length) ins.push(`한국 기사에서 상대적으로 많이 다루는 주제: <b>${krMore.map(esc).join(", ")}</b>.`);
    ins.push(`표본이 적은 초기에는 차이가 크게 보일 수 있습니다. 매일 수집이 쌓일수록 비교가 안정됩니다.`);
    $("#cmp-ins").innerHTML = ins.map(x => `<li>${x}</li>`).join("");
    const d90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    $("#cmp-contracts").innerHTML = REGION_IDS.map(r => { const L = ARTS.filter(a => a.region === r && a.kind === "contract" && a.date >= d90); return `<div style="--rc:${rc(r)}"><h3><span class="rbadge ${r}">${r.toUpperCase()}</span> ${esc(RG[r].name)} <span class="note mono">${L.length}건</span></h3><div class="cards" style="margin-top:8px">${L.slice(0, 4).map(a => card(a, { compact: true })).join("") || '<div class="empty">—</div>'}</div></div>`; }).join("");
  }

  // ---------- SOURCES ----------
  let srcTab = "all";
  const subKey = "lis-subscribed";
  function rSources() {
    const done = store.get(subKey, {});
    const subs = SRCS.filter(s => ["newsletter", "account", "api"].includes(s.sub?.mode)).sort((a, b) => (b.rec || 0) - (a.rec || 0) || REGION_IDS.indexOf(a.region) - REGION_IDS.indexOf(b.region));
    const autos = SRCS.filter(s => s.auto && (s.auto.rss || s.auto.gnews || s.auto.api));
    const okN = autos.filter(s => FST.sources?.[s.id]?.ok).length;
    const doneN = subs.filter(s => done[s.id]).length;
    $("#src-kpis").innerHTML = [[SRCS.length, "추천 소스"], [`${okN}/${autos.length}`, "자동 수집 정상"], [subs.length, "가입 추천"], [`${doneN}/${subs.length}`, "내가 가입 완료"]]
      .map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
    $("#src-prog").textContent = `${doneN} / ${subs.length} 완료`;
    $("#src-sub").innerHTML = subs.map(s => `<label class="subitem ${done[s.id] ? "done" : ""}"><input type="checkbox" data-id="${s.id}" ${done[s.id] ? "checked" : ""}>
      <span><span class="nm"><span class="rbadge ${s.region}">${s.region.toUpperCase()}</span> ${esc(s.name)}</span><br><span class="ds">${esc(s.sub.label)} · ${esc(s.desc.slice(0, 60))}${s.desc.length > 60 ? "…" : ""}</span></span>
      <a class="btn ghost" href="${esc(s.sub.url)}" target="_blank" rel="noopener" style="padding:5px 10px;font-size:13px">열기</a></label>`).join("");
    $("#src-sub").onchange = e => { const c = e.target.closest("input[data-id]"); if (!c) return; const d = store.get(subKey, {}); if (c.checked) d[c.dataset.id] = new Date().toISOString().slice(0, 10); else delete d[c.dataset.id]; store.set(subKey, d); rSources(); };
    $("#src-tabs").innerHTML = [["all", "전체"]].concat(REGION_IDS.map(r => [r, RG[r].name])).map(([k, l]) => `<button class="chip ${srcTab === k ? "on" : ""}" data-t="${k}">${esc(l)}<span class="n">${SRCS.filter(s => k === "all" || s.region === k).length}</span></button>`).join("");
    $("#src-tabs").onclick = e => { const b = e.target.closest(".chip"); if (b) { srcTab = b.dataset.t; rSources(); } };
    const lr = FST.last_run, q = FST.sources?.["gnews-queries"];
    $("#src-run").innerHTML = FST.updated ? `마지막 수집 ${esc(FST.updated)} · 원자료 ${fmt(lr?.raw)}건 → 관련 ${fmt(lr?.relevant)}건 → 신규 ${fmt(lr?.new)}건${q ? ` · 주제 검색어 ${q.queries_ok}/${q.queries}개 정상` : ""}` : "수집 상태는 다음 자동 수집 후 표시됩니다.";
    $("#src-list").innerHTML = SRCS.filter(s => srcTab === "all" || s.region === srcTab).sort((a, b) => REGION_IDS.indexOf(a.region) - REGION_IDS.indexOf(b.region) || (b.rec || 0) - (a.rec || 0)).map(srcCard).join("");
  }

  // ---------- TOPICS ----------
  let tpUnit = "month", tpSel = null;
  function rTopics() {
    const ax = tpUnit === "month" ? TR.months.map(m => m.slice(2).replace("-", ".")) : TR.weeks_label;
    $("#tp-unit").innerHTML = [["month", "월별(최근 24개월)"], ["week", "주별(최근 26주)"]].map(([k, l]) => `<button class="chip ${tpUnit === k ? "on" : ""}" data-u="${k}">${l}</button>`).join("");
    $("#tp-unit").onclick = e => { const b = e.target.closest(".chip"); if (b) { tpUnit = b.dataset.u; rTopics(); } };
    const src = tpUnit === "month" ? TR.m_cats : TR.w_cats;
    chart("c-tp-cats", { legend: { type: "scroll" }, grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true }, xAxis: { type: "category", data: ax }, yAxis: { type: "value", minInterval: 1 },
      series: TAX.cats.map(c => ({ name: c.name, type: "line", smooth: true, symbol: "none", data: src[c.id], itemStyle: { color: c.color }, lineStyle: { width: 2 }, areaStyle: { opacity: .05 } })) });
    const tot = {}; ARTS.forEach(a => (a.cats || []).forEach(c => (tot[c] = (tot[c] || 0) + 1)));
    chart("c-tp-share", { tooltip: { trigger: "item" }, legend: { show: false },
      series: [{ type: "pie", radius: ["45%", "72%"], itemStyle: { borderColor: css("--surface"), borderWidth: 2 }, label: { color: css("--ink-2"), fontSize: 12, formatter: "{b}\n{c}건" },
        data: TAX.cats.map(c => ({ name: c.name, value: tot[c.id] || 0, itemStyle: { color: c.color } })).filter(d => d.value) }] });
    const lk = tpUnit === "month" ? [TR.m_ko, TR.m_en] : [null, null];
    if (tpUnit === "month") chart("c-tp-lang", { xAxis: { type: "category", data: ax }, yAxis: { type: "value", minInterval: 1 }, series: [{ name: "국내", type: "bar", stack: "l", data: lk[0], itemStyle: { color: accent() } }, { name: "해외", type: "bar", stack: "l", data: lk[1], itemStyle: { color: teal() } }] });
    else chart("c-tp-lang", { xAxis: { type: "category", data: ax }, yAxis: { type: "value", minInterval: 1 }, series: [{ name: "전체", type: "bar", data: TR.w_total, itemStyle: { color: accent() } }] });
    const kws = Object.keys(TR.kw_month);
    if (!tpSel) tpSel = kws.slice(0, 5);
    $("#tp-kw").innerHTML = kws.map(k => `<button class="chip ${tpSel.includes(k) ? "on" : ""}" data-k="${esc(k)}">${esc(k)}</button>`).join("");
    $("#tp-kw").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k; tpSel = tpSel.includes(k) ? tpSel.filter(x => x !== k) : tpSel.concat(k); rTopics(); };
    const ks = tpUnit === "month" ? TR.kw_month : TR.kw_week;
    const pal = ["#2563eb", "#0d9488", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#475569", "#059669", "#0891b2", "#ca8a04"];
    chart("c-tp-kw", { legend: { type: "scroll" }, grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true }, xAxis: { type: "category", data: ax }, yAxis: { type: "value", minInterval: 1 },
      series: tpSel.map((k, i) => ({ name: k, type: "line", smooth: true, data: ks[k], symbolSize: 5, itemStyle: { color: pal[i % pal.length] } })) });
    hbar("c-tp-ents", TR.ents.slice(0, 16).map(([e, n]) => [e, n]), teal());
    hbar("c-tp-src", TR.sources.slice(0, 16), accent());
  }

  // ---------- NETWORK ----------
  const NET_TYPES = ["주제", "키워드", "기관", "군", "해외기관", "기업", "무기체계", "행사"];
  const NET_COL = { "주제": "#0f766e", "키워드": "#2563eb", "기관": "#b45309", "군": "#dc2626", "해외기관": "#7c3aed", "기업": "#db2777", "무기체계": "#475569", "행사": "#0891b2" };
  function rNetwork() {
    const min = +$("#net-min").value;
    const links = TR.net.links.filter(l => l.w >= min);
    const used = new Set(links.flatMap(l => [l.s, l.t]));
    const nodes = TR.net.nodes.filter(n => used.has(n.id));
    const types = NET_TYPES.filter(t => nodes.some(n => n.type === t));
    $("#net-legend").innerHTML = types.map(t => `<span><i style="background:${NET_COL[t]}"></i>${t}</span>`).join("");
    const mx = Math.max(1, ...nodes.map(n => n.n));
    const c = chart("c-net", {
      tooltip: { trigger: "item", formatter: p => p.dataType === "edge" ? `${esc(p.data.sn)} — ${esc(p.data.tn)}: ${p.data.value}회` : `${esc(p.data.name)} (${esc(p.data.t)}) · ${p.data.n}건` },
      legend: { show: false },
      series: [{
        type: "graph", layout: "force", roam: true, draggable: true,
        force: { repulsion: 420, edgeLength: [70, 200], gravity: .12, layoutAnimation: false, friction: .2 },
        label: { show: true, position: "right", fontSize: 11, color: css("--ink-2") },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: "adjacency", lineStyle: { width: 3 } },
        data: nodes.map(n => ({ id: n.id, name: n.name, t: n.type, n: n.n, symbolSize: 8 + 30 * Math.sqrt(n.n / mx), itemStyle: { color: NET_COL[n.type] || "#64748b" } })),
        links: links.map(l => ({ source: l.s, target: l.t, value: l.w, sn: l.s.slice(2), tn: l.t.slice(2), lineStyle: { width: Math.min(6, .6 + l.w * .7), color: css("--muted"), opacity: .35, curveness: .1 } })),
      }],
    });
    c && c.on("click", p => { if (p.dataType === "node") netDetail(p.data); });
    $("#net-min").onchange = rNetwork;
  }
  function netDetail(n) {
    const [k, name] = [n.id[0], n.id.slice(2)];
    const L = ARTS.filter(a => k === "k" ? (a.kw || []).includes(name) : k === "e" ? (a.ents || []).includes(name) : (a.cats || []).includes(name));
    const el = $("#net-detail"); el.hidden = false;
    el.innerHTML = `<div class="sec-head"><h2>${esc(n.name)} <span class="pill">${esc(n.t)}</span> 관련 기사 ${L.length}건</h2></div><div class="cards">${L.slice(0, 20).map(a => card(a, { compact: true })).join("")}</div>`;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- PROJECT ----------
  let pjAxis = "ram";
  function rProject() {
    const ms = TR.months.slice(-12);
    $("#pj-cards").innerHTML = TAX.axes.map(a => {
      const L = ARTS.filter(x => (x.axes || []).includes(a.id));
      const last = L[0];
      return `<div class="axc ${pjAxis === a.id ? "on" : ""}" data-a="${a.id}" role="button" tabindex="0"><div class="cap-k">AXIS · ${a.id.toUpperCase()}</div><h3>${esc(a.name)}</h3><div class="v">${fmt(L.length)}<span class="note"> 건</span></div><div class="note">최근: ${last ? esc(last.date) + " · " + esc(last.source) : "—"}</div><div class="spark" id="sp-${a.id}"></div></div>`;
    }).join("");
    $("#pj-cards").onclick = e => { const c = e.target.closest(".axc"); if (c) { pjAxis = c.dataset.a; rProject(); } };
    const pal = { ram: "#059669", parts: "#d97706", manpower: "#dc2626" };
    TAX.axes.forEach(a => chart("sp-" + a.id, { grid: { left: 0, right: 0, top: 4, bottom: 0 }, legend: { show: false }, tooltip: { show: false }, xAxis: { type: "category", show: false, data: ms }, yAxis: { type: "value", show: false }, series: [{ type: "bar", data: TR.m_axes[a.id].slice(-12), itemStyle: { color: pal[a.id] || accent(), opacity: .8 }, barWidth: "60%" }] }));
    chart("c-pj-trend", { xAxis: { type: "category", data: TR.months.map(m => m.slice(2).replace("-", ".")) }, yAxis: { type: "value", minInterval: 1 },
      series: TAX.axes.map(a => ({ name: a.name, type: "line", smooth: true, data: TR.m_axes[a.id], itemStyle: { color: pal[a.id] }, symbolSize: 5 })) });
    const ax = AX[pjAxis];
    $("#pj-tabs").innerHTML = TAX.axes.map(a => `<button class="chip ${pjAxis === a.id ? "on" : ""}" data-a="${a.id}">${esc(a.name)}</button>`).join("");
    $("#pj-tabs").onclick = e => { const b = e.target.closest(".chip"); if (b) { pjAxis = b.dataset.a; rProject(); } };
    const L = ARTS.filter(x => (x.axes || []).includes(pjAxis));
    const kc = {}, ec = {};
    L.forEach(a => { (a.kw || []).forEach(k => (kc[k] = (kc[k] || 0) + 1)); (a.ents || []).forEach(k => (ec[k] = (ec[k] || 0) + 1)); });
    const kp = Object.entries(kc).sort((a, b) => b[1] - a[1]);
    $("#pj-kw-h").textContent = `‘${ax.name}’ 기사에 함께 나온 키워드`;
    hbar("c-pj-kw", kp.slice(0, 12), pal[pjAxis]);
    const ko = L.filter(a => a.lang === "ko").length, en = L.length - ko;
    const ep = Object.entries(ec).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
    const recent = L.filter(a => a.date >= new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)).length;
    const ins = [];
    ins.push(`누적 <b>${L.length}건</b>(국내 ${ko} · 해외 ${en}), 최근 90일 <b>${recent}건</b>.`);
    if (kp.length) ins.push(`가장 자주 함께 나온 키워드는 <b>${kp.slice(0, 3).map(k => esc(k[0])).join(", ")}</b>입니다. 과제의 입력 데이터·방법론 키워드로 참고할 만합니다.`);
    if (ep.length) ins.push(`주로 언급된 기관·기업: ${ep.map(esc).join(", ")}.`);
    if (en > ko) ins.push(`해외 기사가 더 많습니다. 국내 적용 사례가 아직 적다는 신호일 수 있어, 해외 사례(DLA, 미 육군 등)를 비교 기준으로 쓰기 좋습니다.`);
    else if (ko) ins.push(`국내 기사 비중이 높아 국내 정책·사업 흐름과 직접 연결해 설명하기 좋습니다.`);
    if (pjAxis === "manpower") ins.push(`병력 감소 관련 기사는 정비소요인력 예측의 필요성을 설명하는 근거로 쓸 수 있습니다.`);
    if (pjAxis === "parts") ins.push(`수리부속 상호융통·재고·공급망 기사는 수요예측 결과를 어디에 쓰는지(활용 시나리오) 보여 주는 근거가 됩니다.`);
    if (pjAxis === "ram") ins.push(`가동률·예지정비 기사는 RAM 지표(신뢰도·가용도)를 예측 모델의 목표 변수로 잡는 근거가 됩니다.`);
    $("#pj-ins").innerHTML = ins.map(x => `<li>${x}</li>`).join("");
    $("#pj-list-h").textContent = `‘${ax.name}’ 관련 기사 ${L.length}건`;
    $("#pj-list").innerHTML = L.slice(0, 40).map(a => card(a)).join("") || '<div class="empty">관련 기사가 없습니다.</div>';
  }

  // ---------- SYSTEM ----------
  function rSystem() {
    if (rendered.system && $("#sysmap").innerHTML) return;
    const legacy = ["국방군수지휘", "국방탄약", "국방물자", "육군 장비정비", "해군 장비정비", "공군 장비정비"];
    const fn = ["재고·거래·단가 데이터 표준화", "탄약·물자 통합 관리", "3군 공통 군수지원", "전시·훈련 체계 별도 운영"];
    const W = 900, rowH = 46;
    let s = `<svg viewBox="0 0 ${W} 330" role="img" aria-label="6개 군수정보체계가 국방군수통합정보체계로 통합되는 구조">`;
    legacy.forEach((t, i) => {
      const y = 22 + i * rowH;
      s += `<rect x="10" y="${y}" width="190" height="34" rx="6" fill="var(--surface-2)" stroke="var(--line)"/><text x="105" y="${y + 22}" text-anchor="middle" font-size="14" fill="var(--ink)">${t}</text>`;
      s += `<path d="M200 ${y + 17} C 290 ${y + 17}, 290 165, 352 165" fill="none" stroke="var(--accent)" stroke-opacity=".5" stroke-width="1.5"/>`;
      s += `<circle r="3" fill="var(--teal)"><animateMotion dur="${2.2 + i * .25}s" repeatCount="indefinite" path="M200 ${y + 17} C 290 ${y + 17}, 290 165, 352 165"/></circle>`;
    });
    s += `<rect x="352" y="96" width="210" height="138" rx="10" fill="var(--accent)" opacity=".1"/><rect x="352" y="96" width="210" height="138" rx="10" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`;
    s += `<text x="457" y="150" text-anchor="middle" font-size="17" font-weight="700" fill="var(--accent)">국방군수통합</text><text x="457" y="174" text-anchor="middle" font-size="17" font-weight="700" fill="var(--accent)">정보체계</text><text x="457" y="200" text-anchor="middle" font-size="12" fill="var(--muted)">웹 기반 단일체계 · 2020.7</text>`;
    fn.forEach((t, i) => {
      const y = 50 + i * 62;
      s += `<path d="M562 165 C 620 165, 620 ${y + 17}, 680 ${y + 17}" fill="none" stroke="var(--teal)" stroke-opacity=".6" stroke-width="1.5"/>`;
      s += `<rect x="680" y="${y}" width="210" height="34" rx="6" fill="var(--surface)" stroke="var(--teal)"/><text x="785" y="${y + 22}" text-anchor="middle" font-size="13" fill="var(--ink)">${t}</text>`;
    });
    s += `<text x="105" y="318" text-anchor="middle" font-size="12" fill="var(--muted)">통합 이전: 기능·군별 6개 체계</text><text x="785" y="318" text-anchor="middle" font-size="12" fill="var(--muted)">통합 효과(보도 기준)</text></svg>`;
    $("#sysmap").innerHTML = s;
    const tl = [
      ["2014.11", "국방부, 296억원을 들여 흩어진 군수정보시스템을 웹 기반으로 통합하는 사업 추진 보도", "https://www.etnews.com/20141125000273", "전자신문"],
      ["2020.07", "국방군수지휘·탄약·물자·육해공군 장비정비 6개 체계를 단일체계로 통합해 전력화 발표", "https://www.ajunews.com/view/20200727100247802", "아주경제"],
      ["2020.08", "구축 사업자 KCC정보통신, 정당한 사업 대가 지급 요구 보도", "https://zdnet.co.kr/view/?no=20200803180927", "지디넷코리아"],
      ["2025.12", "2026년 국방AI 예산 1,244억원(2025년 283억원)으로 확대", "https://www.korea.kr/news/policyNewsView.do?newsId=148956958", "정책브리핑"],
      ["2026.04", "국방부 ‘AX 스프린트’: 2027년까지 400억원·20개 과제, 장비 수명 예측 등 포함", "https://www.hankyung.com/article/202604309027i", "한국경제"],
      ["2026.09", "국방 AI 아이디어 경연에서 ‘수리부속 상호융통 중개 AI’ 우수상", "https://www.fnnews.com/news/202609091101324398", "파이낸셜뉴스"],
    ];
    $("#sys-cases").innerHTML = CASES.map(caseHTML).join("");
    $("#sys-tl").innerHTML = tl.map(([w, t, u, src]) => `<li><div class="when">${w}</div><p>${esc(t)} <a href="${u}" target="_blank" rel="noopener">${esc(src)}</a></p></li>`).join("");
    $("#sys-kpi").innerHTML = [["13,000+", "재고번호 품목"], ["8,500+", "거래단위 품목"], ["273,000+", "단가 품목"]].map(([v, l]) => `<div class="kpi"><div class="v" style="font-size:22px">${v}</div><div class="l">${l}</div></div>`).join("");
    $("#sys-global").innerHTML = [
      ["미 F-35", "노후·사이버 취약점이 있는 ALIS를 클라우드 기반 ODIN으로 전환(4,760만 달러 발주, 2026.2)", "https://militaryaerospace.com/computers/article/55357534/lockheed-martin-lockheed-martin-to-handle-logistics-and-mission-planning-software-for-f-35-jet-fighter-bomber"],
      ["미 육군", "AI 정비 지원 도구 AIAM을 Vantage 데이터 플랫폼으로 이전·정식 가동(2026.3)", "https://www.army.mil/article/290606/artificial_intelligence_assisted_maintenance_making_strides_in_fy26"],
      ["미 DLA", "4개 공급망 디지털화, 2026년 9월까지 계획 지원 정확도 85% 목표(2026.4)", "https://www.dla.mil/About-DLA/News/News-Article-View/Article/4459715/dla-troop-support-begins-journey-to-predictive-data-with-ai-integration/"],
      ["미 국방부", "DIU 통해 합동 군수지속 결정 도구(JDST)로 공급망 취약점 예측(2026)", "https://federalnewsnetwork.com/army/2026/08/dod-building-ai-tools-to-predict-mitigate-risks-to-sustainment-supply-chain/"],
    ].map(([k, t, u]) => `<li><b>${k}</b> — ${esc(t)} <a href="${u}" target="_blank" rel="noopener">원문</a></li>`).join("");
    const ext = [
      ["무기체계 신뢰도(RAM)", ["정비 이력·고장 데이터로 MTBF·가용도 산출", "예지정비(PHM)·상태기반정비로 정비 시점 예측", "디지털 트윈 기반 정비 훈련"], "근거 기사: 육군 MRO 세미나(2026.6), DX KOREA AI MRO 테마관(2026.3), Armscor(2026.10)"],
      ["수리부속 수요예측", ["재고번호·거래 데이터 기반 소모 패턴 학습", "부대 간 상호융통 추천", "공급망 병목 사전 예측·대체 공급원 추천"], "근거 기사: 수리부속 상호융통 AI(2026.9), 국방 AI 리더스 포럼(2026.4), DLA(2026.4)"],
      ["정비소요인력 예측", ["병력 감소(2040년 35만 명 예상) 반영", "정비 수요 예측값 → 직종·숙련도별 인력 산정", "AI 에이전트로 반복 행정 자동화"], "근거 기사: AX 스프린트(2026.4), 스마트 정예강군(2026.9), 장병 AI 비서(2026.10)"],
    ];
    $("#sys-ext").innerHTML = ext.map(([h, li, ev]) => `<div><h3>${h}</h3><ul>${li.map(x => `<li>${esc(x)}</li>`).join("")}</ul><div class="ev">${esc(ev)}</div></div>`).join("");
  }

  // ---------- SEARCH ----------
  let sPage = 0;
  function rSearch() {
    if (!$("#s-cat").options.length) {
      $("#s-cat").innerHTML = `<option value="">전체</option>` + TAX.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
      $("#s-axis").innerHTML = `<option value="">전체</option>` + TAX.axes.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
      $("#s-region").innerHTML = `<option value="">전체</option>` + REGION_IDS.map(r => `<option value="${r}">${esc(RG[r].name)}</option>`).join("");
      $("#s-dom").innerHTML = `<option value="">전체</option>` + DOM_IDS.map(d => `<option value="${d}">${esc(DM[d].name)}</option>`).join("") + `<option value="none">분야 미분류</option>`;
      ["s-q", "s-cat", "s-axis", "s-lang", "s-from", "s-to", "s-sort", "s-pin", "s-region", "s-dom", "s-kind"].forEach(id => $("#" + id).addEventListener("input", () => { sPage = 0; drawSearch(); }));
      $("#s-csv").onclick = csv;
    }
    drawSearch();
  }
  function searchRows() {
    const rg = $("#s-region").value, dm = $("#s-dom").value, kd = $("#s-kind").value;
    const q = $("#s-q").value.trim().toLowerCase(), c = $("#s-cat").value, x = $("#s-axis").value, l = $("#s-lang").value, f = $("#s-from").value, t = $("#s-to").value, pin = $("#s-pin").checked;
    let L = ARTS.filter(a => (!q || `${a.title} ${a.summary} ${a.ai_sum || ""} ${a.source} ${(a.kw || []).join(" ")}`.toLowerCase().includes(q)) && (!c || (a.cats || []).includes(c)) && (!x || (a.axes || []).includes(x)) && (!l || (l === "ko" ? a.lang === "ko" : a.lang !== "ko")) && (!f || a.date >= f) && (!t || a.date <= t) && (!pin || a.pin) && (!rg || a.region === rg) && (!dm || (dm === "none" ? !(a.domains || []).length : (a.domains || []).includes(dm))) && (!kd || (a.kind || "news") === kd));
    const s = $("#s-sort").value;
    if (s === "old") L = L.slice().reverse(); else if (s === "score") L = L.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    return L;
  }
  function drawSearch() {
    const L = searchRows(), per = 30, pages = Math.max(1, Math.ceil(L.length / per));
    sPage = Math.min(sPage, pages - 1);
    $("#s-info").textContent = `${fmt(L.length)}건 / 전체 ${fmt(ARTS.length)}건`;
    $("#s-list").innerHTML = L.slice(sPage * per, sPage * per + per).map(a => card(a)).join("") || '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
    $("#s-pager").innerHTML = pages > 1 ? `<button class="navbtn" ${sPage ? "" : "disabled"} id="sp-p">‹</button><span class="mono">${sPage + 1} / ${pages}</span><button class="navbtn" ${sPage < pages - 1 ? "" : "disabled"} id="sp-n">›</button>` : "";
    $("#sp-p") && ($("#sp-p").onclick = () => { sPage--; drawSearch(); });
    $("#sp-n") && ($("#sp-n").onclick = () => { sPage++; drawSearch(); });
  }
  function csv() {
    const L = searchRows(), q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["날짜", "지역", "분야", "유형", "언어", "매체", "제목", "요약", "주제", "과제축", "키워드", "URL"]].concat(L.map(a => [a.date, RG[a.region]?.name || "", (a.domains || []).map(d => DM[d]?.name).join("|"), ({ contract: "사업·계약", policy: "정책·보고서" })[a.kind] || "뉴스", a.lang === "ko" ? "국문" : "영문", a.source, a.title, a.summary, (a.cats || []).map(catName).join("|"), (a.axes || []).map(x => AX[x]?.name).join("|"), (a.kw || []).join("|"), a.url]));
    const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
    const u = URL.createObjectURL(blob), el = document.createElement("a"); el.href = u; el.download = `군수뉴스_${today()}.csv`; el.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  }

  // ---------- DB ----------
  let dbTab = "pinned";
  const GH_DEF = { owner: "JaewoonAhn-HRnews", repo: "Logistics-Information-System", branch: "main" };
  function ghCfg() { const c = Object.assign({}, GH_DEF, store.get("lis-gh", {})); c.token = store.get("lis-gh-token", "") || sessionStorage.getItem("lis-gh-token") || ""; return c; }
  function rDB() {
    const c = ghCfg();
    ["owner", "repo", "branch"].forEach(k => ($("#gh-" + k).value = c[k]));
    $("#gh-token").value = c.token; $("#gh-remember").checked = !!store.get("lis-gh-token", "");
    if (!rDB._bound) {
      rDB._bound = true;
      const saveCfg = () => { store.set("lis-gh", { owner: $("#gh-owner").value.trim(), repo: $("#gh-repo").value.trim(), branch: $("#gh-branch").value.trim() || "main" }); const t = $("#gh-token").value.trim(); if ($("#gh-remember").checked) store.set("lis-gh-token", t); else { store.del("lis-gh-token"); try { sessionStorage.setItem("lis-gh-token", t); } catch { /* */ } } };
      ["gh-owner", "gh-repo", "gh-branch", "gh-token", "gh-remember"].forEach(id => $("#" + id).addEventListener("change", saveCfg));
      $("#gh-test").onclick = async () => { saveCfg(); const r = await gh("GET", ""); $("#gh-msg").textContent = r.ok ? "연결됨: " + r.data.full_name : "연결 실패: " + r.msg; };
      $("#gh-save").onclick = async () => { saveCfg(); await saveGH(); };
      $("#gh-run").onclick = async () => { saveCfg(); const r = await gh("POST", "/actions/workflows/update-news.yml/dispatches", { ref: ghCfg().branch, inputs: { days: "3" } }); $("#gh-msg").textContent = r.ok ? "수집을 시작했습니다. 3~5분 뒤 새로고침하세요." : "실행 실패: " + r.msg; };
      $("#db-export").onclick = () => { const b = new Blob([JSON.stringify(db(), null, 1)], { type: "application/json" }); const u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = `lis-db_${today()}.json`; a.click(); };
      $("#db-import").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d.overrides || !d.added) throw 0; DBW = Object.assign({ changelog: { log: [] } }, d); DBW._pending = (DBW._pending || 0) + 1; store.set("lis-db-work", DBW); applyDB(); rDB(); toast("가져왔습니다(로컬)."); } catch { toast("올바른 DB 파일이 아닙니다."); } };
      $("#db-discard").onclick = () => { if (!DBW) return; DBW = null; store.del("lis-db-work"); applyDB(); rDB(); toast("로컬 변경을 취소했습니다."); };
      $("#f-date").value = today();
      const auto = () => { const c2 = classify(`${$("#f-title").value} ${$("#f-summary").value}`); $("#f-auto").textContent = c2.cats.length ? `자동 분류: ${c2.cats.map(catName).join(", ")}${c2.axes.length ? " · 과제축: " + c2.axes.map(x => AX[x].name).join(", ") : ""}` : "요약을 입력하면 주제·키워드가 자동으로 붙습니다."; };
      $("#f-title").addEventListener("input", auto); $("#f-summary").addEventListener("input", auto);
      $("#add-form").onsubmit = e => {
        e.preventDefault();
        const a = { title: $("#f-title").value.trim(), url: $("#f-url").value.trim(), date: $("#f-date").value, source: $("#f-source").value.trim() || new URL($("#f-url").value).hostname, lang: $("#f-lang").value, summary: $("#f-summary").value.trim() };
        a.id = "m" + Math.abs([...a.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
        a.ts = a.date + "T09:00"; Object.assign(a, classify(`${a.title} ${a.summary}`)); if ($("#f-region").value) { a.region = $("#f-region").value; a.hint = a.region; } a.origin = "manual"; a.also = []; a.score = 5;
        if (BYID[a.id]) { toast("이미 있는 기사입니다."); return; }
        mutate(w => w.added.articles.unshift(a), "추가", a.id, a.title);
        e.target.reset(); $("#f-date").value = today(); toast("추가했습니다(로컬). GitHub에 저장하면 모두에게 반영됩니다.");
      };
      $("#db-tabs").onclick = e => { const b = e.target.closest(".chip"); if (b) { dbTab = b.dataset.t; drawDBList(); } };
      $("#db-list").addEventListener("click", e => { const b = e.target.closest("[data-unhide]"); if (b) { const id = b.dataset.unhide; mutate(w => { w.overrides.hidden = w.overrides.hidden.filter(x => x !== id); }, "숨김 해제", id, BYID[id]?.title); } });
    }
    const n = pendingCount();
    $("#db-status").innerHTML = n ? `<b style="color:var(--warn)">저장 안 된 변경 ${n}건</b> <span class="note">이 브라우저에만 있습니다</span>` : `<span class="note">저장소와 같습니다</span>`;
    const log = db().changelog.log || [];
    $("#db-log").innerHTML = `<tr><th>일시</th><th>작업</th><th>대상</th></tr>` + (log.slice(0, 60).map(l => `<tr><td class="mono">${esc(l.at)}</td><td>${esc(l.act)}</td><td>${esc(l.title || l.id)}</td></tr>`).join("") || `<tr><td colspan="3" class="note">이력 없음</td></tr>`);
    drawDBList();
  }
  function drawDBList() {
    const ov = db().overrides;
    const tabs = [["pinned", "중요 표시", ov.pinned.length], ["notes", "메모", Object.keys(ov.notes).length], ["added", "직접 추가", db().added.articles.length], ["hidden", "숨김", ov.hidden.length]];
    $("#db-tabs").innerHTML = tabs.map(([k, l, n]) => `<button class="chip ${dbTab === k ? "on" : ""}" data-t="${k}">${l}<span class="n">${n}</span></button>`).join("");
    let html = "";
    if (dbTab === "pinned") html = ov.pinned.map(id => card(BYID[id])).join("");
    if (dbTab === "notes") html = Object.keys(ov.notes).map(id => card(BYID[id])).join("");
    if (dbTab === "added") html = db().added.articles.map(a => card(BYID[a.id] || a)).join("");
    if (dbTab === "hidden") html = ov.hidden.map(id => { const a = BYID[id]; return a ? `<div class="card compact"><div class="card-top"><span class="src">${esc(a.source)}</span><span class="mono">${esc(a.date)}</span></div><div class="card-title">${esc(a.title)}</div><div><button class="btn ghost" data-unhide="${id}">숨김 해제</button></div></div>` : ""; }).join("");
    $("#db-list").innerHTML = html || '<div class="empty">항목이 없습니다.</div>';
  }
  async function gh(method, path, body) {
    const c = ghCfg(); if (!c.token) return { ok: false, msg: "토큰을 입력하세요" };
    try {
      const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}${path}`, { method, headers: { Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
      return r.ok ? { ok: true, data } : { ok: false, msg: `${r.status} ${data.message || ""}`, status: r.status };
    } catch (e) { return { ok: false, msg: String(e) }; }
  }
  const b64 = s => btoa(unescape(encodeURIComponent(s)));
  async function saveGH() {
    if (!DBW) { $("#gh-msg").textContent = "저장할 변경이 없습니다."; return; }
    const c = ghCfg(); $("#gh-save").disabled = true; $("#gh-msg").textContent = "저장 중…";
    const w = JSON.parse(JSON.stringify(DBW)); delete w._pending;
    const files = { "data/db/added.json": w.added, "data/db/overrides.json": w.overrides, "data/db/changelog.json": { log: (w.changelog.log || []).slice(0, 500) } };
    for (const [p, obj] of Object.entries(files)) {
      const g = await gh("GET", `/contents/${p}?ref=${c.branch}`);
      const r = await gh("PUT", `/contents/${p}`, { message: `데이터 관리: ${p.split("/").pop()} 갱신`, content: b64(JSON.stringify(obj, null, 1) + "\n"), branch: c.branch, sha: g.ok ? g.data.sha : undefined });
      if (!r.ok) { $("#gh-msg").textContent = `저장 실패(${p}): ${r.msg}`; $("#gh-save").disabled = false; return; }
    }
    DBS = w; DBW = null; store.del("lis-db-work"); applyDB(); rDB();
    $("#gh-save").disabled = false; $("#gh-msg").textContent = "저장했습니다. 1~3분 뒤 정리 작업이 끝나면 집계에도 반영됩니다.";
  }

  // ---------- ABOUT ----------
  function rAbout() {
    $("#ab-q").innerHTML = `<h3>국문</h3><div class="chips small" style="margin:6px 0 10px">${TAX.queries.ko.map(q => `<span class="chip">${esc(q)}</span>`).join("")}</div><h3>영문</h3><div class="chips small" style="margin-top:6px">${TAX.queries.en.map(q => `<span class="chip">${esc(q)}</span>`).join("")}</div>`;
    $("#ab-cats").innerHTML = `<div class="chips small" style="margin-top:6px">${TAX.cats.map(c => `<span class="chip"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};margin-right:6px"></i>${esc(c.name)}</span>`).join("")}</div>`;
  }

  // ---------- boot ----------
  load().then(ok => {
    if (!ok) return;
    $("#boot").hidden = true;
    $("#upd").textContent = "갱신 " + IDX.updated;
    route();
  });
})();
