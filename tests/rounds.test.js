import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/engine/rng.js';
import { buildRound, roundInfo } from '../src/engine/rounds.js';
import { buildConfig } from '../src/engine/game.js';
import { statCategory } from '../src/engine/bank.js';
import { ACT_BOSSES } from '../src/engine/modifiers.js';
import { realBank } from './helpers.js';

const config = buildConfig('solo');

function build(questions, seed, roundIndex, extra = {}) {
  return buildRound({
    questions,
    rng: Rng.fromSeed(seed),
    roundIndex,
    config,
    usedIds: new Set(),
    usedBosses: [],
    previousHazard: null,
    ...extra,
  });
}

test('round layout: 9 rounds in 3 acts, boss last in each act', () => {
  assert.deepEqual(roundInfo(0, config), { act: 0, inAct: 0, isBoss: false, totalRounds: 9 });
  assert.equal(roundInfo(2, config).isBoss, true);
  assert.equal(roundInfo(3, config).act, 1);
  assert.equal(roundInfo(5, config).isBoss, true);
  assert.equal(roundInfo(8, config).isBoss, true);
  assert.equal(roundInfo(8, config).act, 2);
});

test('every round has exactly five distinct questions in the required structure', async () => {
  const { questions } = await realBank();
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (let i = 0; i < 300; i++) {
    const round = build(questions, `seed-${i}`, i % 9);
    assert.equal(round.slots.length, 5, 'exactly five questions');
    assert.equal(new Set(round.slots.map((s) => s.questionId)).size, 5, 'no repeated question');
    const cats = round.slots.map((s) => statCategory(byId.get(s.questionId)));
    const science = cats.filter((c) => c === 'science' || c === 'phobia');
    assert.equal(science.length, 1, 'one science-family question');
    assert.equal(cats.filter((c) => c === 'symbols').length, 1, 'one symbols question');
    assert.equal(round.slots.filter((s) => byId.get(s.questionId).subcategory === 'music').length, 1, 'one music/tune question');
    const rotating = cats.filter((c) => ['news', 'history', 'geography', 'nature'].includes(c));
    // Two more slots: from news/history/geography/nature, or a non-music arts question.
    const otherArts = round.slots.filter((s) => {
      const q = byId.get(s.questionId);
      return q.category === 'arts' && q.subcategory !== 'music';
    });
    assert.equal(rotating.length + otherArts.length, 2);
    assert.equal(new Set([...rotating, ...otherArts.map(() => 'arts')]).size, rotating.length + otherArts.length, 'rotating categories are distinct');
  }
});

test('slot order is shuffled and slot numbers follow presentation order', async () => {
  const { questions } = await realBank();
  const firstSlotCats = new Set();
  for (let i = 0; i < 60; i++) {
    const round = build(questions, `order-${i}`, 0);
    assert.deepEqual(round.slots.map((s) => s.slot), [0, 1, 2, 3, 4]);
    firstSlotCats.add(round.slots[0].category);
  }
  assert.ok(firstSlotCats.size >= 3, 'the first question varies');
});

test('phobia questions show up as the science slot sometimes, but never alongside science', async () => {
  const { questions } = await realBank();
  let phobias = 0;
  for (let i = 0; i < 200; i++) {
    const round = build(questions, `ph-${i}`, 0);
    if (round.slots.some((s) => s.category === 'phobia')) phobias++;
  }
  assert.ok(phobias > 30 && phobias < 120, `phobia rounds: ${phobias}`);
});

test('the very first round has no hazard, later normal rounds always have one', async () => {
  const { questions } = await realBank();
  assert.equal(build(questions, 'h0', 0).hazardId, 'none');
  for (let i = 0; i < 40; i++) {
    const r = build(questions, `h-${i}`, 1, { previousHazard: 'short_fuse' });
    assert.notEqual(r.hazardId, 'none');
    assert.notEqual(r.hazardId, 'short_fuse', 'never the same hazard twice in a row');
  }
});

test('boss rounds carry a boss from the right act and no hazard', async () => {
  const { questions } = await realBank();
  for (let act = 0; act < 3; act++) {
    const r = build(questions, `boss-${act}`, act * 3 + 2);
    assert.equal(r.isBoss, true);
    assert.ok(ACT_BOSSES[act].includes(r.bossId));
    assert.equal(r.hazardId, 'none');
  }
});

test('bosses are not repeated within a run when alternatives exist', async () => {
  const { questions } = await realBank();
  const r = build(questions, 'x', 5, { usedBosses: ['examiner', 'all_in', 'blackout'] });
  assert.equal(r.bossId, 'gauntlet');
});

test('the Examiner only targets Hard and Expert difficulty', async () => {
  const { questions } = await realBank();
  let seen = 0;
  for (let i = 0; i < 200 && seen < 5; i++) {
    const r = build(questions, `ex-${i}`, 5);
    if (r.bossId !== 'examiner') continue;
    seen++;
    assert.ok(r.slots.every((s) => s.difficulty >= 3));
  }
  assert.ok(seen > 0);
});

test('difficulty rises with the act', async () => {
  const { questions } = await realBank();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const avg = (act) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 80; i++) {
      const r = build(questions, `d-${act}-${i}`, act * 3);
      for (const s of r.slots) {
        sum += s.difficulty;
        n++;
      }
    }
    return sum / n;
  };
  const [a1, a2, a3] = [avg(0), avg(1), avg(2)];
  assert.ok(a1 < a2 && a2 < a3, `${a1} < ${a2} < ${a3}`);
  assert.ok(byId.size > 0);
});

test('used questions are avoided, recently seen ones are avoided when possible', async () => {
  const { questions } = await realBank();
  const first = build(questions, 'u', 0);
  const used = new Set(first.slots.map((s) => s.questionId));
  const second = build(questions, 'u2', 0, { usedIds: used });
  assert.ok(second.slots.every((s) => !used.has(s.questionId)));
  const avoid = new Set(questions.filter((q) => q.category === 'nature').slice(0, 20).map((q) => q.id));
  for (let i = 0; i < 50; i++) {
    const r = build(questions, `av-${i}`, 0, { avoidIds: avoid });
    const nat = r.slots.filter((s) => s.category === 'nature');
    for (const s of nat) assert.ok(!avoid.has(s.questionId));
  }
});

test('the same seed always builds the same round', async () => {
  const { questions } = await realBank();
  assert.deepEqual(build(questions, 'same', 4), build(questions, 'same', 4));
  assert.notDeepEqual(build(questions, 'same', 4), build(questions, 'other', 4));
});

test('a bank with an empty category fails loudly rather than producing a broken round', () => {
  assert.throws(() => build([], 'empty', 0), /no questions|empty/i);
});
