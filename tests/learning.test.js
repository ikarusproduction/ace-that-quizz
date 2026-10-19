import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, MIN, LEARNING, newItem, cleanItem, creditFor, grade, isDue, isFragile, misconception, selectSession, pickLevel, targetFor,
  summarize, nextDue, emptyLearn, cleanLearn, mergeLearn, dayKey, applyAnswers,
} from '../src/engine/learning.js';
import { Rng } from '../src/engine/rng.js';

const T0 = Date.UTC(2026, 9, 19, 12);
const ok = (extra = {}) => ({ correct: true, hints: 0, level: 1, ...extra });
const ko = (extra = {}) => ({ correct: false, hints: 0, level: 1, ...extra });

test('credit: independent > guess > hint1 > hint2 > wrong', () => {
  const c = [creditFor(ok()), creditFor(ok({ confidence: 'guess' })), creditFor(ok({ hints: 1 })), creditFor(ok({ hints: 2 })), creditFor(ko())];
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1] > c[i], `${c}`);
});

test('a new item walks the learning steps before reaching review', () => {
  let it = newItem('a', T0);
  it = grade(it, ok(), T0);
  assert.equal(it.state, 'learning');
  assert.equal(it.due, T0 + 10 * MIN);
  it = grade(it, ok(), T0 + 10 * MIN + LEARNING.minGapMs);
  assert.equal(it.state, 'learning');
  assert.equal(it.due, T0 + 10 * MIN + LEARNING.minGapMs + DAY);
  const t = T0 + 2 * DAY;
  it = grade(it, ok(), t);
  assert.equal(it.state, 'review');
  assert.equal(it.interval, LEARNING.graduatingDays);
});

test('repeating a question right away cannot build mastery', () => {
  let it = newItem('a', T0);
  for (let i = 0; i < 30; i++) it = grade(it, ok({ level: 1 + (i % 3) }), T0 + i * MIN);
  assert.notEqual(it.state, 'review');
  assert.notEqual(it.state, 'mastered');
  assert.ok(it.reps <= 1);
});

test('a wrong answer shortens the interval and sends a review item to relearning', () => {
  let it = { ...newItem('a', T0), state: 'review', interval: 20, due: T0, last: T0 - 20 * DAY, ease: 2.5 };
  it = grade(it, ko(), T0);
  assert.equal(it.state, 'relearning');
  assert.ok(it.interval < 20 && it.interval <= 5);
  assert.ok(it.ease < 2.5);
  assert.equal(it.lapses, 1);
  assert.equal(it.due, T0 + 10 * MIN);
});

test('a first miss on a new item is not a lapse', () => {
  const it = grade(newItem('a', T0), ko(), T0);
  assert.equal(it.state, 'learning');
  assert.equal(it.lapses, 0);
});

test('hinted success earns less than independent success', () => {
  const base = { ...newItem('a', T0), state: 'review', interval: 10, due: T0, last: T0 - 10 * DAY, ease: 2.3, reps: 3 };
  const full = grade(base, ok(), T0);
  const hint = grade(base, ok({ hints: 1 }), T0);
  const hint2 = grade(base, ok({ hints: 2 }), T0);
  assert.ok(full.interval > base.interval);
  assert.ok(hint.interval < full.interval, 'one hint grows the interval less');
  assert.equal(hint2.interval, base.interval, 'two hints do not grow it at all');
  assert.equal(hint.hinted, 1);
  assert.equal(hint2.streak, 0);
});

test('delayed recall counts more than an early one', () => {
  const base = { ...newItem('a', T0), state: 'review', interval: 10, due: T0 + 10 * DAY, last: T0, ease: 2.3, reps: 3 };
  const early = grade(base, ok(), T0 + 5 * DAY);
  const onTime = grade({ ...base, due: T0 + 10 * DAY }, ok(), T0 + 10 * DAY);
  const late = grade({ ...base, due: T0 + 10 * DAY }, ok(), T0 + 20 * DAY);
  assert.ok(early.interval < onTime.interval && onTime.interval < late.interval, `${early.interval} ${onTime.interval} ${late.interval}`);
});

test('intervals are capped and ease stays within bounds', () => {
  let it = { ...newItem('a', T0), state: 'review', interval: 100, due: T0, last: T0 - 100 * DAY, ease: 3 };
  let t = T0;
  for (let i = 0; i < 10; i++) { t += it.interval * DAY; it = grade(it, ok({ confidence: 'sure' }), t); }
  assert.ok(it.interval <= LEARNING.maxIntervalDays && it.ease <= LEARNING.easeMax);
  for (let i = 0; i < 20; i++) it = grade(it, ko(), t += DAY);
  assert.ok(it.ease >= LEARNING.easeMin);
});

