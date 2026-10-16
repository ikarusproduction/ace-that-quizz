// Runs the PHP relay (server/php/index.php) with PHP's built-in web server and plays a room through OnlineSession
// in poll mode. Skipped when php is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OnlineSession } from '../src/net/session.js';

const hasPhp = spawnSync('php', ['-v']).status === 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(50); } throw new Error('timed out'); };

async function startPhp(access) {
  const dir = mkdtempSync(join(tmpdir(), 'thk-php-'));
  copyFileSync(new URL('../server/php/index.php', import.meta.url), join(dir, 'index.php'));
  writeFileSync(join(dir, 'config.php'), `<?php return ['access_hash' => '${access ? createHash('sha256').update(access).digest('hex') : ''}', 'data_dir' => '${dir}/data'];`);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '6' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/index.php`;
  await until(async () => OnlineSession.health(base));
  return { base, stop: () => { p.kill(); rmSync(dir, { recursive: true, force: true }); } };
}
const prof = (id, name) => ({ id, name, avatar: { key: 'a' }, language: 'en' });

test('PHP relay: host and guest play through polling', { skip: !hasPhp }, async () => {
  const s = await startPhp('');
  try {
    const host = new OnlineSession({ base: s.base });
    await host.create(prof('p1', 'Ana'));
    const guest = new OnlineSession({ base: s.base });
    await guest.join(host.code, prof('p2', 'Ben'));
    const got = { host: [], guest: [] };
    host.on('action', (a) => got.host.push(a)); guest.on('state', (st) => got.guest.push(st)); guest.on('start', (st) => got.guest.push({ start: st }));
    host.open(); guest.open();
    await until(() => host.members.length === 2 && host.members.every((m) => m.connected) && guest.status === 'online');
    await host.start({ rev: 1, state: { hello: 'world' } });
    await until(() => got.guest.some((x) => x.start));
    await guest.sendAction({ type: 'ANSWER', n: 2 }, 1);
    await until(() => got.host.length === 1);
    assert.equal(got.host[0].action.n, 2);
    await host.broadcastState(2, { phase: 'reveal' });
    await until(() => got.guest.some((x) => x.rev === 2));
    // a guest cannot send host-only messages
    await assert.rejects(guest.send('state', { rev: 9, state: {} }, 'all'), /host only/);
    // full room and duplicate names are refused
    const dup = new OnlineSession({ base: s.base });
    await assert.rejects(dup.join(host.code, prof('p3', 'ben')), /locked|already|started/);
    let closed = null; guest.on('closed', (d) => { closed = d; });
    await host.leave();
    await until(() => closed);
    await guest.leave();
  } finally { s.stop(); }
});

test('PHP relay: access code is enforced and wrong tries lock out', { skip: !hasPhp }, async () => {
  const s = await startPhp('sesame');
  try {
    assert.equal((await OnlineSession.gateInfo(s.base)).gated, true);
    assert.equal((await OnlineSession.checkAccess(s.base, 'nope')).ok, false);
    assert.equal((await OnlineSession.checkAccess(s.base, 'sesame')).ok, true);
    await assert.rejects(new OnlineSession({ base: s.base }).create(prof('p1', 'Ana')), /access code/);
    const ok = new OnlineSession({ base: s.base, access: 'sesame' });
    await ok.create(prof('p1', 'Ana'));
    await assert.rejects(new OnlineSession({ base: s.base }).join(ok.code, prof('p2', 'Ben')), /access code/);
    for (let i = 0; i < 12; i++) await OnlineSession.checkAccess(s.base, `bad${i}`);
    assert.match((await OnlineSession.checkAccess(s.base, 'sesame')).error, /too many/);
  } finally { s.stop(); }
});

import { createMemoryStorage } from '../src/storage/memory.js';
import { createRepo } from '../src/storage/repo.js';
import { createCloud, formatKey, isValidKey, newKey } from '../src/storage/cloud.js';

test('save codes are well formed', () => {
  const k = newKey();
  assert.ok(isValidKey(k), k);
  assert.equal(formatKey('ab12cd34ef56gh78'), 'AB12-CD34-EF56-GH78');
  assert.equal(isValidKey('nope'), false);
});

test('cloud save: players and cards survive a wiped device (PHP relay)', { skip: !hasPhp }, async () => {
  const s = await startPhp('sesame');
  try {
    const repoA = await createRepo(createMemoryStorage());
    const ana = await repoA.createProfile({ name: 'Ana', language: 'fr' });
    const cloudA = createCloud({ repo: repoA, base: s.base, getAccess: () => 'sesame' });
    const key = cloudA.ensureKey();
    assert.equal((await cloudA.push()).ok, true);
    // a brand new device with an empty database
    const repoB = await createRepo(createMemoryStorage());
    assert.equal((await repoB.listProfiles()).length, 0);
    const cloudB = createCloud({ repo: repoB, base: s.base, getAccess: () => 'sesame' });
    const sum = await cloudB.restore(key.toLowerCase().replaceAll('-', ''));
    assert.equal(sum.profilesAdded, 1);
    const back = (await repoB.listProfiles())[0];
    assert.equal(back.id, ana.id);
    assert.equal(back.name, 'Ana');
    // wrong code / wrong access
    await assert.rejects(cloudB.restore('AAAA-AAAA-AAAA-AAAA'), /no save found/);
    const bad = createCloud({ repo: repoB, base: s.base, getAccess: () => 'wrong' });
    await assert.rejects(bad.restore(key), /access code/);
    // an older save can't overwrite a newer one
    const old = createCloud({ repo: repoA, base: s.base, getAccess: () => 'sesame', now: () => 1 });
    old.setKey(key);
    await assert.rejects(old.push(), /newer save/);
  } finally { s.stop(); }
});
