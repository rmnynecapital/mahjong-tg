// Mahjong Mini App server: static files, Telegram auth, rooms, live updates (SSE). Zero dependencies.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MJ = require('../docs/engine.js');
const telegram = require('./telegram.js');

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV = !BOT_TOKEN || process.env.DEV === '1'; // allows browser testing without Telegram
const PUBLIC_DIR = path.join(__dirname, '..', 'docs');
const QUICK_MATCH_WAIT = 20000;
const TIMEOUTS = { turn: 25000, claim: 10000, handOver: 30000 };
const BOT_NAMES = ['Mei', 'Hao', 'Lin', 'Jun', 'Yue', 'Bao'];

// ---------- auth ----------

function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > 86400) return null;
  try {
    const u = JSON.parse(params.get('user'));
    return { id: 'tg' + u.id, name: (u.first_name || u.username || 'Player').slice(0, 24) };
  } catch { return null; }
}

function getUser(initData, devUser) {
  const u = verifyInitData(initData);
  if (u) return u;
  if (DEV && devUser) {
    const [id, name] = String(devUser).split('|');
    if (id) return { id: 'dev' + id.slice(0, 32), name: (name || 'Guest').slice(0, 24) };
  }
  return null;
}

// ---------- rooms ----------

const rooms = new Map();     // code -> Room
const userRoom = new Map();  // userId -> code

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}

class Room {
  constructor({ isPublic, host, level, rounds }) {
    this.code = newCode();
    this.isPublic = isPublic;
    this.hostId = host.id;
    this.level = level === 'easy' ? 'easy' : 'normal';
    this.rounds = rounds === 8 ? 8 : 4;
    this.seats = [null, null, null, null]; // {id, name}
    this.clients = new Map(); // userId -> Set(res)
    this.table = null;
    this.startsAt = null;
    this.touched = Date.now();
    rooms.set(this.code, this);
  }

  humans() { return this.seats.filter((s) => s && !s.bot); }
  seatOf(id) { return this.seats.findIndex((s) => s && s.id === id); }

  join(user) {
    const prev = userRoom.get(user.id);
    if (prev && prev !== this.code && rooms.has(prev)) rooms.get(prev).leave(user.id);
    let s = this.seatOf(user.id);
    if (s >= 0) {
      this.seats[s].name = user.name;
      if (this.table && this.table.seats[s].away) this.table.setAway(s, false);
      userRoom.set(user.id, this.code);
      return { ok: true };
    }
    if (this.table) return { ok: false, error: 'Game already started' };
    s = this.seats.indexOf(null);
    if (s < 0) return { ok: false, error: 'Room is full' };
    this.seats[s] = { id: user.id, name: user.name };
    userRoom.set(user.id, this.code);
    if (this.isPublic && this.humans().length === 4) this.start();
    else this.broadcast();
    return { ok: true };
  }

  leave(id) {
    const s = this.seatOf(id);
    if (userRoom.get(id) === this.code) userRoom.delete(id);
    if (s < 0) return;
    if (this.table) {
      this.table.setAway(s, true); // a bot takes over their seat
      this.seats[s].left = true;
      if (this.seats.every((x) => !x || x.bot || x.left)) this.close();
    } else {
      this.seats[s] = null;
      if (this.humans().length === 0) return this.close();
      if (this.hostId === id) this.hostId = this.humans()[0].id;
      this.broadcast();
    }
  }

  start() {
    if (this.table) return;
    clearTimeout(this.startTimer);
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const seats = this.seats.map((s) => s || { bot: true, name: names.pop() });
    this.seats = seats;
    this.table = new MJ.Table({
      seats: seats.map((s) => ({ name: s.name, isBot: !!s.bot, level: this.level })),
      rounds: this.rounds,
      timeouts: TIMEOUTS,
      onChange: () => this.broadcast(),
    });
    this.table.start();
  }

  stateFor(userId) {
    this.touched = Date.now();
    if (this.table) {
      const seat = this.seatOf(userId);
      if (seat < 0) return { kind: 'error', error: 'Not in this room' };
      return { kind: 'game', code: this.code, view: this.table.view(seat) };
    }
    return {
      kind: 'lobby', code: this.code, isPublic: this.isPublic, isHost: userId === this.hostId,
      level: this.level, rounds: this.rounds,
      startsIn: this.startsAt ? Math.max(0, this.startsAt - Date.now()) : null,
      seats: this.seats.map((s) => (s ? { name: s.name, you: s.id === userId, host: s.id === this.hostId } : null)),
    };
  }

  broadcast() {
    for (const [uid, set] of this.clients) {
      const data = `data: ${JSON.stringify(this.stateFor(uid))}\n\n`;
      for (const res of set) res.write(data);
    }
  }

