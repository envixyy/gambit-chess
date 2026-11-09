/* Gambit chess engine — full rules, shared by browser, worker and server.
 * 0x88 board, rank 0 = 8th rank (FEN order). Pieces are FEN chars (uppercase = white).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';
  var KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  var BISHOP = [-17, -15, 15, 17];
  var ROOK = [-16, -1, 1, 16];
  var KING = [-17, -16, -15, -1, 1, 15, 16, 17];

  // move flags
  var CAP = 1, DOUBLE = 2, EP = 4, PROMO = 8, KC = 16, QC = 32;

  function sqName(s) { return FILES[s & 15] + (8 - (s >> 4)); }
  function sqIdx(n) { return (8 - (+n[1])) * 16 + FILES.indexOf(n[0]); }
  function isWhite(p) { return p < 'a'; }

  function Chess(fen) { this.load(fen || START_FEN); }

  Chess.START_FEN = START_FEN;
  Chess.sqName = sqName;
  Chess.sqIdx = sqIdx;

  Chess.prototype.load = function (fen) {
    var parts = fen.trim().split(/\s+/);
    this.board = new Array(128).fill(null);
    var r = 0, f = 0, i, ch;
    for (i = 0; i < parts[0].length; i++) {
      ch = parts[0][i];
      if (ch === '/') { r++; f = 0; }
      else if (ch >= '1' && ch <= '8') f += +ch;
      else { this.board[r * 16 + f] = ch; f++; }
    }
    this.turn = parts[1] === 'b' ? 'b' : 'w';
    var rights = parts[2] && parts[2] !== '-' ? parts[2] : '';
    this.ep = parts[3] && parts[3] !== '-' ? sqIdx(parts[3]) : -1;
    this.half = +parts[4] || 0;
    this.full = +parts[5] || 1;
    this.kings = { w: -1, b: -1 };
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      if (this.board[s] === 'K') this.kings.w = s;
      else if (this.board[s] === 'k') this.kings.b = s;
    }
    // sanitise castling rights against actual piece placement
    var b = this.board, c = '';
    if (rights.indexOf('K') >= 0 && b[116] === 'K' && b[119] === 'R') c += 'K';
    if (rights.indexOf('Q') >= 0 && b[116] === 'K' && b[112] === 'R') c += 'Q';
    if (rights.indexOf('k') >= 0 && b[4] === 'k' && b[7] === 'r') c += 'k';
    if (rights.indexOf('q') >= 0 && b[4] === 'k' && b[0] === 'r') c += 'q';
    this.castling = c;
    this.startFen = this.fen();
    this.stack = [];
    this.hist = [];
    this.keys = [this._key()];
  };

  Chess.prototype.reset = function () { this.load(START_FEN); };

  Chess.prototype.fen = function () {
    var s = '', r, f, e, p;
    for (r = 0; r < 8; r++) {
      e = 0;
      for (f = 0; f < 8; f++) {
        p = this.board[r * 16 + f];
        if (p) { s += (e || '') + p; e = 0; } else e++;
      }
      if (e) s += e;
      if (r < 7) s += '/';
    }
    return s + ' ' + this.turn + ' ' + (this.castling || '-') + ' ' +
      (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
  };

  Chess.prototype._key = function () {
    var f = this.fen().split(' ');
    var ep = '-';
    if (this.ep >= 0) {
      var b = this.board, e = this.ep, w = this.turn === 'w';
      var a1 = w ? e + 15 : e - 17, a2 = w ? e + 17 : e - 15, pc = w ? 'P' : 'p';
      if ((!(a1 & 0x88) && b[a1] === pc) || (!(a2 & 0x88) && b[a2] === pc)) ep = sqName(e);
    }
    return f[0] + ' ' + f[1] + ' ' + f[2] + ' ' + ep;
  };

  Chess.prototype.get = function (name) { return this.board[sqIdx(name)] || null; };

  Chess.prototype.attacked = function (sq, by) {
    var b = this.board, white = by === 'w', i, s, p, d, o;
    var pd = white ? 16 : -16, pawn = white ? 'P' : 'p';
    s = sq + pd - 1; if (!(s & 0x88) && b[s] === pawn) return true;
    s = sq + pd + 1; if (!(s & 0x88) && b[s] === pawn) return true;
    var kn = white ? 'N' : 'n', ki = white ? 'K' : 'k';
    for (i = 0; i < 8; i++) {
      s = sq + KNIGHT[i]; if (!(s & 0x88) && b[s] === kn) return true;
      s = sq + KING[i]; if (!(s & 0x88) && b[s] === ki) return true;
    }
    var bq1 = white ? 'B' : 'b', bq2 = white ? 'Q' : 'q', rq1 = white ? 'R' : 'r';
    for (i = 0; i < 4; i++) {
      d = BISHOP[i]; s = sq + d;
      while (!(s & 0x88)) { p = b[s]; if (p) { if (p === bq1 || p === bq2) return true; break; } s += d; }
      d = ROOK[i]; s = sq + d;
      while (!(s & 0x88)) { p = b[s]; if (p) { if (p === rq1 || p === bq2) return true; break; } s += d; }
    }
    return false;
  };

  Chess.prototype.inCheck = function (side) {
    side = side || this.turn;
    return this.attacked(this.kings[side], side === 'w' ? 'b' : 'w');
  };

  // pseudo-legal move generation
  Chess.prototype._pseudo = function () {
    var out = [], b = this.board, us = this.turn, white = us === 'w', them = white ? 'b' : 'w';
    var sq, p, t, to, c, d, i, o, dir, startRank, promoRank;
    for (sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (!p || isWhite(p) !== white) continue;
      t = p.toLowerCase();
      if (t === 'p') {
        dir = white ? -16 : 16; startRank = white ? 6 : 1; promoRank = white ? 0 : 7;
        to = sq + dir;
        if (!b[to]) {
          if ((to >> 4) === promoRank) this._promos(out, sq, to, p, null, 0);
          else {
            out.push({ f: sq, t: to, p: p, c: null, pr: null, fl: 0 });
            if ((sq >> 4) === startRank && !b[to + dir]) out.push({ f: sq, t: to + dir, p: p, c: null, pr: null, fl: DOUBLE });
          }
        }
        for (i = -1; i <= 1; i += 2) {
          to = sq + dir + i;
          if (to & 0x88) continue;
          c = b[to];
          if (c && isWhite(c) !== white) {
            if ((to >> 4) === promoRank) this._promos(out, sq, to, p, c, CAP);
            else out.push({ f: sq, t: to, p: p, c: c, pr: null, fl: CAP });
          } else if (to === this.ep) {
            out.push({ f: sq, t: to, p: p, c: white ? 'p' : 'P', pr: null, fl: EP | CAP });
          }
        }
      } else if (t === 'n' || t === 'k') {
        o = t === 'n' ? KNIGHT : KING;
        for (i = 0; i < 8; i++) {
          to = sq + o[i];
          if (to & 0x88) continue;
          c = b[to];
          if (!c) out.push({ f: sq, t: to, p: p, c: null, pr: null, fl: 0 });
          else if (isWhite(c) !== white) out.push({ f: sq, t: to, p: p, c: c, pr: null, fl: CAP });
        }
        if (t === 'k') {
          var ks = white ? 116 : 4;
          if (sq === ks && this.castling) {
            var K = white ? 'K' : 'k', Q = white ? 'Q' : 'q';
            if (this.castling.indexOf(K) >= 0 && !b[ks + 1] && !b[ks + 2] &&
              !this.attacked(ks, them) && !this.attacked(ks + 1, them))
              out.push({ f: ks, t: ks + 2, p: p, c: null, pr: null, fl: KC });
            if (this.castling.indexOf(Q) >= 0 && !b[ks - 1] && !b[ks - 2] && !b[ks - 3] &&
              !this.attacked(ks, them) && !this.attacked(ks - 1, them))
              out.push({ f: ks, t: ks - 2, p: p, c: null, pr: null, fl: QC });
          }
        }
      } else {
        o = t === 'b' ? BISHOP : t === 'r' ? ROOK : KING;
        for (i = 0; i < o.length; i++) {
          d = o[i]; to = sq + d;
          while (!(to & 0x88)) {
            c = b[to];
            if (!c) out.push({ f: sq, t: to, p: p, c: null, pr: null, fl: 0 });
            else {
              if (isWhite(c) !== white) out.push({ f: sq, t: to, p: p, c: c, pr: null, fl: CAP });
              break;
            }
            to += d;
          }
        }
      }
    }
    return out;
  };

  Chess.prototype._promos = function (out, f, t, p, c, fl) {
    var pr = ['q', 'r', 'b', 'n'];
    for (var i = 0; i < 4; i++) out.push({ f: f, t: t, p: p, c: c, pr: pr[i], fl: fl | PROMO });
  };

  Chess.prototype._make = function (m) {
    var b = this.board, us = this.turn, white = us === 'w';
    this.stack.push({ m: m, castling: this.castling, ep: this.ep, half: this.half, full: this.full });
    b[m.t] = m.pr ? (white ? m.pr.toUpperCase() : m.pr) : m.p;
    b[m.f] = null;
    if (m.fl & EP) b[m.t + (white ? 16 : -16)] = null;
    if (m.fl & KC) { b[m.t - 1] = b[m.t + 1]; b[m.t + 1] = null; }
    else if (m.fl & QC) { b[m.t + 1] = b[m.t - 2]; b[m.t - 2] = null; }
    if (m.p === 'K' || m.p === 'k') this.kings[us] = m.t;
    if (this.castling) {
      var c = this.castling;
      if (m.p === 'K') c = c.replace(/[KQ]/g, '');
      else if (m.p === 'k') c = c.replace(/[kq]/g, '');
      if (m.f === 0 || m.t === 0) c = c.replace('q', '');
      if (m.f === 7 || m.t === 7) c = c.replace('k', '');
      if (m.f === 112 || m.t === 112) c = c.replace('Q', '');
      if (m.f === 119 || m.t === 119) c = c.replace('K', '');
      this.castling = c;
    }
    this.ep = (m.fl & DOUBLE) ? (m.f + m.t) >> 1 : -1;
    this.half = (m.p === 'P' || m.p === 'p' || m.c) ? 0 : this.half + 1;
    if (!white) this.full++;
    this.turn = white ? 'b' : 'w';
  };

  Chess.prototype._undo = function () {
    var u = this.stack.pop(), m = u.m, b = this.board;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    var us = this.turn, white = us === 'w';
    b[m.f] = m.p;
    if (m.fl & EP) { b[m.t] = null; b[m.t + (white ? 16 : -16)] = m.c; }
    else b[m.t] = m.c || null;
    if (m.fl & KC) { b[m.t + 1] = b[m.t - 1]; b[m.t - 1] = null; }
    else if (m.fl & QC) { b[m.t - 2] = b[m.t + 1]; b[m.t + 1] = null; }
    if (m.p === 'K' || m.p === 'k') this.kings[us] = m.f;
    this.castling = u.castling; this.ep = u.ep; this.half = u.half; this.full = u.full;
  };

  Chess.prototype._legal = function () {
    var us = this.turn, them = us === 'w' ? 'b' : 'w', out = [], ms = this._pseudo(), i;
    for (i = 0; i < ms.length; i++) {
      this._make(ms[i]);
      if (!this.attacked(this.kings[us], them)) out.push(ms[i]);
      this._undo();
    }
    return out;
  };

  Chess.prototype._san = function (m, legal) {
    var s, pt = m.p.toLowerCase(), i, o;
    if (m.fl & KC) s = 'O-O';
    else if (m.fl & QC) s = 'O-O-O';
    else if (pt === 'p') {
      s = (m.fl & CAP) ? FILES[m.f & 15] + 'x' : '';
      s += sqName(m.t);
      if (m.pr) s += '=' + m.pr.toUpperCase();
    } else {
      s = pt.toUpperCase();
      var amb = false, sameFile = false, sameRank = false;
      for (i = 0; i < legal.length; i++) {
        o = legal[i];
        if (o !== m && o.p === m.p && o.t === m.t) {
          amb = true;
          if ((o.f & 15) === (m.f & 15)) sameFile = true;
          if ((o.f >> 4) === (m.f >> 4)) sameRank = true;
        }
      }
      if (amb) {
        if (!sameFile) s += FILES[m.f & 15];
        else if (!sameRank) s += (8 - (m.f >> 4));
        else s += sqName(m.f);
      }
      if (m.fl & CAP) s += 'x';
      s += sqName(m.t);
    }
    this._make(m);
    if (this.inCheck()) s += this._legal().length ? '+' : '#';
    this._undo();
    return s;
  };

  Chess.prototype._pub = function (m, san) {
    var fl = '';
    if (m.fl & CAP) fl += 'c';
    if (m.fl & EP) fl += 'e';
    if (m.fl & DOUBLE) fl += 'd';
    if (m.fl & PROMO) fl += 'p';
    if (m.fl & KC) fl += 'k';
    if (m.fl & QC) fl += 'q';
    var r = { from: sqName(m.f), to: sqName(m.t), piece: m.p.toLowerCase(), color: isWhite(m.p) ? 'w' : 'b', flags: fl };
    if (m.c) r.captured = m.c.toLowerCase();
    if (m.pr) r.promo = m.pr;
    if (san) r.san = san;
    return r;
  };

  /** Legal moves as public objects. opts.square limits to moves from that square. */
  Chess.prototype.moves = function (opts) {
    var ms = this._legal(), out = [], i, from = opts && opts.square ? sqIdx(opts.square) : -1;
    for (i = 0; i < ms.length; i++) {
      if (from >= 0 && ms[i].f !== from) continue;
      out.push(this._pub(ms[i], (opts && opts.san === false) ? null : this._san(ms[i], ms)));
    }
    return out;
  };

  /** Play a move: {from,to,promo} or a SAN string. Returns the move record or null. */
  Chess.prototype.move = function (input) {
    var ms = this._legal(), m = null, i;
    if (typeof input === 'string') {
      var want = input.replace(/[+#?!]+$/g, '').replace(/0/g, 'O');
      for (i = 0; i < ms.length; i++) {
        if (this._san(ms[i], ms).replace(/[+#]$/, '') === want) { m = ms[i]; break; }
      }
    } else if (input && input.from && input.to) {
      var f = sqIdx(input.from), t = sqIdx(input.to), pr = input.promo ? input.promo.toLowerCase() : null;
      for (i = 0; i < ms.length; i++) {
        if (ms[i].f === f && ms[i].t === t) {
          if (ms[i].pr) { if (ms[i].pr === (pr || 'q')) { m = ms[i]; break; } }
          else { m = ms[i]; break; }
        }
      }
    }
    if (!m) return null;
    var rec = this._pub(m, this._san(m, ms));
    this._make(m);
    rec.fen = this.fen();
    this.hist.push(rec);
    this.keys.push(this._key());
    return rec;
  };

  Chess.prototype.undo = function () {
    if (!this.hist.length) return null;
    var rec = this.hist.pop();
    this.keys.pop();
    this._undo();
    return rec;
  };

  Chess.prototype.history = function () { return this.hist; };

  Chess.prototype._insufficient = function () {
    var pcs = [], s, p, t;
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = this.board[s];
      if (!p) continue;
      t = p.toLowerCase();
      if (t !== 'k') pcs.push({ t: t, s: s });
    }
    if (!pcs.length) return true;
    if (pcs.length === 1 && (pcs[0].t === 'b' || pcs[0].t === 'n')) return true;
    var allB = pcs.every(function (x) { return x.t === 'b'; });
    if (allB) {
      var col = pcs[0] && (((pcs[0].s >> 4) + (pcs[0].s & 15)) & 1);
      return pcs.every(function (x) { return (((x.s >> 4) + (x.s & 15)) & 1) === col; });
    }
    return false;
  };

  Chess.prototype.repetitions = function () {
    var k = this.keys[this.keys.length - 1], n = 0;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i] === k) n++;
    return n;
  };

  /** Can `color` still deliver mate with the pieces it has (used for timeout results)? */
  Chess.prototype.canMate = function (color) {
    var minors = 0, s, p;
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = this.board[s];
      if (!p || isWhite(p) !== (color === 'w')) continue;
      p = p.toLowerCase();
      if (p === 'p' || p === 'r' || p === 'q') return true;
      if (p === 'b' || p === 'n') minors++;
    }
    return minors >= 2;
  };

  /** { over, result, reason, check } — result is '1-0', '0-1' or '1/2-1/2' */
  Chess.prototype.status = function () {
    var check = this.inCheck();
    if (!this._legal().length) {
      if (check) return { over: true, result: this.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate', check: true };
      return { over: true, result: '1/2-1/2', reason: 'stalemate', check: false };
    }
    if (this._insufficient()) return { over: true, result: '1/2-1/2', reason: 'insufficient material', check: check };
    if (this.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule', check: check };
    if (this.repetitions() >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition', check: check };
    return { over: false, check: check };
  };

  Chess.prototype.perft = function (depth) {
    if (depth === 0) return 1;
    var ms = this._legal(), n = 0, i;
    for (i = 0; i < ms.length; i++) {
      this._make(ms[i]);
      n += depth === 1 ? 1 : this.perft(depth - 1);
      this._undo();
    }
    return n;
  };

  Chess.prototype.kingSquare = function (side) { return sqName(this.kings[side]); };

  Chess.prototype.pgn = function (headers, result) {
    var out = '', k;
    headers = headers || {};
    result = result || headers.Result || '*';
    var h = Object.assign({ Event: 'Gambit game', Site: 'Gambit', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), Round: '-', White: '?', Black: '?', Result: result }, headers);
    h.Result = result;
    for (k in h) out += '[' + k + ' "' + String(h[k]).replace(/"/g, "'") + '"]\n';
    out += '\n';
    var line = '', i, tok;
    var startFull = +this.startFen.split(' ')[5] || 1;
    var blackFirst = this.startFen.split(' ')[1] === 'b';
    for (i = 0; i < this.hist.length; i++) {
      var ply = i + (blackFirst ? 1 : 0);
      if (ply % 2 === 0) tok = (startFull + (ply >> 1)) + '. ' + this.hist[i].san;
      else tok = (i === 0 ? (startFull) + '... ' : '') + this.hist[i].san;
      line += (line ? ' ' : '') + tok;
    }
    return out + (line ? line + ' ' : '') + result + '\n';
  };

  return Chess;
}));
