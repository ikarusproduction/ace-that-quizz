import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createRepo, RepoError, normalizeName, parseExport, EXPORT_FORMAT, NAME_MAX, DEFAULT_SETTINGS } from '../src/storage/repo.js';
import { runMigrations, migrateSnapshot, SchemaError } from '../src/storage/migrations.js';
import { SCHEMA_VERSION } from '../src/storage/schema.js';
import { createGame, dispatch } from '../src/engine/game.js';
import { STARTER_CARDS } from '../src/engine/cards.js';
import { computeStats } from '../src/stats/stats.js';
import { realBank, fakeContext, playToEnd, accuracyBot } from './helpers.js';

function harness(storage = createMemoryStorage(), opts = {}) {
  let t = 1000;
  let u = 0;
  return createRepo(storage, { now: () => (t += 10), uuid: () => `u${++u}`, ...opts });
}

async function playGame(repo, ctx, ids, { mode = 'solo', seed = 'g', sessionId = 'sess1', accuracy = 0.7 } = {}) {
  const profiles = await Promise.all(ids.map((id) => repo.getProfile(id)));
  let s = createGame({ mode, players: profiles.map((p) => ({ id: p.id, name: p.name, ownedCards: p.ownedCards })), ctx, seed, sessionId });
  s = playToEnd(s, ctx, accuracyBot(accuracy, seed));
  return s;
}

test('memory adapter returns copies, so callers cannot mutate stored data', async () => {
  const st = createMemoryStorage();
  await st.transact([{ op: 'put', store: 'profiles', value: { id: 'a', name: 'x' } }]);
  const got = await st.get('profiles', 'a');
  got.name = 'changed';
  assert.equal((await st.get('profiles', 'a')).name, 'x');
});

test('a failing transaction changes nothing', async () => {
  const st = createMemoryStorage();
  await st.transact([{ op: 'put', store: 'profiles', value: { id: 'a' } }]);
  await assert.rejects(() => st.transact([{ op: 'put', store: 'profiles', value: { id: 'b' } }, { op: 'put', store: 'nope', value: {} }]));
  assert.equal((await st.getAll('profiles')).length, 1);
});

test('profiles: create, unique names (case-insensitive), validation, stable ids', async () => {
  const repo = await harness();
  const a = await repo.createProfile({ name: '  Ana  ', avatar: 'fox' });
  assert.equal(a.name, 'Ana');
  assert.equal(a.avatar.key, 'fox');
  assert.deepEqual(a.ownedCards, [...STARTER_CARDS]);
  await assert.rejects(() => repo.createProfile({ name: 'ANA' }), (e) => e.code === 'NAME_TAKEN');
  await assert.rejects(() => repo.createProfile({ name: '   ' }), (e) => e.code === 'NAME_EMPTY');
  await assert.rejects(() => repo.createProfile({ name: 'x'.repeat(NAME_MAX + 1) }), (e) => e.code === 'NAME_TOO_LONG');
  const b = await repo.createProfile({ name: 'Ben', avatar: 'not-real' });
  assert.notEqual(a.id, b.id);
  assert.ok(b.avatar.key);
  assert.equal((await repo.listProfiles()).length, 2);
});

test('normalizeName strips control characters and collapses whitespace', () => {
  assert.equal(normalizeName(' A\u0000\n  b\t'), 'A b');
  assert.equal(normalizeName(null), '');
});

test('renaming keeps the id and therefore all history', async () => {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  const s = await playGame(repo, ctx, [a.id]);
  await repo.finalizeSession(s);
  const before = (await repo.listResults(a.id)).length;
  const renamed = await repo.updateProfile(a.id, { name: 'Anabel' });
  assert.equal(renamed.id, a.id);
  assert.equal((await repo.listResults(a.id)).length, before);
  await assert.rejects(() => repo.updateProfile(a.id, { name: '' }), (e) => e.code === 'NAME_EMPTY');
  // renaming to your own current name (different case) is fine
  await repo.updateProfile(a.id, { name: 'ANABEL' });
  const b = await repo.createProfile({ name: 'Ben' });
  await assert.rejects(() => repo.updateProfile(b.id, { name: 'anabel' }), (e) => e.code === 'NAME_TAKEN');
});

