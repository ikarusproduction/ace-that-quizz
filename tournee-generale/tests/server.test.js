import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/server.js';

async function withServer(fn) {
  const { server } = createApp({ tickMs: 50 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}

const post = async (base, path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

/** Read SSE "state" events until `until(state)` is true. */
async function readUntil(base, code, s, until, ms = 3000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const res = await fetch(`${base}/api/rooms/${code}/stream?pid=${s.pid}&token=${s.token}`, { signal: ac.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const { state } = JSON.parse(line.slice(6));
        if (until(state)) return state;
      }
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  throw new Error('condition not met');
}

test('create, join, stream, start, roll', async () => {
  await withServer(async (base) => {
    const a = await post(base, '/api/rooms', { name: 'Alice', character: 'gigi' });
    assert.equal(a.status, 200);
    assert.match(a.body.code, /^[A-Z]{4}$/);
    const code = a.body.code;
    const b = await post(base, `/api/rooms/${code.toLowerCase()}/join`, { name: 'Bob', character: 'gigi' });
    assert.equal(b.status, 200);
    let st = await readUntil(base, code, a.body, (s) => s.players.length === 2);
    assert.notEqual(st.players[1].character, 'gigi', 'characters stay unique');
    assert.equal((await post(base, `/api/rooms/${code}/action`, { pid: b.body.pid, token: b.body.token, action: { type: 'start' } })).status, 409, 'only the host starts');
    assert.equal((await post(base, `/api/rooms/${code}/action`, { pid: a.body.pid, token: 'nope', action: { type: 'start' } })).status, 403);
    assert.equal((await post(base, `/api/rooms/${code}/action`, { pid: a.body.pid, token: a.body.token, action: { type: 'start' } })).status, 200);
    for (const s of [a.body, b.body]) assert.equal((await post(base, `/api/rooms/${code}/action`, { pid: s.pid, token: s.token, action: { type: 'roll' } })).status, 200);
    st = await readUntil(base, code, b.body, (s) => s.phase === 'move');
    assert.equal(Object.keys(st.rolls).length, 2);
    assert.equal((await post(base, '/api/rooms/ZZZZ/join', { name: 'x' })).status, 404);
  });
});

test('static files are served, private ones are not', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/src/shared/game.js`)).status, 200);
    assert.equal((await fetch(`${base}/server/server.js`)).status, 404);
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/src/../server/server.js`)).status, 404);
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
  });
});
