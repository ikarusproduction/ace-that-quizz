// Tournée Générale server. Zero dependencies (Node 22+).
//
// The server is the referee: it keeps every room's game state, applies the players'
// actions with the shared rules engine (src/shared/game.js), runs the clock, and pushes
// the full state to every phone (Server-Sent Events down, plain POST up). Mini-games run
// on the phones; only their final score comes back. A phone that locks or reloads just
// reconnects with its token and picks the game up where it is.
//
//   node server/server.js            -> http://localhost:8787
// Env: PORT (8787), HOST (0.0.0.0), ALLOW_ORIGIN (* by default), ROOM_TTL_MIN (240)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createGame, addPlayer, act, tick, setConnected } from '../src/shared/game.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
const PUBLIC = [/^\/$/, /^\/index\.html$/, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/, /^\/src\//, /^\/assets\//];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, no O
const MAX_BODY = 16 * 1024;

const rid = (n = 12) => randomBytes(n).toString('base64url');
const sameToken = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createApp({ allowOrigin = '*', roomTtlMs = 240 * 60_000, now = () => Date.now(), tickMs = 150, serveStatic = true } = {}) {
  /** @type {Map<string, {state: any, members: Map<string, {token: string, streams: Set<any>, dropTimer: any}>, touched: number}>} */
  const rooms = new Map();
  const createLog = new Map();
  const cors = { 'Access-Control-Allow-Origin': allowOrigin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
    res.end(JSON.stringify(body));
  };

  function newCode() {
    for (let i = 0; i < 100; i++) {
      const c = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
    throw new Error('no room code left');
  }

  function send(stream, payload) {
    try { stream.write(`event: state\ndata: ${payload}\n\n`); } catch { /* closed */ }
  }
  function broadcast(room) {
    const payload = JSON.stringify({ now: now(), state: room.state });
    for (const m of room.members.values()) for (const s of m.streams) send(s, payload);
  }

  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw Object.assign(new Error('too big'), { status: 413 });
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad json'), { status: 400 }); }
  }

  function tooManyCreates(req) {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
    const t = now();
    const log = (createLog.get(ip) ?? []).filter((x) => t - x < 600_000);
    log.push(t);
    createLog.set(ip, log);
    return log.length > 30;
  }

  function joinPlayer(room, name, character) {
    const pid = rid(6);
    const token = rid(18);
    const r = addPlayer(room.state, { id: pid, name, character }, now());
    if (!r.ok) return r;
    room.members.set(pid, { token, streams: new Set(), dropTimer: null });
    room.touched = now();
    broadcast(room);
    return { ok: true, pid, token };
  }

  function auth(room, pid, token) {
    const m = room?.members.get(String(pid ?? ''));
    return m && sameToken(m.token, token) ? m : null;
  }

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // api, rooms, CODE, verb
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });

    if (req.method === 'POST' && parts.length === 2 && parts[1] === 'rooms') {
      if (tooManyCreates(req)) return json(res, 429, { error: 'Trop de parties créées, réessaie dans quelques minutes' });
      const b = await body(req);
      const code = newCode();
      const room = { state: createGame({ code, seed: randomInt(2 ** 31), now: now() }), members: new Map(), touched: now() };
      rooms.set(code, room);
      const r = joinPlayer(room, b.name, b.character);
      return json(res, 200, { code, pid: r.pid, token: r.token });
    }

    const code = String(parts[2] ?? '').toUpperCase();
    const room = rooms.get(code);
    if (parts[1] !== 'rooms' || !code) return json(res, 404, { error: 'not found' });
    if (!room) return json(res, 404, { error: 'Partie introuvable. Vérifie le code.' });
    const verb = parts[3];

    if (req.method === 'POST' && verb === 'join') {
      const b = await body(req);
      const r = joinPlayer(room, b.name, b.character);
      return r.ok ? json(res, 200, { code, pid: r.pid, token: r.token }) : json(res, 409, { error: r.error });
    }

    if (req.method === 'GET' && verb === 'stream') {
      const m = auth(room, url.searchParams.get('pid'), url.searchParams.get('token'));
      if (!m) return json(res, 403, { error: 'Session expirée' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors });
      res.write('retry: 1500\n\n');
      m.streams.add(res);
      clearTimeout(m.dropTimer);
      const pid = url.searchParams.get('pid');
      if (setConnected(room.state, pid, true, now())) broadcast(room);
      else send(res, JSON.stringify({ now: now(), state: room.state }));
      room.touched = now();
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15_000);
      req.on('close', () => {
        clearInterval(ping);
        m.streams.delete(res);
        if (m.streams.size === 0) {
          // A short grace period so a reload or a network blip does not count as leaving.
          m.dropTimer = setTimeout(() => {
            if (m.streams.size === 0 && setConnected(room.state, pid, false, now())) broadcast(room);
          }, 4_000);
        }
      });
      return undefined;
    }

    if (req.method === 'POST' && verb === 'action') {
      const b = await body(req);
      if (!auth(room, b.pid, b.token)) return json(res, 403, { error: 'Session expirée' });
      const r = act(room.state, b.pid, b.action, now());
      room.touched = now();
      if (r.ok) {
        if (b.action?.type === 'leave') {
          const m = room.members.get(b.pid);
          room.members.delete(b.pid);
          for (const s of m?.streams ?? []) try { s.end(); } catch { /* closed */ }
        }
        broadcast(room);
      }
      return json(res, r.ok ? 200 : 409, r);
    }

    return json(res, 404, { error: 'not found' });
  }

  async function serveFile(res, pathname) {
    if (!PUBLIC.some((re) => re.test(pathname))) return false;
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT + sep)) return false;
    try {
      const st = await stat(file);
      if (!st.isFile()) return false;
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (serveStatic && req.method === 'GET' && (await serveFile(res, url.pathname))) return undefined;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    } catch (err) {
      if (!err.status) console.error(err);
      return json(res, err.status ?? 500, { error: err.status ? err.message : 'server error' });
    }
  });

  const timer = setInterval(() => {
    const t = now();
    for (const [code, room] of rooms) {
      if (tick(room.state, t)) broadcast(room);
      const live = [...room.members.values()].some((m) => m.streams.size);
      if (!live && t - room.touched > roomTtlMs) rooms.delete(code);
    }
  }, tickMs);
  server.on('close', () => clearInterval(timer));

  return { server, rooms };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';
  const { server } = createApp({ allowOrigin: process.env.ALLOW_ORIGIN ?? '*', roomTtlMs: Number(process.env.ROOM_TTL_MIN ?? 240) * 60_000 });
  server.listen(port, host, () => console.log(`Tournée Générale : http://localhost:${port}`));
}
