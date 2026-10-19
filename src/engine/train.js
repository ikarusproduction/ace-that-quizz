// Training modes built on the learning engine. Pure: given the question bank context and the player's learning record,
// each function returns the questions to ask. The screen plays them (see ui/screens/train.js) and saves the answers.
//
//   daily      a short mixed session: due reviews first, then new concepts
//   focus      one category (and optionally one subcategory)
//   weak       the fragile and relearning concepts, each asked in a different formulation
//   mastery    a harder session over established concepts, no hints, hardest formulations; never certifies anything
//   expedition a run of encounters with shared hearts: due reviews, new knowledge, a contrast round and a boss that
//              throws hex cards (the roguelite wrapper around spaced repetition)
import { Rng } from './rng.js';
import { selectSession, newItem, isDue, isFragile, pickLevel, targetFor, SESSION } from './learning.js';
import { hexPlan } from './adventure.js';
import { THEMES, isFreshNews } from './themes.js';

export const MODES = {
  daily: { id: 'daily', name: 'Daily Training', blurb: 'Reviews that are due, plus something new. About 5 minutes.', size: 8 },
  focus: { id: 'focus', name: 'Focused Training', blurb: 'Pick a subject. Weak spots first, then new material.', size: 8 },
  weak: { id: 'weak', name: 'Weakness Hunter', blurb: 'Your shakiest knowledge, asked from a new angle.', size: 8 },
  mastery: { id: 'mastery', name: 'Mastery Challenge', blurb: 'Harder questions on what you know. No hints.', size: 10 },
  expedition: { id: 'expedition', name: 'Review Expedition', blurb: 'Four encounters, three hearts, one boss.', size: 5 },
};
export const MIN_FOR = { weak: 3, mastery: 6 };

/** Time-sensitive questions: news only counts while it is fresh, and anything with an `expires` date is never asked after it. */
export const isCurrent = (q, now) => (q.category === 'news' ? isFreshNews(q, now) : true) && (!q.expires || !(Date.parse(q.expires) <= now));

/** Every concept (question family with a full ladder of three formulations) that may be asked. */
export function conceptsFor(ctx, { category = null, subcategory = null, now = 0 } = {}) {
  return ctx.questions
    .filter((q) => q.family && (!category || (THEMES[category] ? THEMES[category].match(q, now) : q.category === category)) && (!subcategory || q.subcategory === subcategory) && isCurrent(q, now))
    .filter((q) => [1, 2, 3].every((l) => ctx.families.get(q.family)?.[l]))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((q) => ({ id: q.family, category: q.category, subcategory: q.subcategory }));
}

const toQuestions = (sel, ctx, learnItems, rng, level = null) => sel.map((x) => {
  const it = learnItems[x.id] ?? x.it;
  const l = level ?? pickLevel(it, targetFor(it), rng);
  return { qid: ctx.families.get(x.id)[l].id, family: x.id, level: l, reason: x.reason };
});

/**
 * Questions for one session of a mode.
 * Returns { questions, notice } where notice explains an empty or thin result ("Nothing weak yet").
 */
export function buildTraining(mode, ctx, learn, { now = 0, category = null, subcategory = null, size = null, seed = 'train', exclude = [] } = {}) {
  const items = learn?.items ?? {};
  const rng = Rng.fromSeed(`${seed}:${mode}`);
  const all = conceptsFor(ctx, { category: mode === 'focus' ? category : null, subcategory: mode === 'focus' ? subcategory : null, now });
  const n = size ?? MODES[mode]?.size ?? 8;
  if (!all.length) return { questions: [], notice: 'There are no questions for this yet.' };
  const state = (c) => items[c.id] ?? newItem(c.id, now);
  if (mode === 'weak') {
    const pool = all.filter((c) => { const it = state(c); return it.state !== 'new' && (isFragile(it) || it.state === 'relearning' || isDue(it, now)); });
    if (pool.length < MIN_FOR.weak) return { questions: [], notice: 'Nothing is weak yet. Play a few sessions and come back: this mode works on what you actually miss.' };
    const sel = selectSession({ items, pool, now, seed, mode: 'weak', size: Math.min(n, pool.length), exclude });
    return { questions: toQuestions(sel, ctx, items, rng), notice: null };
  }
  if (mode === 'mastery') {
    const pool = all.filter((c) => ['review', 'mastered'].includes(state(c).state));
    if (pool.length < MIN_FOR.mastery) return { questions: [], notice: `The Mastery Challenge needs at least ${MIN_FOR.mastery} concepts you have already reviewed in the schedule. Train a few days first.` };
    const sel = selectSession({ items, pool, now, seed, mode: 'mastery', size: Math.min(n, pool.length), exclude, cfg: { ...SESSION, minCategories: 3 } });
    // transfer: the hardest formulation, and a different one from the last time when the concept has been asked that way
    const questions = sel.map((x) => { const it = items[x.id]; const l = it && it.lastLevel === 3 ? 2 : 3; return { qid: ctx.families.get(x.id)[l].id, family: x.id, level: l, reason: x.reason }; });
    return { questions, notice: null };
  }
  const sel = selectSession({ items, pool: all, now, seed, mode, size: Math.min(n, all.length), exclude });
  return { questions: toQuestions(sel, ctx, items, rng), notice: all.length < n ? `Only ${all.length} concepts here so far.` : null };
}

