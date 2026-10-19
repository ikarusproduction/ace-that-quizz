import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from '../src/engine/game.js';
import {
  ADVENTURE_IDS, STEPS, stepKind, roadsAt, levelForStep, buildLevel, startRun,
  cleanProgress, frontier, isUnlocked, xpForStep, packForStep, poolFor, OPEN_ADVENTURE_IDS, ADVENTURES, aspectOf, stakeBonusOf,
} from '../src/engine/adventure.js';
import { useHint, hintsLeft, setConfidence, answerRun, advanceRun, currentItem, setStake, stakesAvailable } from '../src/engine/practice.js';
import { emptyLearn, applyAnswers } from '../src/engine/learning.js';
import { HEXES } from '../src/engine/hexes.js';
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
  assert.deepEqual([1, 30, 31, 70, 71, 99].map((s) => levelForStep(s)), [1, 1, 2, 2, 3, 3]);
  assert.equal(levelForStep(5, 'risk'), 2);
  assert.equal(levelForStep(90, 'risk'), 3);
});

test('steps: a boss every tenth, a lab accident every fifth, forks at the third and sixth', () => {
  assert.equal(stepKind(5), 'event'); assert.equal(stepKind(15), 'event'); assert.equal(stepKind(100), 'boss');
});

test('only the Science adventure is open for now', () => {
  assert.deepEqual(OPEN_ADVENTURE_IDS, ['science', 'history', 'geography']);
});

test('every adventure has enough questions with full ladders; Science builds all 100 steps with no lesson cards', async () => {
  const c = await ctx();
  for (const adv of ADVENTURE_IDS) assert.ok(poolFor(adv, c).length >= 25, `${adv} pool`);
  assert.ok(poolFor('science', c).length >= 80, 'Science draws on many subjects');
  for (let step = 1; step <= STEPS; step++) for (const r of roadsAt(step)) {
    const lv = buildLevel('science', step, r.id, c);
    assert.equal(lv.questions.length, lv.kind === 'boss' ? 7 : 5);
    assert.equal(new Set(lv.questions.map((x) => x.family)).size, lv.questions.length, 'no repeated concept inside a step');
    assert.equal(lv.learn, undefined, 'no learn cards any more');
    assert.equal(lv.hexes.length, lv.questions.length);
    for (const x of lv.questions) { assert.ok(c.byId.get(x.qid)); assert.equal(c.byId.get(x.qid).family, x.family); assert.equal(c.byId.get(x.qid).level, x.level); }
  }
});

test('levels are deterministic and a new attempt asks something fresh', async () => {
  const c = await ctx();
  assert.deepEqual(buildLevel('science', 7, 'main', c), buildLevel('science', 7, 'main', c));
  assert.notDeepEqual(buildLevel('science', 3, 'safe', c).questions, buildLevel('science', 3, 'risk', c).questions);
  assert.notDeepEqual(buildLevel('science', 7, 'main', c).questions.map((x) => x.family), buildLevel('science', 7, 'main', c, { attempt: 1 }).questions.map((x) => x.family));
});

test('the chapter focus supplies the new concepts and the previous step is excluded', async () => {
  const c = await ctx();
  const lv = buildLevel('science', 1, 'main', c);
  const subs = lv.questions.map((x) => c.byId.get(x.qid).subcategory);
  assert.equal(subs.filter((x) => x === 'states').length, 3, `${subs}`); // the aspect's own concepts come first
  assert.ok(subs.every((x) => ['states', 'atoms', 'reactions', 'element-symbol', 'periodic-table', 'chemistry'].includes(x)), `${subs}`); // the rest from the same chapter
  const next = buildLevel('science', 2, 'main', c, { exclude: lv.questions.map((x) => x.family) });
  assert.ok(next.questions.every((x) => !lv.questions.some((y) => y.family === x.family)));
});

