'use strict';
/* Gambit chess server: static files + WebSocket game rooms.
 * The server is authoritative: it validates every move, runs the clocks,
 * handles draw/takeback/rematch flow and keeps Elo ratings.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Chess = require('./public/chess.js');

const PORT = +process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

/* ---------------------------------------------------------- persistence */
function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch (e) { return def; }
}
const players = loadJSON('players.json', {});   // pid -> {name, rating, games, wins, losses, draws}
const gamesLog = loadJSON('games.json', []);    // finished games, newest last
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    for (const [file, obj] of [['players.json', players], ['games.json', gamesLog.slice(-300)]]) {
      const tmp = path.join(DATA, file + '.tmp');
      fs.writeFile(tmp, JSON.stringify(obj), (err) => {
        if (!err) fs.rename(tmp, path.join(DATA, file), () => {});
      });
    }
  }, 1000);
}

/* ------------------------------------------------------------ http */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (url === '/' || /^\/g\/[A-Za-z0-9]{3,12}$/.test(url)) url = '/index.html';
  const file = path.join(PUBLIC, url);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

/* ------------------------------------------------------------ state */
const rooms = new Map();     // id -> room
const clients = new Set();

const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function newCode() {
  for (;;) {
    let s = '';
    const b = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) s += CODE_CHARS[b[i] % CODE_CHARS.length];
    if (!rooms.has(s)) return s;
  }
}
const other = (c) => (c === 'w' ? 'b' : 'w');
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

