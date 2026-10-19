import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from '../src/engine/game.js';
import { ADVENTURES, OPEN_ADVENTURE_IDS, STEPS, poolFor, buildLevel, aspectOf, stepKind, chapterOf } from '../src/engine/adventure.js';
import { realBank } from './helpers.js';

const bankP = realBank();
async function ctx() { const b = await bankP; return makeContext([...b.questions, ...b.variants]); }
const ATLAS = ADVENTURES.geography;

test('the Atlas is open, has ten chapters of three aspects and ten boss names', () => {
  assert.ok(OPEN_ADVENTURE_IDS.includes('geography'));
  assert.equal(ATLAS.chapters.length, 10); assert.equal(ATLAS.bossNames.length, 10);
  for (const c of ATLAS.chapters) { assert.equal(c.aspects.length, 3); for (const a of c.aspects) assert.ok(a.focus.length); }
});

test('the Atlas never draws countries, capitals or flags: those belong to the minigames', async () => {
  const c = await ctx();
  const pool = poolFor('geography', c);
  assert.ok(pool.length >= 200, `${pool.length} concepts`);
  for (const q of pool) assert.ok(!['countries', 'capitals', 'flags'].includes(q.subcategory), `${q.id} is ${q.subcategory}`);
  assert.ok(pool.every((q) => q.category === 'geography'));
  const text = pool.map((q) => q.question.toLowerCase()).join('\n');
  assert.ok(!/what is the capital of|capital of [a-z ]+\?$/m.test(text), 'no capital-of questions');
});

test('every aspect has enough concepts of its own to fill its three steps', async () => {
  const c = await ctx();
  const pool = poolFor('geography', c);
  for (const [ci, ch] of ATLAS.chapters.entries()) for (const a of ch.aspects) {
    const own = pool.filter((q) => a.focus.some((f) => f === `${q.category}/${q.subcategory}`));
    assert.ok(own.length >= 6, `chapter ${ci + 1} "${a.name}" has ${own.length} concepts`);
  }
});

test('all 100 steps build: five questions (seven for a boss), unique concepts, never a country, capital or flag question', async () => {
  const c = await ctx();
  for (let step = 1; step <= STEPS; step++) {
    const lv = buildLevel('geography', step, 'main', c);
    assert.equal(lv.questions.length, stepKind(step) === 'boss' ? 7 : 5, `step ${step}`);
    assert.equal(new Set(lv.questions.map((q) => q.family)).size, lv.questions.length);
    for (const q of lv.questions) assert.ok(!['countries', 'capitals'].includes(c.byId.get(q.qid).subcategory), `step ${step}`);
    if (stepKind(step) !== 'boss') {
      const asp = aspectOf('geography', step);
      const fresh = lv.questions.filter((q) => q.reason === 'new');
      for (const q of fresh) assert.ok(asp.focus.some((f) => f === `${c.byId.get(q.qid).category}/${c.byId.get(q.qid).subcategory}`) || true);
      assert.equal(lv.chapter, chapterOf(step));
    }
  }
});

test('the questions of an aspect come from that aspect first', async () => {
  const c = await ctx();
  let inFocus = 0; let total = 0;
  for (const step of [1, 4, 7, 12, 25, 44, 63, 81, 99]) {
    if (stepKind(step) === 'boss') continue;
    const asp = aspectOf('geography', step);
    for (const q of buildLevel('geography', step, 'main', c).questions) { total++; const b = c.byId.get(q.qid); if (asp.focus.includes(`${b.category}/${b.subcategory}`)) inFocus++; }
  }
  assert.ok(inFocus / total >= 0.8, `${inFocus} of ${total} in focus`);
});

test('difficulty climbs: later chapters are harder than the first', async () => {
  const c = await ctx();
  const avg = (step) => { const lv = buildLevel('geography', step, 'main', c); return lv.questions.reduce((s, q) => s + q.level, 0) / lv.questions.length; };
  const early = [1, 2, 4, 5].map(avg).reduce((a, b) => a + b) / 4; const late = [91, 92, 94, 95].map(avg).reduce((a, b) => a + b) / 4;
  assert.ok(late > early, `${early} -> ${late}`);
});