/* ------------------------------------------------------------------ the expedition */

export const EXPEDITION_HEARTS = 3;
const BOSSES = [
  { name: 'The Spark', sprite: 'boss_static' }, { name: 'The Cartographer', sprite: 'boss_cartographer' }, { name: 'The Archivist', sprite: 'boss_archivist' },
  { name: 'The Cipher', sprite: 'boss_cipher' }, { name: 'The Overgrowth', sprite: 'boss_overgrowth' },
];
const SCENES = ['bench', 'greenhouse', 'clinic', 'workshop', 'observatory', 'reactor', 'fearlab', 'deep', 'orbit', 'paradox'];

/**
 * A review expedition: [review, new, contrast, boss]. Each encounter avoids the concepts of the ones before it, and
 * the boss mixes concepts from the earlier encounters. Falls back to what exists when the bank or the record is thin.
 */
export function buildExpedition(ctx, learn, { now = 0, seed = 'expedition', category = null } = {}) {
  const items = learn?.items ?? {};
  const rng = Rng.fromSeed(`${seed}:exp`);
  const all = conceptsFor(ctx, { category, now });
  if (all.length < 12) return { encounters: [], notice: 'There are not enough questions yet for an expedition.' };
  const st = (c) => items[c.id] ?? newItem(c.id, now);
  const used = new Set();
  const take = (sel, kind) => { for (const x of sel) used.add(x.id); return sel; };

  const seen = all.filter((c) => st(c).state !== 'new');
  const reviewPool = seen.filter((c) => isDue(st(c), now) || isFragile(st(c)));
  const reviewSel = take(selectSession({ items, pool: reviewPool.length >= 3 ? reviewPool : (seen.length >= 5 ? seen : all), now, seed: `${seed}:r`, mode: 'weak', size: 5 }), 'review');
  const freshPool = all.filter((c) => st(c).state === 'new' && !used.has(c.id));
  const newSel = take(selectSession({ items, pool: freshPool.length >= 5 ? freshPool : all.filter((c) => !used.has(c.id)), now, seed: `${seed}:n`, mode: 'daily', size: 5, exclude: [...used] }), 'new');

  // contrast: five concepts of one subcategory (easily confused neighbours), most-seen subcategory first
  const bySub = new Map();
  for (const c of all) if (!used.has(c.id)) { const k = `${c.category}/${c.subcategory}`; bySub.set(k, [...(bySub.get(k) ?? []), c]); }
  const subs = [...bySub.values()].filter((l) => l.length >= 5);
  const subPick = subs.length ? rng.pick(subs) : all.filter((c) => !used.has(c.id));
  const contrastSel = take(selectSession({ items, pool: subPick, now, seed: `${seed}:c`, mode: 'daily', size: 5, exclude: [...used] }).map((x) => ({ ...x, reason: 'contrast' })), 'contrast');

  const bossPool = all.filter((c) => used.has(c.id));
  const bossSel = selectSession({ items, pool: bossPool.length >= 7 ? bossPool : all, now, seed: `${seed}:b`, mode: 'mastery', size: 7, cfg: { ...SESSION, minCategories: 1 } });
  const boss = rng.pick(BOSSES);
  const mk = (sel, level = null) => toQuestions(sel, ctx, items, rng, level);
  const scenes = rng.shuffle(SCENES);
  const encounters = [
    { kind: 'review', title: 'Due reviews', blurb: 'What the schedule says is slipping.', scene: scenes[0], questions: mk(reviewSel) },
    { kind: 'new', title: 'New knowledge', blurb: 'Fresh concepts, gently.', scene: scenes[1], questions: mk(newSel) },
    { kind: 'contrast', title: 'Easily confused', blurb: 'Neighbours that are easy to mix up.', scene: scenes[2], questions: mk(contrastSel) },
    { kind: 'boss', title: boss.name, blurb: 'Everything so far, and it throws hexes.', scene: scenes[3], boss, questions: mk(bossSel, 2).map((q, i) => ({ ...q, reason: 'practice' })) },
  ].filter((e) => e.questions.length);
  const last = encounters.at(-1);
  if (last?.kind === 'boss') last.hexes = hexPlan('boss', 30, last.questions.length, rng);
  return { encounters, notice: null };
}
