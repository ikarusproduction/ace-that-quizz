import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from '../src/engine/game.js';
import {
  ADVENTURE_IDS, STEPS, stepKind, roadsAt, levelForStep, buildLevel, startRun, answerRun, advanceRun, currentItem,
  cleanProgress, frontier, isUnlocked, xpForStep, packForStep, poolFor,
} from '../src/engine/adventure.js';
import { metaOf, mergeMeta } from '../src/storage/meta.js';
import { realBank } from './helpers.js';

async function ctx() {
  const bank = await realBank();
  return makeContext([...bank.questions, ...bank.variants]);
}

test('steps: a boss every tenth, forks at the third and sixth', () => {
  assert.equal(stepKind(10), 'boss'); assert.equal(stepKind(100), 'boss');
  assert.equal(stepKind(3), 'fork'); assert.equal(stepKind(16), 'fork'); assert.equal(stepKind(4), 'single');
  assert.equal(roadsAt(3).length, 2); assert.equal(roadsAt(4).length, 1); assert.equal(roadsAt(10)[0].id, 'boss');
});

test('difficulty climbs with the step and the risky road is one level harder', () => {
  assert.deepEqual([1, 30, 31, 65, 66, 99].map((s) => levelForStep(s)), [1, 1, 2, 2, 3, 3]);
  assert.equal(levelForStep(5, 'risk'), 2);
  assert.equal(levelForStep(90, 'risk'), 3);
});

test('every adventure has enough questions with full ladders and builds all 100 steps', async () => {
  const c = await ctx();
  for (const adv of ADVENTURE_IDS) {
    assert.ok(poolFor(adv, c).length >= 25, `${adv} pool`);
    for (let step = 1; step <= STEPS; step++) for (const r of roadsAt(step)) {
      const lv = buildLevel(adv, step, r.id, c);
      assert.equal(lv.questions.length, lv.kind === 'boss' ? 7 : 5);
      assert.equal(new Set(lv.questions.map((id) => c.byId.get(id).family)).size, lv.questions.length, 'no repeat inside a step');
      for (const id of lv.questions) assert.equal(c.byId.get(id).level, lv.level);
      assert.equal(lv.learn.length, lv.kind === 'boss' ? 0 : 3);
    }
  }
});

test('levels are deterministic', async () => {
  const c = await ctx();
  assert.deepEqual(buildLevel('history', 7, 'main', c), buildLevel('history', 7, 'main', c));
  assert.notDeepEqual(buildLevel('history', 3, 'safe', c).questions, buildLevel('history', 3, 'risk', c).questions);
});

function play(run, c, pattern) {
  let r = run; let i = 0;
  while (r.status === 'play') {
    const it = currentItem(r); const q = c.byId.get(it.qid);
    const right = pattern(i++);
    const d = right ? it.order.indexOf(q.answer) : it.order.findIndex((o) => o !== q.answer);
    r = advanceRun(answerRun(r, d, c));
  }
  return r;
}

test('a perfect run wins with three stars', async () => {
  const c = await ctx();
  const r = play(startRun(buildLevel('science', 1, 'main', c), c), c, () => true);
  assert.equal(r.status, 'won'); assert.equal(r.stars, 3); assert.equal(r.hearts, 3);
});

test('a wrong answer costs a heart and the question comes back once', async () => {
  const c = await ctx();
  const r = play(startRun(buildLevel('science', 1, 'main', c), c), c, (i) => i !== 0);
  assert.equal(r.status, 'won'); assert.equal(r.hearts, 2); assert.equal(r.stars, 2); assert.equal(r.queue.length, 6);
});

test('three misses lose the lesson; a boss has no second chances', async () => {
  const c = await ctx();
  const lost = play(startRun(buildLevel('science', 1, 'main', c), c), c, () => false);
  assert.equal(lost.status, 'lost');
  const boss = startRun(buildLevel('science', 10, 'boss', c), c);
  const r = play(boss, c, (i) => i !== 2);
  assert.equal(r.queue.length, 7); assert.equal(r.status, 'won'); assert.equal(r.stars, 2);
});

test('progress unlocks in order and cleaning drops junk', () => {
  const p = cleanProgress({ done: { 1: 3, 2: 2, 4: 1, 999: 3, x: 1, 5: 9 }, road: { 3: 'risk', 2: 'main' } });
  assert.deepEqual(Object.keys(p.done).map(Number), [1, 2, 4]);
  assert.equal(frontier(p), 3);
  assert.ok(isUnlocked(p, 3)); assert.ok(!isUnlocked(p, 4));
  assert.deepEqual(p.road, { 2: 'main' });
});

test('rewards: risky roads pay more, bosses pay a pack', () => {
  assert.ok(xpForStep(3, 'risk', 3) > xpForStep(3, 'safe', 3));
  assert.ok(xpForStep(10, 'boss', 1) > xpForStep(9, 'main', 3));
  assert.equal(packForStep(10), 'silver'); assert.equal(packForStep(100), 'gold'); assert.equal(packForStep(9), null);
});

test('profile meta keeps the best stars when merged', () => {
  const a = metaOf({ adv: { science: { done: { 1: 1, 2: 3 } } } });
  assert.equal(a.adv.science.done[2], 3);
  const m = mergeMeta({ adv: { science: { done: { 1: 1, 2: 3 } } } }, { adv: { science: { done: { 1: 3, 3: 2 } } } }, true);
  assert.deepEqual(m.adv.science.done, { 1: 3, 2: 3, 3: 2 });
});