/* ------------------------------------------------------------ admin
 * Names are not accounts, so being called "kawaiigirl34" proves nothing. Admin rights come from a
 * secret key (env ADMIN_KEY); the admin names are also *reserved*, so nobody without the key can
 * use them. No ADMIN_KEY set = no admin at all.
 */
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ADMIN_NAMES = (process.env.ADMIN_NAMES || 'kawaiigirl34').split(',').map(normName).filter(Boolean);
const isReservedName = (n) => ADMIN_NAMES.includes(normName(n));
function keyOk(k) {
  if (!ADMIN_KEY || typeof k !== 'string' || k.length !== ADMIN_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
}
const adminPids = new Set();          // pids that have authenticated since the server started
let announcement = null;              // {text, from, ts} shown to everyone

function getPlayer(pid, name) {
  let p = players[pid];
  if (!p) p = players[pid] = { name: name || 'Guest', rating: 1200, games: 0, wins: 0, losses: 0, draws: 0 };
  if (name) p.name = name;
  p.seen = Date.now();
  return p;
}

function send(c, msg) {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

/* ------------------------------------------------------------ rooms */
function makeRoom(opts) {
  const room = {
    id: newCode(),
    tc: opts.tc,                       // {base, inc} ms ; base 0 = untimed
    rated: !!opts.rated,
    public: !!opts.public,
    players: { w: null, b: null },     // {pid, sid, name, rating, discAt}
    sockets: new Set(),
    chess: new Chess(),
    clocks: { w: opts.tc.base, b: opts.tc.base },
    clockHist: [{ w: opts.tc.base, b: opts.tc.base }],
    lastTick: 0,
    running: false,
    timer: null,
    status: 'waiting',
    result: null, reason: null,
    drawOffer: null, takeback: null,
    rematch: { w: false, b: false },
    chat: [],
    delta: null,
    created: Date.now(), updated: Date.now(),
  };
  rooms.set(room.id, room);
  return room;
}

function seatPlayer(room, color, c) {
  const p = getPlayer(c.pid, c.name);
  room.players[color] = { pid: c.pid, sid: c.sid, name: p.name, rating: Math.round(p.rating), discAt: 0 };
  c.seat = color;
}

function connected(room, color) {
  for (const c of room.sockets) if (c.seat === color && c.ws.readyState === 1) return true;
  return false;
}

function liveClocks(room) {
  const c = { w: room.clocks.w, b: room.clocks.b };
  if (room.running) {
    const t = room.chess.turn;
    c[t] = Math.max(0, c[t] - (Date.now() - room.lastTick));
  }
  return c;
}

function pubPlayer(room, color) {
  const p = room.players[color];
  if (!p) return null;
  return { name: p.name, rating: p.rating, admin: adminPids.has(p.pid), connected: connected(room, color), discAt: connected(room, color) ? 0 : p.discAt };
}

function stateFor(room, c) {
  return {
    t: 'state',
    id: room.id, status: room.status, result: room.result, reason: room.reason,
    tc: room.tc, rated: room.rated, public: room.public,
    turn: room.chess.turn, fen: room.chess.fen(),
    moves: room.chess.history().map((m) => ({ san: m.san, from: m.from, to: m.to, promo: m.promo || null })),
    players: { w: pubPlayer(room, 'w'), b: pubPlayer(room, 'b') },
    you: c.seat || 's',
    clocks: liveClocks(room), running: room.running,
    drawOffer: room.drawOffer, takeback: room.takeback, rematch: room.rematch,
    spectators: [...room.sockets].filter((s) => !s.seat).length,
    delta: room.delta,
  };
}

function broadcast(room) {
  room.updated = Date.now();
  for (const c of room.sockets) send(c, stateFor(room, c));
  lobbySoon();
}

function attach(room, c) {
  if (c.room && c.room !== room) detach(c);
  c.room = room;
  room.sockets.add(c);
}

function detach(c) {
  const room = c.room;
  if (!room) return;
  room.sockets.delete(c);
  const seat = c.seat;
  c.room = null; c.seat = null;
  if (seat && room.players[seat] && !connected(room, seat)) room.players[seat].discAt = Date.now();
  broadcast(room);
}

/* ------------------------------------------------------------ clocks & results */
function armTimer(room) {
  clearTimeout(room.timer);
  if (!room.running) return;
  const t = room.chess.turn;
  const ms = Math.max(0, room.clocks[t] - (Date.now() - room.lastTick));
  room.timer = setTimeout(() => flag(room, t), ms + 40);
}

function flag(room, color) {
  if (room.status !== 'playing' || !room.running || room.chess.turn !== color) return;
  const rem = room.clocks[color] - (Date.now() - room.lastTick);
  if (rem > 60) return armTimer(room);
  room.clocks[color] = 0;
  const winner = other(color);
  if (!room.chess.canMate(winner)) end(room, '1/2-1/2', 'timeout vs insufficient material');
  else end(room, winner === 'w' ? '1-0' : '0-1', 'timeout');
}

function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }

function end(room, result, reason) {
  if (room.status === 'over') return;
  room.clocks = liveClocks(room);
  room.status = 'over';
  room.result = result; room.reason = reason;
  room.running = false;
  clearTimeout(room.timer);
  room.drawOffer = null; room.takeback = null;

  const W = room.players.w, B = room.players.b;
  const nMoves = room.chess.history().length;
  if (result !== '*' && W && B) {
    const pw = getPlayer(W.pid), pb = getPlayer(B.pid);
    const sw = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
    if (room.rated && W.pid !== B.pid && nMoves >= 2) {
      const kw = pw.games < 10 ? 40 : 24, kb = pb.games < 10 ? 40 : 24;
      const dw = Math.round(kw * (sw - expected(pw.rating, pb.rating)));
      const db = Math.round(kb * ((1 - sw) - expected(pb.rating, pw.rating)));
      pw.rating += dw; pb.rating += db;
      pw.games++; pb.games++;
      if (sw === 1) { pw.wins++; pb.losses++; } else if (sw === 0) { pw.losses++; pb.wins++; } else { pw.draws++; pb.draws++; }
      room.delta = { w: dw, b: db, wr: Math.round(pw.rating), br: Math.round(pb.rating) };
      W.rating = Math.round(pw.rating); B.rating = Math.round(pb.rating);
    }
  }
  if (W && B && nMoves >= 1 && result !== '*') {
    gamesLog.push({
      id: room.id, date: Date.now(), white: W.name, black: B.name,
      wr: W.rating - (room.delta ? room.delta.w : 0), br: B.rating - (room.delta ? room.delta.b : 0),
      result, reason, rated: room.rated && !!room.delta, tc: room.tc,
      moves: room.chess.history().map((m) => m.san),
    });
    if (gamesLog.length > 400) gamesLog.splice(0, gamesLog.length - 300);
  }
  saveSoon();
  broadcast(room);
}

function applyMove(room, color, mv) {
  const now = Date.now();
  let rem = room.clocks[color];
  if (room.running) {
    rem -= now - room.lastTick;
    if (rem <= 0) { room.clocks[color] = 0; return flag(room, color), 'timeout'; }
  }
  const rec = room.chess.move(mv);
  if (!rec) return null;
  if (room.running) rem += room.tc.inc;
  room.clocks[color] = rem;
  room.clockHist[room.chess.history().length] = { w: room.clocks.w, b: room.clocks.b };
  room.clockHist.length = room.chess.history().length + 1;
  room.lastTick = now;
  room.running = room.tc.base > 0 && room.chess.history().length >= 2;
  room.drawOffer = null; room.takeback = null;
  const st = room.chess.status();
  if (st.over) end(room, st.result, st.reason);
  else { armTimer(room); broadcast(room); }
  return rec;
}

/* ------------------------------------------------------------ lobby */
let lobbyTimer = null;
function lobbySoon() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => { lobbyTimer = null; sendLobby(); }, 250);
}