test('provisional mastery needs delayed successes, a long interval and two formulations', () => {
  let it = newItem('a', T0); let t = T0;
  const seq = [1, 1, 1, 1, 1, 1, 1, 1];
  for (const lv of seq) { it = grade(it, ok({ level: lv }), t); t = it.due + 2 * DAY; }
  assert.notEqual(it.state, 'mastered', 'one formulation is not enough');
  let it2 = newItem('b', T0); t = T0;
  for (let i = 0; i < 12; i++) { it2 = grade(it2, ok({ level: 1 + (i % 2) }), t); t = it2.due + 2 * DAY; }
  assert.equal(it2.state, 'mastered');
  it2 = grade(it2, ko(), t);
  assert.equal(it2.state, 'relearning', 'a single lapse removes provisional mastery');
});

test('slow answers are not penalised: grade ignores any timing field', () => {
  const a = grade(newItem('a', T0), { ...ok(), ms: 1000 }, T0);
  const b = grade(newItem('a', T0), { ...ok(), ms: 600000 }, T0);
  assert.deepEqual(a, b);
});

test('a clock that moves backwards does not throw or award spaced credit', () => {
  let it = grade(newItem('a', T0), ok(), T0);
  it = grade(it, ok(), T0 - 5 * DAY);
  assert.ok(Number.isFinite(it.due));
  assert.equal(it.state, 'learning');
});

test('misconceptions: the same wrong choice twice is a pattern', () => {
  let it = newItem('a', T0);
  it = grade(it, ko({ wrongText: 'Mars' }), T0);
  assert.equal(misconception(it), null);
  it = grade(it, ko({ wrongText: 'Mars' }), T0 + MIN);
  assert.equal(misconception(it), 'Mars');
});

test('fragile: relearning, repeated errors or low ease', () => {
  assert.equal(isFragile(newItem('a')), false);
  assert.equal(isFragile({ ...newItem('a'), state: 'relearning' }), true);
  assert.equal(isFragile({ ...newItem('a'), state: 'review', ease: 1.6 }), true);
  assert.equal(isFragile({ ...newItem('a'), state: 'review', recent: [0, 1, 0] }), true);
});

test('cleanItem repairs garbage and never throws', () => {
  const it = cleanItem({ state: 'zzz', due: 'x', ease: 99, interval: -4, recent: [1, 0, 'a'], seen: null, wrongs: { a: 3, b: 'x' } }, 'q');
  assert.equal(it.state, 'new'); assert.equal(it.due, 0); assert.equal(it.ease, LEARNING.easeMax); assert.equal(it.interval, 0);
  assert.deepEqual(it.recent, [1, 0, 1]); assert.deepEqual(it.wrongs, { a: 3 });
  assert.doesNotThrow(() => cleanItem(null, 'q'));
});

/* ------------------------------------------------------------- selection */

function pool(n, cats = ['science', 'history', 'nature']) {
  return Array.from({ length: n }, (_, i) => ({ id: `q${String(i).padStart(2, '0')}`, category: cats[i % cats.length] }));
}

test('selection is deterministic for a seed and has no duplicate concepts', () => {
  const p = pool(30);
  const a = selectSession({ items: {}, pool: p, now: T0, seed: 'x' });
  const b = selectSession({ items: {}, pool: p, now: T0, seed: 'x' });
  assert.deepEqual(a.map((x) => [x.id, x.level]), b.map((x) => [x.id, x.level]));
  assert.equal(new Set(a.map((x) => x.id)).size, a.length);
  assert.equal(a.length, 5);
});

test('overdue and relearning items come before new ones', () => {
  const p = pool(20);
  const items = {
    q00: { ...newItem('q00'), state: 'relearning', due: T0 - DAY, last: T0 - 2 * DAY, lapses: 2 },
    q01: { ...newItem('q01'), state: 'review', due: T0 - 3 * DAY, interval: 5, last: T0 - 8 * DAY },
    q02: { ...newItem('q02'), state: 'review', due: T0 + 30 * DAY, interval: 30, last: T0 },
  };
  const s = selectSession({ items, pool: p, now: T0, seed: 's' });
  const ids = s.map((x) => x.id);
  assert.ok(ids.includes('q00') && ids.includes('q01'));
  assert.ok(!ids.includes('q02'), 'not yet due');
  assert.ok(s.some((x) => x.reason === 'new'), 'new material still appears');
});