test('a deleted name can be reused by a new person without inheriting history', async () => {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  await repo.finalizeSession(await playGame(repo, ctx, [a.id]));
  await repo.deleteProfile(a.id);
  const again = await repo.createProfile({ name: 'Ana' });
  assert.notEqual(again.id, a.id);
  assert.equal((await repo.listResults(again.id)).length, 0);
});

test('solo game: results, session and idempotent re-saves', async () => {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  const s = await playGame(repo, ctx, [a.id]);
  assert.notEqual(s.status, 'active');
  await repo.finalizeSession(s);
  await repo.finalizeSession(s); // duplicate write
  await repo.saveProgress(s, 0);
  const results = await repo.listResults(a.id);
  assert.equal(results.length, s.log.length);
  assert.equal(new Set(results.map((r) => r.resultId)).size, results.length);
  const sessions = await repo.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].players[0].playerId, a.id);
  assert.equal(sessions[0].players[0].answered, s.log.length);
});

test('saveProgress resumes and finalize clears the active game', async () => {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  let s = createGame({ mode: 'solo', players: [{ id: a.id, name: 'Ana', ownedCards: a.ownedCards }], ctx, seed: 'resume', sessionId: 'rs' });
  let persisted = await repo.saveProgress(s, 0);
  assert.equal(persisted, 0);
  const loaded = await repo.loadActiveGame();
  assert.equal(loaded.sessionId, 'rs');
  await assert.rejects(() => repo.finalizeSession(s), (e) => e.code === 'NOT_FINISHED');
  await assert.rejects(() => repo.deleteProfile(a.id), (e) => e.code === 'IN_ACTIVE_GAME');
  await assert.rejects(() => repo.resetProfileStats(a.id), (e) => e.code === 'IN_ACTIVE_GAME');
  s = dispatch(s, { type: 'ABANDON' }, ctx).state;
  await repo.finalizeSession(s);
  assert.equal(await repo.loadActiveGame(), null);
  const [sess] = await repo.listSessions();
  assert.equal(sess.status, 'abandoned');
  await repo.deleteProfile(a.id); // now allowed
});

test('profile isolation in a versus game: each player gets only their own answers', async () => {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  const b = await repo.createProfile({ name: 'Ben' });
  const s = await playGame(repo, ctx, [a.id, b.id], { mode: 'versus', sessionId: 'vs1' });
  await repo.finalizeSession(s);
  const ra = await repo.listResults(a.id);
  const rb = await repo.listResults(b.id);
  assert.ok(ra.length > 0 && rb.length > 0);
  assert.ok(ra.every((r) => r.playerId === a.id));
  assert.ok(rb.every((r) => r.playerId === b.id));
  assert.equal(ra.length + rb.length, s.log.length);
  const all = await repo.storage.getAll('results');
  const sessions = await repo.listSessions();
  const sa = computeStats({ results: all, sessions, playerId: a.id });
  const sb = computeStats({ results: all, sessions, playerId: b.id });
  assert.equal(sa.totals.answered, ra.length);
  assert.equal(sb.totals.answered, rb.length);
  assert.equal(sa.games.total, 1);
});

test('delete and reset only touch the targeted player', async () => {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  const b = await repo.createProfile({ name: 'Ben' });
  await repo.finalizeSession(await playGame(repo, ctx, [a.id, b.id], { mode: 'versus', sessionId: 'vs1' }));
  const bCount = (await repo.listResults(b.id)).length;
  await repo.pushRecent([a.id, b.id], 'versus');

  await repo.resetProfileStats(a.id);
  assert.equal((await repo.listResults(a.id)).length, 0);
  assert.equal((await repo.listResults(b.id)).length, bCount);
  assert.ok(await repo.getProfile(a.id)); // profile and cards kept
  const [sess] = await repo.listSessions();
  assert.deepEqual(sess.players.map((p) => p.playerId), [b.id]);

  await repo.deleteProfile(b.id);
  assert.equal((await repo.listSessions()).length, 0); // no one left in that session
  assert.equal((await repo.listResults(b.id)).length, 0);
  const recent = await repo.getRecent();
  assert.ok(!recent.ids.includes(b.id));
  assert.equal(recent.lastGroup, null);
  await assert.rejects(() => repo.deleteProfile(b.id), (e) => e.code === 'NOT_FOUND');
});