function lobbyData() {
  const open = [], live = [];
  for (const r of rooms.values()) {
    if (!r.public) continue;
    if (r.status === 'waiting') {
      const color = r.players.w ? 'w' : 'b', p = r.players[color];
      if (p) open.push({ id: r.id, name: p.name, rating: p.rating, color, tc: r.tc, rated: r.rated, online: connected(r, color) });
    } else if (r.status === 'playing') {
      live.push({ id: r.id, white: r.players.w.name, black: r.players.b.name, wr: r.players.w.rating, br: r.players.b.rating, moves: r.chess.history().length, tc: r.tc });
    }
  }
  const top = Object.entries(players).filter(([, p]) => p.games > 0)
    .sort((a, b) => b[1].rating - a[1].rating).slice(0, 10)
    .map(([pid, p]) => ({ name: p.name, rating: Math.round(p.rating), games: p.games, wins: p.wins, losses: p.losses, draws: p.draws, admin: adminPids.has(pid) }));
  const recent = gamesLog.slice(-8).reverse().map((g) => ({
    id: g.id, date: g.date, white: g.white, black: g.black, result: g.result, reason: g.reason, n: g.moves.length, rated: g.rated,
  }));
  return { t: 'lobby', open: open.filter((o) => o.online).slice(0, 20), live: live.slice(0, 12), top, recent, online: clients.size, queued: queue.length };
}

/* ------------------------------------------------------------ matchmaking queue */
// Players pick a time control and wait; we pair two players in the same pool
// (time control + rated flag) whose ratings are within a window that widens the longer they wait.
const queue = [];   // {c, tc, rated, since}
const qKey = (e) => e.tc.base + ',' + e.tc.inc + ',' + e.rated;
function dequeue(c) {
  const i = queue.findIndex((e) => e.c === c);
  if (i >= 0) { queue.splice(i, 1); return true; }
  return false;
}
function pairUp(a, b) {
  const room = makeRoom({ tc: a.tc, rated: a.rated, public: false });
  const wFirst = Math.random() < 0.5;
  const [cw, cb] = wFirst ? [a.c, b.c] : [b.c, a.c];
  for (const [col, c] of [['w', cw], ['b', cb]]) {
    const p = getPlayer(c.pid, c.name);
    room.players[col] = { pid: c.pid, sid: c.sid, name: p.name, rating: Math.round(p.rating), discAt: Date.now() };
  }
  room.status = 'playing';
  for (const e of [a, b]) {
    const opp = e === a ? b : a;
    send(e.c, { t: 'matched', room: room.id, opponent: { name: players[opp.c.pid].name, rating: Math.round(players[opp.c.pid].rating) } });
  }
  lobbySoon();
}
function runQueue() {
  const now = Date.now();
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (a.c.ws.readyState !== 1) { queue.splice(i--, 1); continue; }
    for (let j = i + 1; j < queue.length; j++) {
      const b = queue[j];
      if (qKey(a) !== qKey(b) || a.c.pid === b.c.pid) continue;
      const wait = Math.max(now - a.since, now - b.since) / 1000;
      const window = 100 + wait * 25;                       // ±100 at first, +25 per second
      if (Math.abs(players[a.c.pid].rating - players[b.c.pid].rating) <= window) {
        queue.splice(j, 1); queue.splice(i, 1); i--;
        pairUp(a, b);
        break;
      }
    }
  }
  for (const e of queue) send(e.c, { t: 'queue', searching: true, n: queue.length, since: e.since });
}
setInterval(runQueue, 1000);