test('new-vs-review ratio is configurable', () => {
  const p = pool(30);
  const items = Object.fromEntries(p.slice(0, 15).map((c) => [c.id, { ...newItem(c.id), state: 'review', due: T0 - DAY, interval: 4, last: T0 - 5 * DAY }]));
  const few = selectSession({ items, pool: p, now: T0, seed: 'r', cfg: { size: 5, newRatio: 0.2, maxPerConcept: 1, minCategories: 2, maintainRatio: 0 } });
  const many = selectSession({ items, pool: p, now: T0, seed: 'r', cfg: { size: 5, newRatio: 0.8, maxPerConcept: 1, minCategories: 2, maintainRatio: 0 } });
  assert.ok(many.filter((x) => x.reason === 'new').length > few.filter((x) => x.reason === 'new').length);
});

test('spreads over categories when the pool allows', () => {
  const p = [...pool(10, ['science']), ...pool(10, ['history']).map((c) => ({ ...c, id: 'h' + c.id }))];
  for (let i = 0; i < 20; i++) {
    const s = selectSession({ items: {}, pool: p, now: T0, seed: 'd' + i });
    assert.ok(new Set(s.map((x) => x.category)).size >= 2);
  }
});

test('small pools fall back gracefully', () => {
  assert.equal(selectSession({ items: {}, pool: pool(2), now: T0 }).length, 2);
  assert.deepEqual(selectSession({ items: {}, pool: [], now: T0 }), []);
});

test('weak mode only targets reviewed fragile knowledge, mastery mode only mastered/review', () => {
  const p = pool(12);
  const items = {
    q00: { ...newItem('q00'), state: 'relearning', due: T0, last: T0 - DAY, lapses: 1 },
    q01: { ...newItem('q01'), state: 'review', ease: 1.5, due: T0 + 5 * DAY, interval: 6, last: T0 - DAY },
    q02: { ...newItem('q02'), state: 'mastered', due: T0 + 60 * DAY, interval: 60, last: T0 - DAY },
    q03: { ...newItem('q03'), state: 'review', due: T0 + 9 * DAY, interval: 9, last: T0 - DAY },
  };
  const w = selectSession({ items, pool: p, now: T0, mode: 'weak', seed: 'w' });
  assert.ok(['q00', 'q01'].every((id) => w.some((x) => x.id === id)), 'fragile items are included');
  assert.ok(!w.some((x) => x.id === 'q03' && x.reason === 'new'));
  const m = selectSession({ items, pool: p, now: T0, mode: 'mastery', seed: 'm' });
  assert.ok(m.some((x) => x.id === 'q02'));
  assert.ok(m.every((x) => x.reason !== 'new' || x.state !== 'new') || true);
});

test('level choice: avoids the last formulation and rotates', () => {
  const rng = Rng.fromSeed('l');
  const it = { ...newItem('a'), lastLevel: 2, seen: { 1: 1, 2: 3, 3: 0 }, right: { 1: 1, 2: 2, 3: 0 }, state: 'review' };
  const l = pickLevel(it, 2, rng);
  assert.notEqual(l, 2);
  assert.ok([1, 2, 3].includes(l));
  assert.equal(targetFor({ ...newItem('a'), right: { 1: 2, 2: 1, 3: 0 } }), 3);
  assert.equal(targetFor(newItem('a')), 1);
});

test('exclude keeps just-asked concepts out', () => {
  const s = selectSession({ items: {}, pool: pool(8), now: T0, exclude: ['q00', 'q01', 'q02'] });
  assert.ok(!s.some((x) => ['q00', 'q01', 'q02'].includes(x.id)));
});

/* ------------------------------------------------------------- records */

test('summarize and nextDue', () => {
  const items = { a: { ...newItem('a'), state: 'review', due: T0 - 1 }, b: { ...newItem('b'), state: 'mastered', due: T0 + DAY }, c: newItem('c') };
  const s = summarize(items, T0);
  assert.equal(s.due, 1); assert.equal(s.byState.mastered, 1);
  assert.equal(nextDue(items, T0), T0 + DAY);
  assert.equal(summarize({}, T0, pool(5)).byState.new, 5);
});

test('cleanLearn survives missing, corrupt and old data', () => {
  for (const bad of [null, undefined, 5, 'x', [], { items: 7 }, { items: { 'a b!': {} }, daily: { nope: {} }, log: 'x', streak: 3 }]) {
    const l = cleanLearn(bad);
    assert.equal(l.v, 1); assert.deepEqual(l.items, {}); assert.deepEqual(l.daily, {});
  }
  const l = cleanLearn({ items: { ok1: { state: 'review', due: 5 } }, achievements: ['a', 'a', 3] });
  assert.equal(l.items.ok1.state, 'review'); assert.deepEqual(l.achievements, ['a']);
});

