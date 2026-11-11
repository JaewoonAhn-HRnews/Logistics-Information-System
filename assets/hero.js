/* 첫 화면 배경: 회전하는 점 지구본 + 한반도 기점 보급선(대권 호) + 데이터 파티클 + 신경망 성좌 */
(function () {
  const cv = document.getElementById("heroCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const hero = cv.parentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 200, running = false, t0 = performance.now();

  // 육지 마스크(1°×1°, Natural Earth 110m, 1비트/칸) → 지구본 위 대륙 점
  const MASK = atob("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADA/v8/AOD//z8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+///D/////5//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAH/j/+//////8PAAAAgB0AAHgAAAAAAH8AAAAAAAAAAAAAAAAAAAAAAAAAAOD//wP8//////8BAACAfx4AAAAAAAAAAP4AAAAAAAAAAAAAAAAAAAAAAAA4+I73//n///////8AAAAAfwAAAAAAAAAAAAAfAAAAAAAAAAAAAAAAAAAAAOAQACDwP4D///////8BAAAAPAQAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAADzAgPP5H8D//////38AAAAAAAAAAAAA4AEAAAD+DwAAAAAAAAAAAAAAAAAAAIC/g7PfBwAA/v////8AAAAAAAAAAADgBwAAwP//PwAA4B8AAAAAAAAAAAAAAAAMAAB8AgAA+P////8AAAAAAAAAAABwAAAA/P//AwAAAAAAAAAAAAAAAAAAAP8Ahvc5OwAA8P///38AAAAAAAAAAAAcAADg////34cHAAcAAAAAAAAAAAAAgN9/xzf8RwAA4P///z8AAAAAAAAAAAAPAB7g//////8fgD8AAAAAAQAAAAAAAO//B3f8/wsA4P///z8AAAAAAAAAAAAPAG////////8f2f8HAAAAAAD4HwAAAAD4H/D4/38A4P///xMAAAAAAPAHAAAAgN//////////////DwAAAAD+///h/4//H+/Bg/8BwP7//w8AAAAAwP8fAAAAj9///////////////88/A+D///////8DB8TPB/4AAP///wAAAAAA8P//AwDjf77/////////////////DwD////////////vh/kPwP//BwAAAAAA/P//H/P//5//////////////////34H8////////////Afw/gP//AQAQAAAA/v8fH////+///////////////////vD///////////9fAPwYgP8PAOA/AAAA/+N/8P//////////////////////QID4///////////Pw/0DAP8HAMAfAACA//F//v////////////////////8/AAP4///////////BBPAHAP4HAAAAAADg//z///////////////////////9/AID///////////8AQ4ABAPwBAAAAAAD8P/7///////////////////////9fAMD//////////z8AwA8AAPgBAAAAAAD+H/7/////////////////////Of8BAID///z//////z8AwD8AAMABAAAAAAD+P/z///////////////////9/wH8AAAD8MwD//////x8AwH8MAAAAAAAAAAD+P2D///////////////////95cAAAAACAAwD8/////38AwP8eAAAAAAAAgAGcH/D//////////////////wEAOAAAAADADgDA/////38AgP8/AAAAAAAAwANAH/T//////////////////wAAfgAAAAAwAAAA//////8PgP8/AAAAAAAAwAFwD/7/////////////////PwAAfwAAAAAGAAAA//////8/wP//AAAAAAAAwAOwA/7/////////////////DwCAPwAAAIAAAAAA/v//////8///BwAAAAAAOAcgcP//////////////////HwAAHwAAAAAAAACA+P//////4///DwAAAAAAOA74/////////////////////wUADwAAAAAAAAAA8P//////4///DwAAAAAAGD///////////////////////wUAAwAAAAAAAAAA8P//////7///FwAAAAAAAB///////////////////////wUAAgAAAAAAAAAA0P//////////DAAAAAAAgOH//////////////////////w0AAAAAAAAAAAAAYP////////8xLAAAAAAAAPz//////////////////////wwAAAAAAAAAAAAAAP7//////38HfgAAAAAAgP///////////////////////wQAAAAAAAAAAAAAAP3///////8HUAAAAAAAAP7/////////////////////fwQAAAAAAAAAAAAAAP////////+XAAAAAAAAAPz///93/D/+////////////PwwAAAAAAAAAAAAAAP////////9/AAAAAAAAAPj//f9j/g/+////////////HwAAAAAAAAAAAAAAAP////////8MAAAAAAAAAPj/+P8B/Mf/////////////DwQAAAAAAAAAAAAAAP///////z8AAAAAAAAAcPzH8/8A8I//////////////Bx4AAAAAAAAAAAAAAP///////x8AAAAAAAAA+H+Aw/8AwA/+//////////9/AA8AAAAAAAAAAAAAAP///////x8AAAAAAAAA+D8Aj//w4R/8//////////8/AAAAAAAAAAAAAAAAAP///////wMAAAAAAAAA+B8wuE/+/z/+/////////98fAAMAAAAAAAAAAAAAAP///////wMAAAAAAAAA+A8wEMf//x/+/////////0cOAAMAAAAAAAAAAAAAAP7//////wEAAAAAAAAA+A8AAM7//x/8/////////wMOAAEAAAAAAAAAAAAAAP7//////wAAAAAAAAAA+AcABob//z/8/////////zccwAEAAAAAAAAAAAAAAPz//////wAAAAAAAAAAQOB/AAQ2/////////////x8c8AEAAAAAAAAAAAAAAPj//////wAAAAAAAAAAQPx/AAAA/////////////w8Y/gEAAAAAAAAAAAAAAPD/////fwAAAAAAAAAA4P8/AAAA/////////////w+EGwAAAAAAAAAAAAAAAMD/////HwAAAAAAAAAA8P9/AACA/////////////x/AAwAAAAAAAAAAAAAAAID/////DwAAAAAAAAAA+P//BwaA/////////////x/AAAAAAAAAAAAAAAAAAID9////BwAAAAAAAAAA/P//D3+E/////////////z9AAAAAAAAAAAAAAAAAAAD5////BwAAAAAAAAAA/P//f////////////////x8AAAAAAAAAAAAAAAAAAADy/x8GBgAAAAAAAAAA/P/////v/8///////////z8AAAAAAAAAAAAAAAAAAAD0/w8ABgAAAAAAAAAA/v////+//4///////////z8AAAAAAAAAAAAAAAAAAADu/wcADgAAAAAAAACA//////8f/x/+/////////x8AAAAAAAAAAAAAAAAAAACI/wcALAAAAAAAAADA//////8//z/g/////////w8AAAAAAAAAAAAAAAAAAACQ/wcACAAAAAAAAADg//////9//r+A/////////wcAAAAAAAAAAAAAAAAAAAAQ/wMAAAAAAAAAAADg//////9//n8cgP///////ycAAAAAAAAAAAAAAAAAAAAA/gMAAAAAAAAAAADw////////+P9/AP///////xEAAAAAAAAAAAAAAAAAAAAA/AMAHQAAAAAAAADw////////+P//APz/f///fxAAAAAAAAAAAAAAAAAAAAAA+AcAYAAAAAAAAAD4////////+f9/APz/B///BgAAAAAAAAAAAAAAAAAAAAAA/AccgAEAAAAAAADw////////8f9/AOD/B/5/AAAAAAAAAAAAAAAAAQAAAAAA+A8eADgAAAAAAADw////////4f8/AOD/Afw/BgAAAAAAAAAAAAAAAAAAAAAA8J8PAPwCAAAAAADw////////4/8fAOD/APw/AgAAAAAAAAAAAAAAAAAAAAAAgP8PAAAAAAAAAADw////////x/8HAOB/APx/ADAAAAAAAAAAAAAAAAAAAAAAAP4PAAAAAAAAAAD4////////h/8BAOA/APz/ADAAAAAAAAAAAAAAAAAAAAAAAID/AAAAAAAAAAD4////////j/8AAMAPAMD/ATAAAAAAAAAAAAAAAAAAAAAAAAD/AQAAAAAAAAD4////////nx8AAMAPAMD/ATAAAAAAAAAAAAAAAAAAAAAAAAD8AAAAAAAAAAD4////////vwcAAIAPAMD/AcAAAAAAAAAAAAAAAAAAAAAAAADgAQAAAAAAAAD4////////fwAAAIAPAMD8AQABAAAAAAAAAAAAAAAAAAAAAADAAAgAAAAAAADw////////f2AAAAAPAID4AUACAAAAAAAAAAAAAAAAAAAAAADAAe9TAAAAAADg/////////34AAAAPAEBwAAgAAAAAAAAAAAAAAAAAAAAAAAAAE+9/AAAAAADA/////////38AAAAXAEAgAAQCAAAAAAAAAAAAAAAAAAAAAAAAz///AAAAAACA/////////z8AAAASAMAAAIACAAAAAAAAAAAAAAAAAAAAAAAAyP//AQAAAACA/////////z8AAAAwAIAAAEAHAAAAAAAAAAAAAAAAAAAAAAAAgP//AwAAAAAA/v///////x8AAAAwAAADAAMBAAAAAAAAAAAAAAAAAAAAAAAAwP//fwAAAAAA/A/+/////x8AAAAAAAAHAAcAAAAAAAAAAAAAAAAAAAAAAAAAgP///wAAAAAAEAD8/////w8AAAAAADAGwAcAAAAAAAAAAAAAAAAAAAAAAAAAgP///wEAAAAAAADA/////wcAAAAAAGAG4AEAAAAAAAAAAAAAAAAAAAAAAAAA4P///wEAAAAAAADA/////wMAAAAAAMAM+AMAAAAAAAAAAAAAAAAAAAAAAAAA4P///wMAAAAAAADg/////wEAAAAAAIAL/gMQAAAAAAAAAAAAAAAAAAAAAAAA8P///wMAAAAAAADg////fwAAAAAAAIAH/vMQAAAAAAAAAAAAAAAAAAAAAAAA8P///wcAAAAAAADg////PwAAAAAAAAAP/gMAAQAAAAAAAAAAAAAAAAAAAAAA+P///38AAAAAAADg////PwAAAAAAAAAO/DmAAwAAAAAAAAAAAAAAAAAAAAAA+P///38BAAAAAADA////HwAAAAAAAAA+/DkA8gAAAAAAAAAAAAAAAAAAAAAA8P////8fAAAAAACA////DwAAAAAAAAA8wChE/gcAAAAAAAAAAAAAAAAAAAAA+P////8/AAAAAACA////BwAAAAAAAAA4AEAA8B8AAAAAAAAAAAAAAAAAAAAA+P//////AQAAAAAA////BwAAAAAAAAAwAEAAxD8NAAAAAAAAAAAAAAAAAAAA+P//////AQAAAAAA////BwAAAAAAAADAAQAAxP+AAAAAAAAAAAAAAAAAAAAA8P//////AQAAAAAA/v//BwAAAAAAAACAHwAAwH8ABAAAAAAAAAAAAAAAAAAA4P//////AQAAAAAA/v//BwAAAAAAAAAAQFYEAMcAAAAAAAAAAAAAAAAAAAAA4P//////AAAAAAAA/v//DwAAAAAAAAAAAAgBAIABMAAAAAAAAAAAAAAAAAAAwP//////AAAAAAAA/v//DwAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAgP////9/AAAAAAAA/P//DwAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAAAAAAAAgP////8/AAAAAAAA/v//HyAAAAAAAAAAAACAHwQAAAAAAAAAAAAAAAAAAAAAAP////8fAAAAAAAA/v//HyAAAAAAAAAAAADADwwAAAAAAAAAAAAAAAAAAAAAAP////8fAAAAAAAA////HzAAAAAAAAAAAADsDxwAAAAAAAAAAAAAAAAAAAAAAP7///8fAAAAAAAA////DzgAAAAAAAAAAAD/DxwAAAAAAAAAAAAAAAAAAAAAAPj///8fAAAAAAAA////Dz8AAAAAAAAAAAD/Pz4AAAiAAAAAAAAAAAAAAAAAAOD///8fAAAAAAAA////Ax8AAAAAAAAAAMD//z4AAABAAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA////AB8AAAAAAAAAAMD//z8AAAAAAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA/v9/AB8AAAAAAAAAAOD//38AAAAAAAAAAAAAAAAAAAAAAMD///8PAAAAAAAA/v9/AB8AAAAAAAAAAPz///8BAAEAAAAAAAAAAAAAAAAAAMD///8HAAAAAAAA/P9/gA8AAAAAAAAAgP////8BAAIAAAAAAAAAAAAAAAAAAMD///8DAAAAAAAA/P//gA8AAAAAAAAAwP////8DAAAAAAAAAAAAAAAAAAAAAMD//38AAAAAAAAA/P9/AA8AAAAAAAAAwP////8HAAAAAAAAAAAAAAAAAAAAAOD//x8AAAAAAAAA+P9/AAcAAAAAAAAA4P////8PAAAAAAAAAAAAAAAAAAAAAOD//w8AAAAAAAAA+P8fAAIAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA+P8fAAAAAAAAAAAA4P////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA+P8fAAAAAAAAAAAAwP////8fAAAAAAAAAAAAAAAAAAAAAOD//wcAAAAAAAAA8P8PAAAAAAAAAAAAgP////8/AAAAAAAAAAAAAAAAAAAAAOD//wMAAAAAAAAA4P8HAAAAAAAAAAAAgP////8fAAAAAAAAAAAAAAAAAAAAAPD//wMAAAAAAAAA4P8HAAAAAAAAAAAAgP////8fAAAAAAAAAAAAAAAAAAAAAPD//wEAAAAAAAAAwP8DAAAAAAAAAAAAAP////8fAAAAAAAAAAAAAAAAAAAAAOD//wAAAAAAAAAAwP8BAAAAAAAAAAAAAP8D/P8PAAAAAAAAAAAAAAAAAAAAAPD/fwAAAAAAAAAAwH8AAAAAAAAAAAAAgP8A2P8HAAAAAAAAAAAAAAAAAAAAAPD/OwAAAAAAAAAAgAEAAAAAAAAAAAAAAAcA6P8HAAAAAAAAAAAAAAAAAAAAAPj/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwP8DAAACAAAAAAAAAAAAAAAAAPj/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8DAAAEAAAAAAAAAAAAAAAAAPz/BwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8DAAAIAAAAAAAAAAAAAAAAAPj/AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGgAAAA4AAAAAAAAAAAAAAAAAPg/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAPw/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAPwHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAALAAAAAAAAAAAAAAAAAPwfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAIADAAAAAAAAAAAAAAAAAPgHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAMABAAAAAAAAAAAAAAAAAPwHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAP4BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAAAAAAAAAAAAAAAAAP4BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAP4DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH4AAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAOAAAAAAAAAAAAAAAAAIAfAAAAAAAeeADADwAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAPD/AADA/////////z8AAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAgP///wH4//////////8DAAAAAAAAAAAAAAAAAAAAADAfAAAAAAAAAAAAAADw8////wP+////////////AwAAAAAAAAAAAAAAAAAAAHA/AAAAAAAAAAA8//P//////+D/////////////HwAAAAAAAAAAAAAAAAAAAP5+AAAAAAAA5v////////////D//////////////38AAAAAAAAAAAAAAAAAAAB+AAAAAACA/////////////////////////////38AAAAAAAAAYAYA4ON/OPh/AAAAAADw/////////////////////////////x8AAAAAAADwv/EXgP////8fAAAAAADw/////////////////////////////wMAAAAAAPz///////////8HAAAAAAD+/////////////////////////////wAAAAAAAPz//////////z8AAAAAAP///////////////////////////////wAAAADA/////////////wEAAAAA8P///////////////////////////////wAAAACH////////////PwAAAPgA/////////////////////////////////wcAAAAcgP//////////fwAAAP4BwP//////////////////////////////HwAAAAAAAP7//////////wf8wD8AwP//////////////////////////////DwAAAAAA/v////////////8HAAD4////////////////////////////////HwAAAAAA+P//////////////4f///////////////////////////////////wAAAAAA/P///////////////////////////////////////////////////x8A3x8AAP7///////////////////////////////////////////////////8/////f///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////");
  const isLand = (lat, lon) => {
    const r = Math.min(179, Math.max(0, Math.floor(90 - lat))), c = ((Math.floor(lon + 180) % 360) + 360) % 360, i = r * 360 + c;
    return (MASK.charCodeAt(i >> 3) >> (i & 7)) & 1;
  };
  // Fibonacci sphere: 육지는 촘촘히, 바다는 성기게
  const N = 9000, pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = Math.PI * (3 - Math.sqrt(5)) * i;
    const v = [Math.cos(th) * r, y, Math.sin(th) * r];
    const lat = Math.asin(y) * 180 / Math.PI, lon = Math.atan2(v[0], v[2]) * 180 / Math.PI;
    const land = isLand(lat, lon);
    if (land || i % 9 === 0) pts.push([v[0], v[1], v[2], land]);
  }
  const toV = (lat, lon) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]; };
  const HUB = toV(37.0, 127.5);
  const NODES = [[38.9, -77.0], [21.3, -157.9], [51.5, -0.1], [-35.3, 149.1], [35.7, 139.7], [13.4, 144.8], [24.7, 46.7], [52.5, 13.4], [1.35, 103.8], [49.3, -123.1]].map(([a, b]) => toV(a, b));
  const slerp = (p, q, t) => {
    const d = Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])), w = Math.acos(d);
    if (w < 1e-6) return p.slice();
    const s = Math.sin(w), a = Math.sin((1 - t) * w) / s, b = Math.sin(t * w) / s;
    return [p[0] * a + q[0] * b, p[1] * a + q[1] * b, p[2] * a + q[2] * b];
  };
  const ARCS = NODES.map((q, i) => ({ q, seg: Array.from({ length: 48 }, (_, k) => { const t = k / 47, v = slerp(HUB, q, t), h = 1 + 0.22 * Math.sin(Math.PI * t); return [v[0] * h, v[1] * h, v[2] * h]; }), off: i * 0.37 }));

  // 좌측 성좌(신경망)
  let stars = [];
  function seedStars() {
    const n = Math.round(Math.min(70, W / 22));
    stars = Array.from({ length: n }, () => ({ x: Math.random() * W * 0.62, y: Math.random() * H, vx: (Math.random() - .5) * .12, vy: (Math.random() - .5) * .12, r: Math.random() * 1.4 + .5 }));
  }
  // 상승 데이터 비트
  let bits = [];
  function seedBits() { bits = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: .2 + Math.random() * .6, a: Math.random() * .5 })); }

  function layout() {
    const rect = hero.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    cv.width = W * DPR; cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const hud = hero.querySelector(".hud");
    if (hud) {
      const r = hud.getBoundingClientRect();
      cx = r.left - rect.left + r.width / 2; cy = r.top - rect.top + r.height / 2; R = r.width * 0.36;
    } else { cx = W * .7; cy = H * .45; R = Math.min(W, H) * .3; }
    seedStars(); seedBits();
  }

  const TILT = 0.32;
  function proj(v, rot) {
    // Y축 회전 후 X축 기울임
    const c = Math.cos(rot), s = Math.sin(rot);
    let x = v[0] * c + v[2] * s, z = -v[0] * s + v[2] * c, y = v[1];
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    const y2 = y * ct - z * st, z2 = y * st + z * ct;
    return [cx + x * R, cy - y2 * R, z2];
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const rot = -2.5 + t * 0.06; // 한반도가 앞쪽을 지나도록 시작각 설정

    // 데이터 비트
    ctx.font = "10px IBM Plex Mono, monospace";
    for (const b of bits) {
      b.y -= b.v; if (b.y < -10) { b.y = H + 10; b.x = Math.random() * W; }
      ctx.fillStyle = `rgba(94,234,212,${b.a * 0.35})`;
      ctx.fillText(Math.random() < .5 ? "0" : "1", b.x, b.y);
    }
    // 성좌
    for (const p of stars) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W * .65) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; }
    for (let i = 0; i < stars.length; i++) for (let j = i + 1; j < stars.length; j++) {
      const a = stars[i], b = stars[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 120) { ctx.strokeStyle = `rgba(96,165,250,${(1 - d / 120) * 0.18})`; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    for (const p of stars) { ctx.fillStyle = "rgba(165,243,252,.55)"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); }

    // 대기광
    const g = ctx.createRadialGradient(cx, cy, R * .8, cx, cy, R * 1.35);
    g.addColorStop(0, "rgba(56,189,248,.16)"); g.addColorStop(1, "rgba(56,189,248,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 6.283); ctx.fill();
    const g2 = ctx.createRadialGradient(cx - R * .35, cy - R * .4, R * .1, cx, cy, R);
    g2.addColorStop(0, "rgba(30,64,175,.35)"); g2.addColorStop(1, "rgba(4,10,20,.75)");
    ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.fill();

    // 위도선
    ctx.lineWidth = .6;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath(); let first = true;
      for (let lon = 0; lon <= 360; lon += 6) {
        const p = proj(toV(lat, lon), rot);
        if (p[2] < 0) { first = true; continue; }
        first ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); first = false;
      }
      ctx.strokeStyle = "rgba(96,165,250,.16)"; ctx.stroke();
    }
    // 점
    for (const v of pts) {
      const p = proj(v, rot);
      if (p[2] < -0.15) continue;
      const a = Math.max(0, p[2]);
      if (v[3]) { ctx.fillStyle = `rgba(125,211,252,${a * .85 + .12})`; ctx.fillRect(p[0] - .95, p[1] - .95, 1.9, 1.9); }
      else { ctx.fillStyle = `rgba(96,165,250,${a * .22 + .03})`; ctx.fillRect(p[0] - .6, p[1] - .6, 1.2, 1.2); }
    }
    // 호 + 이동 펄스
    for (const arc of ARCS) {
      const P = arc.seg.map(v => proj(v, rot));
      ctx.beginPath(); let started = false;
      for (const p of P) { if (p[2] < -0.05) { started = false; continue; } started ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); started = true; }
      ctx.strokeStyle = "rgba(94,234,212,.42)"; ctx.lineWidth = 1; ctx.stroke();
      const k = ((t * 0.28 + arc.off) % 1);
      const idx = Math.floor(k * (P.length - 1)), p = P[idx];
      if (p[2] > -0.05) {
        ctx.fillStyle = "rgba(240,253,250,.95)"; ctx.beginPath(); ctx.arc(p[0], p[1], 2.2, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(94,234,212,.25)"; ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 6.283); ctx.fill();
      }
      const e = proj(arc.q, rot);
      if (e[2] > 0) { ctx.strokeStyle = "rgba(96,165,250,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(e[0], e[1], 3, 0, 6.283); ctx.stroke(); }
    }
    // 허브(한반도)
    const h = proj(HUB, rot);
    if (h[2] > 0) {
      const pr = 6 + 10 * ((t * .8) % 1);
      ctx.strokeStyle = `rgba(239,68,68,${1 - ((t * .8) % 1)})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(h[0], h[1], pr, 0, 6.283); ctx.stroke();
      ctx.fillStyle = "#f87171"; ctx.beginPath(); ctx.arc(h[0], h[1], 3.4, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(254,226,226,.9)"; ctx.font = "600 11px IBM Plex Mono, monospace"; ctx.fillText("ROK LOG HUB", h[0] + 9, h[1] - 8);
    }
    if (running && !reduce) requestAnimationFrame(frame);
  }

  function start() { if (running) return; running = true; layout(); requestAnimationFrame(frame); }
  function stop() { running = false; }
  window.addEventListener("resize", () => { if (running) layout(); });
  const io = new IntersectionObserver(es => es.forEach(e => (e.isIntersecting && !hero.closest("[hidden]") ? start() : stop())), { threshold: 0.05 });
  io.observe(hero);
  window.HeroFX = { start: () => { stop(); setTimeout(start, 30); }, stop };
  if (reduce) { layout(); running = false; frame(performance.now()); }
})();
