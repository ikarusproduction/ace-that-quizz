// Champion's Academy: elite general-knowledge training built on the learning engine (learning.js) and the question bank.
// Pure and deterministic: given the bank context, the player's learning record and Academy record, each function returns
// what to ask or what the stored answers say. The screen (ui/screens/academy.js) plays the questions with the shared
// practice runner and the repo saves the result. Responsibilities, in order of the file:
//
//   1. taxonomy        which subject a question belongs to, and the training plans (weights per subject)
//   2. selection       balanced, adaptive choice of concepts and formulations for each module
//   3. clues           the Progressive Clue Challenge (its own item format)
//   4. recording       turning a finished run into stored, analysable answers
//   5. analytics       every statistic is computed from the stored answers, never from a made-up mastery number
//   6. achievements    rewards for retention and consistency, not for grinding
//
// Mastery is NOT decided here. A concept becomes "provisionally mastered" only inside learning.js (independent recalls on
// several occasions, delayed, in more than one formulation). Academy scores are a separate, competitive number.
import { Rng } from './rng.js';
import { selectSession, newItem, isDue, isFragile, pickLevel, targetFor, misconception, DAY } from './learning.js';
import { conceptsFor, isCurrent } from './train.js';

export const ACADEMY_VERSION = 1;

/* ---------------------------------------------------------------- 1. taxonomy */

/** Fifteen subjects. Each lists the bank categories it covers (`sub` narrows by subcategory when given). Extensible: add a row. */
export const SUBJECTS = [
  { id: 'history', label: 'History & civilizations', cats: ['history'] },
  { id: 'geography', label: 'Geography & geopolitics', cats: ['geography'] },
  { id: 'science', label: 'Science & technology', cats: ['science', 'medicine'], not: ['maths'] },
  { id: 'nature', label: 'Nature & biology', cats: ['nature'] },
  { id: 'literature', label: 'Literature & language', cats: ['literature'] },
  { id: 'arts', label: 'Arts, architecture & cinema', cats: ['arts', 'cinema'], not: ['music'] },
  { id: 'music', label: 'Music & entertainment', cats: ['music', 'tunes', 'popculture', 'manga'], also: ['arts/music'] },
  { id: 'sports', label: 'Sports', cats: ['sports', 'f1', 'hockey'] },
  { id: 'mythology', label: 'Mythology & religions', cats: ['mythology'] },
  { id: 'philosophy', label: 'Philosophy & major ideas', cats: ['philosophy'] },
  { id: 'politics', label: 'Politics, institutions & economics', cats: ['politics', 'finance', 'business'] },
  { id: 'everyday', label: 'Food, traditions & everyday knowledge', cats: ['cooking', 'symbols'], not: ['math-notation'] },
  { id: 'maths', label: 'Mathematics & logic', cats: ['science'], only: ['maths'], also: ['symbols/math-notation'] },
  { id: 'dates', label: 'Dates, discoveries & chronology', cats: [], tagged: ['chrono'] },
  { id: 'current', label: 'Current affairs', cats: ['news'] },
];
export const SUBJECT = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]));

/** The subject a question (or concept: anything with category and subcategory) counts for. */
export function subjectOf(q) {
  if (q.format === 'chrono' || (q.tags ?? []).includes('chrono')) return 'dates';
  const key = `${q.category}/${q.subcategory}`;
  for (const s of SUBJECTS) {
    if (s.also?.includes(key)) return s.id;
    if (s.only && s.cats.includes(q.category) && s.only.includes(q.subcategory)) return s.id;
  }
  for (const s of SUBJECTS) if (s.cats.includes(q.category) && !(s.not ?? []).includes(q.subcategory)) return s.id;
  return 'everyday';
}