function sendLobby(only) {
  const data = lobbyData();
  for (const c of only ? [only] : clients) if (!c.room && c.pid) send(c, data);
}

/* ------------------------------------------------------------ message handling */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function parseTc(tc) {
  const base = Math.max(0, Math.min(3 * 3600, Math.round(+(tc && tc.base) || 0))) * 1000;
  let inc = Math.max(0, Math.min(60, Math.round(+(tc && tc.inc) || 0))) * 1000;
  if (!base) inc = 0;
  return { base, inc };
}

function me(c) {
  const p = players[c.pid] || {};
  return { t: 'welcome', pid: c.pid, name: p.name, rating: Math.round(p.rating || 1200), games: p.games || 0, admin: !!c.admin, adminEnabled: !!ADMIN_KEY };
}
const guestName = () => 'Guest' + Math.floor(1000 + Math.random() * 9000);

/** undo `plies` half-moves and restore the clocks from that moment */
function rewind(room, plies) {
  for (let i = 0; i < plies; i++) room.chess.undo();
  const left = room.chess.history().length;
  const snap = room.clockHist[left] || room.clockHist[0];
  room.clocks = { w: snap.w, b: snap.b };
  room.clockHist.length = left + 1;
  room.lastTick = Date.now();
  room.running = room.tc.base > 0 && left >= 2;
}

/** Admin "cheats" are never secret: the game becomes unrated and the table is told. */
function cheatNotice(room, c, text) {
  room.rated = false;
  const msg = { from: c.name, seat: 'a', text: '👑 used an admin power: ' + text + ' (game is now unrated)', ts: Date.now() };
  room.chat.push(msg);
  for (const s of room.sockets) send(s, { t: 'chat', msg });
}

function handleAdmin(c, m) {
  if (!c.admin) return send(c, { t: 'error', msg: 'Admins only' });
  const room = c.room, playing = room && c.seat && room.status === 'playing';
  switch (m.a) {
    case 'hint':
      if (!playing) return;
      cheatNotice(room, c, 'engine hint'); broadcast(room);
      return send(c, { t: 'admin', a: 'hint_ok' });
    case 'undo': {
      const n = playing ? room.chess.history().length : 0;
      if (!n) return;
      rewind(room, Math.min(room.chess.turn === c.seat ? 2 : 1, n));
      room.takeback = null; room.drawOffer = null;
      armTimer(room); cheatNotice(room, c, 'undo'); broadcast(room);
      return;
    }
    case 'addtime': {
      if (!playing || !room.tc.base) return;
      const now = Date.now();
      if (room.running) { const t = room.chess.turn; room.clocks[t] = Math.max(0, room.clocks[t] - (now - room.lastTick)); room.lastTick = now; }
      room.clocks[c.seat] += 60000;
      armTimer(room); cheatNotice(room, c, '+60 seconds'); broadcast(room);
      return;
    }
    case 'rooms':
      return send(c, {
        t: 'admin', a: 'rooms',
        rooms: [...rooms.values()].map((r) => ({
          id: r.id, status: r.status, rated: r.rated, tc: r.tc, moves: r.chess.history().length,
          white: r.players.w && r.players.w.name, black: r.players.b && r.players.b.name,
          watching: [...r.sockets].filter((s) => !s.seat).length,
        })).slice(0, 60),
      });
    case 'endroom': {
      const r = rooms.get(String(m.id || ''));
      if (!r) return;
      if (r.status === 'playing') end(r, '*', 'ended by admin');
      else if (r.status === 'waiting') {
        for (const s of r.sockets) { s.room = null; s.seat = null; send(s, { t: 'gone', room: r.id, cancelled: true }); }
        rooms.delete(r.id); lobbySoon();
      }
      return handleAdmin(c, { a: 'rooms' });
    }
    case 'players':
      return send(c, {
        t: 'admin', a: 'players',
        players: Object.entries(players).sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0)).slice(0, 100)
          .map(([pid, p]) => ({ pid, name: p.name, rating: Math.round(p.rating), games: p.games, admin: adminPids.has(pid) })),
      });
    case 'setrating': {
      const p = players[String(m.pid || '')];
      const r = Math.round(+m.rating);
      if (!p || !(r >= 100 && r <= 3500)) return send(c, { t: 'error', msg: 'Rating must be 100–3500' });
      p.rating = r; saveSoon(); lobbySoon();
      for (const s of clients) if (s.pid === String(m.pid)) send(s, me(s));      // update their profile right away
      return handleAdmin(c, { a: 'players' });
    }
    case 'resetboard':
      for (const p of Object.values(players)) { p.rating = 1200; p.games = p.wins = p.losses = p.draws = 0; }
      gamesLog.length = 0; saveSoon(); lobbySoon();
      return send(c, { t: 'notice', msg: 'Leaderboard and history reset' });
    case 'announce': {
      const text = String(m.text || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200);
      announcement = text ? { text, from: c.name, ts: Date.now() } : null;
      for (const s of clients) send(s, { t: 'announce', a: announcement });
      return;
    }
  }
}

