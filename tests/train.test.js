import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from '../src/engine/game.js';
import { MODES, buildTraining, buildExpedition, conceptsFor, isCurrent } from '../src/engine/train.js';
import { emptyLearn, applyAnswers, DAY } from '../src/engine/learning.js';
import { realBank } from './helpers.js';

const T0 = Date.UTC(2026, 9, 19, 12);
async function ctx() { const b = await realBank(); return makeContext([...b.questions, ...b.variants]); }
const ans = (id, level = 1, correct = true) => ({ id, correct, hints: 0, level });

test('conceptsFor: only full ladders, filters by category and drops expired items', async () => {
  const c = await ctx();
  const all = conceptsFor(c);
  assert.ok(all.length > 300);
  assert.ok(conceptsFor(c, { category: 'science' }).every((x) => x.category === 'science'));
  assert.ok(isCurrent({}, T0)); assert.ok(isCurrent({ expires: '2027-01-01' }, T0)); assert.ok(!isCurrent({ expires: '2026-01-01' }, T0));
});

test('daily training mixes new concepts with due reviews and asks each concept once', async () => {
  const c = await ctx();
  let learn = emptyLearn();
  const first = buildTraining('daily', c, learn, { now: T0, seed: 'a' });
  assert.equal(first.questions.length, MODES.daily.size);
  assert.equal(new Set(first.questions.map((q) => q.family)).size, first.questions.length);
  learn = applyAnswers(learn, first.questions.map((q) => ans(q.family, q.level, false)), T0);
  const later = buildTraining('daily', c, learn, { now: T0 + 2 * DAY, seed: 'b' });
  const reasons = later.questions.map((q) => q.reason);
  assert.ok(reasons.includes('relearn') || reasons.includes('due'), `${reasons}`);
  assert.ok(reasons.includes('new'));
  // a missed concept returns in another formulation
  const back = later.questions.find((q) => first.questions.some((f) => f.family === q.family));
  assert.ok(back);
  assert.notEqual(back.qid, first.questions.find((f) => f.family === back.family).qid);
});

test('focused training stays in the chosen subject', async () => {
  const c = await ctx();
  const r = buildTraining('focus', c, emptyLearn(), { now: T0, category: 'science', subcategory: 'space' });
  assert.ok(r.questions.length > 0);
  assert.ok(r.questions.every((q) => c.byId.get(q.qid).category === 'science' && c.byId.get(q.qid).subcategory === 'space'));
});

test('weakness hunter says so when nothing is weak, then targets what was missed', async () => {
  const c = await ctx();
  assert.equal(buildTraining('weak', c, emptyLearn(), { now: T0 }).questions.length, 0);
  assert.match(buildTraining('weak', c, emptyLearn(), { now: T0 }).notice, /Nothing is weak/);
  const ids = conceptsFor(c).slice(0, 12).map((x) => x.id);
  let learn = applyAnswers(emptyLearn(), ids.map((id) => ans(id, 1, false)), T0);
  const r = buildTraining('weak', c, learn, { now: T0 + 1000, seed: 'w' });
  assert.ok(r.questions.length >= 3 && r.questions.every((q) => ids.includes(q.family)));
});

test('mastery challenge needs established concepts and asks the hardest formulation without certifying', async () => {
  const c = await ctx();
  assert.equal(buildTraining('mastery', c, emptyLearn(), { now: T0 }).questions.length, 0);
  const ids = conceptsFor(c).slice(0, 20).map((x) => x.id);
  let learn = emptyLearn(); let t = T0;
  for (let i = 0; i < 4; i++) { learn = applyAnswers(learn, ids.map((id) => ans(id, 1)), t); t += 4 * DAY; }
  const r = buildTraining('mastery', c, learn, { now: t });
  assert.ok(r.questions.length >= 6);
  assert.ok(r.questions.every((q) => q.level >= 2));
  assert.ok(Object.values(learn.items).every((it) => it.state !== 'mastered'), 'level-1 successes alone never certify mastery');
});

test('expedition: review, new, contrast and a boss with hexes; encounters share no concept except the boss', async () => {
  const c = await ctx();
  const ids = conceptsFor(c).slice(0, 15).map((x) => x.id);
  const learn = applyAnswers(emptyLearn(), ids.map((id) => ans(id, 1, false)), T0);
  const e = buildExpedition(c, learn, { now: T0 + DAY, seed: 'x' });
  assert.deepEqual(e.encounters.map((x) => x.kind), ['review', 'new', 'contrast', 'boss']);
  const [r, n, k, b] = e.encounters;
  assert.ok(r.questions.every((q) => ids.includes(q.family)));
  assert.ok(n.questions.every((q) => !ids.includes(q.family)));
  const fams = [r, n, k].flatMap((x) => x.questions.map((q) => q.family));
  assert.equal(new Set(fams).size, fams.length);
  assert.equal(b.questions.length, 7); assert.equal(b.hexes.length, 7); assert.ok(b.boss.sprite);
  assert.ok(b.hexes.flat().length >= 4);
});

test('thin banks fall back instead of failing', async () => {
  const tiny = makeContext([]);
  assert.deepEqual(buildTraining('daily', tiny, emptyLearn(), { now: T0 }).questions, []);
  assert.equal(buildExpedition(tiny, emptyLearn(), { now: T0 }).encounters.length, 0);
});