/** Training plans: a weight (0 to 3) per subject. A plan is a starting point: the player can override any weight. */
export const PLANS = {
  balanced: { id: 'balanced', name: 'Balanced general knowledge', blurb: 'Every subject gets its turn.', w: {} },
  historygeo: { id: 'historygeo', name: 'History and geography', blurb: 'Civilizations, borders, institutions and dates.', w: { history: 3, geography: 3, dates: 2.5, politics: 1.5, mythology: 1, current: 1, science: 0.4, nature: 0.4, arts: 0.6, music: 0.3, sports: 0.3, everyday: 0.3, literature: 0.6, philosophy: 0.6, maths: 0.2 } },
  sciencenature: { id: 'sciencenature', name: 'Science and nature', blurb: 'From atoms to ecosystems, with the maths behind them.', w: { science: 3, nature: 3, maths: 2, dates: 1.2, everyday: 0.8, history: 0.4, geography: 0.8, arts: 0.2, music: 0.2, sports: 0.2, literature: 0.2, mythology: 0.2, philosophy: 0.5, politics: 0.2, current: 0.4 } },
  artsculture: { id: 'artsculture', name: 'Arts and culture', blurb: 'Painting, film, music, myths and ideas.', w: { arts: 3, music: 3, literature: 2.5, mythology: 2, philosophy: 1.5, history: 0.8, dates: 1, geography: 0.4, science: 0.2, nature: 0.2, sports: 0.3, politics: 0.3, everyday: 0.6, maths: 0.1, current: 0.3 } },
  languagelit: { id: 'languagelit', name: 'Language and literature', blurb: 'Authors, works, words and the ideas behind them.', w: { literature: 3, philosophy: 2, mythology: 1.5, history: 1.2, arts: 1, dates: 1, music: 0.5, geography: 0.4, politics: 0.6, science: 0.2, nature: 0.2, sports: 0.1, everyday: 0.4, maths: 0.2, current: 0.2 } },
  championship: { id: 'championship', name: 'Mixed championship preparation', blurb: 'Everything, with extra weight on what you miss.', w: { dates: 1.3, current: 0.8 } },
};
export const PLAN_IDS = Object.keys(PLANS);

/** Effective weight per subject: the plan's value (default 1) overridden by the player's own choices. Always finite, 0 to 3. */
export function weightsFor(plan) {
  const base = PLANS[plan?.id] ?? PLANS.balanced;
  const out = {};
  for (const s of SUBJECTS) {
    const custom = plan?.custom?.[s.id];
    const v = Number.isFinite(custom) ? custom : (base.w[s.id] ?? 1);
    out[s.id] = Math.min(3, Math.max(0, v));
  }
  return out;
}

/* ---------------------------------------------------------------- 2. selection */

export const MODULES = {
  workout: { id: 'workout', name: 'Daily Knowledge Workout', blurb: 'Reviews, weak spots, something new and one hard question. 5 to 10 minutes.', sizes: [5, 8, 10], size: 8 },
  rapid: { id: 'rapid', name: 'Rapid Fire', blurb: 'Ten quick questions across every subject. Gets harder as you go.', size: 10, timer: true },
  assoc: { id: 'assoc', name: 'Associations', blurb: 'Authors and works, scientists and discoveries, in both directions.', size: 8 },
  trick: { id: 'trick', name: 'Precision Training', blurb: 'Look-alikes, misconceptions and careful wording. Every answer is defensible.', size: 8 },
  chrono: { id: 'chrono', name: 'Dates and Chronology', blurb: 'What came first, which century, in what order.', size: 8 },
  clues: { id: 'clues', name: 'Progressive Clues', blurb: 'Name it from clues. The earlier you get it, the more it is worth.', size: 6 },
  exam: { id: 'exam', name: 'Champion Examination', blurb: 'Mixed subjects, no hints, formulations you have not seen. A full report.', size: 20, timer: true },
};
export const TIMER_SECONDS = { 1: 20, 2: 15, 3: 12 }; // suggested seconds per level when the optional timer is on. Never a penalty in learning.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A concept's subject (from the first question of its family). */
function annotate(ctx, list) {
  return list.map((c) => {
    const q = ctx.byId.get(c.id);
    return { ...c, subject: subjectOf(q ?? c) };
  });
}

/**
 * Pick `n` concepts from `pool`, keeping the learning engine's priorities (relearning, due, fragile, new) but spreading them
 * over subjects in proportion to the plan's weights. No subject gets more than its quota while others still have candidates,
 * so a familiar category never takes over, and a weak one never makes the session monotonous.
 */