  close() {
    if (this.table) this.table.destroy();
    clearTimeout(this.startTimer);
    for (const [uid, set] of this.clients) {
      for (const res of set) { res.write(`data: ${JSON.stringify({ kind: 'closed' })}\n\n`); res.end(); }
      if (userRoom.get(uid) === this.code) userRoom.delete(uid);
    }
    for (const s of this.seats) if (s && !s.bot && userRoom.get(s.id) === this.code) userRoom.delete(s.id);
    rooms.delete(this.code);
  }
}

function quickMatch(user) {
  const current = rooms.get(userRoom.get(user.id));
  if (current && current.isPublic && !current.table) return current;
  let room = [...rooms.values()].find((r) => r.isPublic && !r.table && r.seats.includes(null));
  if (!room) {
    room = new Room({ isPublic: true, host: user, level: 'normal', rounds: 4 });
    room.startsAt = Date.now() + QUICK_MATCH_WAIT;
    room.startTimer = setTimeout(() => room.start(), QUICK_MATCH_WAIT);
  }
  room.join(user);
  return room;
}

// Clean up idle rooms and finished games.
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const listeners = [...r.clients.values()].reduce((n, s) => n + s.size, 0);
    const finished = r.table && r.table.game.phase === 'matchOver';
    if ((listeners === 0 && now - r.touched > 10 * 60e3) || (finished && now - r.touched > 30 * 60e3)) r.close();
  }
}, 60e3).unref();

// ---------- http ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const routes = {
  'GET /api/config': async (req, res, user) => send(res, 200, {
    online: true, dev: DEV, botUsername: telegram.botUsername(), appShortName: process.env.APP_SHORT_NAME || null,
    activeRoom: user && rooms.has(userRoom.get(user.id)) ? userRoom.get(user.id) : null,
  }),

  'POST /api/quick': async (req, res, user) => send(res, 200, { code: quickMatch(user).code }),

  'POST /api/create': async (req, res, user, body) => {
    const room = new Room({ isPublic: false, host: user, level: body.level, rounds: Number(body.rounds) });
    room.join(user);
    send(res, 200, { code: room.code });
  },

  'POST /api/join': async (req, res, user, body) => {
    const room = rooms.get(String(body.code || '').toUpperCase().trim());
    if (!room) return send(res, 404, { error: 'Room not found' });
    const r = room.join(user);
    send(res, r.ok ? 200 : 400, r.ok ? { code: room.code } : r);
  },

  'POST /api/start': async (req, res, user, body) => {
    const room = rooms.get(body.code);
    if (!room || room.hostId !== user.id) return send(res, 403, { error: 'Only the host can start' });
    room.start();
    send(res, 200, { ok: true });
  },

  'POST /api/action': async (req, res, user, body) => {
    const room = rooms.get(body.code);
    if (!room || !room.table) return send(res, 404, { error: 'No game' });
    const seat = room.seatOf(user.id);
    if (seat < 0) return send(res, 403, { error: 'Not seated' });
    const r = room.table.act(seat, body.action);
    send(res, r.ok ? 200 : 400, r);
  },

  'POST /api/leave': async (req, res, user, body) => {
    const room = rooms.get(body.code);
    if (room) room.leave(user.id);
    send(res, 200, { ok: true });
  },

  'GET /api/stream': async (req, res, user, body, query) => {
    const room = rooms.get(query.get('code'));
    if (!room || room.seatOf(user.id) < 0) return send(res, 404, { error: 'Room not found' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(room.stateFor(user.id))}\n\n`);
    if (!room.clients.has(user.id)) room.clients.set(user.id, new Set());
    room.clients.get(user.id).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      const set = room.clients.get(user.id);
      if (set) { set.delete(res); if (!set.size) room.clients.delete(user.id); }
    });
  },
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const route = routes[`${req.method} ${u.pathname}`];
  if (!route) {
    if (req.method === 'GET' && !u.pathname.startsWith('/api/')) return serveStatic(req, res, u.pathname);
    return send(res, 404, { error: 'not found' });
  }
  try {
    const initData = req.headers['x-init-data'] || u.searchParams.get('auth');
    const devUser = req.headers['x-dev-user'] || u.searchParams.get('dev');
    const user = getUser(initData, devUser);
    if (!user && u.pathname !== '/api/config') return send(res, 401, { error: 'Open this app from Telegram' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    await route(req, res, user, body, u.searchParams);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Mahjong server on http://localhost:${PORT}${DEV ? '  (dev mode: browser logins allowed)' : ''}`);
  telegram.start();
});