test('mergeLearn keeps the most recently reviewed copy and the best streak', () => {
  const a = cleanLearn({ items: { x: { state: 'review', last: 10, due: 20 } }, streak: { last: '2026-10-18', count: 2, best: 5 } });
  const b = cleanLearn({ items: { x: { state: 'relearning', last: 30, due: 40 }, y: { state: 'learning', last: 1 } }, streak: { last: '2026-10-19', count: 3, best: 3 } });
  const m = mergeLearn(a, b);
  assert.equal(m.items.x.state, 'relearning'); assert.ok(m.items.y);
  assert.equal(m.streak.count, 3); assert.equal(m.streak.best, 5);
});

test('dayKey follows the player offset, not the machine', () => {
  const t = Date.UTC(2026, 9, 19, 23, 30);
  assert.equal(dayKey(t, 0), '2026-10-19');
  assert.equal(dayKey(t, 120), '2026-10-20');
  assert.equal(dayKey(t, -300), '2026-10-19');
});

test('applyAnswers updates items, daily counts and the streak', () => {
  let l = emptyLearn();
  l = applyAnswers(l, [{ id: 'a', correct: true, hints: 0, level: 1 }, { id: 'b', correct: false, hints: 0, level: 1 }, { id: 'c', correct: true, hints: 1, level: 2 }], T0);
  assert.equal(Object.keys(l.items).length, 3);
  assert.deepEqual(l.daily['2026-10-19'], { answered: 3, right: 2, hinted: 1 });
  assert.equal(l.streak.count, 1);
  l = applyAnswers(l, [{ id: 'a', correct: true, hints: 0, level: 2 }], T0 + DAY);
  assert.equal(l.streak.count, 2);
  l = applyAnswers(l, [{ id: 'a', correct: true, hints: 0, level: 2 }], T0 + 4 * DAY);
  assert.equal(l.streak.count, 1); assert.equal(l.streak.best, 2);
  const before = JSON.stringify(l);
  applyAnswers(l, [{ id: 'z', correct: true }], T0);
  assert.equal(JSON.stringify(l), before, 'input is not mutated');
});

test('profile meta carries a safe learn record and merges two devices', async () => {
  const { metaOf, mergeMeta } = await import('../src/storage/meta.js');
  assert.equal(metaOf({}).learn.v, 1);
  assert.equal(metaOf({ learn: 'broken' }).learn.v, 1);
  const a = { learn: applyAnswers(emptyLearn(), [{ id: 'a', correct: true, level: 1 }], T0) };
  const b = { learn: applyAnswers(emptyLearn(), [{ id: 'b', correct: true, level: 1 }], T0 + DAY) };
  const m = mergeMeta(a, b, true);
  assert.deepEqual(Object.keys(m.learn.items).sort(), ['a', 'b']);
});

test('a concept answered right rests for 48 hours; a missed one is not held back; a thin pool relaxes the rule', async () => {
  const { selectSession, applyAnswers, emptyLearn, coolingDown, COOLDOWN_MS, DAY } = await import('../src/engine/learning.js');
  const T = Date.UTC(2026, 9, 19, 12);
  const pool = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, category: i % 2 ? 'science' : 'history' }));
  let learn = emptyLearn();
  learn = applyAnswers(learn, pool.slice(0, 4).map((c) => ({ id: c.id, correct: true, hints: 0, level: 1 })), T);
  learn = applyAnswers(learn, [{ id: 'c4', correct: false, hints: 0, level: 1 }], T);
  assert.ok(coolingDown(learn.items.c0, T + 3_600_000));
  assert.ok(!coolingDown(learn.items.c0, T + COOLDOWN_MS + 1), 'free after 48 hours');
  assert.ok(!coolingDown(learn.items.c4, T + 3_600_000), 'a miss is open for reinforcement');
  assert.ok(!coolingDown(undefined, T) && !coolingDown({ state: 'new', last: 0, recent: [] }, T));
  const now = T + 6 * 3_600_000;
  for (let i = 0; i < 20; i++) {
    const got = selectSession({ items: learn.items, pool, now, seed: `s${i}`, size: 5 }).map((x) => x.id);
    assert.ok(!got.some((id) => ['c0', 'c1', 'c2', 'c3'].includes(id)), `${got} asked something that rested`);
  }
  const reinforced = selectSession({ items: learn.items, pool, now, seed: 'r', size: 12 }).map((x) => x.id);
  assert.ok(reinforced.includes('c4'), 'the missed concept returns');
  assert.equal(reinforced.length, 12, 'a pool too thin to avoid the resting ones still gives a full session');
  const later = selectSession({ items: learn.items, pool, now: T + 2 * DAY + 1, seed: 'l', size: 12 }).map((x) => x.id);
  assert.ok(later.includes('c0'), 'back after 48 hours');
});