export function pickBalanced({ pool, items, now, seed, n, weights, mode = 'daily', target = 1, exclude = [], minSubjects = 3 }) {
  if (!pool.length || n < 1) return [];
  const want = Math.min(n, pool.length);
  const ranked = selectSession({ items, pool, now, seed, mode, target, size: Math.min(pool.length, Math.max(want * 4, 12)), exclude, cfg: { size: want, newRatio: 0.4, maxPerConcept: 1, minCategories: 1, maintainRatio: 0.15 } });
  const subjectOfId = new Map(pool.map((c) => [c.id, c.subject]));
  const present = [...new Set(pool.map((c) => c.subject))].filter((s) => (weights[s] ?? 1) > 0);
  const totalW = present.reduce((s, k) => s + (weights[k] ?? 1), 0) || 1;
  const quota = new Map(present.map((k) => [k, Math.max(1, Math.round((want * (weights[k] ?? 1)) / totalW))]));
  const taken = []; const count = new Map(); const used = new Set();
  const add = (x) => { used.add(x.id); taken.push(x); count.set(subjectOfId.get(x.id), (count.get(subjectOfId.get(x.id)) ?? 0) + 1); };
  for (const x of ranked) { if (taken.length >= want) break; const s = subjectOfId.get(x.id); if (quota.has(s) && (count.get(s) ?? 0) < quota.get(s)) add(x); }
  // not enough because quotas were tight or ranked was short: top up from the rest of the ranking, then from the pool
  for (const x of ranked) { if (taken.length >= want) break; if (!used.has(x.id) && quota.has(subjectOfId.get(x.id))) add(x); }
  if (taken.length < want) {
    const rng = Rng.fromSeed(`${seed}:top`);
    for (const c of rng.shuffle(pool.filter((c2) => !used.has(c2.id) && !exclude.includes(c2.id) && quota.has(c2.subject)))) { if (taken.length >= want) break; add({ id: c.id, category: c.category, subcategory: c.subcategory ?? null, reason: 'practice', state: (items[c.id] ?? newItem(c.id, now)).state, it: items[c.id] ?? newItem(c.id, now), level: 1 }); }
  }
  // the subject spread is a promise: if the session came out with too few subjects and others exist, swap one in
  if (present.length >= minSubjects && new Set(taken.map((x) => subjectOfId.get(x.id))).size < Math.min(minSubjects, want)) {
    const have = new Set(taken.map((x) => subjectOfId.get(x.id)));
    const extra = pool.find((c) => !used.has(c.id) && !have.has(c.subject) && quota.has(c.subject) && !exclude.includes(c.id));
    if (extra) { const last = taken.pop(); used.delete(last.id); add({ id: extra.id, category: extra.category, subcategory: extra.subcategory ?? null, reason: 'practice', state: (items[extra.id] ?? newItem(extra.id, now)).state, it: items[extra.id] ?? newItem(extra.id, now), level: 1 }); }
  }
  return taken;
}

const qOf = (ctx, c, level, reason) => ({ qid: ctx.families.get(c.id)[level].id, family: c.id, level, reason: reason ?? c.reason ?? 'practice', subject: c.subject });

/** The level an examination asks: one the player has not met for this concept, the hardest such level; otherwise the least seen. */
export function examLevel(item) {
  const unseen = [1, 2, 3].filter((l) => item.seen[l] === 0);
  if (unseen.length) return Math.max(...unseen);
  const least = Math.min(...[1, 2, 3].map((l) => item.seen[l]));
  return Math.max(...[1, 2, 3].filter((l) => item.seen[l] === least));
}

/** The concepts of the bank that belong to a module's own question format. */
function formatPool(ctx, now, format) {
  const fams = new Set(ctx.questions.filter((q) => q.format === format && q.family).map((q) => q.family));
  return annotate(ctx, conceptsFor(ctx, { now }).filter((c) => fams.has(c.id)));
}

/**
 * Questions for one session of an Academy module (not clues: see buildClues).
 *   mode: workout | rapid | assoc | trick | chrono | exam
 * Returns { questions, notice, timer }. `timer` is the suggested seconds per level when the player turned the timer on.
 */