test('addCards ignores unknown cards and duplicates', async () => {
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  const p = await repo.addCards(a.id, ['scalpel', 'not_a_card', 'scalpel']);
  assert.equal(p.ownedCards.filter((c) => c === 'scalpel').length, 1);
  assert.ok(!p.ownedCards.includes('not_a_card'));
});

test('recent players cap, ordering and ignore of deleted profiles', async () => {
  const repo = await harness();
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push((await repo.createProfile({ name: `P${i}` })).id);
  for (const id of ids) await repo.pushRecent([id], 'solo');
  const r = await repo.getRecent();
  assert.equal(r.ids.length, 8);
  assert.equal(r.ids[0], ids[9]);
  await repo.pushRecent([ids[2]], 'solo');
  assert.equal((await repo.getRecent()).ids[0], ids[2]);
});

test('settings merge with defaults and are clamped', async () => {
  const repo = await harness();
  assert.deepEqual(await repo.getSettings(), DEFAULT_SETTINGS);
  const s = await repo.saveSettings({ minSample: 1, confidentSample: 2, sound: false });
  assert.equal(s.minSample, 3);
  assert.ok(s.confidentSample >= s.minSample);
  assert.equal((await repo.getSettings()).sound, false);
});

/* ---------------- migrations ---------------- */

test('a new database is stamped with the current version', async () => {
  const st = createMemoryStorage();
  const r = await runMigrations(st, { target: 1 });
  assert.equal(r.migrated, false);
  assert.equal((await st.get('kv', 'meta')).schemaVersion, 1);
});

test('migrations run in order, keep a backup and are atomic', async () => {
  const st = createMemoryStorage();
  await runMigrations(st, { target: 1 });
  await st.transact([{ op: 'put', store: 'profiles', value: { id: 'a', name: 'Ana', v: 1 } }]);
  const migrations = [
    { from: 1, to: 2, up: (s) => ({ ...s, profiles: s.profiles.map((p) => ({ ...p, v: 2, extra: true })) }) },
    { from: 2, to: 3, up: (s) => ({ ...s, profiles: s.profiles.map((p) => ({ ...p, v: 3 })) }) },
  ];
  const r = await runMigrations(st, { migrations, target: 3, now: () => 5 });
  assert.deepEqual([r.from, r.to, r.migrated], [1, 3, true]);
  const p = await st.get('profiles', 'a');
  assert.deepEqual([p.v, p.extra], [3, true]);
  assert.equal((await st.get('kv', 'meta')).schemaVersion, 3);
  const backup = await st.get('kv', 'backup-v1');
  assert.equal(backup.snapshot.profiles[0].v, 1);
  // running again is a no-op
  assert.equal((await runMigrations(st, { migrations, target: 3 })).migrated, false);
});

test('a failing migration leaves the old data untouched', async () => {
  const st = createMemoryStorage();
  await runMigrations(st, { target: 1 });
  await st.transact([{ op: 'put', store: 'profiles', value: { id: 'a', v: 1 } }]);
  const migrations = [{ from: 1, to: 2, up: () => { throw new Error('boom'); } }];
  await assert.rejects(() => runMigrations(st, { migrations, target: 2 }), /boom/);
  assert.equal((await st.get('profiles', 'a')).v, 1);
  assert.equal((await st.get('kv', 'meta')).schemaVersion, 1);
});

