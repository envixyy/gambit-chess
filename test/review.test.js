// Runs the review engine on known games and checks the move classifications.
const fs = require('fs'), path = require('path'), vm = require('vm');
const Chess = require('../public/chess.js');
const Review = require('../public/review.js');
let out = [];
const sandbox = { Chess, importScripts() {}, postMessage: (m) => out.push(m), console, Math, Date };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/ai.js'), 'utf8') + '\n;this.onmessage=onmessage;', sandbox);
let fail = 0;
const check = (label, cond) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + label); };

function review(sans, ms) {
  const g = new Chess(), items = [], turns = [];
  for (const s of sans) { const f = g.fen(); const r = g.move(s); items.push({ fen: f, played: { from: r.from, to: r.to, promo: r.promo } }); }
  items.push({ fen: g.fen(), played: null });
  out = [];
  const t = Date.now();
  sandbox.onmessage({ data: { id: 1, type: 'review', items, ms } });
  const res = out.filter((m) => m.type === 'progress').map((m) => m.item);
  const turnsArr = items.map((x) => x.fen.split(' ')[1]);
  const a = Review.analyze({ items: res, turns: turnsArr });
  return { a, res, ms: Date.now() - t };
}

// Legal's mate: 5.Nxe5!! sacrifices the queen and wins by force.
const legal = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];
let r = review(legal, 2500);
console.log('     legal:', legal.map((s, i) => s + ':' + r.a.cls[i]).join(' '), ' (' + r.ms + 'ms)');
check('Nxe5 (queen sacrifice) is Brilliant', r.a.cls[8] === 'brilliant');
check('mate position evaluates as a win for White', r.a.evals[legal.length] > 50000);
check('no Brilliant on ordinary opening moves', r.a.cls.slice(0, 8).every((c) => c !== 'brilliant'));

// Hanging the queen is a blunder: 1.e4 e5 2.Qh5 Nc6 3.Qxf7?? no - use 1.e4 e5 2.Qg4?? d5? (queen attacked) simple: 1.e4 e5 2.Qh5 Nf6?? 3.Qxe5+
const bl = ['e4', 'e5', 'Qh5', 'Nf6', 'Qxe5+'];
r = review(bl, 1200);
console.log('     blunder:', bl.map((s, i) => s + ':' + r.a.cls[i]).join(' '));
check('3...Nf6?? hanging e5 is not "best"', ['mistake', 'blunder', 'inaccuracy'].includes(r.a.cls[3]));

// Missing a free queen is a blunder, taking it is not.
const g = new Chess('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
const items = [{ fen: g.fen(), played: { from: 'e1', to: 'e2' } }, { fen: '4k3/8/8/3q4/8/8/4K3/3R4 b - - 1 1', played: null }];
out = [];
sandbox.onmessage({ data: { id: 1, type: 'review', items, ms: 800 } });
const res = out.filter((m) => m.type === 'progress').map((m) => m.item);
const a = Review.analyze({ items: res, turns: ['w', 'b'] });
check('ignoring a hanging queen (Ke2 instead of Rxd5) is a blunder -> ' + a.cls[0], a.cls[0] === 'blunder');

// accuracy sanity
check('accuracy curve: 0 loss = ~100, big loss is low', Review.accuracy(0) > 99 && Review.accuracy(40) < 25);
process.exit(fail ? 1 : 0);
