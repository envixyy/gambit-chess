/* Game review: turns raw engine numbers (from ai.js `review`) into move classes and accuracy.
 *
 * Per position the engine gives (all from the mover's point of view, centipawns):
 *   bestScore, playedScore, onlyMove (every alternative is clearly worse), sac (material given up
 *   after captures settle), forced (single legal move), terminal ('mate'|'draw').
 * Scores are mapped to win-probability so a 1-pawn slip in a dead-lost position matters less than
 * in an equal one, then:
 *   Brilliant  best/near-best move that sacrifices material and doesn't throw the position away
 *   Great      the only move that keeps the advantage / saves the game
 *   Best       matches the engine's top move
 *   Excellent / Good / Inaccuracy / Mistake / Blunder   by win-probability lost
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Review = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MATE = 100000;

  function wp(cp) {                       // win probability (0..100) for the side the score is from
    cp = Math.max(-1500, Math.min(1500, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }
  function accuracy(loss) {               // per-move accuracy, lichess-style curve
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  }

  var INFO = {
    brilliant: { sym: '!!', color: '#1baca6', ink: '#fff', label: 'Brilliant', notable: true },
    great: { sym: '!', color: '#5c8bb0', ink: '#fff', label: 'Great move', notable: true },
    best: { sym: '★', color: '#96bc4b', ink: '#fff', label: 'Best move' },
    excellent: { sym: '✓', color: '#7fa650', ink: '#fff', label: 'Excellent' },
    good: { sym: '✓', color: '#a3b98a', ink: '#1d2a10', label: 'Good' },
    book: { sym: '≡', color: '#a88865', ink: '#fff', label: 'Book move' },
    inaccuracy: { sym: '?!', color: '#f7c631', ink: '#3a2e00', label: 'Inaccuracy', notable: true },
    mistake: { sym: '?', color: '#e58f2a', ink: '#fff', label: 'Mistake', notable: true },
    blunder: { sym: '??', color: '#ca3431', ink: '#fff', label: 'Blunder', notable: true },
    forced: { sym: '→', color: '#7b8594', ink: '#fff', label: 'Forced' }
  };
  var ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];

  /**
   * opts.items   per-position engine results (length n+1; last one is the final position)
   * opts.turns   side to move at each position, 'w'|'b' (length n+1)
   * opts.book    optional function(i) -> true if move i (0-based) is still known opening theory
   */
  function analyze(opts) {
    var items = opts.items, turns = opts.turns, n = items.length - 1;
    var cls = [], loss = [], evals = [], i, it;
    var sums = { w: 0, b: 0 }, cnt = { w: 0, b: 0 };
    var counts = { w: {}, b: {} };
    ORDER.forEach(function (k) { counts.w[k] = 0; counts.b[k] = 0; });

    for (i = 0; i <= n; i++) {
      it = items[i];
      if (!it) evals.push(0);
      else if (it.terminal === 'mate') evals.push(turns[i] === 'w' ? -MATE : MATE);
      else if (it.terminal === 'draw') evals.push(0);
      else evals.push(it.bestScore * (turns[i] === 'w' ? 1 : -1));
    }

    for (i = 0; i < n; i++) {
      it = items[i];
      cls.push(null); loss.push(0);
      if (!it || it.terminal || it.playedScore == null) continue;
      var side = turns[i];
      var wb = wp(it.bestScore), wpl = wp(it.playedScore);
      var l = Math.max(0, wb - wpl), c;
      loss[i] = l;
      if (it.forced) c = 'forced';
      else {
        var sacrificed = (it.sac || 0) >= 170 && wpl >= 45 && wb < 92;
        if (l <= 0.5) {
          c = 'best';
          if (sacrificed) c = 'brilliant';
          else if (it.onlyMove && wb >= 25 && wb <= 97) c = 'great';
        } else if (l < 2) c = sacrificed ? 'brilliant' : 'excellent';
        else if (l < 5) c = 'good';
        else if (l < 10) c = 'inaccuracy';
        else if (l < 20) c = 'mistake';
        else c = 'blunder';
        if ((c === 'best' || c === 'excellent' || c === 'good') && opts.book && opts.book(i)) c = 'book';
      }
      cls[i] = c;
      counts[side][c === 'forced' ? 'best' : c]++;
      sums[side] += c === 'forced' ? 100 : accuracy(l);
      cnt[side]++;
    }
    return {
      cls: cls, loss: loss, evals: evals, counts: counts,
      acc: { w: cnt.w ? sums.w / cnt.w : null, b: cnt.b ? sums.b / cnt.b : null }
    };
  }

  return { wp: wp, accuracy: accuracy, analyze: analyze, INFO: INFO, ORDER: ORDER, MATE: MATE };
}));