function handle(c, m) {
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'ping': return send(c, { t: 'pong' });

    case 'hello': {
      if (!ID_RE.test(m.pid || '') || !ID_RE.test(m.sid || '')) return send(c, { t: 'error', msg: 'Bad identity' });
      c.pid = m.pid; c.sid = m.sid;
      c.admin = keyOk(m.akey);
      if (c.admin) adminPids.add(c.pid);
      let nm = cleanName(m.name) || (players[c.pid] && players[c.pid].name) || guestName();
      const reserved = isReservedName(nm) && !c.admin;
      if (reserved) nm = guestName();
      c.name = nm;
      getPlayer(c.pid, c.name);
      saveSoon();
      send(c, me(c));
      if (reserved) send(c, { t: 'error', msg: 'That name is reserved. You were given a guest name.' });
      if (announcement) send(c, { t: 'announce', a: announcement });
      if (!c.room) sendLobby(c);
      return;
    }
    case 'admin_login': {
      if (!c.pid) return;
      c.adminTries = (c.adminTries || 0) + 1;
      if (c.adminTries > 6) return send(c, { t: 'error', msg: 'Too many attempts. Reload and try again later.' });
      if (!keyOk(m.key)) return send(c, { t: 'adminfail', msg: ADMIN_KEY ? 'Wrong admin key' : 'Admin is not enabled on this server' });
      c.admin = true; adminPids.add(c.pid);
      send(c, me(c));
      send(c, { t: 'notice', msg: '👑 Admin unlocked' });
      if (c.room && c.seat) broadcast(c.room);
      return;
    }
    case 'admin_logout':
      c.admin = false; adminPids.delete(c.pid);
      send(c, me(c));
      if (c.room && c.seat) broadcast(c.room);
      return;
    case 'admin': return handleAdmin(c, m);
    case 'rename': {
      if (!c.pid) return;
      let n = cleanName(m.name);
      if (!n) return;
      if (isReservedName(n) && !c.admin) { send(c, { t: 'error', msg: 'That name is reserved.' }); return send(c, me(c)); }
      c.name = n; getPlayer(c.pid, n); saveSoon();
      if (c.room && c.seat) { c.room.players[c.seat].name = n; broadcast(c.room); }
      send(c, me(c));
      return;
    }
    case 'lobby': return c.pid && (detach(c), sendLobby(c));

    case 'queue': {
      if (!c.pid) return;
      if (m.a === 'leave') { dequeue(c); send(c, { t: 'queue', searching: false }); return lobbySoon(); }
      if (c.room && c.seat && c.room.status === 'playing') return send(c, { t: 'error', msg: 'Finish your current game first.' });
      detach(c);
      dequeue(c);
      queue.push({ c, tc: parseTc(m.tc), rated: m.rated !== false, since: Date.now() });
      send(c, { t: 'queue', searching: true, n: queue.length, since: queue[queue.length - 1].since });
      lobbySoon();
      return runQueue();
    }

    case 'create': {
      if (!c.pid) return;
      dequeue(c);
      if ([...rooms.values()].filter((r) => r.status === 'waiting' && r.players.w && r.players.w.pid === c.pid || r.status === 'waiting' && r.players.b && r.players.b.pid === c.pid).length >= 5)
        return send(c, { t: 'error', msg: 'You already have several open games waiting.' });
      detach(c);
      const room = makeRoom({ tc: parseTc(m.tc), rated: m.rated !== false, public: !!m.public });
      let color = m.color === 'w' || m.color === 'b' ? m.color : (Math.random() < 0.5 ? 'w' : 'b');
      seatPlayer(room, color, c);
      attach(room, c);
      send(c, { t: 'created', room: room.id });
      broadcast(room);
      return;
    }

    case 'join': {
      if (!c.pid) return;
      const room = rooms.get(String(m.room || '').toLowerCase());
      if (!room) return send(c, { t: 'gone', room: m.room });
      dequeue(c);
      if (c.room === room) return send(c, stateFor(room, c));
      detach(c);
      let seat = null;
      for (const col of ['w', 'b']) if (room.players[col] && room.players[col].sid === c.sid) seat = col;
      if (!seat) {
        // same person returning from a different tab/device after disconnecting
        for (const col of ['w', 'b']) {
          const p = room.players[col];
          if (p && p.pid === c.pid && !connected(room, col) && (!room.players[other(col)] || room.players[other(col)].pid !== c.pid)) seat = col;
        }
        if (seat) room.players[seat].sid = c.sid;
      }
      if (!seat) {
        const free = !room.players.w ? 'w' : !room.players.b ? 'b' : null;
        if (free && room.status === 'waiting') {
          seatPlayer(room, free, c); seat = free;
          const o = room.players[other(free)];
          if (o && o.pid === c.pid) room.rated = false;     // playing yourself is never rated
          room.status = 'playing';
        }
      }
      if (seat) { c.seat = seat; room.players[seat].discAt = 0; room.players[seat].name = c.name; }
      attach(room, c);
      send(c, { t: 'chatlog', msgs: room.chat });
      broadcast(room);
      return;
    }

    case 'leave': return detach(c);

    case 'move': {
      const room = c.room;
      if (!room || !c.seat || room.status !== 'playing') return;
      if (room.chess.turn !== c.seat) return send(c, { t: 'error', msg: 'Not your turn' });
      const mv = m.mv || {};
      const rec = applyMove(room, c.seat, { from: String(mv.from), to: String(mv.to), promo: mv.promo ? String(mv.promo) : undefined });
      if (rec === null) { send(c, { t: 'error', msg: 'Illegal move' }); send(c, stateFor(room, c)); }
      return;
    }

    case 'resign': {
      const room = c.room;
      if (!room || !c.seat || room.status !== 'playing') return;
      return end(room, c.seat === 'w' ? '0-1' : '1-0', 'resignation');
    }

    case 'abort': {
      const room = c.room;
      if (!room || !c.seat) return;
      if (room.status === 'waiting') {
        for (const s of room.sockets) { s.room = null; s.seat = null; send(s, { t: 'gone', room: room.id, cancelled: true }); }
        rooms.delete(room.id); lobbySoon();
        return;
      }
      if (room.status === 'playing' && room.chess.history().length < 2) return end(room, '*', 'aborted');
      return;
    }

    case 'draw': {                       // offer | accept | decline
      const room = c.room;
      if (!room || !c.seat || room.status !== 'playing') return;
      if (m.a === 'offer') {
        if (room.drawOffer === c.seat) return;
        if (room.drawOffer === other(c.seat)) return end(room, '1/2-1/2', 'agreement');
        room.drawOffer = c.seat; return broadcast(room);
      }
      if (m.a === 'accept' && room.drawOffer === other(c.seat)) return end(room, '1/2-1/2', 'agreement');
      if ((m.a === 'decline' || m.a === 'cancel') && room.drawOffer) { room.drawOffer = null; return broadcast(room); }
      return;
    }

    case 'takeback': {
      const room = c.room;
      if (!room || !c.seat || room.status !== 'playing') return;
      const n = room.chess.history().length;
      if (m.a === 'offer') {
        if (n < 1) return;
        room.takeback = c.seat; return broadcast(room);
      }
      if (m.a === 'accept' && room.takeback && room.takeback === other(c.seat)) {
        const req = room.takeback;
        // undo the requester's last move (and the reply, if the opponent already answered)
        rewind(room, Math.min(room.chess.turn === req ? 2 : 1, n));
        room.takeback = null; room.drawOffer = null;
        armTimer(room);
        return broadcast(room);
      }
      if ((m.a === 'decline' || m.a === 'cancel') && room.takeback) { room.takeback = null; return broadcast(room); }
      return;
    }

    case 'claim': {                      // opponent abandoned the game
      const room = c.room;
      if (!room || !c.seat || room.status !== 'playing') return;
      const o = room.players[other(c.seat)];
      if (o && !connected(room, other(c.seat)) && Date.now() - o.discAt > 55000)
        return end(room, c.seat === 'w' ? '1-0' : '0-1', 'abandonment');
      return;
    }

    case 'rematch': {
      const room = c.room;
      if (!room || !c.seat || room.status !== 'over') return;
      room.rematch[c.seat] = true;
      if (room.rematch.w && room.rematch.b) {
        const nr = makeRoom({ tc: room.tc, rated: room.rated, public: false });
        for (const col of ['w', 'b']) {
          const p = room.players[other(col)];          // swap colours
          nr.players[col] = { pid: p.pid, sid: p.sid, name: p.name, rating: Math.round((players[p.pid] || {}).rating || p.rating), discAt: Date.now() };
        }
        nr.status = 'playing';
        for (const s of room.sockets) if (s.seat) send(s, { t: 'rematch', room: nr.id });
        for (const s of room.sockets) if (!s.seat) send(s, { t: 'notice', msg: 'Players started a rematch.' });
        lobbySoon();
        return;
      }
      return broadcast(room);
    }

    case 'chat': {
      const room = c.room;
      if (!room) return;
      const now = Date.now();
      if (now - (c.lastChat || 0) < 400) return;
      c.lastChat = now;
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
      if (!text) return;
      const msg = { from: c.name, seat: c.seat || 's', text, ts: now };
      room.chat.push(msg);
      if (room.chat.length > 80) room.chat.shift();
      for (const s of room.sockets) send(s, { t: 'chat', msg });
      return;
    }

    case 'getgame': {
      const g = gamesLog.find((x) => x.id === m.id);
      if (!g) return send(c, { t: 'error', msg: 'Game not found' });
      return send(c, { t: 'game', game: g });
    }
  }
}

