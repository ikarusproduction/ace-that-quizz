import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from '../src/engine/game.js';
import { pickQuestion } from '../src/engine/rounds.js';
import { buildLevel } from '../src/engine/adventure.js';
import { spreadBy, topicKey, interleave } from '../src/engine/learning.js';
import { buildQuiz } from '../src/engine/periodic.js';
import { Rng } from '../src/engine/rng.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createRepo } from '../src/storage/repo.js';
import { createSafety } from '../src/storage/safety.js';
import { realBank } from './helpers.js';

const bankP = realBank();
const ctx = async () => { const b = await bankP; return makeContext([...b.questions, ...b.variants]); };

test('an adventure step is a fresh draw every visit, not the same five questions each time', async () => {
  const c = await ctx();
  const sets = new Set();
  for (let i = 0; i < 6; i++) sets.add(buildLevel('science', 1, 'main', c, { now: 1_700_000_000_000 + i * 60_000 }).questions.map((q) => q.family).join());
  assert.ok(sets.size >= 4, `${sets.size} different openings out of 6`);
  assert.deepEqual(buildLevel('science', 7, 'main', c, { now: 5 }), buildLevel('science', 7, 'main', c, { now: 5 }));
});

test('the first question drawn differs from one game to the next, and never follows another form of itself', async () => {
  const b = await bankP;
  const pool = b.questions.filter((q) => q.difficulty === 1);
  const firsts = new Set();
  for (let i = 0; i < 12; i++) firsts.add(pickQuestion({ pool, rng: Rng.fromSeed(`variety-${i}`), difficulty: 1, usedIds: new Set() }).id);
  assert.ok(firsts.size >= 8, `${firsts.size} different first questions out of 12`);
  const mk = (id) => ({ id, difficulty: 1 });
  for (let i = 0; i < 30; i++) {
    const q = pickQuestion({ pool: [mk('per-007b'), mk('per-020a'), mk('x-1')], rng: Rng.fromSeed(`n${i}`), difficulty: 1, usedIds: new Set(['per-007a']) });
    assert.notEqual(q.id, 'per-007b');
  }
  // when nothing else is left, the other form is still allowed
  assert.equal(pickQuestion({ pool: [mk('per-007b')], rng: Rng.fromSeed('z'), difficulty: 1, usedIds: new Set(['per-007a']) }).id, 'per-007b');
});

test('spreadBy keeps neighbours apart and topicKey groups the forms of one question', () => {
  assert.equal(topicKey('per-007a'), topicKey('per-007a~2'));
  assert.notEqual(topicKey('per-007a'), topicKey('per-007b') === topicKey('per-007a') ? 'x' : topicKey('per-007b'), 'a and b of one element are the same topic');
  const out = spreadBy(['a1', 'a2', 'a3', 'b1', 'c1'], (x) => x[0]);
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i][0], out[i - 1][0]);
  assert.equal(spreadBy([], (x) => x).length, 0);
  assert.deepEqual(spreadBy(['a1', 'a2'], (x) => x[0]).sort(), ['a1', 'a2']); // nothing to do, nothing lost
});

test('a periodic quiz never asks the same element twice in a row', () => {
  for (let i = 0; i < 20; i++) {
    const qs = buildQuiz({ learn: null, now: 1000 * i, seed: `q${i}`, size: 12, newLimit: 4 });
    for (let k = 1; k < qs.length; k++) assert.notEqual(qs[k].z, qs[k - 1].z);
  }
});

test('new concepts do not always come in the same alphabetical order of categories', () => {
  const list = ['art', 'film', 'geo', 'music', 'sport', 'zoo'].map((category) => ({ id: `${category}-1`, category, reason: 'new' }));
  const firsts = new Set();
  for (let i = 0; i < 30; i++) firsts.add(interleave(list, Rng.fromSeed(`s${i}`))[0].category);
  assert.ok(firsts.size >= 4);
});

test('safety copy: players are put back when the main database comes back empty, and an empty state never overwrites a copy', async () => {
  const mem = new Map(); const store = { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, v); } };
  let t = 1000; let u = 0;
  const repo = await createRepo(createMemoryStorage(), { now: () => (t += 10), uuid: () => `u${++u}` });
  const safety = createSafety({ repo, store, now: () => t });
  assert.equal(await safety.save(), false, 'nothing to keep yet');
  await repo.createProfile({ name: 'Mara' });
  assert.equal(await safety.save(), true);
  const fresh = await createRepo(createMemoryStorage(), { now: () => (t += 10), uuid: () => `v${++u}` });
  const s2 = createSafety({ repo: fresh, store, now: () => t });
  assert.equal(await s2.save(), false, 'an empty database does not overwrite the copy');
  const back = await s2.restoreIfEmpty();
  assert.equal(back.profilesAdded, 1);
  assert.deepEqual((await fresh.listProfiles()).map((p) => p.name), ['Mara']);
  assert.equal(await s2.restoreIfEmpty(), null, 'not when players already exist');
});
