// Friends: the list lives inside the profile; cards are published to the PHP relay under a code and a secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepo } from '../src/storage/repo.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createCloud } from '../src/storage/cloud.js';
import { metaOf, mergeMeta } from '../src/storage/meta.js';
import { buildCard, cleanCard, newFriendCode, normalizeFriendCode, FRIEND_CODE_RE, accuracyOf } from '../src/stats/card.js';
import { OnlineSession } from '../src/net/session.js';

const hasPhp = spawnSync('php', ['-v']).status === 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(50); } throw new Error('timed out'); };
async function startPhp() {
  const dir = mkdtempSync(join(tmpdir(), 'thk-friends-'));
  copyFileSync(new URL('../server/php/index.php', import.meta.url), join(dir, 'index.php'));
  writeFileSync(join(dir, 'config.php'), `<?php return ['access_hash' => '', 'data_dir' => '${dir}/data'];`);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', dir], { env: { ...process.env, PHP_CLI_SERVER_WORKERS: '4' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/index.php`;
  await until(async () => OnlineSession.health(base));
  return { base, stop: () => { p.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

test('friend codes look right and are normalised', () => {
  const c = newFriendCode();
  assert.match(c, FRIEND_CODE_RE);
  assert.equal(normalizeFriendCode('k7qd 4mxp'), 'K7QD-4MXP');
  assert.equal(normalizeFriendCode('k7q'), 'K7Q');
});

test('cards keep only known fields and sane numbers', () => {
  const c = cleanCard({ name: '<b>Evil</b>\u0000', games: -5, wins: 3.7, cats: { science: [10, 99], 'BAD KEY': [1, 1] }, extra: 'x', best: 'lots' });
  assert.equal(c.games, 0);
  assert.equal(c.wins, 3);
  assert.equal(c.best, 0);
  assert.deepEqual(c.cats, { science: [10, 10] });
  assert.equal('extra' in c, false);
  assert.ok(!c.name.includes('<'));
  assert.equal(cleanCard(null), null);
});

test('buildCard summarises results and runs', () => {
  const profile = { id: 'p1', name: 'Ana', avatar: { key: 'owl' }, ownedCards: ['a', 'b'], hexes: { owned: ['x', 'y', 'z'] } };
  const results = [
    { playerId: 'p1', category: 'science', correct: true }, { playerId: 'p1', category: 'science', correct: false }, { playerId: 'p2', category: 'science', correct: true },
  ];
  const sessions = [
    { status: 'completed', mode: 'solo', variant: 'rush', players: [{ playerId: 'p1', result: 'won', score: 700, longestStreak: 4, bossesCleared: 1 }] },
    { status: 'completed', mode: 'solo', variant: 'map', players: [{ playerId: 'p1', result: 'lost', score: 300, longestStreak: 6, bossesCleared: 0 }] },
    { status: 'abandoned', mode: 'solo', players: [{ playerId: 'p1', result: null }] },
    { status: 'completed', mode: 'versus', players: [{ playerId: 'p1', placement: 1, score: 9999 }] },
  ];
  const c = buildCard({ profile, results, sessions });
  assert.equal(c.games, 3); assert.equal(c.wins, 2); assert.equal(c.best, 700); assert.equal(c.streak, 6);
  assert.equal(c.rush, 1); assert.equal(c.maps, 0); assert.equal(c.bosses, 1); assert.equal(c.hexes, 3); assert.equal(c.cards, 2);
  assert.deepEqual(c.cats.science, [2, 1]);
  assert.equal(accuracyOf(c), 0.5);
});

test('the friends list is stored in the profile, survives export/import and merges', async () => {
  const repoA = await createRepo(createMemoryStorage());
  const ana = await repoA.createProfile({ name: 'Ana' });
  const id = await repoA.friendIdentity(ana.id);
  assert.match(id.code, FRIEND_CODE_RE);
  assert.deepEqual(await repoA.friendIdentity(ana.id), id); // stable
  const card = { name: 'Ben', avatar: 'fox', games: 4, wins: 2, answered: 40, correct: 30, cats: { science: [10, 9] } };
  await assert.rejects(repoA.saveFriend(ana.id, { code: id.code, card }), /your own code/);
  await assert.rejects(repoA.saveFriend(ana.id, { code: 'nope', card }), /not valid/);
  const r1 = await repoA.saveFriend(ana.id, { code: 'k7qd4mxp', card });
  assert.equal(r1.added, true);
  const r2 = await repoA.saveFriend(ana.id, { code: 'K7QD-4MXP', card: { ...card, wins: 3 } });
  assert.equal(r2.added, false);
  const list = await repoA.listFriends(ana.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].card.wins, 3);
  assert.equal(list[0].name, 'Ben');
  // export -> import on another device keeps friends and my own code
  const data = JSON.parse(JSON.stringify(await repoA.exportData()));
  const repoB = await createRepo(createMemoryStorage());
  await repoB.importData(data, { mode: 'merge' });
  const back = (await repoB.listProfiles())[0];
  assert.equal(metaOf(back).friends.length, 1);
  assert.equal(back.friendCode, id.code);
  assert.equal(back.friendSecret, id.secret);
  // merging two devices unions the lists
  const merged = mergeMeta({ friends: [{ code: 'AAAA-BBBB', name: 'X', card: null, fetchedAt: 1 }] }, back, false);
  assert.equal(merged.friends.length, 2);
  // remove
  assert.equal((await repoA.removeFriend(ana.id, 'K7QD-4MXP')).length, 0);
});

test('PHP relay: publish a card, look it up, nobody else can overwrite it', { skip: !hasPhp }, async () => {
  const s = await startPhp();
  try {
    const repoA = await createRepo(createMemoryStorage());
    const ana = await repoA.createProfile({ name: 'Ana', avatar: { key: 'owl' } });
    const cloudA = createCloud({ repo: repoA, base: s.base });
    const { code, card } = await cloudA.publishFriendCard(ana.id);
    assert.match(code, FRIEND_CODE_RE);
    assert.equal(card.name, 'Ana');
    const repoB = await createRepo(createMemoryStorage());
    const ben = await repoB.createProfile({ name: 'Ben' });
    const cloudB = createCloud({ repo: repoB, base: s.base });
    const got = await cloudB.lookupFriend(code.toLowerCase().replace('-', ''));
    assert.equal(got.card.name, 'Ana');
    await repoB.saveFriend(ben.id, { code: got.code, card: got.card });
    assert.equal((await repoB.listFriends(ben.id))[0].name, 'Ana');
    await assert.rejects(cloudB.lookupFriend('ZZZZ-ZZZZ'), /nobody has that/);
    await assert.rejects(cloudB.lookupFriend('bad'), /not valid/);
    // somebody who knows the code but not the secret cannot replace the card
    const res = await fetch(`${s.base}?p=${encodeURIComponent('/api/friend')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, secret: 'x'.repeat(24), card: { name: 'Mallory' } }) });
    assert.equal(res.status, 403);
    assert.equal((await cloudB.lookupFriend(code)).card.name, 'Ana');
    // the owner can update it, and the server cleans what it stores
    const res2 = await fetch(`${s.base}?p=${encodeURIComponent('/api/friend')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, secret: (await repoA.friendIdentity(ana.id)).secret, card: { name: '<i>Ana</i>', wins: -4, games: 5, cats: { science: [3, 99] }, junk: 'x' } }) });
    assert.equal(res2.status, 200);
    const again = (await cloudB.lookupFriend(code)).card;
    assert.equal(again.wins, 0); assert.equal(again.games, 5); assert.deepEqual(again.cats.science, [3, 3]); assert.equal('junk' in again, false); assert.ok(!again.name.includes('<'));
  } finally { s.stop(); }
});