/* ------------------------------------------------------------ websocket plumbing */
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  const c = { ws, pid: null, sid: null, name: 'Guest', room: null, seat: null, alive: true, lastChat: 0 };
  clients.add(c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    try { handle(c, m); } catch (e) { console.error('handler error', e); send(c, { t: 'error', msg: 'Server error' }); }
  });
  ws.on('close', () => { clients.delete(c); dequeue(c); detach(c); lobbySoon(); });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch (e) { /* ignore */ }
  }
}, 25000);

// housekeeping: drop abandoned rooms
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const idle = now - r.updated;
    if (r.sockets.size === 0 && ((r.status === 'waiting' && idle > 10 * 60e3) || (r.status === 'over' && idle > 30 * 60e3) || idle > 3 * 3600e3)) {
      clearTimeout(r.timer); rooms.delete(r.id);
    } else if (r.status === 'waiting' && idle > 60 * 60e3) {
      clearTimeout(r.timer); rooms.delete(r.id);
    }
  }
  lobbySoon();
}, 60000);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Gambit chess is running\n');
    console.log('  This computer:  http://localhost:' + PORT);
    for (const list of Object.values(os.networkInterfaces()))
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log('  Same Wi-Fi/LAN: http://' + i.address + ':' + PORT);
    console.log('\n  To play with friends over the internet see README.md\n');
  });
}

module.exports = { server, rooms, players, adminPids };
