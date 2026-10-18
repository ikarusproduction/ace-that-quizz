import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, makeContext, levelFor, variantFor, getStakeOptions } from '../src/engine/game.js';
import { levelOfDifficulty } from '../src/engine/bank.js';
import { realBank, must } from './helpers.js';

async function setup(seenCounts = {}, seed = 'v1') {
  const bank = await realBank();
  let t = 1_700_000_000_000;
  const ctx = makeContext([...bank.questions, ...bank.variants], () => (t += 1000));
  const s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed, sessionId: `s-${seed}`, seenCounts });
  return { bank, ctx, s };
}

test('levelOfDifficulty maps the four difficulties onto three levels', () => {
  assert.deepEqual([1, 2, 3, 4].map(levelOfDifficulty), [1, 2, 3, 3]);
});

test('every question in the main pool has all three levels, with labels', async () => {
  const { bank, ctx } = await setup();
  for (const q of bank.questions) {
    if (!q.family) continue; // news, tunes: no ladder
    const fam = ctx.families.get(q.family);
    assert.ok(fam?.[1] && fam?.[2] && fam?.[3], `${q.id} lacks a level`);
    for (const l of [1, 2, 3]) assert.ok(fam[l].ask && fam[l].ask.length <= 28, `${q.id} level ${l} label`);
  }
  assert.ok(bank.variants.length > 1000);
});

test('only primary questions are drawn into rounds; variants stay in byId', async () => {
  const { bank, ctx } = await setup();
  assert.equal(ctx.questions.length, bank.questions.length);
  assert.ok(ctx.questions.every((q) => !q.id.includes('~')));
  assert.ok(ctx.byId.has(bank.variants[0].id));
});

test('stake maps to level, and a question already seen in solo goes one level up', async () => {
  const { bank, ctx, s } = await setup();
  const q = bank.questions.find((x) => x.family);
  assert.equal(levelFor(s, q, 1), 1);
  assert.equal(levelFor(s, q, 2), 2);
  assert.equal(levelFor(s, q, 3), 3);
  const seen = { ...s, seenCounts: { [q.family]: 2 } };
  assert.equal(levelFor(seen, q, 1), 2);
  assert.equal(levelFor(seen, q, 3), 3, 'capped at 3');
  assert.equal(variantFor(s, ctx, q, 3).level, 3);
});

test('confirming a stake swaps in the variant for that level and keeps answering consistent', async () => {
  for (const stake of [1, 2, 3]) {
    const { ctx, s } = await setup({}, `sw${stake}`);
    let t = must(dispatch(s, { type: 'START_ROUND' }, ctx));
    if (t.phase !== 'stake') continue;
    const opts = getStakeOptions(t, ctx, 'p1');
    const want = opts.find((o) => o.stake === stake);
    if (!want) continue;
    t = must(dispatch(t, { type: 'CONFIRM_STAKE', playerId: 'p1', stake }, ctx));
    const asked = ctx.byId.get(t.q.questionId);
    assert.equal(asked.level, stake);
    assert.equal(t.q.order.length, asked.choices.length);
    assert.ok(t.q.order.includes(asked.answer));
    const choice = t.q.order.indexOf(asked.answer);
    t = must(dispatch(t, { type: 'ANSWER', playerId: 'p1', choice, elapsedMs: 2000 }, ctx));
    assert.equal(t.log.at(-1).correct ?? true, true);
  }
});
