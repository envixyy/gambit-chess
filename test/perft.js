// Move-generation correctness: perft node counts from the Chess Programming Wiki.
const Chess = require('../public/chess.js');
let fail = 0;

function perft(name, fen, depth, expected) {
  const g = new Chess(fen);
  const t = Date.now();
  const n = g.perft(depth);
  const ok = n === expected;
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ' d' + depth + ' = ' + n + (ok ? '' : ' (expected ' + expected + ')') + '  ' + (Date.now() - t) + 'ms');
}

perft('start', Chess.START_FEN, 4, 197281);
perft('kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862);
perft('pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238);
perft('pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467);
perft('pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379);
perft('pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 3, 89890);

// rules checks
(function rules() {
  const check = (label, cond) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + label); };
  let g = new Chess();
  ['f3', 'e5', 'g4', 'Qh4#'].forEach((m) => g.move(m));
  let st = g.status();
  check('fools mate', st.over && st.reason === 'checkmate' && st.result === '0-1');

  g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  st = g.status();
  check('stalemate', st.over && st.reason === 'stalemate');

  g = new Chess('4k3/8/8/8/8/8/8/4K2B w - - 0 1');
  check('insufficient (K+B v K)', g.status().reason === 'insufficient material');

  g = new Chess();
  ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'].forEach((m) => g.move(m));
  check('threefold repetition', g.status().reason === 'threefold repetition');

  g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  check('castle SAN O-O-O', !!g.move('O-O-O') && g.get('c1') === 'K' && g.get('d1') === 'R');
  g.undo();
  check('undo restores fen', g.fen() === 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');

  g = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const ep = g.move('exf6');
  check('en passant', ep && ep.flags.indexOf('e') >= 0 && g.get('f5') === null && g.get('f6') === 'P');

  g = new Chess('8/P7/8/8/8/8/k6K/8 w - - 0 1');
  const pr = g.move({ from: 'a7', to: 'a8', promo: 'n' });
  check('under-promotion', pr && pr.san === 'a8=N' && g.get('a8') === 'N');

  g = new Chess('4k3/8/8/8/8/8/8/R6R w - - 0 1');
  const rn = g.moves().filter((m) => m.san === 'Rad1' || m.san === 'Rhd1' || m.san === 'Rd1');
  check('SAN disambiguation (' + rn.map((m) => m.san).join(',') + ')', rn.length === 2 && rn.every((m) => m.san !== 'Rd1'));

  g = new Chess();
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].forEach((m) => g.move(m));
  check('pgn output', /1\. e4 e5 2\. Nf3 Nc6 3\. Bb5 a6/.test(g.pgn({ White: 'A', Black: 'B' })));
})();

if (fail) { console.log('\n' + fail + ' FAILED'); process.exit(1); }
console.log('\nAll engine tests passed');