export function buildAcademy(mode, ctx, learn, acad, { now = 0, seed = 'academy', size = null, exclude = [] } = {}) {
  const items = learn?.items ?? {};
  const weights = weightsFor(acad?.plan);
  const rng = Rng.fromSeed(`${seed}:${mode}`);
  const n = size ?? MODULES[mode]?.size ?? 8;
  const st = (c) => items[c.id] ?? newItem(c.id, now);
  const all = annotate(ctx, conceptsFor(ctx, { now })).filter((c) => (weights[c.subject] ?? 1) > 0);
  if (all.length < 5) return { questions: [], notice: 'There are not enough questions for this yet.', timer: TIMER_SECONDS };
  const fin = (questions, notice = null) => ({ questions, notice, timer: TIMER_SECONDS });

  if (mode === 'rapid') {
    const sel = pickBalanced({ pool: all, items, now, seed, n, weights, mode: 'daily', exclude, minSubjects: 4 });
    const ordered = rng.shuffle(sel); // progressive difficulty is set by position, not by who is due
    return fin(ordered.map((x, i) => {
      const c = all.find((y) => y.id === x.id); const it = st(c);
      const target = i < n / 3 ? 1 : i < (2 * n) / 3 ? 2 : 3;
      const level = pickLevel(it, target, rng);
      return qOf(ctx, c, ctx.families.get(c.id)[level] ? level : 1, x.reason);
    }));
  }
  if (mode === 'workout') {
    const hardPool = all.filter((c) => ['review', 'mastered'].includes(st(c).state));
    const hard = hardPool.length ? Rng.fromSeed(`${seed}:hard`).pick(hardPool) : null;
    const body = pickBalanced({ pool: all, items, now, seed, n: hard ? n - 1 : n, weights, mode: 'daily', exclude: hard ? [...exclude, hard.id] : exclude });
    const qs = body.map((x) => { const c = all.find((y) => y.id === x.id); return qOf(ctx, c, x.level ?? pickLevel(st(c), targetFor(st(c)), rng), x.reason); });
    if (hard) qs.push(qOf(ctx, hard, 3, 'challenge'));
    return fin(qs);
  }
  if (mode === 'exam') {
    // Mostly knowledge the player has already met (to measure retention and transfer), some completely new, never the same
    // formulation as last time when another exists, and never the same concept twice. Subjects are not revealed.
    const met = all.filter((c) => st(c).state !== 'new'); const fresh = all.filter((c) => st(c).state === 'new');
    const nMet = met.length >= 6 ? Math.round(n * 0.7) : 0;
    const a = pickBalanced({ pool: met, items, now, seed: `${seed}:m`, n: nMet, weights, mode: 'mastery', exclude, minSubjects: 4 });
    const b = pickBalanced({ pool: fresh.length ? fresh : all, items, now, seed: `${seed}:f`, n: n - a.length, weights, mode: 'daily', exclude: [...exclude, ...a.map((x) => x.id)], minSubjects: 4 });
    const qs = rng.shuffle([...a, ...b]).map((x) => { const c = all.find((y) => y.id === x.id); return qOf(ctx, c, examLevel(st(c)), 'exam'); });
    return fin(qs, qs.length < n ? `Only ${qs.length} concepts available.` : null);
  }
  const format = { assoc: 'assoc', trick: 'trick', chrono: 'chrono' }[mode];
  if (format) {
    const pool = formatPool(ctx, now, format);
    if (pool.length < 4) return fin([], 'This module has too little content yet.');
    const sel = pickBalanced({ pool, items, now, seed, n, weights: Object.fromEntries(SUBJECTS.map((s) => [s.id, 1])), mode: 'daily', exclude, minSubjects: 2 });
    return fin(sel.map((x) => { const c = pool.find((y) => y.id === x.id); return qOf(ctx, c, x.level ?? pickLevel(st(c), targetFor(st(c)), rng), x.reason); }));
  }
  return fin([], 'Unknown module.');
}

/* ---------------------------------------------------------------- 3. progressive clues */

export const CLUE_COUNT = 4;
/** Points by the clue that gave it away: 4 for the first, 1 for the last. A wrong guess costs nothing but the next clue. */
export const CLUE_POINTS = [4, 3, 2, 1];

/** Clue items that are well formed and answerable: four clues, four distinct choices, one of them the answer. */
export function validClues(file) {
  const ok = [];
  for (const it of file?.items ?? []) {
    const en = (x) => x?.en;
    if (typeof it.id === 'string' && Array.isArray(it.clues) && it.clues.length === CLUE_COUNT && it.clues.every((c) => en(c)) && Array.isArray(it.choices) && it.choices.length === 4 && en(it.answer)
      && new Set(it.choices.map(en)).size === 4 && it.choices.some((c) => c.en === it.answer.en) && !it.clues.some((c) => c.en.toLowerCase().includes(it.answer.en.toLowerCase()))) ok.push(it);
  }
  return ok;
}