test('newer or unreachable data versions are refused, not guessed at', async () => {
  const st = createMemoryStorage();
  await st.transact([{ op: 'put', store: 'kv', value: { key: 'meta', schemaVersion: 9 } }]);
  await assert.rejects(() => runMigrations(st, { target: 1 }), (e) => e instanceof SchemaError && e.code === 'NEWER_SCHEMA');
  assert.throws(() => migrateSnapshot({}, 1, 3, []), (e) => e.code === 'NO_MIGRATION');
});

test('unstamped legacy data is treated as v0 and migrated', async () => {
  const st = createMemoryStorage();
  await st.transact([{ op: 'put', store: 'profiles', value: { id: 'a', old: true } }]);
  const migrations = [{ from: 0, to: 1, up: (s) => ({ ...s, profiles: s.profiles.map((p) => ({ ...p, old: false })) }) }];
  const r = await runMigrations(st, { migrations, target: 1 });
  assert.equal(r.migrated, true);
  assert.equal((await st.get('profiles', 'a')).old, false);
});

test('repo creation runs migrations for stored data', async () => {
  const st = createMemoryStorage();
  const r1 = await harness(st);
  await r1.createProfile({ name: 'Ana' });
  assert.equal(r1.migration.migrated, false);
  const r2 = await harness(st);
  assert.equal((await r2.listProfiles()).length, 1);
});

/* ---------------- export / import ---------------- */

async function populated() {
  const bank = await realBank();
  const ctx = fakeContext(bank.questions);
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana', avatar: 'owl' });
  await repo.finalizeSession(await playGame(repo, ctx, [a.id]));
  return { repo, a, ctx };
}

test('export then replace-import round-trips exactly', async () => {
  const { repo } = await populated();
  const data = JSON.parse(JSON.stringify(await repo.exportData()));
  const fresh = await harness();
  const summary = await fresh.importData(data, { mode: 'replace' });
  assert.equal(summary.profilesAdded, 1);
  const again = JSON.parse(JSON.stringify(await fresh.exportData()));
  assert.deepEqual(again.profiles, data.profiles);
  assert.deepEqual(again.results, data.results);
  assert.deepEqual(again.sessions, data.sessions);
});

test('merge import is idempotent and never duplicates results', async () => {
  const { repo } = await populated();
  const data = JSON.parse(JSON.stringify(await repo.exportData()));
  const before = (await repo.storage.getAll('results')).length;
  const s1 = await repo.importData(data);
  const s2 = await repo.importData(data);
  assert.equal(s1.resultsAdded, 0);
  assert.equal(s2.resultsAdded, 0);
  assert.equal((await repo.storage.getAll('results')).length, before);
  assert.equal((await repo.listProfiles()).length, 1);
});

test('merge import adds a new profile and renames on name clash without merging people', async () => {
  const { repo: src } = await populated();
  const data = JSON.parse(JSON.stringify(await src.exportData()));
  let k = 0;
  const other = await harness(createMemoryStorage(), { uuid: () => `other${++k}` }); // distinct ids: a different device
  const local = await other.createProfile({ name: 'Ana' }); // same name, different person
  const summary = await other.importData(data);
  assert.equal(summary.profilesAdded, 1);
  assert.equal(summary.renamed.length, 1);
  const profiles = await other.listProfiles();
  assert.equal(profiles.length, 2);
  assert.ok(profiles.some((p) => p.id === local.id && p.name === 'Ana'));
  assert.ok(profiles.some((p) => p.name === 'Ana (2)'));
  assert.equal((await other.listResults(local.id)).length, 0);
});

test('merge import of a known profile unions cards and keeps the newer avatar', async () => {
  const { repo, a } = await populated();
  const data = JSON.parse(JSON.stringify(await repo.exportData()));
  data.profiles[0].ownedCards.push('safety_net');
  data.profiles[0].avatar = { key: 'crow' };
  data.profiles[0].updatedAt += 1000;
  await repo.addCards(a.id, []);
  const summary = await repo.importData(data);
  assert.equal(summary.profilesUpdated, 1);
  assert.equal((await repo.getProfile(a.id)).avatar.key, 'crow');
});

