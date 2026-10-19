// Learning engine: spaced repetition and adaptive question selection. Pure functions only (no storage, no UI, no clock
// reads); everything that needs "now" takes it as an argument so it is testable and safe across time zones.
//
// CONCEPTS AND FORMULATIONS
//   A concept is a question family (see bank.js): the same knowledge asked at three levels of precision. The levels are
//   the different formulations. Knowing a concept means being able to retrieve it through more than one of them.
//
// THE SCHEDULER (a simplified SM-2 with learning steps, in the spirit of Anki)
//   state:  new -> learning -> review -> mastered(provisional), and relearning after a lapse.
//   An item keeps: due and last (epoch ms, UTC), interval (days), ease (1.3 to 3), reps (successful recalls that
//   counted), streak (consecutive successes), lapses, hint-assisted successes, recent errors, per-formulation counts,
//   and the wrong answers the player picks again and again (misconceptions).
//   Each answer is graded into `credit`, a number from 0 to 1:
//     independent recall 1, with a "guess" confidence 0.7, with one hint 0.55, with two hints 0.3, wrong 0.
//   * A wrong answer is a lapse: ease drops, the interval collapses, the item goes to relearning and returns within
//     minutes (and again the next day).
//   * Learning steps (minutes, then days) must be passed before an item reaches review, so repeating a question five
//     times in a row cannot "master" it: successes that come sooner than `minGapMs` after the last review do not count.
//   * In review, the next interval is interval * ease * credit-adjusted growth. A recall that is late (past due) is
//     stronger evidence than one that is early, so lateness (up to 2x) adds to the growth and earliness removes from it.
//   * Provisional mastery needs three delayed successes (reviews at least a day after the previous one), a 21-day
//     interval and two different formulations. A single lapse sends it back to relearning. It is never certified.
//   Speed is never used: a slow, careful answer earns the same credit as a fast one.
import { Rng } from './rng.js';

export const DAY = 86_400_000;
export const MIN = 60_000;

/** Every number you may want to tune. */
export const LEARNING = {
  learningSteps: [10 * MIN, 1 * DAY],       // after a first correct recall: come back in 10 minutes, then the next day
  relearningSteps: [10 * MIN, 1 * DAY],
  graduatingDays: 3,                        // the first review interval after the steps
  minGapMs: 4 * 60 * MIN,                   // a success sooner than this after the last review does not count as spaced
  easeStart: 2.3, easeMin: 1.3, easeMax: 3.0,
  easeLapse: 0.2, easeHard: 0.1, easeGood: 0.05,
  lapseIntervalFactor: 0.25,
  maxIntervalDays: 180,
  credit: { independent: 1, guess: 0.7, hint1: 0.55, hint2: 0.3 },
  lateBonusCap: 2,                          // how much extra growth a recall at 2x the interval can earn
  mastery: { delayedSuccesses: 3, intervalDays: 21, formulations: 2 },
  fragile: { lapses: 1, ease: 2.0, recentErrors: 2 },
  recentWindow: 5,
};

export const STATES = ['new', 'learning', 'relearning', 'review', 'mastered'];

export function newItem(id, now = 0) {
  return { id, state: 'new', due: now, last: 0, interval: 0, ease: LEARNING.easeStart, reps: 0, streak: 0, lapses: 0, step: 0, hinted: 0, delayed: 0, recent: [], seen: { 1: 0, 2: 0, 3: 0 }, right: { 1: 0, 2: 0, 3: 0 }, lastLevel: 0, wrongs: {}, first: now };
}

/** Clean one saved item. Anything odd falls back to a safe default; nothing throws. */
export function cleanItem(raw, id) {
  const n = (v, d = 0, lo = 0, hi = 1e15) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const lv = (o) => ({ 1: n(o?.[1], 0, 0, 1e6), 2: n(o?.[2], 0, 0, 1e6), 3: n(o?.[3], 0, 0, 1e6) });
  const wrongs = {};
  for (const [k, v] of Object.entries(raw?.wrongs ?? {}).slice(0, 6)) if (Number.isFinite(v) && v > 0) wrongs[String(k).slice(0, 60)] = Math.min(99, Math.floor(v));
  return {
    id,
    state: STATES.includes(raw?.state) ? raw.state : 'new',
    due: n(raw?.due), last: n(raw?.last), interval: n(raw?.interval, 0, 0, LEARNING.maxIntervalDays),
    ease: n(raw?.ease, LEARNING.easeStart, LEARNING.easeMin, LEARNING.easeMax),
    reps: Math.floor(n(raw?.reps, 0, 0, 1e6)), streak: Math.floor(n(raw?.streak, 0, 0, 1e6)), lapses: Math.floor(n(raw?.lapses, 0, 0, 1e6)),
    step: Math.floor(n(raw?.step, 0, 0, 9)), hinted: Math.floor(n(raw?.hinted, 0, 0, 1e6)), delayed: Math.floor(n(raw?.delayed, 0, 0, 1e6)),
    recent: (Array.isArray(raw?.recent) ? raw.recent : []).slice(-LEARNING.recentWindow).map((x) => (x ? 1 : 0)),
    seen: lv(raw?.seen), right: lv(raw?.right), lastLevel: [0, 1, 2, 3].includes(raw?.lastLevel) ? raw.lastLevel : 0, wrongs, first: n(raw?.first),
  };
}