/** A session of clue items: due and fragile first, then unseen, spread over subjects. Deterministic for the seed. */
export function buildClues(file, learn, acad, { now = 0, seed = 'clues', size = MODULES.clues.size } = {}) {
  const items = learn?.items ?? {};
  const weights = weightsFor(acad?.plan);
  const clues = validClues(file);
  if (clues.length < 4) return { items: [], notice: 'No clue puzzles are available yet.' };
  const rng = Rng.fromSeed(`${seed}:clues`);
  const rank = (c) => { const it = items[c.id]; if (!it || it.state === 'new') return 2; if (isDue(it, now) || it.state === 'relearning') return 0; if (isFragile(it)) return 1; return 3; };
  const pool = rng.shuffle(clues).map((c) => ({ c, subject: subjectOf({ category: c.category, subcategory: c.subcategory }) })).filter((x) => (weights[x.subject] ?? 1) > 0);
  pool.sort((a, b) => rank(a.c) - rank(b.c));
  const picked = []; const perSubject = new Map(); const cap = Math.max(2, Math.ceil(size / 3));
  for (const x of pool) { if (picked.length >= size) break; if ((perSubject.get(x.subject) ?? 0) < cap) { picked.push(x.c); perSubject.set(x.subject, (perSubject.get(x.subject) ?? 0) + 1); } }
  for (const x of pool) { if (picked.length >= size) break; if (!picked.includes(x.c)) picked.push(x.c); }
  return { items: picked.map((c) => ({ ...c, order: rng.shuffle([0, 1, 2, 3]) })), notice: null };
}

/** A clue round as a learning outcome: the clue that solved it counts like hints (the first is fully independent). */
export function clueOutcome(item, { solvedAt, wrongs = [] }) {
  const correct = solvedAt != null;
  return { id: item.id, qid: item.id, correct, hints: correct ? Math.min(2, solvedAt) : 0, confidence: null, level: Math.min(3, Math.max(1, item.d ?? 2)), wrongText: !correct && wrongs.length ? String(wrongs.at(-1)).slice(0, 60) : null, clue: correct ? solvedAt + 1 : null, cat: item.category ?? null, sub: item.subcategory ?? null, subject: subjectOf({ category: item.category, subcategory: item.subcategory }) };
}
export const cluePoints = (solvedAt) => (solvedAt == null ? 0 : CLUE_POINTS[solvedAt] ?? 0);

/* ---------------------------------------------------------------- 4. recording */

export const MAX_ANSWERS = 800;
export const MAX_SESSIONS = 80;

export const emptyAcad = () => ({ v: ACADEMY_VERSION, plan: { id: 'balanced', custom: {} }, answers: [], sessions: [], achv: {}, timer: false });

/**
 * The stored form of each answer of a finished run: what analytics needs and nothing personal.
 * `learnItems` is the learning record BEFORE the answers were applied, so `gap` (time since the concept was last asked)
 * and `form` ('new' = a formulation the player had not met for a concept they already knew) describe the situation at answer time.
 */
export function entriesFromRun(answers, ctx, learnItems, { mode, now, timed = false, limits = null }) {
  // A question asked again straight after a miss teaches; it does not measure. Only first attempts are recorded.
  return answers.filter((a) => !a.retry).map((a, i) => {
    const q = ctx.byId.get(a.qid);
    const it = learnItems[a.id];
    const known = Boolean(it && it.state !== 'new' && it.last > 0);
    const level = [1, 2, 3].includes(a.level) ? a.level : null;
    const form = known && level && it.seen[level] === 0 ? 'new' : 'seen';
    const ms = Number.isFinite(a.ms) ? Math.min(600_000, Math.max(0, Math.round(a.ms))) : null;
    return {
      t: now + i, id: String(a.id).slice(0, 40), subj: q ? subjectOf(q) : (a.subject ?? 'everyday'), cat: q?.category ?? a.cat ?? null, sub: q?.subcategory ?? a.sub ?? null,
      mode, level, ok: a.correct ? 1 : 0, hints: Math.min(2, Math.max(0, a.hints | 0)), conf: ['sure', 'maybe', 'guess'].includes(a.confidence) ? a.confidence : null,
      ms, timed: Boolean(timed), late: Boolean(timed && ms != null && level && limits && ms > limits[level] * 1000),
      gap: known ? Math.round(Math.max(0, now - it.last) / 60_000) : null, // minutes since the concept was last asked
      form, clue: a.clue ?? null, fmt: q?.format ?? null, stake: a.stake ?? null,
    };
  });
}

