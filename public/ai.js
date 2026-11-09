/* Gambit engine worker: alpha-beta search with quiescence, used for the computer
 * opponent, hints and the analysis eval bar.
 *   postMessage({id, type:'move'|'analyze', fen, level, depth, ms})
 *   -> {id, type:'info', depth, score, best, pv}   (analyze only, per iteration)
 *   -> {id, type:'done', move:{from,to,promo}|null, score, depth}
 * `score` is in centipawns from White's point of view (±100000 = mate).
 */
importScripts('/chess.js');

var VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
var PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ke: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50]
};
var MATE = 100000;
var INF = 1000000;
var nodes = 0, deadline = 0, TIMEOUT = { timeout: true };

function evaluate(g) {
  var b = g.board, s, p, t, white, score = 0, mat = 0, bw = 0, bb = 0, i64;
  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    p = b[s];
    if (!p) continue;
    t = p.toLowerCase();
    if (t !== 'k' && t !== 'p') mat += VAL[t];
  }
  var endgame = mat < 2600;
  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    p = b[s];
    if (!p) continue;
    t = p.toLowerCase();
    white = p < 'a';
    i64 = (s >> 4) * 8 + (s & 7);
    var tab = t === 'k' ? (endgame ? PST.ke : PST.k) : PST[t];
    var v = VAL[t] + tab[white ? i64 : i64 ^ 56];
    if (t === 'b') { if (white) bw++; else bb++; }
    score += white ? v : -v;
  }
  if (bw >= 2) score += 30;
  if (bb >= 2) score -= 30;
  return g.turn === 'w' ? score : -score;
}

function order(g, moves, best) {
  var b = g.board, i, m, sc = new Array(moves.length);
  for (i = 0; i < moves.length; i++) {
    m = moves[i];
    sc[i] = 0;
    if (best && m.f === best.f && m.t === best.t && m.pr === best.pr) sc[i] = 1e6;
    else if (m.c) sc[i] = 10 * VAL[m.c.toLowerCase()] - VAL[m.p.toLowerCase()] + 1000;
    if (m.pr) sc[i] += VAL[m.pr] + 800;
  }
  var idx = moves.map(function (_, k) { return k; });
  idx.sort(function (a, b2) { return sc[b2] - sc[a]; });
  return idx.map(function (k) { return moves[k]; });
}

function tick() {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
}

