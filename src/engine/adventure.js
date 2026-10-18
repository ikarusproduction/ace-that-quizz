// Adventures: a solo path of 100 steps through one theme. Pure data and pure functions; the screen owns the UI and
// the profile owns the saved progress.
//
// A step is a short lesson: you first read three fact cards (learn), then answer five questions (practise) with
// three hearts. A wrong answer costs a heart and the question comes back once at the end. The path forks at some
// steps (a safe road or a risky one), and every tenth step is a boss. Difficulty climbs with the step, using the
// three versions every question has (see `levelFor` in game.js).
import { Rng } from './rng.js';

export const STEPS = 100;
export const HEARTS = 3;
export const BOSS_EVERY = 10;
export const FORK_AT = [3, 6]; // step % 10 values that fork

export const ADVENTURES = {
  science: {
    id: 'science', name: 'The Lab', title: 'Science', cats: ['science', 'phobia'], color: '#6fd1ff', icon: 'science',
    blurb: 'Atoms, bodies, space and a few fears.',
    bossSprite: 'boss_static',
    bossNames: ['The Spark', 'The Flask', 'The Magnet', 'The Prism', 'The Orbit', 'The Gene', 'The Quark', 'The Vacuum', 'The Paradox', 'Dr. Static'],
  },
  history: {
    id: 'history', name: 'The Archive', title: 'History', cats: ['history'], color: '#c9a26b', icon: 'owl', bossSprite: 'boss_archivist',
    blurb: 'Empires, revolutions and dates worth knowing.',
    bossNames: ['The Scribe', 'The Legion', 'The Crown', 'The Crusader', 'The Printer', 'The Revolution', 'The Engine', 'The Trench', 'The Wall', 'The Archivist'],
  },
  symbols: {
    id: 'symbols', name: 'The Cipher', title: 'Symbols', cats: ['symbols'], color: '#b48cff', icon: 'key', bossSprite: 'boss_cipher',
    blurb: 'Elements, acronyms, flags and signs.',
    bossNames: ['The Letter', 'The Element', 'The Acronym', 'The Flag', 'The Sign', 'The Code', 'The Formula', 'The Glyph', 'The Cipher', 'The Keymaster'],
  },
  geography: {
    id: 'geography', name: 'The Atlas', title: 'Geography', cats: ['geography'], color: '#d9a441', icon: 'radio', bossSprite: 'boss_cartographer',
    blurb: 'Capitals, rivers, borders and the odd island.',
    bossNames: ['The Compass', 'The Capital', 'The River', 'The Peak', 'The Desert', 'The Strait', 'The Archipelago', 'The Pole', 'The Meridian', 'The Cartographer'],
  },
  nature: {
    id: 'nature', name: 'The Wild', title: 'Nature', cats: ['nature'], color: '#7ddc7a', icon: 'owl', bossSprite: 'boss_overgrowth',
    blurb: 'Animals, plants and how life works.',
    bossNames: ['The Seed', 'The Hive', 'The Reef', 'The Canopy', 'The Predator', 'The Migration', 'The Fungus', 'The Deep', 'The Apex', 'The Ancient One'],
  },
};
export const ADVENTURE_IDS = Object.keys(ADVENTURES);

/** What kind of step this is: a single road, a fork, or a boss. */
export function stepKind(step) {
  if (step % BOSS_EVERY === 0) return 'boss';
  return FORK_AT.includes(step % BOSS_EVERY) ? 'fork' : 'single';
}

/** The roads available at a step. A road id is stable and saved with the progress. */
export function roadsAt(step) {
  const k = stepKind(step);
  if (k === 'boss') return [{ id: 'boss', label: 'Boss' }];
  if (k === 'fork') return [{ id: 'safe', label: 'Safe road', hint: 'Normal questions' }, { id: 'risk', label: 'Risky road', hint: 'Harder questions, 1.5× XP' }];
  return [{ id: 'main', label: 'Road' }];
}

/** Question level (1 to 3) for a step: easy first, precise later. A risky road is one level harder. */
export function levelForStep(step, road = 'main') {
  const base = step <= 30 ? 1 : step <= 65 ? 2 : 3;
  const bump = road === 'risk' || road === 'boss' ? 1 : 0;
  return Math.min(3, base + bump);
}

export const chapterOf = (step) => Math.ceil(step / BOSS_EVERY);