/** How much credit an outcome deserves: 0 for wrong, up to 1 for independent recall. */
export function creditFor({ correct, hints = 0, confidence = null }, cfg = LEARNING) {
  if (!correct) return 0;
  if (hints >= 2) return cfg.credit.hint2;
  if (hints === 1) return cfg.credit.hint1;
  return confidence === 'guess' ? cfg.credit.guess : cfg.credit.independent;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Grade one answer. `outcome`: { correct, hints (0-2), confidence ('sure'|'maybe'|'guess'|null), level (1-3), wrongText }.
 * Returns a new item; the old one is untouched.
 */
export function grade(item, outcome, now, cfg = LEARNING) {
  const it = { ...item, seen: { ...item.seen }, right: { ...item.right }, recent: [...item.recent], wrongs: { ...item.wrongs } };
  const level = [1, 2, 3].includes(outcome.level) ? outcome.level : 0;
  if (level) it.seen[level]++;
  it.lastLevel = level || it.lastLevel;
  it.recent = [...it.recent, outcome.correct ? 1 : 0].slice(-cfg.recentWindow);
  const credit = creditFor(outcome, cfg);
  const gap = it.last ? Math.max(0, now - it.last) : Infinity; // a clock that went backwards counts as "no time passed"
  const spaced = gap >= cfg.minGapMs;
  it.last = now;
  if (!it.first) it.first = now;

  if (!outcome.correct) {
    const known = it.state === 'review' || it.state === 'mastered' || it.state === 'relearning'; // only forgetting something learned is a lapse
    it.lapses += known ? 1 : 0;
    it.streak = 0; it.step = 0;
    it.ease = clamp(it.ease - cfg.easeLapse, cfg.easeMin, cfg.easeMax);
    it.interval = it.state === 'review' || it.state === 'mastered' ? Math.max(0.25, it.interval * cfg.lapseIntervalFactor) : 0;
    it.state = known ? 'relearning' : 'learning';
    it.due = now + cfg.relearningSteps[0];
    if (outcome.wrongText) { const k = String(outcome.wrongText).slice(0, 60); it.wrongs[k] = (it.wrongs[k] ?? 0) + 1; }
    return it;
  }

  if (level) it.right[level]++;
  if (outcome.hints > 0) it.hinted++;
  // Only a recall with real credit moves the schedule forward. A hint-assisted one keeps the item where it is.
  if (credit < 0.5) { it.due = Math.min(it.due || now, now) + cfg.learningSteps[0]; it.streak = 0; return it; }
  // A success that comes too soon after the last one is fine practice but is not evidence of retention.
  if (!spaced && it.state !== 'new') { it.due = Math.max(it.due, now + cfg.learningSteps[0]); return it; }

  it.streak++; it.reps++;
  if (gap >= DAY && !(outcome.hints > 0)) it.delayed++; // only an unaided recall after a day's gap is evidence of retention
  const steps = it.state === 'relearning' ? cfg.relearningSteps : cfg.learningSteps;
  if (it.state === 'new' || it.state === 'learning' || it.state === 'relearning') {
    if (it.state === 'new') it.state = 'learning';
    if (it.step < steps.length) { it.due = now + steps[it.step]; it.interval = steps[it.step] / DAY; it.step++; return it; }
    it.state = 'review'; it.step = 0;
    it.interval = Math.max(it.interval, 0) > 0 ? Math.max(cfg.graduatingDays, it.interval) : cfg.graduatingDays;
    it.due = now + it.interval * DAY;
    return it;
  }
  // review / mastered: grow the interval. Late recalls grow it more, early ones less; low credit grows it less.
  const late = clamp((now - it.due) / Math.max(it.interval * DAY, DAY), -0.5, cfg.lateBonusCap - 1);
  const growth = it.ease * (0.85 + 0.15 * credit) * (1 + 0.5 * late) * (outcome.confidence === 'sure' ? 1.1 : 1);
  it.interval = clamp(Math.max(it.interval + 1, it.interval * Math.max(1.1, growth)), 1, cfg.maxIntervalDays);
  it.ease = clamp(it.ease + (credit >= 1 ? cfg.easeGood : -cfg.easeHard), cfg.easeMin, cfg.easeMax);
  it.due = now + it.interval * DAY;
  const formulations = [1, 2, 3].filter((l) => it.right[l] > 0).length;
  if (it.state === 'review' && it.delayed >= cfg.mastery.delayedSuccesses && it.interval >= cfg.mastery.intervalDays && formulations >= cfg.mastery.formulations) it.state = 'mastered';
  return it;
}

export const isDue = (item, now) => item.state !== 'new' && item.due <= now;
export const isFragile = (item, cfg = LEARNING) => item.state === 'relearning' || (item.state !== 'new' && item.recent.at(-1) === 0) || item.lapses >= cfg.fragile.lapses && item.state !== 'mastered' || item.ease < cfg.fragile.ease || item.recent.filter((x) => !x).length >= cfg.fragile.recentErrors;
/** The wrong answer the player keeps picking for a concept, if there is a pattern (picked twice or more). */
export const misconception = (item) => Object.entries(item.wrongs).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

/* ---------------------------------------------------------------- selection */

export const SESSION = {
  size: 5,
  newRatio: 0.4,            // share of new concepts when there are both new and due ones
  maxPerConcept: 1,         // a concept appears once per session (a miss may be re-asked by the runner)
  minCategories: 2,         // spread over at least this many categories when the pool allows it
  maintainRatio: 0.15,      // chance to slip in a mastered concept for maintenance
};

/**
 * Choose which concepts to ask and in which formulation.
 *   items:   { [familyId]: item }
 *   pool:    [{ id, category, subcategory }] the concepts allowed in this session (already filtered by mode)
 *   target:  1-3, the difficulty the session aims at; a formulation is chosen near it
 *   mode:    'daily' | 'focus' | 'weak' | 'mastery' | 'adventure'
 * Deterministic for a given seed. Falls back gracefully when the pool is small.
 */
export function selectSession({ items, pool, now, seed = 'seed', target = 1, mode = 'daily', size = SESSION.size, cfg = SESSION, exclude = [] }) {
  const rng = Rng.fromSeed(`${seed}:${mode}`);
  const ban = new Set(exclude);
  const cand = pool.filter((c) => !ban.has(c.id)).map((c) => ({ c, it: items[c.id] ?? newItem(c.id, now) }));
  const buckets = { relearn: [], due: [], fragile: [], fresh: [], maintain: [], rest: [] };
  for (const x of cand) {
    const { it } = x;
    if (it.state === 'new') buckets.fresh.push(x);
    else if (it.state === 'relearning') buckets.relearn.push(x);
    else if (isDue(it, now)) buckets.due.push(x);
    else if (isFragile(it)) buckets.fragile.push(x);
    else if (it.state === 'mastered') buckets.maintain.push(x);
    else buckets.rest.push(x);
  }
  const overdue = (x) => (now - x.it.due) / DAY + x.it.lapses * 0.5 + (x.it.ease < 2 ? 0.5 : 0);
  const byOverdue = (a, b) => overdue(b) - overdue(a) || (a.c.id < b.c.id ? -1 : 1);
  buckets.relearn.sort(byOverdue); buckets.due.sort(byOverdue);
  buckets.fragile.sort((a, b) => a.it.ease - b.it.ease || (a.c.id < b.c.id ? -1 : 1));
  buckets.fresh = rng.shuffle(buckets.fresh); buckets.maintain = rng.shuffle(buckets.maintain); buckets.rest = rng.shuffle(buckets.rest);

  const reviewFirst = mode === 'weak' ? [...buckets.relearn, ...buckets.fragile, ...buckets.due] : mode === 'mastery' ? [...buckets.maintain, ...buckets.due, ...buckets.rest] : [...buckets.relearn, ...buckets.due, ...buckets.fragile];
  const wantNew = mode === 'weak' || mode === 'mastery' ? 0 : reviewFirst.length === 0 ? size : Math.max(1, Math.round(size * cfg.newRatio));
  const picked = []; const used = new Set(); const perCat = new Map();
  const take = (x, reason) => { if (used.has(x.c.id)) return false; used.add(x.c.id); picked.push({ id: x.c.id, category: x.c.category, subcategory: x.c.subcategory ?? null, reason, state: x.it.state, it: x.it }); perCat.set(x.c.category, (perCat.get(x.c.category) ?? 0) + 1); return true; };
  const fill = (list, limit, reason) => { for (const x of list) { if (picked.length >= limit) break; take(x, reason); } };
  // 1. reviews, 2. new concepts, 3. anything left, in that order of value
  const reviewSlots = size - wantNew;
  for (const x of reviewFirst) { if (picked.length >= reviewSlots) break; take(x, buckets.relearn.includes(x) ? 'relearn' : buckets.due.includes(x) ? 'due' : 'weak'); }
  fill(buckets.fresh, Math.min(size, picked.length + wantNew), 'new');
  if (rng.next() < cfg.maintainRatio && buckets.maintain.length && picked.length < size) take(buckets.maintain[0], 'maintain');
  fill(buckets.fresh, size, 'new');
  fill([...buckets.fragile, ...buckets.due, ...buckets.relearn], size, 'weak');
  fill(buckets.rest, size, 'practice');
  fill(buckets.maintain, size, 'maintain');

  // Diversity: if too many share one category and another exists, swap the surplus for something from elsewhere.
  const cats = new Set(pool.map((c) => c.category));
  if (cats.size >= cfg.minCategories && picked.length >= 3 && new Set(picked.map((p) => p.category)).size < cfg.minCategories) {
    const other = cand.find((x) => !used.has(x.c.id) && x.c.category !== picked[0].category);
    if (other) { used.delete(picked[picked.length - 1].id); picked.pop(); take(other, other.it.state === 'new' ? 'new' : 'practice'); }
  }
  return interleave(picked, rng).map((p) => ({ ...p, level: pickLevel(p.it, target, rng) }));
}

/** New concepts come in pairs of the same category (guided practice); reviews are spread so neighbours differ. */
export function interleave(list, rng) {
  const fresh = list.filter((p) => p.reason === 'new').sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const rest = rng.shuffle(list.filter((p) => p.reason !== 'new'));
  const out = []; let f = 0; let r = 0;
  while (f < fresh.length || r < rest.length) {
    if (r < rest.length) {
      let k = r; while (k < rest.length && out.length && rest[k].category === out.at(-1).category && rest.slice(k + 1).some((x) => x.category !== out.at(-1).category)) k++;
      if (k !== r && k < rest.length) [rest[r], rest[k]] = [rest[k], rest[r]];
      out.push(rest[r++]);
    }
    if (f < fresh.length) out.push(fresh[f++]);
    if (f < fresh.length && (f % 2 === 1)) out.push(fresh[f++]);
  }
  return out;
}

/**
 * Pick the formulation (1-3) to ask. Near the target difficulty, but different from the last one asked when possible,
 * and one the player has not already answered right several times. Mastered items are asked in a new form (transfer).
 */
export function pickLevel(item, target, rng) {
  const t = clamp(Math.round(target), 1, 3);
  let options = [1, 2, 3].filter((l) => Math.abs(l - t) <= (item.state === 'mastered' || item.state === 'review' ? 2 : 1));
  const fresh = options.filter((l) => l !== item.lastLevel);
  if (fresh.length) options = fresh;
  const unsolved = options.filter((l) => item.right[l] < 2);
  if (unsolved.length) options = unsolved;
  const least = Math.min(...options.map((l) => item.seen[l]));
  options = options.filter((l) => item.seen[l] === least);
  options.sort((a, b) => Math.abs(a - t) - Math.abs(b - t) || a - b);
  return options.length > 1 && rng ? options[rng.int(Math.min(2, options.length))] : options[0];
}

/** The difficulty a player is ready for in a concept: more formulations answered right means harder asks. */
export function targetFor(item) {
  const solved = [1, 2, 3].filter((l) => item.right[l] > 0).length;
  return clamp(1 + solved, 1, 3);
}

/* ---------------------------------------------------------------- summaries */

export function summarize(items, now, pool = null) {
  const list = pool ? pool.map((c) => items[c.id]).filter(Boolean) : Object.values(items);
  const by = { new: 0, learning: 0, relearning: 0, review: 0, mastered: 0 };
  for (const it of list) by[it.state]++;
  const total = pool ? pool.length : list.length;
  by.new += pool ? total - list.length : 0;
  return { total, byState: by, due: list.filter((it) => isDue(it, now)).length, fragile: list.filter((it) => isFragile(it)).length, seen: list.length };
}

/** Next time something comes due (epoch ms), or null. Used for "come back at ..." messages. */
export function nextDue(items, now) {
  const times = Object.values(items).filter((it) => it.state !== 'new' && it.due > now).map((it) => it.due);
  return times.length ? Math.min(...times) : null;
}

/* ---------------------------------------------------------------- the profile's learning record */

export const LEARN_VERSION = 1;
export const emptyLearn = () => ({ v: LEARN_VERSION, items: {}, daily: {}, log: [], streak: { last: '', count: 0, best: 0 }, achievements: [] });

export function cleanLearn(raw) {
  const out = emptyLearn();
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, it] of Object.entries(raw.items ?? {}).slice(0, 5000)) if (/^[\w~.-]{1,40}$/.test(id) && it && typeof it === 'object') out.items[id] = cleanItem(it, id);
  for (const [day, d] of Object.entries(raw.daily ?? {}).slice(-120)) if (/^\d{4}-\d{2}-\d{2}$/.test(day)) out.daily[day] = { answered: Math.floor(Math.max(0, Number(d?.answered) || 0)), right: Math.floor(Math.max(0, Number(d?.right) || 0)), hinted: Math.floor(Math.max(0, Number(d?.hinted) || 0)) };
  out.log = (Array.isArray(raw.log) ? raw.log : []).slice(-60).map((l) => ({ t: Number(l?.t) || 0, kind: String(l?.kind ?? '').slice(0, 20), n: Math.floor(Number(l?.n) || 0), right: Math.floor(Number(l?.right) || 0) }));
  const s = raw.streak ?? {};
  out.streak = { last: /^\d{4}-\d{2}-\d{2}$/.test(s.last) ? s.last : '', count: Math.floor(Math.max(0, Number(s.count) || 0)), best: Math.floor(Math.max(0, Number(s.best) || 0)) };
  out.achievements = [...new Set((Array.isArray(raw.achievements) ? raw.achievements : []).filter((x) => typeof x === 'string').map((x) => x.slice(0, 30)))].slice(0, 80);
  return out;
}

