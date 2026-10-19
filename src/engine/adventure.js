// Adventures: a solo path of 100 steps through one theme. Pure data and pure functions; the screen owns the UI and
// the profile owns the saved progress.
//
// A step is a short run of questions (five, seven for a boss) with three hearts. There are no lesson cards: what you
// are asked comes from the learning engine (learning.js), so reviews that are due come back in a new formulation and
// new concepts fill the rest. The path forks at some steps (a safe road or a risky one), every fifth step is a lab
// accident (a few hex cards are thrown at you) and every tenth step is a boss that throws more and more of them.
// Difficulty climbs with the step, using the three versions every question has (see `levelFor` in game.js).
import { Rng } from './rng.js';
import { selectSession, isDue } from './learning.js';
import { startPractice } from './practice.js';
import { HEXES } from './hexes.js';

export const STEPS = 100;
export const HEARTS = 3;
export const BOSS_EVERY = 10;
export const FORK_AT = [3, 6]; // step % 10 values that fork
export const EVENT_AT = 5;     // step % 10 value of the lab accident

export const ADVENTURES = {
  science: {
    id: 'science', name: 'The Lab', title: 'Science', cats: ['science', 'phobia'], color: '#6fd1ff', icon: 'science', open: true,
    blurb: 'Atoms, bodies, space and a few fears.',
    bossSprite: 'boss_static',
    bossNames: ['The Spark', 'The Flask', 'The Magnet', 'The Prism', 'The Orbit', 'The Gene', 'The Quark', 'The Vacuum', 'The Paradox', 'Dr. Static'],
    // Concepts the adventure draws from: "category/subcategory", or "category" for everything in it.
    subs: ['science', 'nature/anatomy', 'nature/cells', 'nature/plants', 'symbols/element-symbol', 'symbols/periodic-table', 'symbols/formula', 'symbols/si-units', 'cooking/science'],
    // Ten chapters, ten subjects. Each chapter has three aspects (steps 1 to 3, 4 to 6, 7 to 9) that draw their NEW concepts from
    // their own subcategories; the boss mixes all three. Reviews that are due can come from anywhere in the adventure.
    // Questions get harder as the chapters go on: the ladder level rises (levelForStep) and so does the content itself.
    chapters: [
      { scene: 'bench', name: 'The Bench', subject: 'Matter', aspects: [
        { name: 'States of matter', focus: ['science/states'] }, { name: 'Atoms and elements', focus: ['science/atoms', 'symbols/element-symbol', 'symbols/periodic-table'] }, { name: 'Reactions', focus: ['science/reactions', 'science/chemistry'] }] },
      { scene: 'greenhouse', name: 'The Greenhouse', subject: 'Life', aspects: [
        { name: 'Cells', focus: ['science/cells', 'nature/cells'] }, { name: 'Plants', focus: ['science/plants', 'nature/plants', 'cooking/science'] }, { name: 'Evolution and ecosystems', focus: ['science/evolution', 'science/history-of-science'] }] },
      { scene: 'clinic', name: 'The Clinic', subject: 'Body and brain', aspects: [
        { name: 'The senses', focus: ['science/senses'] }, { name: 'Brain and hormones', focus: ['science/brain'] }, { name: 'Genes and the body', focus: ['science/genes', 'nature/anatomy'] }] },
      { scene: 'workshop', name: 'The Workshop', subject: 'Forces and machines', aspects: [
        { name: 'Motion', focus: ['science/motion', 'science/physics'] }, { name: 'Energy and heat', focus: ['science/energy'] }, { name: 'Machines and units', focus: ['science/machines', 'symbols/si-units', 'symbols/formula'] }] },
      { scene: 'observatory', name: 'The Observatory', subject: 'Space', aspects: [
        { name: 'The Solar System', focus: ['science/solar', 'science/space'] }, { name: 'Stars and light', focus: ['science/stars'] }, { name: 'The cosmos', focus: ['science/cosmos'] }] },
      { scene: 'reactor', name: 'The Reactor', subject: 'Electricity, waves and the nucleus', aspects: [
        { name: 'Electricity and magnets', focus: ['science/electricity'] }, { name: 'Waves and light', focus: ['science/waves'] }, { name: 'The nucleus', focus: ['science/nuclear'] }] },
      { scene: 'fearlab', name: 'The Fear Lab', subject: 'Mind and method', aspects: [
        { name: 'Perception and memory', focus: ['science/illusions'] }, { name: 'Fear and conditioning', focus: ['science/fears', 'science/phobia'] }, { name: 'How science works', focus: ['science/method'] }] },
      { scene: 'deep', name: 'The Deep', subject: 'Earth', aspects: [
        { name: 'Rocks and plates', focus: ['science/rocks'] }, { name: 'Oceans', focus: ['science/oceans'] }, { name: 'Air and climate', focus: ['science/climate'] }] },
      { scene: 'orbit', name: 'High Orbit', subject: 'Frontier technology', aspects: [
        { name: 'Computing and AI', focus: ['science/computing'] }, { name: 'Materials and power', focus: ['science/materials'] }, { name: 'Flight and space travel', focus: ['science/flight'] }] },
      { scene: 'paradox', name: 'The Paradox', subject: 'The edge of knowledge', aspects: [
        { name: 'Relativity', focus: ['science/relativity'] }, { name: 'Quantum world', focus: ['science/quantum'] }, { name: 'Maths and logic', focus: ['science/maths'] }] },
    ].map((c) => ({ ...c, focus: c.aspects.flatMap((a) => a.focus) })),
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

/** Only some adventures are playable for now. */
export const OPEN_ADVENTURE_IDS = ADVENTURE_IDS.filter((id) => ADVENTURES[id].open);

/** What kind of step this is: a single road, a fork, a lab accident (event), or a boss. */
export function stepKind(step) {
  if (step % BOSS_EVERY === 0) return 'boss';
  if (step % BOSS_EVERY === EVENT_AT) return 'event';
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
  const base = step <= 30 ? 1 : step <= 70 ? 2 : 3;
  const bump = road === 'risk' || road === 'boss' ? 1 : 0;
  return Math.min(3, base + bump);
}

export const chapterOf = (step) => Math.ceil(step / BOSS_EVERY);
/** Position inside the chapter, 0 (first step) to 1 (the boss). Drives the scene's lighting. */
export const phaseOf = (step) => ((step - 1) % BOSS_EVERY) / (BOSS_EVERY - 1);
export const chapterInfo = (adv, step) => ADVENTURES[adv].chapters?.[chapterOf(step) - 1] ?? { scene: 'bench', name: `Chapter ${chapterOf(step)}`, focus: [] };

/** The aspect a step belongs to: steps 1 to 3 of a chapter are the first, 4 to 6 the second, 7 to 9 the third. A boss has none (null). */
export function aspectOf(adv, step) {
  const ch = ADVENTURES[adv]?.chapters?.[chapterOf(step) - 1];
  const pos = (step - 1) % BOSS_EVERY;
  return ch?.aspects && pos < 9 ? ch.aspects[Math.floor(pos / 3)] : null;
}

const inSubs = (q, subs) => subs.some((s) => (s.includes('/') ? s === `${q.category}/${q.subcategory}` : s === q.category));

/** Primary questions of an adventure that have a complete ladder, in a fixed order. */
export function poolFor(adv, ctx) {
  const a = ADVENTURES[adv];
  const subs = a.subs ?? a.cats;
  return ctx.questions
    .filter((q) => inSubs(q, subs) && q.family && ctx.families.get(q.family)?.[1] && ctx.families.get(q.family)?.[2] && ctx.families.get(q.family)?.[3])
    .sort((a2, b2) => (a2.id < b2.id ? -1 : 1));
}

/* ---------------------------------------------------------------- hex cards thrown at the player */

const HEX_LADDER = [ // [first progress at which it can be thrown, hex id]
  [0, 'goo_splat'], [0.2, 'ink_blast'], [0.4, 'blur_out'], [0.6, 'quake'], [0.8, 'flip_table'],
];
export const hexEffects = (id) => HEXES[id]?.fx ?? [];

/**
 * Which hexes are thrown at which question. A boss starts calm and escalates: more cards per question and nastier ones
 * (slime, ink, blur, quake, and from chapter 3 a flipped table). A lab accident throws one mild card at each of the last
 * two questions. Everything is visual: no hex can make an answer wrong, and nothing is timed.
 */
export function hexPlan(kind, step, count, rng) {
  const plan = Array.from({ length: count }, () => []);
  if (kind === 'event') {
    for (let i = Math.max(1, count - 2); i < count; i++) plan[i] = [rng.pick(['goo_splat', 'ink_blast'])];
  } else if (kind === 'boss') {
    const chapter = chapterOf(step);
    for (let i = 1; i < count; i++) {
      const t = i / (count - 1);
      const intensity = Math.min(1, 0.25 + 0.55 * t + 0.02 * chapter);
      const n = intensity < 0.5 ? 1 : intensity < 0.8 ? 2 : 3;
      const ok = HEX_LADDER.filter(([from, id]) => t >= from && !(id === 'flip_table' && chapter < 3)).map(([, id]) => id);
      const picked = [];
      for (let k = 0; k < n; k++) {
        const pool = ok.filter((id) => !picked.includes(id));
        if (!pool.length) break;
        // later throws in a question lean on the newest tricks
        picked.push(k === 0 ? rng.pick(pool) : pool[Math.min(pool.length - 1, pool.length - 1 - rng.int(Math.min(2, pool.length)))]);
      }
      plan[i] = picked;
    }
  }
  return plan;
}

/**
 * The questions for a step. The learning engine picks them: reviews that are due first, then new concepts from this
 * chapter's focus, never the concepts of the step before (`exclude`). `learn` is the player's learning record.
 * Deterministic for (adventure, step, road, attempt, learn, now).
 */
export function buildLevel(adv, step, road, ctx, { learn = null, now = 0, attempt = 0, exclude = [] } = {}) {
  if (!ADVENTURES[adv] || step < 1 || step > STEPS) throw new Error('No such step');
  const pool = poolFor(adv, ctx);
  if (pool.length < 10) throw new Error(`Not enough questions for ${adv}`);
  const items = learn?.items ?? {};
  const kind = stepKind(step);
  const count = kind === 'boss' ? 7 : 5;
  const target = levelForStep(step, kind === 'boss' ? 'boss' : road);
  const chapter = chapterInfo(adv, step);
  const concepts = pool.map((q) => ({ id: q.family, category: q.category, subcategory: q.subcategory }));
  const aspect = aspectOf(adv, step);
  const focusSubs = aspect?.focus ?? chapter.focus;
  const focus = focusSubs.length ? concepts.filter((c) => inSubs(c, focusSubs)) : concepts;
  // New concepts come from the chapter's focus; anything already seen and due can come from anywhere in the adventure.
  const allowed = new Map(focus.map((c) => [c.id, c]));
  for (const c of concepts) if (items[c.id] && items[c.id].state !== 'new' && isDue(items[c.id], now)) allowed.set(c.id, c);
  // When the chapter has run out of unseen concepts, unseen ones from elsewhere come in before anything is drilled again.
  const unseen = (c) => !items[c.id] || items[c.id].state === 'new';
  // A thin aspect borrows only what it lacks: first from the rest of its chapter, then from elsewhere in the adventure.
  const borrow = (candidates, tag) => {
    const need = count + exclude.length - [...allowed.values()].filter(unseen).length;
    if (need <= 0) return;
    const fresh = candidates.filter((c) => unseen(c) && !allowed.has(c.id));
    for (const c of Rng.fromSeed(`borrow:${tag}:${adv}:${step}:${attempt}`).shuffle(fresh).slice(0, need)) allowed.set(c.id, c);
  };
  if (chapter.focus.length) borrow(concepts.filter((c) => inSubs(c, chapter.focus)), 'chapter');
  borrow(concepts, 'any');
  let list = [...allowed.values()];
  if (list.length < count + exclude.length) list = concepts; // a thin focus never starves a step
  const sel = selectSession({ items, pool: list, now, seed: `adv:${adv}:${step}:${road}:${attempt}`, target, mode: 'adventure', size: count, exclude });
  const rng = Rng.fromSeed(`hex:${adv}:${step}:${attempt}`);
  const questions = sel.map((x) => ({ qid: ctx.families.get(x.id)[x.level].id, family: x.id, level: x.level, reason: x.reason }));
  return {
    adv, step, road, kind, target, hearts: HEARTS, attempt, chapter: chapterOf(step), scene: chapter.scene, aspect: aspect?.name ?? null, subject: chapter.subject ?? null, phase: phaseOf(step),
    questions, hexes: hexPlan(kind, step, questions.length, rng),
    boss: kind === 'boss' ? { name: ADVENTURES[adv].bossNames[chapterOf(step) - 1], sprite: step === STEPS ? 'boss_house' : ADVENTURES[adv].bossSprite } : null,
  };
}

/** Start playing a built level. Bosses allow no hints; every other step allows two per question. */
export function startRun(level, ctx, seed = `${level.adv}:${level.step}:${level.road}:${level.attempt}`) {
  const run = startPractice({ questions: level.questions, ctx, hearts: level.hearts, allowHints: level.kind !== 'boss', allowRetry: level.kind !== 'boss', hexes: level.hexes, seed });
  return { ...run, level };
}

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
export function xpForStep(step, road, stars, stakeBonus = 0) {
  const base = stepKind(step) === 'boss' ? 60 : 12;
  return Math.round((base + stars * 4 + Math.max(0, Math.min(STAKE_BONUS_CAP, Math.floor(stakeBonus)))) * (road === 'risk' ? 1.5 : 1));
}
export const STAKE_BONUS_CAP = 8;
/** Bold stakes pay: points above the standard 2 per question become bonus XP (safe stakes never cost XP). */
export const stakeBonusOf = (run) => Math.max(0, Math.min(STAKE_BONUS_CAP, (run.points ?? 0) - 2 * run.queue.filter((x) => !x.retry).length));

/** A silver pack comes with a first boss win; a gold one with the last boss of an adventure. */
export function packForStep(step) {
  if (step === STEPS) return 'gold';
  return stepKind(step) === 'boss' ? 'silver' : null;
}