/** Primary questions of an adventure that have a complete ladder, in a fixed order. */
export function poolFor(adv, ctx) {
  const cats = new Set(ADVENTURES[adv].cats);
  return ctx.questions
    .filter((q) => cats.has(q.category) && q.family && ctx.families.get(q.family)?.[1] && ctx.families.get(q.family)?.[2] && ctx.families.get(q.family)?.[3])
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The lesson for a step: three facts to learn, then the questions to answer. Deterministic for (adventure, step, road). */
export function buildLevel(adv, step, road, ctx) {
  if (!ADVENTURES[adv] || step < 1 || step > STEPS) throw new Error('No such step');
  const pool = poolFor(adv, ctx);
  if (pool.length < 10) throw new Error(`Not enough questions for ${adv}`);
  const order = Rng.fromSeed(`adv:${adv}`).shuffle(pool);
  const kind = stepKind(step);
  const count = kind === 'boss' ? 7 : 5;
  const level = levelForStep(step, kind === 'boss' ? 'boss' : road);
  const offset = (step - 1) * 5 + (road === 'risk' ? Math.floor(pool.length / 2) : 0);
  const picked = [];
  for (let i = 0; picked.length < count && i < order.length; i++) picked.push(order[(offset + i) % order.length]);
  const ids = picked.map((q) => ctx.families.get(q.family)[level].id);
  return {
    adv, step, road, kind, level, hearts: HEARTS,
    learn: kind === 'boss' ? [] : ids.slice(0, 3),
    questions: ids,
    boss: kind === 'boss' ? { name: ADVENTURES[adv].bossNames[chapterOf(step) - 1], sprite: step === STEPS ? 'boss_house' : ADVENTURES[adv].bossSprite } : null,
  };
}

/* ---------------------------------------------------------------- a run of one level */

/** Start practising. `seed` fixes the answer order so a saved run could be replayed. */
export function startRun(level, ctx, seed = `${level.adv}:${level.step}:${level.road}`) {
  const rng = Rng.fromSeed(seed);
  const queue = level.questions.map((qid) => ({ qid, order: rng.shuffle(ctx.byId.get(qid).choices.map((_, i) => i)), retry: false }));
  return { level, queue, idx: 0, hearts: level.hearts, status: 'play', picked: null, right: 0, wrong: 0, stars: 0 };
}

export const currentItem = (run) => (run.status === 'play' ? run.queue[run.idx] : null);

/** Answer the current question by the displayed position. Returns a new run; `picked` holds the outcome until `advance`. */
export function answerRun(run, display, ctx) {
  if (run.status !== 'play' || run.picked) return run;
  const item = run.queue[run.idx];
  const q = ctx.byId.get(item.qid);
  const chosen = item.order[display];
  const correct = chosen === q.answer;
  const next = { ...run, picked: { display, correct, answerDisplay: item.order.indexOf(q.answer) }, right: run.right + (correct ? 1 : 0), wrong: run.wrong + (correct ? 0 : 1) };
  if (!correct) {
    next.hearts = run.hearts - 1;
    // A missed question returns once at the end of the lesson (not on a boss, which has no second chances).
    if (!item.retry && run.level.kind !== 'boss') next.queue = [...run.queue, { ...item, retry: true, order: [...item.order].reverse() }];
  }
  return next;
}

/** Move on after seeing the result. Ends the run when hearts are gone or the questions are done. */
export function advanceRun(run) {
  if (run.status !== 'play' || !run.picked) return run;
  if (run.hearts <= 0) return { ...run, status: 'lost', picked: null, stars: 0 };
  const idx = run.idx + 1;
  if (idx >= run.queue.length) return { ...run, idx, status: 'won', picked: null, stars: starsFor(run.hearts) };
  return { ...run, idx, picked: null };
}

export const starsFor = (hearts) => Math.max(1, Math.min(3, hearts));

/* ---------------------------------------------------------------- progress and rewards */

/** An empty or cleaned progress record for one adventure: { done: { [step]: stars }, road: { [step]: roadId } }. */
export function cleanProgress(p) {
  const done = {}; const road = {};
  for (const [k, v] of Object.entries(p?.done ?? {})) {
    const step = Number(k); const stars = Math.floor(Number(v));
    if (Number.isInteger(step) && step >= 1 && step <= STEPS && stars >= 1 && stars <= 3) done[step] = stars;
  }
  for (const [k, v] of Object.entries(p?.road ?? {})) {
    const step = Number(k);
    if (done[step] && roadsAt(step).some((r) => r.id === v)) road[step] = v;
  }
  return { done, road };
}

/** The first step that is not finished (101 when the adventure is complete). Steps unlock in order. */
export function frontier(progress) {
  let s = 1;
  while (s <= STEPS && progress.done[s]) s++;
  return s;
}

export const isUnlocked = (progress, step) => step <= frontier(progress);

export function totals(progress) {
  const steps = Object.keys(progress.done).length;
  const stars = Object.values(progress.done).reduce((n, v) => n + v, 0);
  return { steps, stars, complete: steps === STEPS };
}

/** XP for finishing a step for the first time. */
export function xpForStep(step, road, stars) {
  const base = stepKind(step) === 'boss' ? 60 : 12;
  return Math.round((base + stars * 4) * (road === 'risk' ? 1.5 : 1));
}

/** A silver pack comes with a first boss win; a gold one with the last boss of an adventure. */
export function packForStep(step) {
  if (step === STEPS) return 'gold';
  return stepKind(step) === 'boss' ? 'silver' : null;
}
