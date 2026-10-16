// The House Knows: tiny room relay for online play. Zero dependencies (Node 22+).
//
// It does NOT know the game rules. The host's phone runs the game; this server
// only passes messages between the phones in a room (Server-Sent Events down,
// plain POST up) and, optionally, serves the game's static files so one process
// can host everything:   node server/relay.js   ->  http://localhost:8787
//
// Env: PORT (8787), HOST (0.0.0.0), ALLOW_ORIGIN (* by default; set to your site's origin),
//      STATIC=0 to disable serving the game files, ROOM_TTL_MIN (180).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json',
};
// Only these paths are public. Server code, tests and docs never are.
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icon\.svg$/, /^\/src\//, /^\/data\//];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
export const MAX_PLAYERS = 4;
const MAX_BODY = 512 * 1024;
const HOST_ONLY = new Set(['state', 'start', 'end', 'kick', 'lobby']);

const rid = (n = 12) => randomBytes(n).toString('base64url');
const json = (res, status, body, headers) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};

export function createRelay({ allowOrigin = '*', serveStatic = true, roomTtlMs = 180 * 60_000, now = () => Date.now() } = {}) {
  /** @type {Map<string, any>} */
  const rooms = new Map();
  const createLog = new Map(); // ip -> timestamps
  const cors = { 'Access-Control-Allow-Origin': allowOrigin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };

  function newCode() {
    for (let i = 0; i < 50; i++) {
      const c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
    throw new Error('no room code available');
  }

  const publicMembers = (room) => [...room.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, language: m.language, profileId: m.profileId, host: m.id === room.hostId, connected: m.streams.size > 0 }));

  function emit(stream, event, data) {
    try { stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
  }
  function broadcastMembers(room) {
    const data = { members: publicMembers(room), locked: room.locked };
    for (const m of room.members.values()) for (const s of m.streams) emit(s, 'members', data);
  }

  async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
  }

  const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
  const memberView = (m) => ({ id: m.id, name: m.name, avatar: m.avatar, language: m.language, profileId: m.profileId });

  function authed(room, token) {
    if (!room || typeof token !== 'string') return null;
    for (const m of room.members.values()) if (m.token === token) return m;
    return null;
  }

  function rateOk(m) {
    const t = now();
    m.hits = (m.hits ?? []).filter((x) => t - x < 1000);
    if (m.hits.length >= 40) return false;
    m.hits.push(t);
    return true;
  }

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api','rooms',CODE,action]
    const send = (status, body) => json(res, status, body, cors);

    if (parts[1] === 'health') return send(200, { ok: true, rooms: rooms.size, time: now() });

    if (parts[1] !== 'rooms') return send(404, { error: 'not found' });

    if (parts.length === 2 && req.method === 'POST') {
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
      const t = now();
      const recent = (createLog.get(ip) ?? []).filter((x) => t - x < 3_600_000);
      if (recent.length >= 30) return send(429, { error: 'too many rooms created from this address, try again later' });
      recent.push(t);
      createLog.set(ip, recent);
      const body = await readBody(req);
      const code = newCode();
      const hostId = 'm_' + rid(6);
      const room = { code, hostId, createdAt: t, touched: t, locked: false, members: new Map(), latest: null, seq: 0 };
      const host = { id: hostId, token: rid(18), name: clean(body.name, 20) || 'Host', avatar: clean(body.avatar, 16), language: clean(body.language, 5), profileId: clean(body.profileId, 80), streams: new Set() };
      room.members.set(hostId, host);
      rooms.set(code, room);
      return send(200, { code, memberId: hostId, token: host.token, hostId, members: publicMembers(room) });
    }

    const code = String(parts[2] ?? '').toUpperCase();
    const room = rooms.get(code);
    const action = parts[3];
    if (!room) return send(404, { error: 'room not found' });
    room.touched = now();

    if (action === 'join' && req.method === 'POST') {
      const body = await readBody(req);
      if (room.locked) return send(403, { error: 'the game has already started' });
      if (room.members.size >= MAX_PLAYERS) return send(403, { error: 'room is full (4 players max)' });
      const profileId = clean(body.profileId, 80);
      if (profileId && [...room.members.values()].some((m) => m.profileId === profileId)) return send(409, { error: 'that player is already in this room' });
      const name = clean(body.name, 20) || 'Player';
      if ([...room.members.values()].some((m) => m.name.toLowerCase() === name.toLowerCase())) return send(409, { error: `"${name}" is already taken in this room, pick another player` });
      const id = 'm_' + rid(6);
      const m = { id, token: rid(18), name, avatar: clean(body.avatar, 16), language: clean(body.language, 5), profileId, streams: new Set() };
      room.members.set(id, m);
      broadcastMembers(room);
      return send(200, { code, memberId: id, token: m.token, hostId: room.hostId, members: publicMembers(room) });
    }

    if (action === 'events' && req.method === 'GET') {
      const m = authed(room, url.searchParams.get('token'));
      if (!m) return send(403, { error: 'bad token' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors });
      res.write('retry: 1500\n\n');
      m.streams.add(res);
      emit(res, 'hello', { you: memberView(m), hostId: room.hostId, members: publicMembers(room), locked: room.locked, latest: room.latest });
      broadcastMembers(room);
      const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* closed */ } }, 20_000);
      req.on('close', () => {
        clearInterval(ka);
        m.streams.delete(res);
        if (rooms.get(code) === room) broadcastMembers(room);
      });
      return undefined;
    }

    if (action === 'send' && req.method === 'POST') {
      const body = await readBody(req);
      const m = authed(room, body.token);
      if (!m) return send(403, { error: 'bad token' });
      if (!rateOk(m)) return send(429, { error: 'slow down' });
      const type = clean(body.type, 24);
      if (!type) return send(400, { error: 'missing type' });
      const isHost = m.id === room.hostId;
      if (HOST_ONLY.has(type) && !isHost) return send(403, { error: 'host only' });
      if (type === 'start') room.locked = true;
      const msg = { seq: ++room.seq, from: m.id, type, payload: body.payload ?? null };
      if (type === 'state' || type === 'start' || type === 'lobby') room.latest = { ...msg, to: 'all' };
      let targets;
      const to = body.to ?? (isHost ? 'all' : 'host');
      if (to === 'all') targets = [...room.members.values()];
      else if (to === 'host') targets = [room.members.get(room.hostId)];
      else targets = [room.members.get(to)].filter(Boolean);
      for (const t of targets) for (const s of t.streams) emit(s, 'msg', msg);
      if (type === 'end') { room.locked = true; }
      return send(200, { ok: true, seq: msg.seq, delivered: targets.reduce((n, t) => n + t.streams.size, 0) });
    }

    if (action === 'leave' && req.method === 'POST') {
      const body = await readBody(req);
      const m = authed(room, body.token);
      if (!m) return send(403, { error: 'bad token' });
      for (const s of m.streams) { try { s.end(); } catch { /* ignore */ } }
      m.streams.clear();
      if (m.id === room.hostId) {
        for (const o of room.members.values()) for (const s of o.streams) emit(s, 'closed', { reason: 'host left' });
        rooms.delete(code);
      } else if (!room.locked) {
        room.members.delete(m.id);
        broadcastMembers(room);
      } else {
        broadcastMembers(room); // in a running game the member stays listed as disconnected
      }
      return send(200, { ok: true });
    }

    return send(404, { error: 'not found' });
  }

  async function staticFile(req, res, url) {
    if (!serveStatic) { res.writeHead(404); return res.end('Not found'); }
    try {
      const p = decodeURIComponent(url.pathname);
      if (!PUBLIC.some((re) => re.test(p))) throw new Error('not public');
      let file = normalize(join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT)) throw new Error('outside root');
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return await staticFile(req, res, url);
    } catch (e) {
      const status = e.status ?? 500;
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'server error' : e.message }, cors);
      else res.end();
      if (status === 500) console.error(e);
    }
  });

  const sweep = setInterval(() => {
    const t = now();
    for (const [code, room] of rooms) {
      const live = [...room.members.values()].some((m) => m.streams.size > 0);
      if (t - room.touched > roomTtlMs && !live) rooms.delete(code);
    }
  }, 60_000);
  sweep.unref?.();
  server.on('close', () => clearInterval(sweep));

  return { server, rooms };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT) || 8787;
  const { server } = createRelay({ allowOrigin: process.env.ALLOW_ORIGIN ?? '*', serveStatic: process.env.STATIC !== '0', roomTtlMs: (Number(process.env.ROOM_TTL_MIN) || 180) * 60_000 });
  server.listen(port, process.env.HOST ?? '0.0.0.0', () => console.log(`The House Knows relay on http://localhost:${port}  (game files ${process.env.STATIC === '0' ? 'off' : 'served'})`));
}
