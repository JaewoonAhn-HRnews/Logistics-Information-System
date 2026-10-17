/* 첫 화면 배경: 회전하는 점 지구본 + 한반도 기점 보급선(대권 호) + 데이터 파티클 + 신경망 성좌 */
(function () {
  const cv = document.getElementById("heroCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const hero = cv.parentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 200, running = false, t0 = performance.now();

  // Fibonacci sphere
  const N = 1100, pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = Math.PI * (3 - Math.sqrt(5)) * i;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
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
      const a = Math.max(0, p[2]) * .75 + .08;
      ctx.fillStyle = `rgba(125,211,252,${a})`;
      ctx.fillRect(p[0] - .9, p[1] - .9, 1.8, 1.8);
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
