/* Gambit visual effects: animated background, confetti, bursts.
 * Pure canvas, no dependencies. Respects prefers-reduced-motion and pauses in hidden tabs.
 *   FX.setUi('neon'|'sakura'|'gold')   FX.enable(bool)
 *   FX.confetti()                      FX.burst(x, y, color, count)
 */
(function () {
  'use strict';

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var bg = document.getElementById('fx-bg'), top = document.getElementById('fx-top');
  if (!bg || !top) { window.FX = { setUi: function () {}, enable: function () {}, confetti: function () {}, burst: function () {} }; return; }
  var bctx = bg.getContext('2d'), tctx = top.getContext('2d');
  var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);
  var ui = 'neon', enabled = !reduce, parts = [], bits = [], topRunning = false;
  var GLYPHS = '♔♕♖♗♘♙♚♛♜♝♞♟';
  var PALETTE = {
    neon: ['#8b5cf6', '#22d3ee', '#c084fc', '#38bdf8'],
    sakura: ['#ff8fc7', '#ffc2e0', '#ffe1ef', '#ff6fb5'],
    gold: ['#e8b64c', '#f3cb73', '#b98a2c']
  };
  var CONFETTI = {
    neon: ['#8b5cf6', '#22d3ee', '#f472b6', '#facc15', '#34d399', '#ffffff'],
    sakura: ['#ff8fc7', '#ffc2e0', '#ffffff', '#c084fc', '#ffd166', '#ff6fb5'],
    gold: ['#e8b64c', '#f3cb73', '#ffffff', '#5fbf7a', '#e5645f', '#8b5cf6']
  };
  var rand = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    [bg, top].forEach(function (c) {
      c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
      c.style.width = W + 'px'; c.style.height = H + 'px';
      c.getContext('2d').setTransform(DPR, 0, 0, DPR, 0, 0);
    });
    seed();
  }

  function make(anywhere) {
    var pal = PALETTE[ui] || PALETTE.neon, p = { c: pick(pal), t: Math.random() * 6.28, x: rand(0, W) };
    if (ui === 'sakura') {
      p.kind = 'petal'; p.s = rand(5, 11); p.y = anywhere ? rand(0, H) : -20;
      p.vy = rand(0.35, 1.0); p.vx = rand(-0.25, 0.25); p.a = rand(0.35, 0.8); p.rot = rand(0, 6.28); p.vr = rand(-0.02, 0.02);
    } else if (Math.random() < 0.38) {
      p.kind = 'dot'; p.s = rand(0.6, 1.8); p.y = anywhere ? rand(0, H) : H + 10;
      p.vy = -rand(0.03, 0.15); p.vx = 0; p.a = rand(0.2, 0.7);
    } else {
      p.kind = 'glyph'; p.g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      p.s = rand(18, ui === 'gold' ? 40 : 58); p.y = anywhere ? rand(0, H) : H + 60;
      p.vy = -rand(0.12, 0.42); p.vx = rand(-0.12, 0.12); p.a = rand(0.035, 0.1); p.rot = rand(-0.5, 0.5); p.vr = rand(-0.003, 0.003);
    }
    return p;
  }
  function seed() {
    parts = [];
    var n = Math.round(Math.min(56, Math.max(20, W * H / 38000)));
    for (var i = 0; i < n; i++) parts.push(make(true));
  }

  var last = 0, bgRunning = false;
  function frame(ts) {
    if (!enabled || document.hidden) { bgRunning = false; return; }
    window.requestAnimationFrame(frame);
    if (ts - last < 33) return;      // ~30fps is plenty for a backdrop
    last = ts;
    bctx.clearRect(0, 0, W, H);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.t += 0.02;
      p.y += p.vy; p.x += p.vx + (p.kind === 'petal' ? Math.sin(p.t) * 0.6 : 0);
      if (p.rot !== undefined) p.rot += p.vr;
      if (p.y < -80 || p.y > H + 80 || p.x < -60 || p.x > W + 60) { parts[i] = make(false); continue; }
      bctx.save();
      bctx.translate(p.x, p.y);
      if (p.kind === 'glyph') {
        bctx.rotate(p.rot); bctx.globalAlpha = p.a; bctx.fillStyle = p.c;
        bctx.font = p.s + 'px "Segoe UI Symbol","Noto Sans Symbols 2","Apple Symbols",sans-serif';
        bctx.textAlign = 'center'; bctx.textBaseline = 'middle';
        bctx.fillText(p.g + '︎', 0, 0);
      } else if (p.kind === 'dot') {
        bctx.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(p.t * 2)); bctx.fillStyle = p.c;
        bctx.beginPath(); bctx.arc(0, 0, p.s, 0, 6.283); bctx.fill();
      } else {
        bctx.rotate(p.rot + Math.sin(p.t) * 0.5); bctx.globalAlpha = p.a; bctx.fillStyle = p.c;
        bctx.beginPath(); bctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 6.283); bctx.fill();
      }
      bctx.restore();
    }
  }
  function startBg() {
    if (bgRunning || !enabled || document.hidden) return;
    bgRunning = true; window.requestAnimationFrame(frame);
  }

  /* ---------- confetti + bursts on the top canvas */
  function topLoop() {
    tctx.clearRect(0, 0, W, H);
    var alive = [];
    for (var i = 0; i < bits.length; i++) {
      var b = bits[i];
      b.life -= 1;
      if (b.life <= 0 || b.y > H + 30) continue;
      b.vy += b.g; b.x += b.vx; b.y += b.vy; b.vx *= b.drag; b.rot += b.vr;
      tctx.save();
      tctx.globalAlpha = Math.max(0, Math.min(1, b.life / b.fade));
      tctx.translate(b.x, b.y); tctx.rotate(b.rot); tctx.fillStyle = b.c;
      if (b.shape === 'rect') tctx.fillRect(-b.s, -b.s * 0.5, b.s * 2, b.s);
      else { tctx.beginPath(); tctx.arc(0, 0, b.s, 0, 6.283); tctx.fill(); }
      tctx.restore();
      alive.push(b);
    }
    bits = alive;
    if (bits.length) window.requestAnimationFrame(topLoop);
    else { topRunning = false; tctx.clearRect(0, 0, W, H); }
  }
  function runTop() { if (!topRunning) { topRunning = true; window.requestAnimationFrame(topLoop); } }

  function confetti() {
    if (reduce) return;
    var pal = CONFETTI[ui] || CONFETTI.neon;
    for (var side = 0; side < 2; side++) {
      for (var i = 0; i < 90; i++) {
        var ang = (side ? Math.PI - rand(0.25, 1.0) : rand(0.25, 1.0)) * -1;
        var sp = rand(9, 20);
        bits.push({
          x: side ? W + 10 : -10, y: H * 0.78, vx: Math.cos(ang) * sp * (side ? -1 : 1) * (side ? -1 : 1), vy: Math.sin(ang) * sp,
          g: 0.28, drag: 0.985, rot: rand(0, 6.28), vr: rand(-0.3, 0.3), s: rand(3, 6.5), c: pick(pal),
          shape: Math.random() < 0.75 ? 'rect' : 'dot', life: rand(110, 200), fade: 40
        });
      }
    }
    runTop();
  }

  function burst(x, y, color, count) {
    if (reduce) return;
    var n = count || 14, pal = color ? [color, '#ffffff'] : (CONFETTI[ui] || CONFETTI.neon);
    for (var i = 0; i < n; i++) {
      var a = rand(0, 6.283), sp = rand(1.5, 5.5);
      bits.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, g: 0.12, drag: 0.95, rot: 0, vr: 0, s: rand(1.5, 3.8), c: pick(pal), shape: 'dot', life: rand(22, 42), fade: 22 });
    }
    runTop();
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', startBg);
  resize();
  startBg();

  window.FX = {
    setUi: function (name) { ui = PALETTE[name] ? name : 'neon'; seed(); },
    enable: function (on) {
      enabled = !!on && !reduce;
      bg.style.display = enabled ? 'block' : 'none';
      if (enabled) startBg(); else bctx.clearRect(0, 0, W, H);
    },
    confetti: confetti,
    burst: burst
  };
}());
