import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../server/relay.js';

async function start(opts) {
  const { server, rooms } = createRelay(opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, rooms, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const post = async (base, path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json() };
};

/** Minimal SSE reader. */
async function sse(base, code, token) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/rooms/${code}/events?token=${token}`, { signal: ctl.signal });
  assert.equal(res.status, 200);
  const events = [];
  const waiters = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /event: (.*)/.exec(chunk)?.[1]; const data = /data: (.*)/.exec(chunk)?.[1];
          if (ev) { events.push({ event: ev, data: JSON.parse(data) }); waiters.splice(0).forEach((w) => w()); }
        }
      }
    } catch { /* aborted */ }
  })();
  const waitFor = async (pred, ms = 2000) => {
    const t0 = Date.now();
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for event; got ' + JSON.stringify(events.map((e) => e.event + ':' + (e.data.type ?? ''))));
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
  };
  return { events, waitFor, close: () => ctl.abort() };
}

test('create, join, relay actions to host and state to all', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', { name: 'Ana', profileId: 'p1' })).body;
    assert.match(host.code, /^[A-Z]{4}$/);
    const g = await post(s.base, `/api/rooms/${host.code}/join`, { name: 'Ben', profileId: 'p2' });
    assert.equal(g.status, 200);
    const hs = await sse(s.base, host.code, host.token);
    const gs = await sse(s.base, host.code, g.body.token);
    await hs.waitFor((e) => e.event === 'hello');
    await gs.waitFor((e) => e.event === 'hello');

    // Guest -> host (default target)
    await post(s.base, `/api/rooms/${host.code}/send`, { token: g.body.token, type: 'action', payload: { x: 1 } });
    const got = await hs.waitFor((e) => e.event === 'msg' && e.data.type === 'action');
    assert.deepEqual(got.data.payload, { x: 1 });
    assert.equal(got.data.from, g.body.memberId);
    assert.ok(!gs.events.some((e) => e.event === 'msg' && e.data.type === 'action'), 'guest should not receive its own action');

    // Host -> everyone
    await post(s.base, `/api/rooms/${host.code}/send`, { token: host.token, type: 'state', payload: { rev: 1 } });
    await gs.waitFor((e) => e.event === 'msg' && e.data.type === 'state');
    await hs.waitFor((e) => e.event === 'msg' && e.data.type === 'state');
    hs.close(); gs.close();
  } finally { await s.close(); }
});

test('guests cannot send host-only messages or use bad tokens', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', {})).body;
    const g = (await post(s.base, `/api/rooms/${host.code}/join`, { name: 'Ben' })).body;
    assert.equal((await post(s.base, `/api/rooms/${host.code}/send`, { token: g.token, type: 'state', payload: {} })).status, 403);
    assert.equal((await post(s.base, `/api/rooms/${host.code}/send`, { token: 'nope', type: 'action' })).status, 403);
    assert.equal((await post(s.base, `/api/rooms/ZZZZ/join`, { name: 'x' })).status, 404);
  } finally { await s.close(); }
});

test('room limits: 4 players, unique names and profiles, locked after start', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', { name: 'A', profileId: 'pa' })).body;
    assert.equal((await post(s.base, `/api/rooms/${host.code}/join`, { name: 'A' })).status, 409); // name taken
    assert.equal((await post(s.base, `/api/rooms/${host.code}/join`, { name: 'Z', profileId: 'pa' })).status, 409); // profile in room
    for (const n of ['B', 'C', 'D']) assert.equal((await post(s.base, `/api/rooms/${host.code}/join`, { name: n })).status, 200);
    assert.equal((await post(s.base, `/api/rooms/${host.code}/join`, { name: 'E' })).status, 403); // full
  } finally { await s.close(); }
});

test('late joiners and reconnecting phones receive the latest state', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', {})).body;
    const g = (await post(s.base, `/api/rooms/${host.code}/join`, { name: 'Ben' })).body;
    await post(s.base, `/api/rooms/${host.code}/send`, { token: host.token, type: 'state', payload: { rev: 7 } });
    const gs = await sse(s.base, host.code, g.token);
    const hello = await gs.waitFor((e) => e.event === 'hello');
    assert.equal(hello.data.latest.payload.rev, 7);
    gs.close();
  } finally { await s.close(); }
});

test('start locks the room; members list shows who is connected', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', { name: 'A' })).body;
    const g = (await post(s.base, `/api/rooms/${host.code}/join`, { name: 'B' })).body;
    const hs = await sse(s.base, host.code, host.token);
    const gs = await sse(s.base, host.code, g.token);
    await hs.waitFor((e) => e.event === 'members' && e.data.members.every((m) => m.connected));
    gs.close();
    await hs.waitFor((e) => e.event === 'members' && e.data.members.some((m) => !m.connected && m.name === 'B'));
    await post(s.base, `/api/rooms/${host.code}/send`, { token: host.token, type: 'start', payload: {} });
    assert.equal((await post(s.base, `/api/rooms/${host.code}/join`, { name: 'C' })).status, 403);
    hs.close();
  } finally { await s.close(); }
});

test('host leaving closes the room', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', {})).body;
    const g = (await post(s.base, `/api/rooms/${host.code}/join`, { name: 'B' })).body;
    const gs = await sse(s.base, host.code, g.token);
    await gs.waitFor((e) => e.event === 'hello');
    await post(s.base, `/api/rooms/${host.code}/leave`, { token: host.token });
    await gs.waitFor((e) => e.event === 'closed');
    assert.equal((await post(s.base, `/api/rooms/${host.code}/join`, { name: 'C' })).status, 404);
    gs.close();
  } finally { await s.close(); }
});

test('oversized bodies are rejected and server code is not served as a static file', async () => {
  const s = await start();
  try {
    const host = (await post(s.base, '/api/rooms', {})).body;
    const big = 'x'.repeat(600 * 1024);
    const r = await fetch(`${s.base}/api/rooms/${host.code}/send`, { method: 'POST', body: JSON.stringify({ token: host.token, type: 'state', payload: big }) });
    assert.equal(r.status, 413);
    assert.equal((await fetch(`${s.base}/server/relay.js`)).status, 404);
    assert.equal((await fetch(`${s.base}/package.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/tests/helpers.js`)).status, 404);
    assert.equal((await fetch(`${s.base}/`)).status, 200);
    assert.equal((await fetch(`${s.base}/src/main.js`)).status, 200);
    assert.equal((await fetch(`${s.base}/data/questions/index.json`)).status, 200);
  } finally { await s.close(); }
});