/** Merge two records (two devices). For each concept the most recently reviewed copy wins. */
export function mergeLearn(a, b) {
  const x = cleanLearn(a); const y = cleanLearn(b);
  const items = { ...x.items };
  for (const [id, it] of Object.entries(y.items)) if (!items[id] || it.last > items[id].last) items[id] = it;
  const daily = { ...x.daily };
  for (const [d, v] of Object.entries(y.daily)) daily[d] = daily[d] ? { answered: Math.max(daily[d].answered, v.answered), right: Math.max(daily[d].right, v.right), hinted: Math.max(daily[d].hinted, v.hinted) } : v;
  const log = [...x.log, ...y.log].sort((p, q) => p.t - q.t).filter((l, i, arr) => !i || l.t !== arr[i - 1].t).slice(-60);
  const streak = x.streak.last >= y.streak.last ? { ...x.streak, best: Math.max(x.streak.best, y.streak.best) } : { ...y.streak, best: Math.max(x.streak.best, y.streak.best) };
  return { v: LEARN_VERSION, items, daily, log, streak, achievements: [...new Set([...x.achievements, ...y.achievements])] };
}

/** Local day key for a timestamp, "2026-10-19". `offsetMin` is minutes east of UTC (use -getTimezoneOffset()). */
export function dayKey(ms, offsetMin = 0) {
  const d = new Date(ms + offsetMin * MIN);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const dayNum = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / DAY;

/** Apply a list of answered questions to a learning record. Returns a new record. */
export function applyAnswers(learn, answers, now, { kind = 'train', offsetMin = 0 } = {}) {
  const out = cleanLearn(learn);
  let right = 0;
  const day = dayKey(now, offsetMin);
  const d = out.daily[day] ?? { answered: 0, right: 0, hinted: 0 };
  for (const a of answers) {
    const before = out.items[a.id] ?? newItem(a.id, now);
    out.items[a.id] = grade(before, a, now);
    d.answered++; if (a.correct) { d.right++; right++; } if (a.hints > 0) d.hinted++;
  }
  out.daily[day] = d;
  const keys = Object.keys(out.daily).sort(); for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete out.daily[k];
  if (answers.length) {
    out.log = [...out.log, { t: now, kind, n: answers.length, right }].slice(-60);
    const gap = out.streak.last ? dayNum(day) - dayNum(out.streak.last) : null;
    if (gap === null || gap > 1 || gap < 0) out.streak.count = gap !== null && gap < 0 ? out.streak.count : 1;
    else if (gap === 1) out.streak.count++;
    out.streak.last = gap !== null && gap < 0 ? out.streak.last : day;
    out.streak.best = Math.max(out.streak.best, out.streak.count);
  }
  return out;
}
