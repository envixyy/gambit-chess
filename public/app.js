/* Gambit — client application */
(function () {
  'use strict';

  /* ================================================================ helpers */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var FILES = 'abcdefgh';
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function rid(n) {
    var a = new Uint8Array(n), s = '', i;
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[a[i] % 36];
    return s;
  }
  function other(c) { return c === 'w' ? 'b' : 'w'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function toast(msg, isErr) {
    var t = h('div', 'toast' + (isErr ? ' err' : ''), msg);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 4200 : 2800);
  }

  /* ================================================================ identity & settings */
  var S = { pid: lsGet('gambit.pid', null), sid: ssGet('gambit.sid'), name: lsGet('gambit.name', null), rating: 1200, queued: null };
  if (!S.pid || typeof S.pid !== 'string' || S.pid.length < 8) { S.pid = 'p' + rid(23); lsSet('gambit.pid', S.pid); }
  if (!S.sid) { S.sid = 's' + rid(15); ssSet('gambit.sid', S.sid); }
  if (!S.name) { S.name = 'Guest' + Math.floor(1000 + Math.random() * 9000); lsSet('gambit.name', S.name); }

  var settings = Object.assign({ theme: 'green', pieces: 'solid', sound: true, anim: true, hints: true, autoq: false, coords: true, reviewMs: 800 }, lsGet('gambit.settings', {}));
  function saveSettings() { lsSet('gambit.settings', settings); }

  var THEMES = { green: ['#eeeed2', '#769656'], brown: ['#f0d9b5', '#b58863'], blue: ['#dee3e6', '#8ca2ad'], slate: ['#c9ccd4', '#66758a'], midnight: ['#8f9bb3', '#45506b'], rose: ['#f1e0dc', '#b87f87'], walnut: ['#d9b98a', '#8a5a35'] };

  /* ================================================================ sound (synthesised, no assets) */
  var actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, type, vol, delay, slide) {
    var a = audio();
    if (!a || !settings.sound) return;
    var t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function sfx(kind) {
    if (!settings.sound) return;
    if (kind === 'move') { tone(240, 0.07, 'triangle', 0.22, 0, 130); }
    else if (kind === 'capture') { tone(190, 0.1, 'sawtooth', 0.13, 0, 90); tone(120, 0.09, 'triangle', 0.2, 0.01); }
    else if (kind === 'check') { tone(660, 0.09, 'square', 0.07); tone(880, 0.12, 'square', 0.06, 0.09); }
    else if (kind === 'end') { tone(523, 0.18, 'sine', 0.16); tone(392, 0.2, 'sine', 0.14, 0.16); tone(262, 0.35, 'sine', 0.16, 0.34); }
    else if (kind === 'notify') { tone(760, 0.12, 'sine', 0.14); tone(1010, 0.18, 'sine', 0.12, 0.1); }
    else if (kind === 'low') { tone(1000, 0.04, 'square', 0.04); }
  }
  function sfxFor(rec) {
    if (/[+#]$/.test(rec.san)) sfx('check');
    else if (rec.flags.indexOf('c') >= 0) sfx('capture');
    else sfx('move');
  }

  /* ================================================================ network */
  var Net = {
    ws: null, backoff: 500, queue: [], open: false,
    connect: function () {
      var self = this;
      setNet('wait');
      var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
      this.ws = ws;
      ws.onopen = function () {
        self.open = true; self.backoff = 500;
        setNet('ok');
        ws.send(JSON.stringify({ t: 'hello', pid: S.pid, sid: S.sid, name: S.name }));
        if (G && G.mode === 'online' && G.room) ws.send(JSON.stringify({ t: 'join', room: G.room }));
        else if (S.queued) ws.send(JSON.stringify({ t: 'queue', tc: S.queued.tc, rated: S.queued.rated }));   // re-enter the queue after a reconnect
        else ws.send(JSON.stringify({ t: 'lobby' }));
        var q = self.queue; self.queue = [];
        q.forEach(function (m) { ws.send(m); });
      };
      ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
      ws.onclose = function () {
        self.open = false; setNet('off');
        setTimeout(function () { self.connect(); }, self.backoff);
        self.backoff = Math.min(self.backoff * 1.6, 5000);
      };
      ws.onerror = function () { try { ws.close(); } catch (x) { /* ignore */ } };
    },
    send: function (m) {
      var s = JSON.stringify(m);
      if (this.ws && this.ws.readyState === 1) this.ws.send(s);
      else if (m.t !== 'ping') this.queue.push(s);
    }
  };
  setInterval(function () { if (Net.open) Net.send({ t: 'ping' }); }, 20000);
  function setNet(st) {
    var n = $('#net');
    n.className = 'net ' + (st === 'ok' ? 'ok' : st === 'wait' ? 'wait' : '');
    $('#net-text').textContent = st === 'ok' ? 'online' : st === 'wait' ? 'connecting…' : 'reconnecting…';
  }

  /* ================================================================ engine worker wrapper */
  var Engine = {
    w: null, id: 0,
    run: function (msg, onInfo) {
      if (this.w) this.w.terminate();
      var w = this.w = new Worker('/ai.js'), id = ++this.id;
      return new Promise(function (resolve) {
        w.onmessage = function (e) {
          if (e.data.id !== id) return;
          if (e.data.type === 'info') { if (onInfo) onInfo(e.data); } else resolve(e.data);
        };
        w.postMessage(Object.assign({ id: id }, msg));
      });
    },
    cancel: function () { if (this.w) { this.w.terminate(); this.w = null; } this.id++; }
  };

  /* ================================================================ board view */
  var SOLID = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  var OUTLINE = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
  function glyph(ch) {
    var white = ch === ch.toUpperCase(), t = ch.toLowerCase();
    return ((settings.pieces === 'classic' && white) ? OUTLINE[t] : SOLID[t]) + '︎';
  }
  function parseFen(fen) {
    var map = {}, rows = fen.split(' ')[0].split('/'), r, f, i, ch;
    for (r = 0; r < 8; r++) {
      f = 0;
      for (i = 0; i < rows[r].length; i++) {
        ch = rows[r][i];
        if (ch >= '1' && ch <= '8') f += +ch;
        else { map[FILES[f] + (8 - r)] = ch; f++; }
      }
    }
    return map;
  }

  function BoardView(root, handlers) {
    this.root = root; this.h = handlers;
    this.flipped = false;
    this.pieces = {}; this.sqEls = {};
    this.sel = null; this.dests = new Set();
    this.marks = { last: [], check: null, pre: [] };
    this.userHl = new Set(); this.userArrows = new Map(); this.hint = null;
    this.drag = null; this.rc = null; this.hoverSq = null;

    this.squaresEl = h('div', 'squares');
    this.piecesEl = h('div', 'pieces');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'arrows');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.badgeEl = h('div', 'badge');
    this.badgeEl.style.display = 'none';
    this.badge = null; this.hintColor = null;
    root.appendChild(this.squaresEl); root.appendChild(this.piecesEl); root.appendChild(this.svg); root.appendChild(this.badgeEl);
    this.buildSquares();

    var self = this;
    root.addEventListener('pointerdown', function (e) { self.down(e); });
    window.addEventListener('pointermove', function (e) { self.move(e); });
    window.addEventListener('pointerup', function (e) { self.up(e); });
    window.addEventListener('pointercancel', function () { self.cancelDrag(); });
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { root.style.setProperty('--sq', (root.clientWidth / 8) + 'px'); }).observe(root);
    }
  }
  var BV = BoardView.prototype;

  BV.pos = function (sq) {
    var f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return { col: this.flipped ? 7 - f : f, row: this.flipped ? r : 7 - r };
  };
  BV.sqAt = function (e) {
    var rect = this.root.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width * 8, y = (e.clientY - rect.top) / rect.height * 8;
    if (x < 0 || y < 0 || x >= 8 || y >= 8) return null;
    var col = Math.floor(x), row = Math.floor(y);
    var f = this.flipped ? 7 - col : col, r = this.flipped ? row : 7 - row;
    return FILES[f] + (r + 1);
  };
  BV.buildSquares = function () {
    this.squaresEl.textContent = '';
    this.sqEls = {};
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var f = this.flipped ? 7 - col : col, r = this.flipped ? row : 7 - row;
        var name = FILES[f] + (r + 1), d = h('div', 'sqr' + (((f + r) % 2 === 0) ? ' d' : ''));
        if (col === 0) d.appendChild(h('span', 'co r', String(r + 1)));
        if (row === 7) d.appendChild(h('span', 'co f', FILES[f]));
        this.squaresEl.appendChild(d);
        this.sqEls[name] = d;
      }
    }
    this.refreshClasses();
  };
  BV.setFlipped = function (f) {
    if (f === this.flipped) return;
    this.flipped = f;
    this.buildSquares();
    this.layout(false);
    this.drawArrows();
    this.drawBadge();
  };
  /** small classification badge (review) pinned to a square's top-right corner */
  BV.setBadge = function (sq, info) { this.badge = sq && info ? { sq: sq, info: info } : null; this.drawBadge(); };
  BV.drawBadge = function () {
    var el = this.badgeEl;
    el.textContent = '';
    if (!this.badge) { el.style.display = 'none'; return; }
    var p = this.pos(this.badge.sq), info = this.badge.info;
    el.style.display = 'block';
    el.style.left = (p.col * 12.5) + '%'; el.style.top = (p.row * 12.5) + '%';
    var b = h('span', 'bdg' + (info.sym.length > 1 ? '' : ' big'), info.sym);
    b.style.background = info.color; b.style.color = info.ink;
    el.appendChild(b);
  };
  BV.place = function (el, sq, animated) {
    var p = this.pos(sq);
    if (animated && settings.anim) {
      el.classList.add('anim');
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.classList.remove('anim'); }, 280);
    } else el.classList.remove('anim');
    el.style.transform = 'translate(' + (p.col * 100) + '%,' + (p.row * 100) + '%)';
  };
  BV.layout = function (animated) {
    for (var sq in this.pieces) { this.pieces[sq].el.classList.remove('drag'); this.place(this.pieces[sq].el, sq, animated); }
  };
  BV.makePiece = function (ch) {
    var el = h('div', 'piece ' + (ch === ch.toUpperCase() ? 'w' : 'b'), glyph(ch));
    this.piecesEl.appendChild(el);
    return { ch: ch, el: el };
  };
  BV.restyle = function () {
    for (var sq in this.pieces) {
      var p = this.pieces[sq];
      p.el.textContent = glyph(p.ch);
    }
  };
  /** anim: array of {from,to} moves to animate */
  BV.setPosition = function (fen, anim) {
    var N = parseFen(fen), np = {}, used = {}, sq, i, a, old;
    for (sq in N) if (this.pieces[sq] && this.pieces[sq].ch === N[sq]) { np[sq] = this.pieces[sq]; used[sq] = true; }
    if (anim) {
      for (i = 0; i < anim.length; i++) {
        a = anim[i]; old = this.pieces[a.from];
        if (old && !used[a.from] && N[a.to] && !np[a.to]) {
          used[a.from] = true;
          old.ch = N[a.to]; old.el.textContent = glyph(old.ch);
          old.el.className = 'piece ' + (old.ch === old.ch.toUpperCase() ? 'w' : 'b');
          np[a.to] = old;
        }
      }
    }
    for (sq in N) if (!np[sq]) np[sq] = this.makePiece(N[sq]);
    for (sq in this.pieces) if (!used[sq]) this.pieces[sq].el.remove();
    var moved = {};
    if (anim) anim.forEach(function (x) { moved[x.to] = true; });
    this.pieces = np;
    for (sq in np) this.place(np[sq].el, sq, !!moved[sq]);
    np = null;
    this.refreshClasses();
  };
  BV.setMarks = function (m) { this.marks = Object.assign({ last: [], check: null, pre: [] }, m); this.refreshClasses(); };
  BV.refreshClasses = function () {
    var m = this.marks, sq, el, c;
    for (sq in this.sqEls) {
      el = this.sqEls[sq];
      c = 'sqr' + (el.classList.contains('d') ? ' d' : '');
      if (m.last.indexOf(sq) >= 0) c += ' last';
      if (m.check === sq) c += ' check';
      if (m.pre.indexOf(sq) >= 0) c += ' pre';
      if (this.userHl.has(sq)) c += ' userhl';
      if (this.sel === sq) c += ' sel';
      if (this.hoverSq === sq) c += ' hover';
      if (this.dests.has(sq) && settings.hints) c += ' dest' + (this.pieces[sq] ? ' cap' : '');
      el.className = c;
    }
  };
  BV.select = function (sq) {
    this.sel = sq;
    this.dests = sq ? this.h.getDests(sq) : new Set();
    this.refreshClasses();
  };
  BV.refreshSelection = function () {
    if (this.sel && this.h.canSelect(this.sel)) this.select(this.sel);
    else this.select(null);
  };
  BV.clearUser = function () {
    if (!this.userHl.size && !this.userArrows.size) return;
    this.userHl.clear(); this.userArrows.clear();
    this.refreshClasses(); this.drawArrows();
  };
  BV.setHint = function (mv, color) { this.hint = mv; this.hintColor = color || null; this.drawArrows(); };

  BV.down = function (e) {
    if (e.button === 2) {
      var s = this.sqAt(e);
      if (s) { this.rc = { sq: s, cur: s }; }
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    this.root.focus({ preventScroll: true });
    audio();
    this.clearUser();
    var sq = this.sqAt(e);
    if (!sq) return;
    if (this.sel && this.dests.has(sq)) {
      var from = this.sel;
      this.select(null);
      this.h.onUserMove(from, sq, false);
      return;
    }
    if (this.pieces[sq] && this.h.canSelect(sq)) {
      var was = this.sel === sq;
      this.select(sq);
      this.drag = { sq: sq, x0: e.clientX, y0: e.clientY, active: false, was: was };
      e.preventDefault();
    } else {
      this.select(null);
      if (this.h.onEmptyClick) this.h.onEmptyClick();
    }
  };
  BV.move = function (e) {
    if (this.rc) {
      var cur = this.sqAt(e);
      if (cur !== this.rc.cur) { this.rc.cur = cur; this.drawArrows(); }
    }
    var d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 5) {
      d.active = true;
      d.el = this.pieces[d.sq].el;
      d.el.classList.remove('anim');
      d.el.classList.add('drag');
    }
    if (d.active) {
      var rect = this.root.getBoundingClientRect(), size = rect.width / 8;
      d.el.style.transform = 'translate(' + (e.clientX - rect.left - size / 2) + 'px,' + (e.clientY - rect.top - size / 2) + 'px)';
      var hs = this.sqAt(e);
      if (hs !== this.hoverSq) { this.hoverSq = hs && this.dests.has(hs) ? hs : null; this.refreshClasses(); }
    }
  };
  BV.up = function (e) {
    if (this.rc && e.button === 2) {
      var to = this.sqAt(e), rc = this.rc;
      this.rc = null;
      if (to) {
        if (to === rc.sq) { if (this.userHl.has(to)) this.userHl.delete(to); else this.userHl.add(to); }
        else {
          var key = rc.sq + to;
          if (this.userArrows.has(key)) this.userArrows.delete(key); else this.userArrows.set(key, { from: rc.sq, to: to });
        }
      }
      this.refreshClasses(); this.drawArrows();
      return;
    }
    var d = this.drag;
    if (!d || e.button !== 0) return;
    this.drag = null;
    this.hoverSq = null;
    if (d.active) {
      var t = this.sqAt(e);
      d.el.classList.remove('drag');
      if (t && t !== d.sq && this.dests.has(t)) {
        this.place(d.el, t, false);   // snap onto the target square while any promotion picker is open
        this.select(null);
        this.h.onUserMove(d.sq, t, true);
      } else {
        this.place(d.el, d.sq, true);
        if (t !== d.sq) this.select(null);
        this.refreshClasses();
      }
    } else if (d.was) {
      this.select(null);
    }
  };
  BV.cancelDrag = function () {
    if (this.drag && this.drag.active) { this.drag.el.classList.remove('drag'); this.place(this.drag.el, this.drag.sq, true); }
    this.drag = null; this.rc = null; this.hoverSq = null; this.refreshClasses(); this.drawArrows();
  };

  BV.center = function (sq) { var p = this.pos(sq); return { x: p.col + 0.5, y: p.row + 0.5 }; };
  BV.arrowEl = function (a, b, color, w) {
    var A = this.center(a), B = this.center(b), dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len, head = 0.36, tip = { x: B.x - ux * 0.1, y: B.y - uy * 0.1 };
    var base = { x: tip.x - ux * head, y: tip.y - uy * head };
    var ns = 'http://www.w3.org/2000/svg', g = document.createElementNS(ns, 'g');
    var line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', A.x); line.setAttribute('y1', A.y); line.setAttribute('x2', base.x); line.setAttribute('y2', base.y);
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', w || 0.15); line.setAttribute('stroke-linecap', 'round');
    var poly = document.createElementNS(ns, 'polygon');
    var px = -uy * 0.2, py = ux * 0.2;
    poly.setAttribute('points', [tip.x, tip.y, base.x + px, base.y + py, base.x - px, base.y - py].join(','));
    poly.setAttribute('fill', color);
    g.appendChild(line); g.appendChild(poly);
    return g;
  };
  BV.drawArrows = function () {
    var self = this;
    this.svg.textContent = '';
    if (this.hint) this.svg.appendChild(this.arrowEl(this.hint.from, this.hint.to, this.hintColor || 'rgba(60,140,255,.82)', 0.17));
    this.userArrows.forEach(function (a) { self.svg.appendChild(self.arrowEl(a.from, a.to, 'rgba(255,170,0,.85)')); });
    if (this.rc && this.rc.cur && this.rc.cur !== this.rc.sq) this.svg.appendChild(this.arrowEl(this.rc.sq, this.rc.cur, 'rgba(255,170,0,.5)'));
  };

  /* ================================================================ game model */
  var G = null;
  var view = new BoardView($('#board'), {
    canSelect: function (sq) { return canSelect(sq); },
    getDests: function (sq) { return getDests(sq); },
    onUserMove: function (from, to, drag) { userMove(from, to, drag); },
    onEmptyClick: function () { if (G && G.premove) { G.premove = null; renderBoard(null); renderStatus(); } }
  });

  var START = Chess.START_FEN;

  function newGame(mode) {
    Engine.cancel();
    ReviewRunner.cancel();
    if (S.queued) { leaveQueue(); toast('Search cancelled'); }
    if (G && G.mode === 'online' && mode !== 'online') Net.send({ t: 'leave' });
    var c = new Chess();
    G = {
      mode: mode, seat: 's', room: null, chess: c, moves: [], infos: [{ fen: c.fen(), check: null }],
      viewPly: null, flipped: false, players: { w: null, b: null },
      tc: null, clocks: { w: 0, b: 0 }, running: false, clockAt: 0,
      status: 'playing', result: null, reason: null, rated: false, delta: null,
      drawOffer: null, takeback: null, rematch: { w: false, b: false }, spectators: 0,
      chat: [], premove: null, level: 3, aiThinking: false, hint: null, analysis: false, analysisInfo: null,
      discSeen: null, confirmResign: 0, ready: false, overShown: false, connState: { w: null, b: null }
    };
    view.userHl.clear(); view.userArrows.clear(); view.hint = null;
    view.select(null);
    view.setFlipped(false);
    $('#chat-log').textContent = '';
    return G;
  }

  function curPly() { return G.viewPly === null ? G.moves.length : G.viewPly; }
  function isLive() { return G.viewPly === null || G.viewPly === G.moves.length; }
  function myTurnNow() {
    if (!G || G.status !== 'playing') return false;
    if (G.mode === 'online') return G.seat === G.chess.turn;
    if (G.mode === 'computer') return !G.aiThinking && G.seat === G.chess.turn;
    if (G.mode === 'local') return true;
    return false;
  }
  function myColorAt(ch) {
    var white = ch === ch.toUpperCase();
    if (G.mode === 'local') return true;
    return G.seat === (white ? 'w' : 'b');
  }

  function playRecord(mv) {
    var rec = G.chess.move({ from: mv.from, to: mv.to, promo: mv.promo || undefined });
    if (!rec) return null;
    G.moves.push(rec);
    G.infos.push({ fen: G.chess.fen(), check: G.chess.inCheck() ? G.chess.kingSquare(G.chess.turn) : null });
    return rec;
  }
  function truncateTo(ply) {
    dropReview();
    while (G.moves.length > ply) { G.chess.undo(); G.moves.pop(); G.infos.pop(); }
    G.viewPly = null; G.status = 'playing'; G.result = null; G.reason = null; G.overShown = false;
  }
  function rebuildFrom(startFen, sans) {
    var c = new Chess(startFen || START);
    G.chess = c; G.moves = []; G.infos = [{ fen: c.fen(), check: null }];
    for (var i = 0; i < sans.length; i++) {
      var mv = typeof sans[i] === 'string' ? sans[i] : { from: sans[i].from, to: sans[i].to, promo: sans[i].promo };
      var rec = c.move(mv);
      if (!rec) return false;
      G.moves.push(rec);
      G.infos.push({ fen: c.fen(), check: c.inCheck() ? c.kingSquare(c.turn) : null });
    }
    return true;
  }

  /* ---- interaction predicates */
  function canSelect(sq) {
    if (!G || G.status !== 'playing') return false;
    var ch = view.pieces[sq] && view.pieces[sq].ch;
    if (!ch) return false;
    if (G.mode === 'review') return false;
    if (G.mode === 'local') {
      if (!isLive()) return true;
      return (ch === ch.toUpperCase()) === (G.chess.turn === 'w');
    }
    if (!isLive()) return false;
    if (!myColorAt(ch)) return false;
    if (G.mode === 'computer') return myTurnNow();
    return true; // online: own pieces always selectable (premove when not our turn)
  }
  function getDests(sq) {
    var set = new Set(), c;
    if (G.mode === 'local' && !isLive()) {
      c = new Chess(G.infos[curPly()].fen);
      c.moves({ square: sq, san: false }).forEach(function (m) { set.add(m.to); });
      return set;
    }
    if (G.chess.turn === (G.mode === 'local' ? G.chess.turn : G.seat)) {
      G.chess.moves({ square: sq, san: false }).forEach(function (m) { set.add(m.to); });
    } else {
      // premove: pretend it is our turn
      var parts = G.chess.fen().split(' ');
      parts[1] = other(G.chess.turn); parts[3] = '-';
      try {
        c = new Chess(parts.join(' '));
        c.moves({ square: sq, san: false }).forEach(function (m) { set.add(m.to); });
      } catch (e) { /* ignore */ }
    }
    return set;
  }

  function userMove(from, to, drag) {
    if (G.mode === 'local' && !isLive()) { truncateTo(G.viewPly); }
    var turnIsMine = G.mode === 'local' || G.chess.turn === G.seat;
    if (!turnIsMine) {
      // premove
      G.premove = { from: from, to: to };
      renderBoard(null); renderStatus();
      return;
    }
    var cands = G.chess.moves({ square: from, san: false }).filter(function (m) { return m.to === to; });
    if (!cands.length) { renderBoard(null); return; }
    if (cands[0].flags.indexOf('p') >= 0) {
      if (settings.autoq) return commit({ from: from, to: to, promo: 'q' }, drag);
      askPromo(cands[0].color).then(function (p) {
        if (p) commit({ from: from, to: to, promo: p }, drag); else renderBoard(null);
      });
      return;
    }
    commit({ from: from, to: to }, drag);
  }

  function askPromo(color) {
    return new Promise(function (resolve) {
      var modal = $('#promo-modal'), row = $('#promo-row');
      row.textContent = '';
      function done(v) { modal.classList.add('hidden'); modal.onclick = null; resolve(v); }
      ['q', 'r', 'b', 'n'].forEach(function (p) {
        var b = h('button', color, glyph(color === 'w' ? p.toUpperCase() : p));
        b.title = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p];
        b.onclick = function (e) { e.stopPropagation(); done(p); };
        row.appendChild(b);
      });
      modal.onclick = function () { done(null); };
      modal.classList.remove('hidden');
    });
  }

  function animFor(rec, reverse) {
    var list = [{ from: rec.from, to: rec.to }];
    if (rec.flags.indexOf('k') >= 0) { var r = rec.color === 'w' ? '1' : '8'; list.push({ from: 'h' + r, to: 'f' + r }); }
    else if (rec.flags.indexOf('q') >= 0) { var r2 = rec.color === 'w' ? '1' : '8'; list.push({ from: 'a' + r2, to: 'd' + r2 }); }
    if (reverse) list = list.map(function (x) { return { from: x.to, to: x.from }; });
    return list;
  }

  function commit(mv, drag) {
    var rec = playRecord(mv);
    if (!rec) { renderBoard(null); return; }
    dropReview();
    G.viewPly = null; G.premove = null; G.hint = null;
    view.setHint(null);
    sfxFor(rec);
    if (G.mode === 'online') {
      Net.send({ t: 'move', mv: { from: mv.from, to: mv.to, promo: mv.promo || null } });
      if (G.tc && G.tc.base > 0) {
        var now = Date.now();
        if (G.running) { G.clocks[G.seat] -= now - G.clockAt; G.clocks[G.seat] += G.tc.inc; }
        G.clockAt = now;
        G.running = G.moves.length >= 2;
      }
      G.drawOffer = null; G.takeback = null;
    }
    renderAll(drag ? null : animFor(rec));
    afterMove();
  }

  function afterMove() {
    if (G.mode !== 'online') {
      var st = G.chess.status();
      if (st.over) { endLocal(st.result, st.reason); return; }
    }
    if (G.mode === 'computer' && G.chess.turn !== G.seat) requestAI();
    if (G.mode === 'local' && G.analysis) requestAnalysis();
  }

  function endLocal(result, reason) {
    G.status = 'over'; G.result = result; G.reason = reason;
    G.aiThinking = false;
    renderAll(null);
    showOver();
  }

  /* ---- computer */
  function requestAI() {
    G.aiThinking = true;
    var token = G.moves.length, g = G;
    renderStatus(); renderActions();
    var fen = G.chess.fen();
    setTimeout(function () {
      if (G !== g || g.mode !== 'computer' || g.moves.length !== token) return;
      Engine.run({ type: 'move', fen: fen, level: g.level }).then(function (res) {
        if (G !== g || g.moves.length !== token || g.status !== 'playing') return;
        g.aiThinking = false;
        if (!res.move) { return; }
        var rec = playRecord(res.move);
        if (!rec) return;
        g.viewPly = null; g.hint = null; view.setHint(null);
        sfxFor(rec);
        renderAll(animFor(rec));
        var st = g.chess.status();
        if (st.over) endLocal(st.result, st.reason);
      });
    }, 220);
  }

  function requestHint() {
    if (!G || G.mode !== 'computer' || !myTurnNow()) return;
    var g = G, fen = G.chess.fen();
    toast('Thinking…');
    Engine.run({ type: 'analyze', fen: fen, depth: 8, ms: 1400 }).then(function (res) {
      if (G !== g || !res.move) return;
      g.hint = res.move; view.setHint(res.move);
    });
  }

  /* ---- analysis (local board) */
  var analysisSeq = 0;
  function requestAnalysis() {
    if (!G || !G.analysis) return;
    var g = G, ply = curPly(), fen = G.infos[ply].fen, seq = ++analysisSeq;
    var over = new Chess(fen).status();
    if (over.over) {
      var sc = over.reason === 'checkmate' ? (over.result === '1-0' ? 100000 : -100000) : 0;
      g.analysisInfo = { score: sc, depth: 0, text: cap(over.reason) };
      g.hint = null; view.setHint(null);
      renderEval(); return;
    }
    Engine.run({ type: 'analyze', fen: fen, depth: 14, ms: 3500 }, function (info) {
      if (G !== g || seq !== analysisSeq) return;
      applyAnalysis(g, fen, info);
    }).then(function (res) {
      if (G !== g || seq !== analysisSeq) return;
      applyAnalysis(g, fen, { depth: res.depth, score: res.score, best: res.move });
    });
  }
  function applyAnalysis(g, fen, info) {
    var san = '';
    if (info.best) { var t = new Chess(fen), r = t.move(info.best); san = r ? r.san : ''; }
    g.analysisInfo = { score: info.score, depth: info.depth, best: info.best, san: san };
    g.hint = info.best || null;
    view.setHint(g.hint);
    renderEval();
  }
  function fmtScore(s) {
    if (Math.abs(s) > 90000) { var n = Math.ceil((100000 - Math.abs(s)) / 2); return (s > 0 ? '+M' : '-M') + n; }
    return (s >= 0 ? '+' : '') + (s / 100).toFixed(2);
  }
  function renderEval() {
    var bar = $('#evalbar'), line = $('#analysis-line');
    var on = G && G.mode === 'local' && G.analysis;
    bar.classList.toggle('hidden', !on);
    line.classList.toggle('hidden', !on);
    if (!on) return;
    var info = G.analysisInfo;
    var score = info ? info.score : 0;
    var whitePct = 1 / (1 + Math.exp(-score / 300));
    var fill = $('#eval-fill');
    fill.style.height = ((1 - whitePct) * 100) + '%';
    fill.style.top = G.flipped ? 'auto' : '0'; fill.style.bottom = G.flipped ? '0' : 'auto';
    bar.style.transform = '';
    $('#eval-text').textContent = info ? (Math.abs(score) > 90000 ? fmtScore(score).replace(/^[+-]/, '') : (Math.abs(score) / 100).toFixed(1)) : '0.0';
    bar.classList.toggle('black-better', score < 0 !== G.flipped);
    line.textContent = '';
    if (!info) { line.textContent = 'Engine warming up…'; return; }
    if (info.text) { line.textContent = info.text; return; }
    var b = h('b', null, fmtScore(info.score));
    line.appendChild(b);
    line.appendChild(document.createTextNode('  depth ' + info.depth + (info.san ? '  ·  best: ' : '')));
    if (info.san) line.appendChild(h('b', null, info.san));
  }

  /* ================================================================ rendering */
  var PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  var INIT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  function capturedBy(fen) {
    var cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }, ch, t, sq;
    var map = parseFen(fen);
    for (sq in map) { ch = map[sq]; t = ch.toLowerCase(); if (t !== 'k') cnt[ch === ch.toUpperCase() ? 'w' : 'b'][t]++; }
    var out = { w: [], b: [] }, mat = { w: 0, b: 0 };
    ['w', 'b'].forEach(function (c) {
      ['q', 'r', 'b', 'n', 'p'].forEach(function (t) {
        mat[c] += cnt[c][t] * PIECE_VAL[t];
        var missing = Math.max(0, INIT[t] - cnt[c][t]);
        for (var i = 0; i < missing; i++) out[other(c)].push({ t: t, color: c });   // pieces captured BY other(c)
      });
    });
    return { list: out, diff: mat.w - mat.b };
  }

  function bottomColor() { return G.flipped ? 'b' : 'w'; }

  function renderAll(anim) {
    renderBoard(anim);
    renderBars();
    renderMoves();
    renderStatus();
    renderActions();
    renderEval();
    renderReview();
  }

  function renderBoard(anim) {
    var ply = curPly(), info = G.infos[ply];
    view.setFlipped(G.flipped);
    view.setPosition(info.fen, anim);
    var last = ply > 0 ? [G.moves[ply - 1].from, G.moves[ply - 1].to] : [];
    view.setMarks({ last: last, check: info.check, pre: G.premove ? [G.premove.from, G.premove.to] : [] });
    view.refreshSelection();
    var rv = reviewFor(ply), hintMv = G.hint, hintCol = null;
    if (rv && rv.item && rv.item.best && rv.loss >= 3) { hintMv = rv.item.best; hintCol = 'rgba(120,190,60,.88)'; }   // "best was…"
    view.setHint(hintMv, hintCol);
    view.setBadge(rv && rv.cls ? G.moves[ply - 1].to : null, rv && rv.cls ? Review.INFO[rv.cls] : null);
  }

  function playerLabel(c) {
    var p = G.players[c];
    if (G.mode === 'online') return p ? p.name : (G.ready ? 'Waiting for opponent…' : '');
    return p ? p.name : (c === 'w' ? 'White' : 'Black');
  }

  function renderBars() {
    var bc = bottomColor(), tc = other(bc), cb = capturedBy(G.infos[curPly()].fen);
    [['top', tc], ['bottom', bc]].forEach(function (pair) {
      var pos = pair[0], c = pair[1], p = G.players[c];
      $('#name-' + pos).textContent = playerLabel(c);
      $('#rating-' + pos).textContent = p && p.rating ? '(' + p.rating + ')' : '';
      var dot = $('#dot-' + pos);
      dot.classList.toggle('on', G.mode === 'online' ? !!(p && p.connected) : true);
      dot.classList.toggle('turn', G.status === 'playing' && G.chess.turn === c && curPly() === G.moves.length);
      var capEl = $('#cap-' + pos);
      capEl.textContent = '';
      cb.list[c].sort(function (a, b) { return PIECE_VAL[b.t] - PIECE_VAL[a.t]; }).forEach(function (x) {
        var s = h('span', null, SOLID[x.t] + '︎');
        s.style.color = x.color === 'w' ? '#f1f1f1' : '#6c7584';
        capEl.appendChild(s);
      });
      var adv = c === 'w' ? cb.diff : -cb.diff;
      if (adv > 0) capEl.appendChild(h('span', 'adv', '+' + adv));
    });
    updateClocks();
  }

  function fmtClock(ms) {
    ms = Math.max(0, ms);
    var tot = Math.floor(ms / 1000);
    if (ms < 20000) return '0:' + String(tot).padStart(2, '0') + '.' + Math.floor((ms % 1000) / 100);
    var m = Math.floor(tot / 60), s = tot % 60;
    if (m >= 60) return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }
  var lastLowBeep = 0;
  function updateClocks() {
    if (!G) return;
    var bc = bottomColor();
    [['top', other(bc)], ['bottom', bc]].forEach(function (pair) {
      var el = $('#clock-' + pair[0]), c = pair[1];
      if (!G.tc || !G.tc.base) { el.classList.add('hide'); return; }
      el.classList.remove('hide');
      var active = G.running && G.status === 'playing' && G.chess.turn === c;
      var ms = G.clocks[c] - (active ? Date.now() - G.clockAt : 0);
      el.textContent = fmtClock(ms);
      el.classList.toggle('active', active);
      el.classList.toggle('low', active && ms < 10000);
      if (active && ms < 10000 && G.seat === c && Date.now() - lastLowBeep > 900 && Math.floor(ms / 1000) !== -1) { lastLowBeep = Date.now(); sfx('low'); }
    });
    // abandonment claim button appears after the opponent has been gone a while
    if (G.mode === 'online' && G.discSeen && !G.claimShown && Date.now() - G.discSeen > 60000) { G.claimShown = true; renderActions(); }
  }
  setInterval(updateClocks, 100);

  function renderMoves() {
    var box = $('#moves'), ply = curPly(), i;
    box.textContent = '';
    for (i = 0; i < G.moves.length; i += 2) {
      var row = h('div', 'mrow');
      row.appendChild(h('span', 'mn', (i / 2 + 1) + '.'));
      for (var k = 0; k < 2; k++) {
        var idx = i + k;
        if (idx >= G.moves.length) { row.appendChild(h('span')); continue; }
        var b = h('button', 'mv' + (idx + 1 === ply ? ' active' : ''), G.moves[idx].san);
        b.dataset.ply = idx + 1;
        var rcls = G.review && G.review.res && G.review.res.cls[idx];
        if (rcls && Review.INFO[rcls].notable) {
          var bd = h('span', 'bdg', Review.INFO[rcls].sym);
          bd.style.background = Review.INFO[rcls].color; bd.style.color = Review.INFO[rcls].ink;
          bd.title = Review.INFO[rcls].label;
          b.appendChild(bd);
        }
        b.onclick = (function (n) { return function () { setView(n); }; })(idx + 1);
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    var act = box.querySelector('.mv.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
    else box.scrollTop = ply === 0 ? 0 : box.scrollHeight;
    $('#opening').textContent = window.OPENINGS ? window.OPENINGS.find(G.moves.slice(0, ply).map(function (m) { return m.san; })) : '';
    $('#nav-first').disabled = $('#nav-prev').disabled = ply === 0;
    $('#nav-next').disabled = $('#nav-last').disabled = ply === G.moves.length;
  }

  function setView(ply, noAnim) {
    var before = curPly();
    ply = Math.max(0, Math.min(G.moves.length, ply));
    if (ply === before) return;
    G.viewPly = ply === G.moves.length ? null : ply;
    var anim = null;
    if (!noAnim && Math.abs(ply - before) === 1) {
      anim = ply > before ? animFor(G.moves[ply - 1], false) : animFor(G.moves[before - 1], true);
      if (ply > before) sfxFor(G.moves[ply - 1]);
    }
    renderBoard(anim); renderBars(); renderMoves(); renderStatus(); renderActions(); renderReview();
    if (G.mode === 'local' && G.analysis) requestAnalysis();
  }

  function resultInfo(result, reason) {
    var why = {
      checkmate: 'checkmate', stalemate: 'stalemate', resignation: 'resignation', timeout: 'timeout',
      agreement: 'agreement', abandonment: 'abandonment', 'insufficient material': 'insufficient material',
      'fifty-move rule': 'the fifty-move rule', 'threefold repetition': 'threefold repetition',
      'timeout vs insufficient material': 'timeout (insufficient mating material)', aborted: 'abort'
    }[reason] || reason;
    if (reason === 'aborted') return { title: 'Game aborted', sub: '' };
    if (result === '1-0') return { title: 'White wins', sub: 'by ' + why, winner: 'w' };
    if (result === '0-1') return { title: 'Black wins', sub: 'by ' + why, winner: 'b' };
    return { title: 'Draw', sub: 'by ' + why, winner: null };
  }

  function renderStatus() {
    var line = $('#status-line'), sub = $('#status-sub');
    line.className = 'status-line';
    var parts = [];
    if (G.tc) parts.push(G.tc.base ? (G.tc.base / 60000) + '+' + (G.tc.inc / 1000) : 'Unlimited');
    if (G.mode === 'online') parts.push(G.rated ? 'Rated' : 'Casual');
    if (G.mode === 'computer') parts.push('Level ' + G.level);
    if (G.mode === 'online' && G.spectators) parts.push(G.spectators + ' watching');
    var text = '';
    if (!G.ready && G.mode === 'online') text = 'Connecting…';
    else if (G.status === 'waiting') text = 'Waiting for an opponent…';
    else if (G.status === 'over') {
      var ri = resultInfo(G.result, G.reason);
      text = ri.title + (ri.sub ? ' — ' + ri.sub : '');
      if (G.seat === 'w' || G.seat === 'b') {
        if (ri.winner === G.seat) line.classList.add('good'); else if (ri.winner) line.classList.add('bad');
      }
    } else {
      var inCheck = G.infos[G.moves.length].check;
      if (G.mode === 'computer') text = G.aiThinking ? 'Computer is thinking…' : (G.chess.turn === G.seat ? 'Your move' : 'Computer to move');
      else if (G.mode === 'online' && (G.seat === 'w' || G.seat === 'b')) text = G.chess.turn === G.seat ? 'Your move' : "Opponent's move";
      else text = (G.chess.turn === 'w' ? 'White' : 'Black') + ' to move';
      if (inCheck) text += ' · Check!';
      if (G.mode === 'local' && G.moves.length === 0) text = 'Analysis board — ' + text;
    }
    line.textContent = text;
    var subtxt = parts.join(' · ');
    if (!isLive()) subtxt = 'Viewing move ' + curPly() + ' of ' + G.moves.length + ' — press End to return';
    else if (G.premove) subtxt = 'Premove set (' + G.premove.from + '→' + G.premove.to + ') — click anywhere else to clear';
    sub.textContent = subtxt;
    // invite
    var inv = $('#invite');
    var showInv = G.mode === 'online' && G.status === 'waiting' && (G.seat === 'w' || G.seat === 'b');
    inv.classList.toggle('hidden', !showInv);
    if (showInv) $('#invite-link').value = location.origin + '/g/' + G.room;
    renderOfferBanner();
    $('#chat-panel').classList.toggle('hidden', G.mode !== 'online');
    document.title = (G.mode === 'online' && G.status === 'playing' && G.seat === G.chess.turn && document.hidden ? '● Your move — ' : '') + 'Gambit — chess with friends';
  }

  function renderOfferBanner() {
    var b = $('#offer-banner');
    b.textContent = '';
    b.className = 'banner offer hidden';
    if (G.mode !== 'online' || (G.seat !== 'w' && G.seat !== 'b')) return;
    var me = G.seat, opp = other(me), msg = null, btns = [];
    if (G.status === 'playing') {
      if (G.drawOffer === opp) { msg = 'Your opponent offers a draw.'; btns = [['Accept', 'good', { t: 'draw', a: 'accept' }], ['Decline', '', { t: 'draw', a: 'decline' }]]; }
      else if (G.takeback === opp) { msg = 'Your opponent asks to take back a move.'; btns = [['Accept', 'good', { t: 'takeback', a: 'accept' }], ['Decline', '', { t: 'takeback', a: 'decline' }]]; }
      else if (G.drawOffer === me) { msg = 'Draw offer sent…'; btns = [['Cancel', '', { t: 'draw', a: 'cancel' }]]; }
      else if (G.takeback === me) { msg = 'Takeback requested…'; btns = [['Cancel', '', { t: 'takeback', a: 'cancel' }]]; }
    } else if (G.status === 'over') {
      if (G.rematch[opp] && !G.rematch[me]) { msg = 'Your opponent wants a rematch.'; btns = [['Accept rematch', 'primary', { t: 'rematch' }]]; }
      else if (G.rematch[me] && !G.rematch[opp]) { msg = 'Rematch offered — waiting for your opponent…'; }
    }
    if (!msg) return;
    b.classList.remove('hidden');
    b.appendChild(h('div', null, msg));
    if (btns.length) {
      var row = h('div', 'row');
      btns.forEach(function (x) {
        var bt = h('button', 'btn small ' + x[1], x[0]);
        bt.onclick = function () { Net.send(x[2]); };
        row.appendChild(bt);
      });
      b.appendChild(row);
    }
  }

  function renderActions() {
    var box = $('#actions');
    box.textContent = '';
    function add(label, cls, fn, disabled, title) {
      var b = h('button', 'btn ' + (cls || ''), label);
      if (disabled) b.disabled = true;
      if (title) b.title = title;
      b.onclick = fn;
      box.appendChild(b);
      return b;
    }
    var flip = function () { G.flipped = !G.flipped; renderAll(null); };
    var playing = G.status === 'playing', over = G.status === 'over';

    if (G.mode === 'online') {
      var isPlayer = G.seat === 'w' || G.seat === 'b', me = G.seat, opp = other(me);
      add('⇅ Flip', '', flip);
      if (G.status === 'waiting' && isPlayer) {
        add('Cancel game', 'danger', function () { Net.send({ t: 'abort' }); });
      } else if (playing && isPlayer) {
        add('↶ Takeback', '', function () { Net.send({ t: 'takeback', a: 'offer' }); }, G.moves.length === 0 || !!G.takeback || !!G.drawOffer);
        add('½ Draw', '', function () { Net.send({ t: 'draw', a: 'offer' }); }, G.moves.length < 2 || !!G.drawOffer || !!G.takeback);
        if (G.moves.length < 2) add('Abort', 'danger', function () { Net.send({ t: 'abort' }); });
        else {
          var confirming = Date.now() - G.confirmResign < 3000;
          add(confirming ? 'Really resign?' : '⚑ Resign', 'danger', function () {
            if (Date.now() - G.confirmResign < 3000) { G.confirmResign = 0; Net.send({ t: 'resign' }); }
            else { G.confirmResign = Date.now(); renderActions(); setTimeout(function () { if (G && G.mode === 'online') renderActions(); }, 3100); }
          });
        }
        var oppP = G.players[opp];
        if (oppP && !oppP.connected && G.discSeen && Date.now() - G.discSeen > 60000)
          add('Claim win (opponent left)', 'primary', function () { Net.send({ t: 'claim' }); });
      } else if (over && isPlayer) {
        add('↻ Rematch', 'primary', function () { Net.send({ t: 'rematch' }); }, !!G.rematch[me]);
        add('New game', '', function () { go('/'); });
      }
      add('⤓ PGN', '', downloadPgn, G.moves.length === 0);
      if (over) addReview(add);
      if (over || !isPlayer) add('🔍 Analyze', '', analyzeCurrent, G.moves.length === 0);
      if (!isPlayer || over) add('Leave', '', function () { go('/'); });
    } else if (G.mode === 'computer') {
      add('⇅ Flip', '', flip);
      add('💡 Hint', '', requestHint, !myTurnNow());
      add('↶ Undo', '', undoComputer, G.moves.length === 0);
      if (playing) add('⚑ Resign', 'danger', function () { endLocal(G.seat === 'w' ? '0-1' : '1-0', 'resignation'); }, G.moves.length === 0);
      else add('↻ New game', 'primary', function () { startComputer(G.level, G.seat === 'w' ? 'b' : 'w'); });
      add('⤓ PGN', '', downloadPgn, G.moves.length === 0);
      addReview(add);
      add('🔍 Analyze', '', analyzeCurrent, G.moves.length === 0);
      add('Menu', '', function () { go('/'); });
    } else if (G.mode === 'local') {
      add('⇅ Flip', '', flip);
      add('Engine: ' + (G.analysis ? 'on' : 'off'), G.analysis ? 'good' : '', function () {
        G.analysis = !G.analysis; G.analysisInfo = null;
        if (!G.analysis) { Engine.cancel(); G.hint = null; view.setHint(null); }
        renderAll(null);
        if (G.analysis) requestAnalysis();
      });
      add('↶ Undo', '', function () { if (G.moves.length) { truncateTo(Math.min(curPly(), G.moves.length) - (isLive() ? 1 : 0)); renderAll(null); if (G.analysis) requestAnalysis(); } }, G.moves.length === 0);
      add('New', '', function () { startLocal(); });
      add('Import', '', function () {
        var t = window.prompt('Paste a FEN or a PGN to load:');
        if (t) importText(t);
      });
      add('⎘ FEN', '', function () { copyText(G.infos[curPly()].fen, 'FEN copied'); });
      add('⤓ PGN', '', downloadPgn, G.moves.length === 0);
      addReview(add);
      add('Menu', '', function () { go('/'); });
    } else if (G.mode === 'review') {
      add('⇅ Flip', '', flip);
      add('⤓ PGN', '', downloadPgn);
      addReview(add);
      add('🔍 Analyze', '', analyzeCurrent);
      add('Back', '', function () { go('/'); });
    }
  }

  /* ================================================================ misc actions */
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(okMsg || 'Copied'); } catch (e) { toast('Copy failed', true); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast(okMsg || 'Copied'); }, fallback);
    else fallback();
  }

  function pgnText() {
    var hd = { White: playerLabel('w'), Black: playerLabel('b') };
    if (G.mode === 'computer') hd[G.seat === 'w' ? 'Black' : 'White'] = 'Computer level ' + G.level;
    if (G.tc && G.tc.base) hd.TimeControl = (G.tc.base / 1000) + (G.tc.inc ? '+' + (G.tc.inc / 1000) : '');
    var sf = G.chess.startFen;
    if (sf && sf !== START) { hd.SetUp = '1'; hd.FEN = sf; }
    return G.chess.pgn(hd, G.status === 'over' && G.result ? G.result : '*');
  }
  function downloadPgn() {
    var blob = new Blob([pgnText()], { type: 'application/x-chess-pgn' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gambit-' + playerLabel('w').replace(/\W+/g, '') + '-vs-' + playerLabel('b').replace(/\W+/g, '') + '.pgn';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function analyzeCurrent() {
    var sans = G.moves.map(function (m) { return m.san; }), startFen = G.chess.startFen, flipped = G.flipped;
    var ply = curPly();
    startLocal(startFen === START ? null : startFen, sans);
    G.flipped = flipped; G.analysis = true;
    G.viewPly = ply === G.moves.length ? null : ply;
    renderAll(null);
    requestAnalysis();
  }

  function importText(txt) {
    txt = txt.trim();
    if (/^[prnbqkPRNBQK1-8\/]+\s+[wb](\s|$)/.test(txt)) {
      try {
        var c = new Chess(txt);
        if (c.kings.w < 0 || c.kings.b < 0) throw new Error('missing king');
        startLocal(c.fen(), []);
        return;
      } catch (e) { toast('That FEN is not valid', true); return; }
    }
    var fenHdr = txt.match(/\[FEN\s+"([^"]+)"\]/);
    var body = txt.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
    var prev;
    do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);
    body = body.replace(/\$\d+/g, ' ').replace(/\d+\.+\s*/g, ' ');
    var toks = body.split(/\s+/).filter(function (t) { return t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t); });
    var start = fenHdr ? fenHdr[1] : null, probe;
    try { probe = new Chess(start || START); } catch (e) { toast('Bad FEN in PGN', true); return; }
    var ok = [];
    for (var i = 0; i < toks.length; i++) {
      if (!probe.move(toks[i])) { toast('Stopped at unreadable move "' + toks[i] + '"', true); break; }
      ok.push(toks[i]);
    }
    if (!ok.length && !start) { toast('Nothing to import', true); return; }
    startLocal(start, ok);
    G.viewPly = null;
    renderAll(null);
  }

  function undoComputer() {
    if (!G.moves.length) return;
    var wasThinking = G.aiThinking;
    Engine.cancel(); G.aiThinking = false;
    var n = wasThinking ? 1 : (G.status === 'over' ? (G.chess.turn === G.seat ? 2 : 1) : 2);
    // after our own move that ended the game, only one ply to take back
    n = Math.min(n, G.moves.length);
    truncateTo(G.moves.length - n);
    G.hint = null;
    renderAll(null);
    if (G.chess.turn !== G.seat) requestAI();
  }

  /* ================================================================ game over modal */
  function showOver() {
    if (G.overShown) return;
    G.overShown = true;
    sfx('end');
    var ri = resultInfo(G.result, G.reason), me = G.seat, mine = me === 'w' || me === 'b';
    var title = ri.title, icon = '♚';
    if (mine && ri.winner) { title = ri.winner === me ? 'You won!' : 'You lost'; icon = ri.winner === me ? '♛' : '♚'; }
    else if (!ri.winner) icon = '½';
    $('#over-icon').textContent = icon;
    $('#over-title').textContent = title;
    $('#over-sub').textContent = ri.winner ? ri.title + ' ' + ri.sub : (ri.sub ? 'Draw ' + ri.sub : '');
    var d = $('#over-delta');
    d.textContent = '';
    if (G.mode === 'online' && G.delta && mine) {
      var dv = G.delta[me], nr = me === 'w' ? G.delta.wr : G.delta.br;
      var sp = h('span', dv >= 0 ? 'up' : 'down', (dv >= 0 ? '+' : '') + dv);
      d.appendChild(document.createTextNode('Rating: '));
      d.appendChild(sp);
      d.appendChild(document.createTextNode('  →  ' + nr));
      S.rating = nr; updateProfile();
    }
    var acts = $('#over-actions');
    acts.textContent = '';
    function btn(label, cls, fn) { var b = h('button', 'btn ' + cls, label); b.onclick = function () { $('#over-modal').classList.add('hidden'); fn(); }; acts.appendChild(b); }
    if (G.mode === 'online' && mine && G.reason !== 'aborted') btn('↻ Rematch', 'primary', function () { Net.send({ t: 'rematch' }); });
    if (G.mode === 'computer') btn('↻ Play again', 'primary', function () { startComputer(G.level, G.seat === 'w' ? 'b' : 'w'); });
    if (G.moves.length > 1) btn('📊 Review', G.mode === 'online' ? '' : 'primary', startReview);
    if (G.moves.length) btn('🔍 Analyze', '', analyzeCurrent);
    btn('Close', '', function () { /* just close */ });
    $('#over-modal').classList.remove('hidden');
  }
  $('#over-close').onclick = function () { $('#over-modal').classList.add('hidden'); };
  $('#over-modal').addEventListener('click', function (e) { if (e.target === this) this.classList.add('hidden'); });

  /* ================================================================ online state sync */
  function onState(st) {
    if (!G || G.mode !== 'online' || G.room !== st.id) return;
    var prevStatus = G.status, prevN = G.moves.length, wasEnd = G.viewPly === null || G.viewPly === prevN;
    var firstState = !G.ready;
    var same = G.moves.length <= st.moves.length && G.moves.every(function (m, i) { return m.san === st.moves[i].san; });
    var anim = null, newRecs = [];
    if (same && G.ready) {
      for (var i = G.moves.length; i < st.moves.length; i++) {
        var r = playRecord(st.moves[i]);
        if (!r) { same = false; break; }
        newRecs.push(r);
      }
    }
    if (!same || !G.ready) {
      newRecs = [];
      if (!rebuildFrom(START, st.moves)) { toast('Out of sync, reloading…', true); setTimeout(function () { location.reload(); }, 800); return; }
      if (G.ready && st.moves.length === prevN + 1) newRecs = [G.moves[G.moves.length - 1]];
    }
    if (newRecs.length === 1 && wasEnd) anim = animFor(newRecs[0]);
    if (newRecs.length) { sfxFor(newRecs[newRecs.length - 1]); if (document.hidden) { /* tab title handles it */ } }
    if (wasEnd) G.viewPly = null;
    G.ready = true;
    G.seat = st.you;
    G.status = st.status; G.result = st.result; G.reason = st.reason;
    G.tc = st.tc; G.rated = st.rated;
    G.players = st.players;
    G.clocks = st.clocks; G.running = st.running; G.clockAt = Date.now();
    G.drawOffer = st.drawOffer; G.takeback = st.takeback; G.rematch = st.rematch;
    G.spectators = st.spectators; G.delta = st.delta;
    if (G.seat === 'b' && !G.flipSet) { G.flipped = true; }
    G.flipSet = true;

    // premove execution
    if (G.premove && G.status === 'playing' && G.chess.turn === G.seat && isLive()) {
      var pm = G.premove; G.premove = null;
      var ok = G.chess.moves({ square: pm.from, san: false }).filter(function (m) { return m.to === pm.to; })[0];
      if (ok) { setTimeout(function () { if (G && G.mode === 'online') commit({ from: pm.from, to: pm.to, promo: ok.flags.indexOf('p') >= 0 ? 'q' : undefined }, false); }, 40); }
    }

    // opponent presence
    var opp = other(G.seat);
    if (G.seat === 'w' || G.seat === 'b') {
      var op = st.players[opp], cs = G.connState[opp];
      if (op) {
        if (cs === true && !op.connected && st.status === 'playing') chatSys(op.name + ' disconnected');
        if (cs === false && op.connected && st.status === 'playing') chatSys(op.name + ' reconnected');
        if (cs === null && op.connected && st.status === 'playing' && prevStatus === 'waiting') { chatSys(op.name + ' joined'); sfx('notify'); }
        G.connState[opp] = op.connected;
        G.discSeen = op.connected ? null : (G.discSeen || Date.now());
        if (op.connected) G.claimShown = false;
      }
    }
    if (firstState && st.status === 'over') {
      G.overShown = true;            // arrived at an already-finished game: no pop-up
      renderAll(anim);
    } else if (prevStatus !== 'over' && st.status === 'over') {
      renderAll(anim);
      if (st.reason !== 'aborted') showOver(); else toast('Game aborted');
    } else {
      renderAll(anim);
      if (prevStatus === 'waiting' && st.status === 'playing' && (G.seat === 'w' || G.seat === 'b')) toast('Opponent joined — good luck!');
    }
    if (G.status === 'over') { /* keep delta for profile */
      if (st.delta && (G.seat === 'w' || G.seat === 'b')) { S.rating = G.seat === 'w' ? st.delta.wr : st.delta.br; updateProfile(); }
    }
  }

  function chatSys(text) { addChat({ sys: true, text: text }); }
  function addChat(m) {
    var log = $('#chat-log'), d = h('div', 'msg' + (m.sys ? ' sys' : ''));
    if (m.sys) d.textContent = text2(m.text);
    else { d.appendChild(h('span', 'who ' + (m.seat || 's'), m.from)); d.appendChild(document.createTextNode(m.text)); }
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }
  function text2(t) { return '— ' + t; }

  /* ================================================================ screens & routing */
  function showView(name) {
    $('#home').classList.toggle('hidden', name !== 'home');
    $('#game').classList.toggle('hidden', name !== 'game');
  }

  function showHome() {
    Engine.cancel();
    ReviewRunner.cancel();
    G = null;
    showView('home');
    document.title = 'Gambit — chess with friends';
    if (Net.open) Net.send({ t: 'lobby' });
  }

  function openOnline(code) {
    if (G && G.mode === 'online' && G.room === code) { showView('game'); return; }
    newGame('online');
    G.room = code;
    G.players = { w: null, b: null };
    showView('game');
    renderAll(null);
    Net.send({ t: 'join', room: code });
  }

  function startComputer(level, color) {
    if (color === 'random') color = Math.random() < 0.5 ? 'w' : 'b';
    newGame('computer');
    G.seat = color; G.level = level; G.flipped = color === 'b';
    G.players = { w: { name: color === 'w' ? S.name : 'Computer', rating: color === 'w' ? S.rating : null }, b: { name: color === 'b' ? S.name : 'Computer', rating: color === 'b' ? S.rating : null } };
    G.players[other(color)].rating = null;
    G.ready = true;
    showView('game');
    renderAll(null);
    if (color === 'b') requestAI();
  }

  function startLocal(fen, sans) {
    newGame('local');
    G.seat = 'both'; G.ready = true;
    G.players = { w: { name: 'White' }, b: { name: 'Black' } };
    if (fen || (sans && sans.length)) {
      if (!rebuildFrom(fen || START, sans || [])) toast('Could not load that game', true);
    }
    showView('game');
    renderAll(null);
  }

  function openReview(game) {
    newGame('review');
    G.seat = 's'; G.ready = true; G.status = 'over'; G.result = game.result; G.reason = game.reason;
    G.players = { w: { name: game.white, rating: game.wr }, b: { name: game.black, rating: game.br } };
    G.tc = game.tc; G.rated = game.rated; G.overShown = true;
    rebuildFrom(START, game.moves);
    G.viewPly = null;
    showView('game');
    renderAll(null);
    setView(0, true);
  }

  function route() {
    var m = location.pathname.match(/^\/g\/([A-Za-z0-9]+)/);
    if (m) openOnline(m[1].toLowerCase()); else showHome();
  }
  function go(path, replace) {
    try { history[replace ? 'replaceState' : 'pushState']({}, '', path); } catch (e) { /* ignore */ }
    route();
  }
  window.addEventListener('popstate', route);
  $('#brand').addEventListener('click', function (e) { e.preventDefault(); go('/'); });

  /* ================================================================ server messages */
  function onMsg(m) {
    switch (m.t) {
      case 'welcome':
        S.name = m.name || S.name; S.rating = m.rating;
        lsSet('gambit.name', S.name);
        updateProfile();
        break;
      case 'lobby': renderLobby(m); break;
      case 'queue':
        if (!m.searching && S.queued) { S.queued = null; renderQueue(); }
        else if (m.searching) $('#queue-count').textContent = m.n + ' searching';
        break;
      case 'matched':
        S.queued = null; renderQueue();
        sfx('notify');
        toast('Opponent found: ' + m.opponent.name + ' (' + m.opponent.rating + ')');
        go('/g/' + m.room);
        break;
      case 'created': go('/g/' + m.room); break;
      case 'state': onState(m); break;
      case 'chatlog':
        if (G && G.mode === 'online') { $('#chat-log').textContent = ''; m.msgs.forEach(addChat); }
        break;
      case 'chat':
        if (G && G.mode === 'online') {
          addChat(m.msg);
          if (m.msg.from !== S.name && document.hidden) sfx('notify');
        }
        break;
      case 'gone':
        toast(m.cancelled ? 'Game cancelled' : 'That game no longer exists', !m.cancelled);
        go('/', true);
        break;
      case 'rematch': go('/g/' + m.room); break;
      case 'game': openReview(m.game); break;
      case 'error': toast(m.msg, true); break;
      case 'notice': toast(m.msg); break;
    }
  }

  /* ================================================================ lobby UI */
  function tcLabel(tc) { return tc && tc.base ? (tc.base / 60000) + '+' + (tc.inc / 1000) : '∞'; }
  function ago(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function fillList(id, items, emptyText) {
    var box = $(id);
    box.textContent = '';
    if (!items.length) { box.appendChild(h('div', 'empty', emptyText)); return; }
    items.forEach(function (x) { box.appendChild(x); });
  }
  function item(tag, onclick) {
    var e = h(tag, 'item');
    if (onclick) { e.onclick = onclick; e.type = 'button'; }
    return e;
  }
  function renderLobby(m) {
    $('#online-count').textContent = m.online + ' online';
    if (!S.queued) $('#queue-count').textContent = m.queued ? m.queued + ' searching' : '';
    fillList('#open-list', m.open.map(function (g) {
      var e = item('button', function () { go('/g/' + g.id); });
      var sq = h('span', 'sq ' + (g.color === 'w' ? 'sq-w' : 'sq-b')); e.appendChild(sq);
      e.appendChild(h('span', 'grow', g.name + ' (' + g.rating + ')'));
      e.appendChild(h('span', 'tag', tcLabel(g.tc)));
      e.appendChild(h('span', 'tag' + (g.rated ? ' r' : ''), g.rated ? 'Rated' : 'Casual'));
      return e;
    }), 'No open games. Create one and share the link!');
    fillList('#live-list', m.live.map(function (g) {
      var e = item('button', function () { go('/g/' + g.id); });
      e.appendChild(h('span', 'grow', g.white + ' vs ' + g.black));
      e.appendChild(h('span', 'tag', tcLabel(g.tc)));
      e.appendChild(h('span', 'tag', g.moves + ' ply'));
      return e;
    }), 'Nothing in progress.');
    fillList('#top-list', m.top.map(function (p, i) {
      var e = item('div');
      e.appendChild(h('span', 'rk', String(i + 1)));
      e.appendChild(h('span', 'grow', p.name));
      e.appendChild(h('span', 'tag', p.wins + 'W ' + p.losses + 'L ' + p.draws + 'D'));
      e.appendChild(h('span', 'res', String(p.rating)));
      return e;
    }), 'Play a rated game to get on the board.');
    fillList('#recent-list', m.recent.map(function (g) {
      var e = item('button', function () { Net.send({ t: 'getgame', id: g.id }); });
      e.appendChild(h('span', 'grow', g.white + ' vs ' + g.black));
      e.appendChild(h('span', 'res', g.result === '1/2-1/2' ? '½–½' : g.result.replace('-', '–')));
      e.appendChild(h('span', 'tag', ago(g.date)));
      return e;
    }), 'No finished games yet.');
  }

  function updateProfile() {
    $('#my-rating').textContent = S.rating;
    $('#avatar').textContent = (S.name || '?').trim().charAt(0).toUpperCase() || '?';
    var inp = $('#name-input');
    if (document.activeElement !== inp) inp.value = S.name;
  }

  function seg(id, onchange) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      Array.prototype.forEach.call(box.children, function (x) { x.classList.toggle('on', x === b); });
      if (onchange) onchange(b.dataset.v);
    });
    return function () { var on = box.querySelector('.on'); return on ? on.dataset.v : null; };
  }
  var getColor = seg('#seg-color');
  var getAiColor = seg('#seg-ai-color');

  function saveName() {
    var n = $('#name-input').value.replace(/[<>]/g, '').trim().slice(0, 20);
    if (!n) { $('#name-input').value = S.name; return; }
    S.name = n; lsSet('gambit.name', n);
    Net.send({ t: 'rename', name: n });
    updateProfile();
    toast('Name saved');
  }
  $('#btn-save-name').onclick = saveName;
  $('#name-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') { saveName(); this.blur(); } });

  $('#btn-create').onclick = function () {
    var tc = $('#tc').value.split(',').map(Number);
    Net.send({
      t: 'create', tc: { base: tc[0] * 60, inc: tc[1] },
      color: getColor(), rated: $('#opt-rated').checked, public: $('#opt-public').checked
    });
  };
  $('#btn-ai').onclick = function () { startComputer(+$('#ai-level').value, getAiColor()); };
  $('#btn-local').onclick = function () { startLocal(); };
  function joinFromInput() {
    var v = $('#join-code').value.trim(), m = v.match(/([A-Za-z0-9]{4,12})\/?(\?.*)?$/);
    if (!m) { toast('Paste an invite link or game code', true); return; }
    go('/g/' + m[1].toLowerCase());
  }
  $('#btn-join').onclick = joinFromInput;
  $('#join-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') joinFromInput(); });

  $('#btn-copy-link').onclick = function () { copyText($('#invite-link').value, 'Invite link copied!'); };
  $('#invite-link').addEventListener('focus', function () { this.select(); });

  $('#nav-first').onclick = function () { setView(0); };
  $('#nav-prev').onclick = function () { setView(curPly() - 1); };
  $('#nav-next').onclick = function () { setView(curPly() + 1); };
  $('#nav-last').onclick = function () { setView(G.moves.length); };

  $('#chat-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('#chat-input'), t = inp.value.trim();
    if (!t) return;
    Net.send({ t: 'chat', text: t });
    inp.value = '';
  });

  document.addEventListener('keydown', function (e) {
    if (!G || $('#game').classList.contains('hidden')) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft': setView(curPly() - 1); e.preventDefault(); break;
      case 'ArrowRight': setView(curPly() + 1); e.preventDefault(); break;
      case 'ArrowUp': case 'Home': setView(0); e.preventDefault(); break;
      case 'ArrowDown': case 'End': setView(G.moves.length); e.preventDefault(); break;
      case 'f': case 'F': G.flipped = !G.flipped; renderAll(null); break;
      case 'Escape': view.select(null); G.premove = null; renderBoard(null); renderStatus(); break;
    }
  });
  // clicking anywhere outside the board clears a pending premove
  document.addEventListener('pointerdown', function (e) {
    if (G && G.premove && !e.target.closest('#board')) { G.premove = null; renderBoard(null); renderStatus(); }
  });
  document.addEventListener('visibilitychange', function () { if (G && !G.premove) renderStatus(); });

  /* ================================================================ settings UI */
  function applySettings() {
    document.body.dataset.theme = settings.theme;
    $('#board').classList.toggle('classic', settings.pieces === 'classic');
    $('#board').classList.toggle('no-coords', !settings.coords);
    $('#promo-row').classList.toggle('classic', settings.pieces === 'classic');
    $('#set-sound').checked = settings.sound; $('#set-anim').checked = settings.anim;
    $('#set-hints').checked = settings.hints; $('#set-autoq').checked = settings.autoq; $('#set-coords').checked = settings.coords;
    Array.prototype.forEach.call($('#themes').children, function (b) { b.classList.toggle('on', b.dataset.v === settings.theme); });
    Array.prototype.forEach.call($('#seg-pieces').children, function (b) { b.classList.toggle('on', b.dataset.v === settings.pieces); });
    Array.prototype.forEach.call($('#seg-review').children, function (b) { b.classList.toggle('on', +b.dataset.v === settings.reviewMs); });
    view.restyle();
    view.refreshClasses();
  }
  Object.keys(THEMES).forEach(function (k) {
    var b = h('button', 'swatch');
    b.dataset.v = k; b.title = cap(k);
    b.style.setProperty('--l', THEMES[k][0]); b.style.setProperty('--d', THEMES[k][1]);
    b.onclick = function () { settings.theme = k; saveSettings(); applySettings(); };
    $('#themes').appendChild(b);
  });
  $('#seg-review').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    settings.reviewMs = +b.dataset.v; saveSettings(); applySettings();
  });
  $('#seg-pieces').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    settings.pieces = b.dataset.v; saveSettings(); applySettings();
  });
  [['sound', '#set-sound'], ['anim', '#set-anim'], ['hints', '#set-hints'], ['autoq', '#set-autoq'], ['coords', '#set-coords']].forEach(function (p) {
    $(p[1]).addEventListener('change', function () { settings[p[0]] = this.checked; saveSettings(); applySettings(); if (p[0] === 'sound' && this.checked) sfx('move'); });
  });
  $('#btn-settings').onclick = function () { $('#settings-modal').classList.remove('hidden'); };
  $('#settings-close').onclick = function () { $('#settings-modal').classList.add('hidden'); };
  $('#settings-modal').addEventListener('click', function (e) { if (e.target === this) this.classList.add('hidden'); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $('#settings-modal').classList.add('hidden'); $('#over-modal').classList.add('hidden'); }
  });

  /* ================================================================ game review */
  var ReviewRunner = { w: null, cancel: function () { if (this.w) { this.w.terminate(); this.w = null; } } };

  function dropReview() {
    ReviewRunner.cancel();
    if (G) G.review = null;
  }
  function addReview(add) {
    var running = G.review && G.review.status === 'running';
    add(G.review && G.review.status === 'done' ? '📊 Re-run review' : '📊 Review', G.review ? '' : 'primary', startReview, G.moves.length < 1 || running, 'Classify every move: Brilliant, Great, Mistake…');
  }

  function startReview() {
    if (!G || !G.moves.length) return;
    if (G.mode === 'online' && G.status !== 'over') { toast('Reviews unlock when the game is over', true); return; }
    ReviewRunner.cancel();
    var g = G, items = [], i;
    for (i = 0; i <= g.moves.length; i++) {
      items.push({
        fen: g.infos[i].fen,
        played: i < g.moves.length ? { from: g.moves[i].from, to: g.moves[i].to, promo: g.moves[i].promo || null } : null
      });
    }
    g.review = { status: 'running', done: 0, total: items.length, items: [], res: null };
    var w = ReviewRunner.w = new Worker('/ai.js');
    w.onmessage = function (e) {
      var d = e.data;
      if (G !== g || !g.review) return;
      if (d.type === 'progress') { g.review.items[d.i] = d.item; g.review.done = d.i + 1; updateReviewProgress(); }
      else if (d.type === 'done') finishReview(g);
    };
    w.postMessage({ type: 'review', id: 1, items: items, ms: settings.reviewMs });
    $('#over-modal').classList.add('hidden');
    renderActions(); renderReview();
    var p = $('#review-panel');
    if (p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finishReview(g) {
    ReviewRunner.cancel();
    var turns = g.infos.map(function (x) { return x.fen.split(' ')[1]; });
    g.review.res = Review.analyze({
      items: g.review.items, turns: turns,
      book: function (i) { return !!window.OPENINGS && i < 16 && !!window.OPENINGS.exact(g.moves.slice(0, i + 1).map(function (m) { return m.san; })); }
    });
    g.review.status = 'done';
    if (G !== g) return;
    renderBoard(null); renderMoves(); renderActions(); renderReview();
    sfx('notify');
  }

  function updateReviewProgress() {
    var R = G && G.review, bar = $('#rv-bar'), txt = $('#rv-text');
    if (!R || !bar) return;
    bar.style.width = (R.done / R.total * 100) + '%';
    txt.textContent = 'Analysing position ' + R.done + ' of ' + R.total + '…';
  }

  function reviewFor(ply) {
    var R = G && G.review;
    if (!R || R.status !== 'done' || ply < 1) return null;
    var i = ply - 1;
    return { i: i, cls: R.res.cls[i], loss: R.res.loss[i], item: R.items[i] };
  }

  function bdgEl(cls) {
    var info = Review.INFO[cls], b = h('span', 'bdg', info.sym);
    b.style.background = info.color; b.style.color = info.ink;
    return b;
  }
  function keyPlies() {
    var out = [], c = G.review.res.cls;
    for (var i = 0; i < c.length; i++) if (c[i] === 'brilliant' || c[i] === 'great' || c[i] === 'mistake' || c[i] === 'blunder') out.push(i + 1);
    return out;
  }

  function renderReview() {
    var box = $('#review-panel'), R = G && G.review;
    if (!R) { box.classList.add('hidden'); box.textContent = ''; return; }
    box.classList.remove('hidden');
    box.textContent = '';
    var head = h('div', 'rv-head');
    head.appendChild(h('h3', null, '📊 Game review'));
    var x = h('button', 'btn ghost icon', '✕');
    x.title = 'Close review';
    x.onclick = function () { dropReview(); renderBoard(null); renderMoves(); renderActions(); renderReview(); };
    head.appendChild(x);
    box.appendChild(head);

    if (R.status === 'running') {
      var pr = h('div', 'rv-progress'), bar = h('i'); bar.id = 'rv-bar';
      bar.style.width = (R.done / R.total * 100) + '%';
      pr.appendChild(bar); box.appendChild(pr);
      var t = h('div', 'muted small', 'Analysing position ' + R.done + ' of ' + R.total + '…'); t.id = 'rv-text';
      box.appendChild(t);
      box.appendChild(h('div', 'muted small', 'You can keep browsing the game while it works.'));
      return;
    }

    var res = R.res, n = G.moves.length;
    // accuracy
    var acc = h('div', 'rv-acc');
    ['w', 'b'].forEach(function (c) {
      var d = h('div'), nm = h('div', 'nm');
      nm.appendChild(h('span', 'sq ' + (c === 'w' ? 'sq-w' : 'sq-b')));
      var sq = nm.firstChild; sq.style.cssText = 'width:11px;height:11px;border-radius:3px;display:inline-block;border:1px solid #0006;';
      nm.appendChild(document.createTextNode(playerLabel(c)));
      d.appendChild(nm);
      var p = h('div', 'pct', res.acc[c] == null ? '–' : res.acc[c].toFixed(1));
      if (res.acc[c] != null) p.appendChild(h('small', null, '%'));
      d.appendChild(p);
      acc.appendChild(d);
    });
    box.appendChild(acc);

    // eval graph
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'rv-graph'); svg.setAttribute('viewBox', '0 0 ' + Math.max(1, n) + ' 100'); svg.setAttribute('preserveAspectRatio', 'none');
    var pts = res.evals.map(function (cp, i) { return i + ',' + (100 - Review.wp(cp)).toFixed(1); });
    var area = document.createElementNS(ns, 'polygon');
    area.setAttribute('points', '0,100 ' + pts.join(' ') + ' ' + n + ',100');
    area.setAttribute('fill', '#f1f1f1');
    svg.appendChild(area);
    var mid = document.createElementNS(ns, 'line');
    mid.setAttribute('x1', 0); mid.setAttribute('x2', n); mid.setAttribute('y1', 50); mid.setAttribute('y2', 50);
    mid.setAttribute('stroke', 'rgba(120,120,120,.8)'); mid.setAttribute('stroke-width', 1); mid.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(mid);
    var cur = document.createElementNS(ns, 'line'), ply = curPly();
    cur.setAttribute('x1', ply); cur.setAttribute('x2', ply); cur.setAttribute('y1', 0); cur.setAttribute('y2', 100);
    cur.setAttribute('stroke', '#e8b64c'); cur.setAttribute('stroke-width', 2); cur.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(cur);
    svg.addEventListener('click', function (e) {
      var r = svg.getBoundingClientRect();
      setView(Math.round((e.clientX - r.left) / r.width * n));
    });
    box.appendChild(svg);

    // counts
    var grid = h('div', 'rv-counts');
    grid.appendChild(h('span')); grid.appendChild(h('span', 'hd', 'White')); grid.appendChild(h('span', 'hd', 'Black'));
    Review.ORDER.forEach(function (k) {
      if (!res.counts.w[k] && !res.counts.b[k]) return;
      var l = h('span', 'rv-lbl'); l.appendChild(bdgEl(k)); l.appendChild(document.createTextNode(Review.INFO[k].label));
      grid.appendChild(l);
      ['w', 'b'].forEach(function (c) { grid.appendChild(h('span', 'num' + (res.counts[c][k] ? '' : ' zero'), String(res.counts[c][k]))); });
    });
    box.appendChild(grid);

    // current move commentary
    var now = h('div', 'rv-now'), rv = reviewFor(ply);
    if (ply === 0) {
      now.appendChild(h('div', 't', 'Starting position'));
      now.appendChild(h('div', 's', 'Use ← → or click the graph to step through the game.'));
    } else if (!rv || !rv.cls) {
      now.appendChild(h('div', 't', G.moves[ply - 1].san));
    } else {
      var info = Review.INFO[rv.cls], t2 = h('div', 't');
      t2.appendChild(bdgEl(rv.cls));
      var PHRASE = { brilliant: 'a brilliant move', great: 'a great move', best: 'the best move', excellent: 'an excellent move', good: 'a good move', book: 'a book move', inaccuracy: 'an inaccuracy', mistake: 'a mistake', blunder: 'a blunder', forced: 'forced' };
      var sp = h('span'); sp.appendChild(h('b', null, G.moves[ply - 1].san)); sp.appendChild(document.createTextNode(' is ' + (PHRASE[rv.cls] || info.label.toLowerCase())));
      t2.appendChild(sp);
      now.appendChild(t2);
      var s = h('div', 's'), parts = [];
      if (rv.cls === 'brilliant' && rv.item.sac) parts.push('Gives up about ' + Math.max(1, Math.round(rv.item.sac / 100)) + ' points of material and keeps the position');
      else if (rv.cls === 'great') parts.push('The only move that keeps your position healthy');
      else if (rv.cls === 'forced') parts.push('Only legal move');
      if (rv.loss >= 3 && rv.item.best) {
        var bs = null;
        try { var bm = new Chess(G.infos[rv.i].fen).move(rv.item.best); bs = bm && bm.san; } catch (e) { /* ignore */ }
        if (bs) { s.appendChild(document.createTextNode(parts.concat(['best was ']).join(' · ').replace(/ · best was $/, ' · best was '))); s.appendChild(h('b', null, bs)); parts = null; }
      }
      var ev = res.evals[ply], evText = Math.abs(ev) >= 100000 ? 'checkmate' : 'eval ' + fmtScore(ev);
      if (parts) s.appendChild(document.createTextNode(parts.concat([evText]).join(' · ')));
      else s.appendChild(document.createTextNode(' · ' + evText));
      now.appendChild(s);
    }
    box.appendChild(now);

    // key-move navigation
    var nav = h('div', 'rv-nav'), keys = keyPlies();
    var prev = h('button', 'btn', '◀ Key move'), next = h('button', 'btn', 'Key move ▶');
    var before = keys.filter(function (k) { return k < ply; }), after = keys.filter(function (k) { return k > ply; });
    prev.disabled = !before.length; next.disabled = !after.length;
    prev.onclick = function () { setView(before[before.length - 1]); };
    next.onclick = function () { setView(after[0]); };
    nav.appendChild(prev); nav.appendChild(next);
    box.appendChild(nav);
  }

  /* ================================================================ quick play queue */
  function joinQueue(tc, rated) {
    if (!Net.open) { toast('Not connected yet — try again in a second', true); return; }
    S.queued = { tc: tc, rated: rated, since: Date.now() };
    Net.send({ t: 'queue', tc: tc, rated: rated });
    audio();
    renderQueue();
  }
  function leaveQueue() {
    if (!S.queued) return;
    S.queued = null;
    Net.send({ t: 'queue', a: 'leave' });
    renderQueue();
  }
  function renderQueue() {
    var q = S.queued;
    $('#quick-pick').classList.toggle('hidden', !!q);
    $('#quick-wait').classList.toggle('hidden', !q);
    $('#quick-card').classList.toggle('searching-now', !!q);
    if (q) { $('#search-tc').textContent = (q.tc.base / 60) + '+' + q.tc.inc + (q.rated ? ' rated' : ' casual'); updateQueueTimer(); }
  }
  function updateQueueTimer() {
    var q = S.queued;
    if (!q) return;
    var s = Math.floor((Date.now() - q.since) / 1000);
    $('#search-time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    $('#search-range').textContent = String(100 + s * 25);
  }
  setInterval(updateQueueTimer, 500);
  $('#quick-grid').addEventListener('click', function (e) {
    var b = e.target.closest('.quick');
    if (!b) return;
    var p = b.dataset.tc.split(',').map(Number);
    joinQueue({ base: p[0] * 60, inc: p[1] }, $('#quick-rated').checked);
  });
  $('#btn-cancel-queue').onclick = leaveQueue;

  /* ================================================================ boot */
  applySettings();
  updateProfile();
  Net.connect();
  route();

  // tiny debugging/testing hook
  window.__gambit = { get G() { return G; }, view: view, Net: Net };
})();
