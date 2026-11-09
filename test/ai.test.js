// Runs public/ai.js outside a browser by faking the worker globals.
const fs = require('fs'), path = require('path'), vm = require('vm');
const Chess = require('../public/chess.js');
let out = [];
const sandbox = { Chess, importScripts() {}, postMessage: (m) => out.push(m), console, Math, Date };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/ai.js'), 'utf8') + '\n;this.onmessage=onmessage;', sandbox);
let fail = 0;
function ask(fen, level, type) {
  out = [];
  const t = Date.now();
  sandbox.onmessage({ data: { id: 1, type: type || 'move', fen, level, depth: 8, ms: 1500 } });
  return { res: out[out.length - 1], ms: Date.now() - t };
}
function check(label, cond) { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + label); }

let r = ask('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 4);
check('finds back-rank mate in 1 (Ra8#) -> ' + JSON.stringify(r.res.move), r.res.move.from === 'a1' && r.res.move.to === 'a8');


// free queen: black queen hangs to the rook
r = ask('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', 3);
check('wins hanging queen -> ' + JSON.stringify(r.res.move), r.res.move.from === 'd1' && r.res.move.to === 'd5');

r = ask(Chess.START_FEN, 5);
console.log('     level 5 from start: ' + JSON.stringify(r.res.move) + ' depth ' + r.res.depth + ' in ' + r.ms + 'ms');
check('level 5 respects time budget', r.ms < 6000);

r = ask('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 4);
console.log('     level 4 italian: ' + JSON.stringify(r.res.move) + ' depth ' + r.res.depth + ' in ' + r.ms + 'ms');

r = ask(Chess.START_FEN, 1);
check('level 1 returns a legal move', !!r.res.move);

// full self-play game sanity (level 2 vs level 2, 60 plies) to catch illegal moves / crashes
const g = new Chess();
let ok = true;
for (let i = 0; i < 60 && !g.status().over; i++) {
  const x = ask(g.fen(), 2).res;
  if (!x.move || !g.move(x.move)) { ok = false; console.log('bad move', x.move, g.fen()); break; }
}
check('60-ply self-play stays legal', ok);
process.exit(fail ? 1 : 0);
