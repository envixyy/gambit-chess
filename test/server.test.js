// End-to-end server test: two websocket players, a spectator, rating, takeback, draw, rematch, timeout.
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gambit-test-'));
const WebSocket = require('ws');
const { server } = require('../server.js');

let fail = 0;
const check = (label, cond) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + label); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, port) {
  const ws = new WebSocket('ws://localhost:' + port);
  const id = (n) => (name + '_' + n + '________').slice(0, 16);
  const c = { ws, name, pid: id('pid'), sid: id('sid'), state: null, msgs: [], last: {} };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    c.msgs.push(m); c.last[m.t] = m;
    if (m.t === 'state') c.state = m;
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.open = new Promise((r) => ws.on('open', () => { c.send({ t: 'hello', pid: c.pid, sid: c.sid, name }); r(); }));
  c.waitFor = async (fn, ms = 2000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { if (fn(c)) return true; await sleep(10); }
    return false;
  };
  return c;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const A = client('Alice', port), B = client('Bob', port), S = client('Spec', port);
  await Promise.all([A.open, B.open, S.open]);
  await A.waitFor((c) => c.last.welcome);
  check('welcome with rating 1200', A.last.welcome.rating === 1200);

  // --- game 1: scholar's mate, rated
  A.send({ t: 'create', tc: { base: 0, inc: 0 }, rated: true, public: true, color: 'w' });
  await A.waitFor((c) => c.last.created);
  const room = A.last.created.room;
  check('room code created', /^[a-z0-9]{6}$/.test(room));
  B.send({ t: 'join', room });
  await B.waitFor((c) => c.state && c.state.status === 'playing');
  check('second player seated as black', B.state.you === 'b' && A.state.you === 'w');
  S.send({ t: 'join', room });
  await S.waitFor((c) => c.state);
  check('spectator', S.state.you === 's');

  B.send({ t: 'move', mv: { from: 'e7', to: 'e5' } });
  await B.waitFor((c) => c.last.error);
  check('move out of turn rejected', B.last.error.msg === 'Not your turn');
  A.send({ t: 'move', mv: { from: 'e2', to: 'e5' } });
  await A.waitFor((c) => c.last.error && c.last.error.msg === 'Illegal move');
  check('illegal move rejected', A.last.error.msg === 'Illegal move');

  const seq = [[A, 'e2', 'e4'], [B, 'e7', 'e5'], [A, 'd1', 'h5'], [B, 'b8', 'c6'], [A, 'f1', 'c4'], [B, 'g8', 'f6'], [A, 'h5', 'f7']];
  for (const [p, f, t] of seq) { p.send({ t: 'move', mv: { from: f, to: t } }); await sleep(30); }
  await A.waitFor((c) => c.state.status === 'over');
  check('checkmate detected', A.state.result === '1-0' && A.state.reason === 'checkmate' && A.state.moves.at(-1).san === 'Qxf7#');
  check('spectator sees result', S.state.status === 'over');
  check('elo updated', A.state.delta && A.state.delta.w > 0 && A.state.delta.b < 0 && A.state.delta.w === -A.state.delta.b);

  // --- rematch swaps colours
  A.send({ t: 'rematch' }); B.send({ t: 'rematch' });
  await B.waitFor((c) => c.last.rematch);
  const room2 = B.last.rematch.room;
  A.send({ t: 'join', room: room2 }); B.send({ t: 'join', room: room2 });
  await A.waitFor((c) => c.state && c.state.id === room2);
  await B.waitFor((c) => c.state && c.state.id === room2);
  check('rematch swaps colours', A.state.you === 'b' && B.state.you === 'w' && A.state.status === 'playing');

  // --- takeback + draw + resign
  B.send({ t: 'move', mv: { from: 'd2', to: 'd4' } }); await sleep(30);
  B.send({ t: 'takeback', a: 'offer' });
  await A.waitFor((c) => c.state.takeback === 'w');
  A.send({ t: 'takeback', a: 'accept' });
  await A.waitFor((c) => c.state.moves.length === 0);
  check('takeback accepted', A.state.moves.length === 0 && A.state.turn === 'w');
  B.send({ t: 'draw', a: 'offer' });
  await A.waitFor((c) => c.state.drawOffer === 'w');
  A.send({ t: 'draw', a: 'accept' });
  await A.waitFor((c) => c.state.status === 'over');
  check('draw by agreement', A.state.result === '1/2-1/2' && A.state.reason === 'agreement');

  // --- game 3: abort then resign flow, timeout
  A.send({ t: 'create', tc: { base: 1, inc: 0 }, rated: false, public: false, color: 'b' });
  await A.waitFor((c) => c.last.created && c.last.created.room !== room);
  const room3 = A.last.created.room;
  B.send({ t: 'join', room: room3 });
  await B.waitFor((c) => c.state && c.state.id === room3 && c.state.status === 'playing');
  check('timed game, creator chose black', A.state.you === 'b' && B.state.you === 'w');
  B.send({ t: 'move', mv: { from: 'e2', to: 'e4' } }); await sleep(30);
  A.send({ t: 'move', mv: { from: 'e7', to: 'e5' } });
  await B.waitFor((c) => c.state.moves.length === 2);
  check('clock starts after both moved', B.state.running === true);
  await B.waitFor((c) => c.state.status === 'over', 3000);
  check('white flagged', B.state.result === '0-1' && B.state.reason === 'timeout');

  // --- resign
  A.send({ t: 'create', tc: { base: 0, inc: 0 }, rated: false, public: false, color: 'w' });
  await A.waitFor((c) => c.last.created && c.last.created.room !== room3 && c.last.created.room !== room);
  const room4 = A.last.created.room;
  B.send({ t: 'join', room: room4 });
  await B.waitFor((c) => c.state && c.state.id === room4 && c.state.status === 'playing');
  A.send({ t: 'move', mv: { from: 'e2', to: 'e4' } }); await sleep(30);
  B.send({ t: 'resign' });
  await A.waitFor((c) => c.state.status === 'over');
  check('resignation', A.state.result === '1-0' && A.state.reason === 'resignation');

  // --- chat
  A.send({ t: 'chat', text: 'gg <b>hi</b>' });
  await B.waitFor((c) => c.last.chat);
  check('chat relayed', B.last.chat.msg.text === 'gg <b>hi</b>' && B.last.chat.msg.from === 'Alice');

  // --- matchmaking queue
  const { players } = require('../server.js');
  const Q1 = client('Qa', port), Q2 = client('Qb', port), Q3 = client('Qc', port), Q4 = client('Qd', port);
  await Promise.all([Q1.open, Q2.open, Q3.open, Q4.open]);
  await Q4.waitFor((c) => c.last.welcome);
  players[Q4.pid].rating = 1900;                                   // far from everyone else
  Q1.send({ t: 'queue', tc: { base: 180, inc: 0 }, rated: true });
  Q3.send({ t: 'queue', tc: { base: 600, inc: 0 }, rated: true }); // different pool
  Q4.send({ t: 'queue', tc: { base: 180, inc: 0 }, rated: true }); // same pool, rating too far
  await Q1.waitFor((c) => c.last.queue && c.last.queue.searching);
  check('queue acknowledges searching', Q1.last.queue.searching === true);
  await sleep(1300);
  check('different pools / distant ratings are not matched', !Q1.last.matched && !Q3.last.matched && !Q4.last.matched);
  Q2.send({ t: 'queue', tc: { base: 180, inc: 0 }, rated: true });
  await Q1.waitFor((c) => c.last.matched);
  await Q2.waitFor((c) => c.last.matched);
  check('two close-rated players in the same pool are paired', Q1.last.matched.room === Q2.last.matched.room && !!Q1.last.matched.opponent.name);
  Q1.send({ t: 'join', room: Q1.last.matched.room }); Q2.send({ t: 'join', room: Q2.last.matched.room });
  await Q1.waitFor((c) => c.state && c.state.status === 'playing');
  await Q2.waitFor((c) => c.state && c.state.status === 'playing');
  check('matched players get opposite colours in a rated game', Q1.state.you !== Q2.state.you && Q1.state.rated && Q1.state.tc.base === 180000);
  Q3.send({ t: 'queue', a: 'leave' });
  await Q3.waitFor((c) => c.last.queue && c.last.queue.searching === false);
  check('leaving the queue works', Q3.last.queue.searching === false);
  Q1.send({ t: 'queue', tc: { base: 180, inc: 0 }, rated: true });
  await Q1.waitFor((c) => c.last.error);
  check('cannot queue during a live game', /current game/.test(Q1.last.error.msg));
  [Q1, Q2, Q3, Q4].forEach((c) => c.ws.close());

  // --- static files
  const body = await new Promise((resolve) => require('http').get('http://localhost:' + port + '/chess.js', (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => resolve({ code: res.statusCode, s }));
  }));
  check('serves static files', body.code === 200 && body.s.includes('Gambit chess engine'));
  const trav = await new Promise((resolve) => require('http').get({ host: 'localhost', port, path: '/..%2fpackage.json' }, (res) => { res.resume(); resolve(res.statusCode); }));
  check('path traversal blocked', trav === 403 || trav === 404);

  [A, B, S].forEach((c) => c.ws.close());
  server.close();
  if (fail) { console.log('\n' + fail + ' FAILED'); process.exit(1); }
  console.log('\nAll server tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