function qsearch(g, alpha, beta, ply) {
  tick();
  var stand = evaluate(g);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  var us = g.turn, them = us === 'w' ? 'b' : 'w';
  var ms = g._pseudo().filter(function (m) { return m.c || m.pr; });
  ms = order(g, ms, null);
  for (var i = 0; i < ms.length; i++) {
    g._make(ms[i]);
    if (g.attacked(g.kings[us], them)) { g._undo(); continue; }
    var sc = -qsearch(g, -beta, -alpha, ply + 1);
    g._undo();
    if (sc >= beta) return sc;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function search(g, depth, alpha, beta, ply) {
  tick();
  var us = g.turn, them = us === 'w' ? 'b' : 'w';
  var chk = g.attacked(g.kings[us], them);
  if (chk && ply < 12) depth++;
  if (depth <= 0) return qsearch(g, alpha, beta, ply);
  if (g.half >= 100) return 0;
  var ms = order(g, g._pseudo(), null), legal = 0, best = -INF, i, sc;
  for (i = 0; i < ms.length; i++) {
    g._make(ms[i]);
    if (g.attacked(g.kings[us], them)) { g._undo(); continue; }
    legal++;
    sc = -search(g, depth - 1, -beta, -alpha, ply + 1);
    g._undo();
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  if (!legal) return chk ? -MATE + ply : 0;
  return best;
}

function pub(m) {
  var o = { from: Chess.sqName(m.f), to: Chess.sqName(m.t) };
  if (m.pr) o.promo = m.pr;
  return o;
}

/* one root iteration; returns {move, score, all} or throws TIMEOUT */
function root(g, depth, prevBest, wantAll) {
  var us = g.turn, them = us === 'w' ? 'b' : 'w';
  var ms = order(g, g._pseudo(), prevBest), alpha = -INF, best = null, bestScore = -INF, all = [], i, sc, base = g.stack.length;
  try {
    for (i = 0; i < ms.length; i++) {
      g._make(ms[i]);
      if (g.attacked(g.kings[us], them)) { g._undo(); continue; }
      sc = -search(g, depth - 1, -INF, wantAll ? INF : -alpha, 1);
      g._undo();
      all.push({ m: ms[i], s: sc });
      if (sc > bestScore) { bestScore = sc; best = ms[i]; }
      if (sc > alpha) alpha = sc;
    }
  } catch (e) {
    while (g.stack.length > base) g._undo();
    throw e;
  }
  return { move: best, score: bestScore, all: all };
}

var LEVELS = {
  1: { depth: 1, noise: 220, ms: 300 },
  2: { depth: 2, noise: 90, ms: 500 },
  3: { depth: 3, noise: 25, ms: 1000 },
  4: { depth: 4, noise: 0, ms: 2000 },
  5: { depth: 7, noise: 0, ms: 4000 }
};

function think(req) {
  var g = new Chess(req.fen);
  var analyze = req.type === 'analyze';
  var cfg = analyze ? { depth: req.depth || 12, noise: 0, ms: req.ms || 2500 } : (LEVELS[req.level] || LEVELS[3]);
  nodes = 0;
  deadline = Date.now() + cfg.ms;
  var sign = g.turn === 'w' ? 1 : -1;
  var best = null, bestScore = 0, doneDepth = 0, d, r;
  // fallback: any legal move
  var legal = g._legal();
  if (!legal.length) return { move: null, score: 0, depth: 0 };
  best = legal[0];
  for (d = 1; d <= cfg.depth; d++) {
    try {
      r = root(g, d, best, cfg.noise > 0);
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
    if (cfg.noise > 0) {
      var pick = null, pickScore = -INF;
      r.all.forEach(function (x) {
        var s = x.s + (Math.random() * 2 - 1) * cfg.noise;
        if (s > pickScore) { pickScore = s; pick = x; }
      });
      best = pick.m; bestScore = pick.s;
    } else { best = r.move; bestScore = r.score; }
    doneDepth = d;
    if (analyze) postMessage({ id: req.id, type: 'info', depth: d, score: bestScore * sign, best: pub(best) });
    if (Math.abs(bestScore) > MATE - 200) break;
  }
  return { move: pub(best), score: bestScore * sign, depth: doneDepth };
}

/* ------------------------------------------------------------------ game review */
/** material balance from the side-to-move's point of view (no positional terms) */
function matStatic(g) {
  var b = g.board, s, p, v = 0;
  for (s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    p = b[s];
    if (!p) continue;
    var x = VAL[p.toLowerCase()];
    v += p < 'a' ? x : -x;
  }
  return g.turn === 'w' ? v : -v;
}
/** material-only capture search: what the material balance settles at after all captures */
function matQ(g, alpha, beta, depth) {
  var stand = matStatic(g);
  if (depth <= 0 || stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  var us = g.turn, them = us === 'w' ? 'b' : 'w';
  var ms = order(g, g._pseudo().filter(function (m) { return m.c; }), null);
  for (var i = 0; i < ms.length; i++) {
    g._make(ms[i]);
    if (g.attacked(g.kings[us], them)) { g._undo(); continue; }
    var sc = -matQ(g, -beta, -alpha, depth - 1);
    g._undo();
    if (sc >= beta) return sc;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}
function sameMove(m, p) { return m.f === Chess.sqIdx(p.from) && m.t === Chess.sqIdx(p.to) && (m.pr || null) === ((p.promo || '').toLowerCase() || null); }

/** Analyse one position of a game. `played` is the move that was actually made (or null). */
function reviewOne(fen, played, ms) {
  var g = new Chess(fen), legal = g._legal(), out = { legal: legal.length };
  if (!legal.length) { out.terminal = g.inCheck() ? 'mate' : 'draw'; return out; }
  var us = g.turn, matBefore = matStatic(g);
  // 1) normal alpha-beta search for the best move
  nodes = 0; deadline = Date.now() + ms * 0.6;
  var best = legal[0], bestScore = 0, D = 0, d, r;
  for (d = 1; d <= 9; d++) {
    try { r = root(g, d, best, false); } catch (e) { if (e !== TIMEOUT) throw e; break; }
    best = r.move; bestScore = r.score; D = d;
    if (Math.abs(bestScore) > MATE - 200) break;
  }
  out.depth = D; out.best = pub(best); out.bestScore = bestScore;
  if (legal.length === 1) { out.forced = true; out.playedScore = bestScore; }
  var pm = null, i;
  if (played) for (i = 0; i < legal.length; i++) if (sameMove(legal[i], played)) { pm = legal[i]; break; }
  if (pm) {
    var isBest = pm === best || (pm.f === best.f && pm.t === best.t && pm.pr === best.pr);
    // 2) score of the move that was played, searched to the same depth
    if (isBest) out.playedScore = bestScore;
    else if (legal.length > 1) {
      var depthTry = D, sc = null;
      while (sc === null && depthTry >= 1) {
        nodes = 0; deadline = Date.now() + ms * 0.4;
        try { g._make(pm); sc = -search(g, depthTry - 1, -INF, INF, 1); g._undo(); }
        catch (e) { if (e !== TIMEOUT) throw e; while (g.stack.length) g._undo(); depthTry--; }
      }
      out.playedScore = sc === null ? bestScore : sc;
    }
    // 3) was it an "only move"? every alternative is at least ~1.2 pawns worse
    if (isBest && legal.length > 1) {
      var thr = bestScore - 120, only = true;
      nodes = 0; deadline = Date.now() + ms * 0.3;
      try {
        for (i = 0; i < legal.length && only; i++) {
          if (legal[i] === pm || (legal[i].f === pm.f && legal[i].t === pm.t && legal[i].pr === pm.pr)) continue;
          g._make(legal[i]);
          var s2 = -search(g, Math.max(0, D - 1), -thr, -(thr - 1), 1);
          g._undo();
          if (s2 >= thr) only = false;
        }
      } catch (e) { if (e !== TIMEOUT) throw e; while (g.stack.length) g._undo(); only = false; }
      out.onlyMove = only;
    }
    // 4) did it give up material that the opponent can win back by captures?
    g._make(pm);
    out.sac = matBefore - (-matQ(g, -INF, INF, 8));
    g._undo();
  }
  return out;
}

onmessage = function (e) {
  var req = e.data;
  if (req.type === 'move' || req.type === 'analyze') {
    var res = think(req);
    res.id = req.id; res.type = 'done';
    postMessage(res);
  } else if (req.type === 'review') {
    for (var i = 0; i < req.items.length; i++) {
      var it = req.items[i];
      postMessage({ id: req.id, type: 'progress', i: i, n: req.items.length, item: reviewOne(it.fen, it.played, req.ms || 700) });
    }
    postMessage({ id: req.id, type: 'done' });
  }
};