/** Clean a saved Academy record. Anything odd falls back to a safe default; nothing throws. */
export function cleanAcad(raw) {
  const out = emptyAcad();
  if (!raw || typeof raw !== 'object') return out;
  const plan = raw.plan ?? {};
  out.plan = { id: PLANS[plan.id] ? plan.id : 'balanced', custom: {} };
  for (const s of SUBJECTS) { const v = plan.custom?.[s.id]; if (Number.isFinite(v)) out.plan.custom[s.id] = Math.min(3, Math.max(0, v)); }
  out.timer = raw.timer === true;
  const num = (v, d = 0, lo = 0, hi = 1e15) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  out.answers = (Array.isArray(raw.answers) ? raw.answers : []).filter((a) => a && typeof a.id === 'string' && Number.isFinite(a.t)).slice(-MAX_ANSWERS).map((a) => ({
    t: a.t, id: a.id.slice(0, 40), subj: SUBJECT[a.subj] ? a.subj : 'everyday', cat: typeof a.cat === 'string' ? a.cat.slice(0, 30) : null, sub: typeof a.sub === 'string' ? a.sub.slice(0, 40) : null,
    mode: typeof a.mode === 'string' ? a.mode.slice(0, 12) : 'workout', level: [1, 2, 3].includes(a.level) ? a.level : null, ok: a.ok ? 1 : 0,
    hints: Math.floor(num(a.hints, 0, 0, 2)), conf: ['sure', 'maybe', 'guess'].includes(a.conf) ? a.conf : null, ms: a.ms == null ? null : num(a.ms, null, 0, 600_000),
    timed: Boolean(a.timed), late: Boolean(a.late), gap: a.gap == null ? null : num(a.gap, null, 0, 1e9), form: a.form === 'new' ? 'new' : 'seen', clue: [1, 2, 3, 4].includes(a.clue) ? a.clue : null, fmt: typeof a.fmt === 'string' ? a.fmt.slice(0, 10) : null, stake: null,
  }));
  out.sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter((s) => s && Number.isFinite(s.t)).slice(-MAX_SESSIONS).map((s) => ({
    t: s.t, mode: typeof s.mode === 'string' ? s.mode.slice(0, 12) : 'workout', n: Math.floor(num(s.n, 0, 0, 1000)), right: Math.floor(num(s.right, 0, 0, 1000)), score: Math.floor(num(s.score, 0, 0, 1e6)),
    ms: s.ms == null ? null : num(s.ms, null, 0, 1e9), timed: Boolean(s.timed),
  }));
  for (const [k, v] of Object.entries(raw.achv ?? {}).slice(0, 40)) if (typeof k === 'string' && Number.isFinite(v)) out.achv[k.slice(0, 30)] = v;
  return out;
}

/** Merge two Academy records (two devices): union of answers and sessions by time and id, plan and timer from the newer write. */
export function mergeAcad(a, b) {
  const x = cleanAcad(a); const y = cleanAcad(b);
  const key = (e) => `${e.t}:${e.id}`;
  const answers = [...new Map([...x.answers, ...y.answers].map((e) => [key(e), e])).values()].sort((p, q) => p.t - q.t).slice(-MAX_ANSWERS);
  const sessions = [...new Map([...x.sessions, ...y.sessions].map((s) => [`${s.t}:${s.mode}`, s])).values()].sort((p, q) => p.t - q.t).slice(-MAX_SESSIONS);
  const lastX = x.sessions.at(-1)?.t ?? 0; const lastY = y.sessions.at(-1)?.t ?? 0;
  const newer = lastY > lastX ? y : x;
  const achv = { ...y.achv, ...x.achv };
  for (const k of Object.keys(achv)) achv[k] = Math.min(x.achv[k] ?? Infinity, y.achv[k] ?? Infinity);
  return { v: ACADEMY_VERSION, plan: newer.plan, timer: newer.timer, answers, sessions, achv };
}

/** Rapid Fire's competitive score. Accuracy pays most, level adds, a streak adds a little, a fast right answer (timer on) adds a little. */
export function rapidScore(entries) {
  let score = 0; let streak = 0;
  for (const e of entries) {
    if (!e.ok) { streak = 0; continue; }
    streak++;
    score += 10 + 5 * ((e.level ?? 1) - 1) + Math.min(10, (streak - 1) * 2);
    if (e.timed && !e.late) score += 3;
  }
  return score;
}

/* ---------------------------------------------------------------- 5. analytics */

const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
const group = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); if (k != null) m.set(k, [...(m.get(k) ?? []), x]); } return m; };
const acc = (list) => ({ n: list.length, right: list.filter((e) => e.ok).length, pct: pct(list.filter((e) => e.ok).length, list.length) });

/** Below this many answers a figure is shown as "not enough data" instead of a percentage that would mislead. */
export const MIN_SAMPLE = 5;
export const DELAY_MIN = 24 * 60; // minutes: a recall after at least a day counts as delayed

/**
 * Every statistic, from the stored answers (and the learning record for schedule facts). Four separate families:
 * game (immediate performance), independent (recall with no hint), delayed (a day or more after the last time), transfer (a new formulation).
 */