test('over many steps concepts come back in a different formulation, not the same question', async () => {
  const c = await ctx();
  let learn = emptyLearn(); let now = Date.UTC(2026, 9, 19, 10);
  const asked = new Map(); let prev = [];
  for (let step = 1; step <= 40; step++) {
    const road = roadsAt(step)[0].id;
    const lv = buildLevel('science', step, road, c, { learn, now, exclude: prev });
    for (const x of lv.questions) { if (!asked.has(x.family)) asked.set(x.family, []); asked.get(x.family).push({ qid: x.qid, step }); }
    learn = applyAnswers(learn, lv.questions.map((x) => ({ id: x.family, correct: true, hints: 0, level: x.level })), now);
    prev = lv.questions.map((x) => x.family);
    now += 3 * 3600_000; // three hours per step
  }
  assert.ok(asked.size >= 80, `variety: ${asked.size} concepts in 40 steps`);
  // the very same question never returns within ten steps
  for (const [fam, list] of asked) for (let i = 1; i < list.length; i++) {
    if (list[i].qid === list[i - 1].qid) assert.ok(list[i].step - list[i - 1].step >= 10, `${fam} repeated too soon`);
  }
});

test('bosses throw more, nastier hexes as the fight goes on; nothing is thrown at the first question', async () => {
  const c = await ctx();
  const lv = buildLevel('science', 60, 'boss', c);
  assert.deepEqual(lv.hexes[0], []);
  const counts = lv.hexes.map((l) => l.length);
  assert.ok(counts.at(-1) >= counts[1], `${counts}`);
  assert.ok(counts.at(-1) >= 2);
  assert.ok(lv.hexes.flat().every((id) => HEXES[id]?.fx?.length));
  const early = buildLevel('science', 10, 'boss', c).hexes.flat();
  assert.ok(!early.includes('flip_table'), 'no flipped table in the first chapter');
  const ev = buildLevel('science', 5, 'main', c);
  assert.equal(ev.kind, 'event'); assert.equal(ev.hexes.flat().length, 2);
  assert.equal(buildLevel('science', 4, 'main', c).hexes.flat().length, 0);
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

test('a perfect run wins with three stars and records every answer for the learning engine', async () => {
  const c = await ctx();
  const r = play(startRun(buildLevel('science', 1, 'main', c), c), c, () => true);
  assert.equal(r.status, 'won'); assert.equal(r.stars, 3); assert.equal(r.hearts, 3);
  assert.equal(r.answers.length, 5); assert.ok(r.answers.every((a) => a.correct && a.hints === 0 && a.id && a.level));
});

test('a wrong answer costs a heart and the concept comes back once in another formulation', async () => {
  const c = await ctx();
  const r = play(startRun(buildLevel('science', 1, 'main', c), c), c, (i) => i !== 0);
  assert.equal(r.status, 'won'); assert.equal(r.hearts, 2); assert.equal(r.stars, 2); assert.equal(r.queue.length, 6);
  const [first, retry] = [r.queue[0], r.queue[5]];
  assert.equal(retry.family, first.family); assert.notEqual(retry.level, first.level); assert.notEqual(retry.qid, first.qid);
  assert.equal(r.answers[0].wrongText.length > 0, true);
});

test('three misses lose the lesson; a boss has no second chances and no hints', async () => {
  const c = await ctx();
  const lost = play(startRun(buildLevel('science', 1, 'main', c), c), c, () => false);
  assert.equal(lost.status, 'lost');
  const boss = startRun(buildLevel('science', 10, 'boss', c), c);
  assert.equal(useHint(boss, c), boss);
  const r = play(boss, c, (i) => i !== 2);
  assert.equal(r.queue.length, 7); assert.equal(r.status, 'won'); assert.equal(r.stars, 2);
});

test('hints remove wrong answers, are recorded, and a removed answer cannot be picked', async () => {
  const c = await ctx();
  let r = startRun(buildLevel('science', 1, 'main', c), c);
  r = useHint(r, c); r = useHint(r, c);
  const it = currentItem(r); const q = c.byId.get(it.qid);
  assert.equal(it.hints, 2); assert.equal(it.elim.length, 2); assert.ok(!it.elim.includes(q.answer));
  assert.equal(hintsLeft(r, c), 0);
  assert.equal(useHint(r, c), r);
  const elimDisplay = it.order.indexOf(it.elim[0]);
  assert.equal(answerRun(r, elimDisplay, c), r);
  r = setConfidence(r, 'guess');
  r = answerRun(r, it.order.indexOf(q.answer), c);
  assert.deepEqual([r.answers[0].hints, r.answers[0].confidence, r.answers[0].correct], [2, 'guess', true]);
  assert.equal(r.hearts, 3);
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

test('each chapter is a subject with three aspects, and a step draws its new concepts from its own aspect', async () => {
  const c = await ctx();
  const ch = ADVENTURES.science.chapters;
  assert.equal(ch.length, 10);
  assert.ok(ch.every((x) => x.subject && x.aspects.length === 3 && x.aspects.every((a) => a.name && a.focus.length)));
  assert.equal(aspectOf('science', 1).name, 'States of matter');
  assert.equal(aspectOf('science', 4).name, 'Atoms and elements');
  assert.equal(aspectOf('science', 8).name, 'Reactions');
  assert.equal(aspectOf('science', 10), null);
  // fresh player: step 4 is all atoms/elements, step 14 is cells, step 91 is relativity
  const subsOf = (step) => buildLevel('science', step, 'main', c).questions.map((x) => c.byId.get(x.qid).subcategory);
  assert.ok(subsOf(4).every((x) => ['atoms', 'element-symbol', 'periodic-table'].includes(x)), `${subsOf(4)}`);
  assert.ok(subsOf(4).includes('atoms'), `${subsOf(4)}`);
  assert.equal(subsOf(12).filter((x) => x === 'cells').length, 4, `${subsOf(12)}`);
  assert.equal(subsOf(91).filter((x) => x === 'relativity').length, 3, `${subsOf(91)}`);
});

test('the Science adventure has enough concepts for every aspect to fill a step', async () => {
  const c = await ctx();
  const pool = poolFor('science', c);
  for (const [i, chap] of ADVENTURES.science.chapters.entries()) for (const a of chap.aspects) {
    const n = pool.filter((q) => a.focus.some((f) => (f.includes('/') ? f === `${q.category}/${q.subcategory}` : f === q.category))).length;
    assert.ok(n >= 3, `chapter ${i + 1} ${a.name}: ${n} concepts`);
  }
});

test('stakes: the same concept at another level, bold gives up hints, and bold pays', async () => {
  const c = await ctx();
  const lv = buildLevel('science', 42, 'main', c);
  const fam0 = lv.questions[0].family; // force a standard level 2 question so all three stakes exist
  lv.questions[0] = { qid: c.families.get(fam0)[2].id, family: fam0, level: 2, reason: 'new' };
  let run = startRun(lv, c);
  const it0 = run.queue[0];
  assert.deepEqual(stakesAvailable(run, c), [-1, 0, 1]);
  run = setStake(run, 1, c);
  const it1 = run.queue[0];
  assert.equal(it1.family, it0.family); assert.equal(it1.level, Math.min(3, it0.base + 1)); assert.equal(hintsLeft(run, c), 0);
  run = setStake(run, -1, c);
  assert.equal(run.queue[0].level, it0.base - 1);
  assert.ok(hintsLeft(run, c) > 0);
  run = setStake(run, 1, c);
  const q = c.byId.get(run.queue[0].qid);
  run = answerRun(run, run.queue[0].order.indexOf(q.answer), c);
  assert.equal(run.points, 3); assert.equal(run.answers[0].stake, 1);
  // a hint locks the stake
  let r2 = startRun(lv, c); r2 = useHint(r2, c);
  assert.deepEqual(stakesAvailable(r2, c), [0]);
  // XP: bonus only above the standard 2 points a question, capped
  const r3 = { points: 15, queue: [1, 2, 3, 4, 5].map(() => ({ retry: false })) };
  assert.equal(stakeBonusOf(r3), 5);
  assert.equal(stakeBonusOf({ points: 5, queue: r3.queue }), 0);
  assert.equal(xpForStep(3, 'main', 3, 5), xpForStep(3, 'main', 3) + 5);
  assert.equal(xpForStep(3, 'main', 3, 99), xpForStep(3, 'main', 3) + 8);
});