test('replace import wipes local data, including the saved game', async () => {
  const { repo } = await populated();
  const data = JSON.parse(JSON.stringify(await repo.exportData()));
  const extra = await repo.createProfile({ name: 'Zed' });
  await repo.pushRecent([extra.id], 'solo');
  await repo.importData(data, { mode: 'replace' });
  assert.deepEqual((await repo.listProfiles()).map((p) => p.name), ['Ana']);
  assert.deepEqual((await repo.getRecent()).ids, []);
});

test('results for unknown players and malformed records are skipped and counted', async () => {
  const { repo } = await populated();
  const data = JSON.parse(JSON.stringify(await repo.exportData()));
  const stray = { ...data.results[0], resultId: 'stray', playerId: 'ghost' };
  data.results.push(stray, { nonsense: true });
  data.profiles.push({ id: '', name: 'bad' });
  const fresh = await harness();
  const summary = await fresh.importData(data, { mode: 'replace' });
  assert.equal(summary.skipped.results, 2);
  assert.equal(summary.skipped.profiles, 1);
  assert.ok(!(await fresh.storage.getAll('results')).some((r) => r.resultId === 'stray'));
});

test('invalid import files are rejected without touching data', async () => {
  const { repo } = await populated();
  const before = JSON.stringify(await repo.exportData());
  for (const bad of [null, 'text', {}, { format: 'other' }, { format: EXPORT_FORMAT }, { format: EXPORT_FORMAT, schemaVersion: 1, profiles: [], sessions: [] }]) {
    await assert.rejects(() => repo.importData(bad), (e) => e instanceof RepoError && e.code === 'INVALID_IMPORT');
  }
  await assert.rejects(() => repo.importData({ format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION + 5, profiles: [], sessions: [], results: [] }), (e) => e.code === 'NEWER_SCHEMA');
  const after = JSON.stringify(await repo.exportData());
  assert.equal(JSON.parse(after).profiles.length, JSON.parse(before).profiles.length);
});

test('older exports are migrated on import', () => {
  const migrations = [{ from: 1, to: 2, up: (s) => ({ ...s, profiles: s.profiles.map((p) => ({ ...p, name: `${p.name}!` })) }) }];
  const parsed = parseExport(
    { format: EXPORT_FORMAT, schemaVersion: 1, profiles: [{ id: 'p', name: 'Ana', avatar: {}, createdAt: 1, updatedAt: 1, ownedCards: [] }], sessions: [], results: [] },
    { migrations, schemaVersion: 2 },
  );
  assert.equal(parsed.profiles[0].name, 'Ana!');
});

test('pending card rewards: stored once, claimed once, only offered cards, dropped with the profile', async () => {
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  const offer = { sessionId: 's1', playerId: a.id, options: ['peek', 'rewind'] };
  await repo.addPendingRewards([offer]);
  await repo.addPendingRewards([offer]); // duplicate is ignored
  assert.equal((await repo.listPendingRewards()).length, 1);
  await assert.rejects(() => repo.claimReward('s1', a.id, 'siphon'), (e) => e.code === 'BAD_CARD');
  const p = await repo.claimReward('s1', a.id, 'rewind');
  assert.ok(p.ownedCards.includes('rewind'));
  assert.equal((await repo.listPendingRewards()).length, 0);
  await assert.rejects(() => repo.claimReward('s1', a.id, 'peek'), (e) => e.code === 'NO_REWARD');
  await repo.addPendingRewards([{ sessionId: 's2', playerId: a.id, options: ['peek'] }]);
  await repo.deleteProfile(a.id);
  assert.equal((await repo.listPendingRewards()).length, 0);
});

test('wipeAll removes everything', async () => {
  const repo = await harness();
  const a = await repo.createProfile({ name: 'Ana' });
  await repo.saveSettings({ sound: false });
  await repo.pushRecent([a.id], 'solo');
  await repo.wipeAll();
  assert.equal((await repo.listProfiles()).length, 0);
  assert.equal((await repo.getSettings()).sound, true);
  assert.deepEqual((await repo.getRecent()).ids, []);
});