export function academyStats(acad, learn, ctx, now = 0) {
  const a = cleanAcad(acad).answers;
  const items = learn?.items ?? {};
  const known = (s) => s.n >= MIN_SAMPLE;
  const delayed = a.filter((e) => e.gap != null && e.gap >= DELAY_MIN && e.hints === 0);
  const transfer = a.filter((e) => e.form === 'new' && e.hints === 0);
  const timed = a.filter((e) => e.timed && e.ms != null); const untimed = a.filter((e) => !e.timed);
  const speed = a.filter((e) => e.ms != null);
  const bySubject = SUBJECTS.map((s) => ({ id: s.id, label: s.label, ...acc(a.filter((e) => e.subj === s.id)) })).filter((s) => s.n > 0).sort((p, q) => (q.pct ?? -1) - (p.pct ?? -1));
  const subs = [...group(a, (e) => (e.cat && e.sub ? `${e.cat}/${e.sub}` : null)).entries()].map(([k, l]) => ({ key: k, ...acc(l) })).filter(known);
  const weakest = subs.filter((s) => s.pct < 70).sort((p, q) => p.pct - q.pct || q.n - p.n).slice(0, 5);
  // most improved: the same subject's first and last thirds of answers (needs at least 6 per third's worth)
  const improved = [];
  for (const [subj, list] of group(a, (e) => e.subj)) {
    if (list.length < 9) continue;
    const t = Math.floor(list.length / 3); const first = acc(list.slice(0, t)); const last = acc(list.slice(-t));
    if (last.pct - first.pct >= 10) improved.push({ id: subj, label: SUBJECT[subj].label, from: first.pct, to: last.pct, n: list.length });
  }
  improved.sort((p, q) => (q.to - q.from) - (p.to - p.from));
  const calib = ['sure', 'maybe', 'guess'].map((c) => ({ conf: c, ...acc(a.filter((e) => e.conf === c)) }));
  const withHints = a.filter((e) => e.hints > 0);
  const confused = Object.values(items).map((it) => ({ id: it.id, wrong: misconception(it) })).filter((x) => x.wrong).slice(0, 8)
    .map((x) => { const q = ctx?.byId?.get(x.id); return { id: x.id, picked: x.wrong, question: q?.question ?? null }; });
  const states = Object.values(items).reduce((m, it) => { m[it.state] = (m[it.state] ?? 0) + 1; return m; }, {});
  const clueRows = [1, 2, 3, 4].map((c) => ({ clue: c, n: a.filter((e) => e.clue === c).length }));
  const clueAnswered = a.filter((e) => e.mode === 'clues');
  const examSessions = cleanAcad(acad).sessions.filter((s) => s.mode === 'exam');
  return {
    total: a.length,
    overall: acc(a),
    game: { ...acc(a), note: 'Everything you answered here, with or without hints.' },
    independent: { ...acc(a.filter((e) => e.hints === 0)), known: known(acc(a.filter((e) => e.hints === 0))), note: 'Recall with no hint.' },
    delayed: { ...acc(delayed), known: known(acc(delayed)), note: 'Right or wrong a day or more after the concept was last asked.' },
    transfer: { ...acc(transfer), known: known(acc(transfer)), note: 'A formulation you had not met for a concept you already knew.' },
    bySubject,
    speed: { timed: acc(timed), untimed: acc(untimed), medianMs: median(speed.map((e) => e.ms)), onTimePct: pct(timed.filter((e) => !e.late).length, timed.length), note: 'Speed is tracked apart from accuracy; slow answers are never penalised in learning.' },
    calibration: calib.map((c) => ({ ...c, known: known(c) })),
    hints: { share: pct(withHints.length, a.length), withHints: acc(withHints), without: acc(a.filter((e) => e.hints === 0)) },
    weakest, improved,
    due: Object.values(items).filter((it) => isDue(it, now)).length,
    mastered: states.mastered ?? 0, states,
    confused,
    clues: { byClue: clueRows, answered: clueAnswered.length },
    exams: examSessions.slice(-5).map((s) => ({ t: s.t, n: s.n, right: s.right, pct: pct(s.right, s.n) })),
    recent: cleanAcad(acad).sessions.slice(-8).reverse(),
    days: [...new Set(a.map((e) => Math.floor(e.t / DAY)))].length,
  };
}
function median(xs) { const s = xs.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; }

/** The examination report: accuracy, speed, confidence, delayed retention and transfer, each from this sitting's answers alone. */
export function examReport(entries, previous = null) {
  const subj = group(entries, (e) => e.subj);
  const delayed = entries.filter((e) => e.gap != null && e.gap >= DELAY_MIN);
  const transfer = entries.filter((e) => e.form === 'new');
  const sure = entries.filter((e) => e.conf === 'sure'); const guess = entries.filter((e) => e.conf === 'guess');
  const slow = entries.filter((e) => e.late);
  return {
    n: entries.length, ...acc(entries),
    bySubject: [...subj].map(([id, l]) => ({ id, label: SUBJECT[id]?.label ?? id, ...acc(l) })).sort((p, q) => p.pct - q.pct),
    medianMs: median(entries.map((e) => e.ms)), late: slow.length,
    delayed: acc(delayed), transfer: acc(transfer),
    confidence: { sureWrong: sure.filter((e) => !e.ok).length, sure: sure.length, guessRight: guess.filter((e) => e.ok).length, guess: guess.length },
    vsPrevious: previous && previous.n ? { pct: pct(previous.right, previous.n), delta: pct(entries.filter((e) => e.ok).length, entries.length) - pct(previous.right, previous.n) } : null,
    advice: examAdvice(entries, [...subj].map(([id, l]) => ({ id, ...acc(l) }))),
  };
}
function examAdvice(entries, subjects) {
  const out = [];
  const weak = subjects.filter((s) => s.n >= 2 && s.pct < 60).sort((p, q) => p.pct - q.pct)[0];
  if (weak) out.push(`Your weakest subject this time was ${SUBJECT[weak.id]?.label ?? weak.id} (${weak.right} of ${weak.n}).`);
  const sureWrong = entries.filter((e) => e.conf === 'sure' && !e.ok).length;
  if (sureWrong >= 2) out.push(`${sureWrong} answers were wrong although you were sure. Those are the best ones to fix.`);
  const slow = entries.filter((e) => e.late).length;
  if (slow >= 3) out.push(`${slow} answers took longer than the suggested time. Speed is separate from knowledge: train it in Rapid Fire.`);
  if (!out.length) out.push('No clear weak spot in this sitting. Repeat it in a few days: only delayed results show what has stuck.');
  return out;
}

/* ---------------------------------------------------------------- 6. achievements */

/** Rewards for retention and progress. Each is computed from stored answers and the learning record, never granted for playing more. */
export const ACHIEVEMENTS = [
  { id: 'recall25', name: 'Unaided', text: '25 correct answers with no hint.', dust: 10, test: (s) => s.independent.right >= 25 },
  { id: 'recall100', name: 'Sharp memory', text: '100 correct answers with no hint.', dust: 25, test: (s) => s.independent.right >= 100 },
  { id: 'delayed10', name: 'It stuck', text: '10 correct recalls a day or more after the last time.', dust: 20, test: (s) => s.delayed.right >= 10 },
  { id: 'transfer10', name: 'Transferable', text: '10 correct answers on a formulation you had not seen.', dust: 20, test: (s) => s.transfer.right >= 10 },
  { id: 'mastered5', name: 'Provisionally mastered', text: '5 concepts provisionally mastered.', dust: 25, test: (s) => s.mastered >= 5 },
  { id: 'comeback3', name: 'Comeback', text: '3 concepts that once slipped are back in your schedule.', dust: 20, test: (s, l) => Object.values(l?.items ?? {}).filter((it) => it.lapses >= 1 && ['review', 'mastered'].includes(it.state)).length >= 3 },
  { id: 'streak7', name: 'A week of knowledge', text: 'Train 7 days in a row.', dust: 25, test: (s, l) => (l?.streak?.best ?? 0) >= 7 },
  { id: 'exam70', name: 'Examination passed', text: 'Score 70% or more in a Champion Examination of at least 15 questions.', dust: 30, test: (s, l, a) => a.sessions.some((x) => x.mode === 'exam' && x.n >= 15 && x.right / x.n >= 0.7) },
  { id: 'improved', name: 'Rising', text: 'Improve a subject by 10 points or more.', dust: 20, test: (s) => s.improved.length > 0 },
  { id: 'wide', name: 'Wide reader', text: 'Answer in 8 different subjects.', dust: 15, test: (s) => s.bySubject.length >= 8 },
];

/** Ids of achievements earned now and not recorded before. */
export function newAchievements(acad, learn, ctx, now) {
  const a = cleanAcad(acad);
  const stats = academyStats(a, learn, ctx, now);
  return ACHIEVEMENTS.filter((x) => !a.achv[x.id] && x.test(stats, learn, a));
}
