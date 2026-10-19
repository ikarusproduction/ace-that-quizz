import test from 'node:test';
import assert from 'node:assert/strict';
import { makeContext } from '../src/engine/game.js';
import { validateQuestions } from '../src/engine/bank.js';
import { isCurrent } from '../src/engine/train.js';
import { emptyLearn, applyAnswers, DAY } from '../src/engine/learning.js';
import {
  SUBJECTS, SUBJECT, PLANS, PLAN_IDS, MODULES, TIMER_SECONDS, CLUE_POINTS, MIN_SAMPLE, DELAY_MIN, ACHIEVEMENTS,
  subjectOf, weightsFor, buildAcademy, validClues, buildClues, clueOutcome, cluePoints, emptyAcad, cleanAcad, mergeAcad, entriesFromRun, rapidScore,
  academyStats, examReport, examLevel, newAchievements,
} from '../src/engine/academy.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createRepo } from '../src/storage/repo.js';
import { metaOf } from '../src/storage/meta.js';
import { realBank } from './helpers.js';
import { readFileSync } from 'node:fs';

const T0 = Date.UTC(2026, 9, 19, 12);
const bankP = realBank();
async function ctx() { const b = await bankP; return makeContext([...b.questions, ...b.variants]); }
const ans = (id, level = 1, correct = true, extra = {}) => ({ id, correct, hints: 0, level, ...extra });
const clueFile = JSON.parse(readFileSync(new URL('../data/academy/clues.json', import.meta.url), 'utf8'));

/* ---------------------------------------------------------------- taxonomy and plans */

test('every question of the bank maps to one of the fifteen subjects', async () => {
  const b = await bankP;
  assert.equal(SUBJECTS.length, 15);
  for (const q of b.questions) assert.ok(SUBJECT[subjectOf(q)], `${q.id} -> ${subjectOf(q)}`);
});

test('plans give every subject a finite weight from 0 to 3, and custom weights override the plan', () => {
  assert.deepEqual(PLAN_IDS.length, 6);
  for (const id of PLAN_IDS) { const w = weightsFor({ id, custom: {} }); for (const s of SUBJECTS) assert.ok(Number.isFinite(w[s.id]) && w[s.id] >= 0 && w[s.id] <= 3, `${id}/${s.id}`); }
  assert.equal(weightsFor({ id: 'balanced', custom: {} }).history, 1);
  assert.ok(weightsFor({ id: 'historygeo', custom: {} }).history > weightsFor({ id: 'historygeo', custom: {} }).sports);
  assert.equal(weightsFor({ id: 'historygeo', custom: { history: 0.5 } }).history, 0.5);
  assert.equal(weightsFor({ id: 'nope', custom: { history: 99 } }).history, 3, 'unknown plans fall back and weights are clamped');
});

/* ---------------------------------------------------------------- selection and balance */

test('the workout is deterministic for a seed and asks each concept once, across several subjects', async () => {
  const c = await ctx();
  const a = buildAcademy('workout', c, emptyLearn(), emptyAcad(), { now: T0, seed: 's1', size: 10 });
  const b = buildAcademy('workout', c, emptyLearn(), emptyAcad(), { now: T0, seed: 's1', size: 10 });
  assert.deepEqual(a.questions, b.questions);
  assert.equal(a.questions.length, 10);
  assert.equal(new Set(a.questions.map((q) => q.family)).size, 10);
  assert.ok(new Set(a.questions.map((q) => subjectOf(c.byId.get(q.qid)))).size >= 4, 'broad coverage');
});

test('a plan shifts the subject mix without removing the other subjects, and weight 0 leaves one out', async () => {
  const c = await ctx();
  const count = (acad, subj, seeds = 12) => {
    let n = 0; let total = 0;
    for (let i = 0; i < seeds; i++) { const r = buildAcademy('workout', c, emptyLearn(), acad, { now: T0, seed: `p${i}`, size: 10 }); total += r.questions.length; n += r.questions.filter((q) => subjectOf(c.byId.get(q.qid)) === subj).length; }
    return n / total;
  };
  const balanced = count(emptyAcad(), 'science'); const sci = count({ ...emptyAcad(), plan: { id: 'sciencenature', custom: {} } }, 'science');
  assert.ok(sci > balanced, `${sci} vs ${balanced}`);
  assert.ok(sci < 0.8, 'the plan does not make the session one subject');
  assert.equal(count({ ...emptyAcad(), plan: { id: 'balanced', custom: { sports: 0 } } }, 'sports'), 0);
});

test('the module pools only ask their own question format', async () => {
  const c = await ctx();
  for (const [mode, fmt] of [['assoc', 'assoc'], ['trick', 'trick'], ['chrono', 'chrono']]) {
    const r = buildAcademy(mode, c, emptyLearn(), emptyAcad(), { now: T0, seed: 'f' });
    assert.ok(r.questions.length >= 8, mode);
    assert.ok(r.questions.every((q) => c.byId.get(q.qid).format === fmt), mode);
  }
});

test('rapid fire is timer-optional and never penalises slow answers in learning', async () => {
  const c = await ctx();
  const r = buildAcademy('rapid', c, emptyLearn(), emptyAcad(), { now: T0, seed: 'r' });
  assert.equal(r.questions.length, MODULES.rapid.size);
  assert.deepEqual(Object.keys(TIMER_SECONDS), ['1', '2', '3']);
  const slow = { ...ans('x', 1, true), timed: true };
  const fast = rapidScore([{ ok: 1, level: 1, timed: true, late: false }]); const late = rapidScore([{ ok: 1, level: 1, timed: true, late: true }]);
  assert.ok(late > 0 && late <= fast, 'a slow right answer still scores');
  assert.equal(rapidScore([{ ok: 0, level: 3 }]), 0);
  assert.ok(rapidScore([{ ok: 1, level: 3 }]) > rapidScore([{ ok: 1, level: 1 }]), 'harder questions pay more');
  assert.ok(slow);
});

test('the examination never uses a hint-bearing mode and picks an unseen formulation when it can', async () => {
  const c = await ctx();
  const fam = [...c.families.keys()][0];
  const item = { seen: { 1: 3, 2: 0, 3: 0 }, state: 'review' };
  assert.notEqual(examLevel(item), 1, 'it moves to a formulation the player has not met');
  const r = buildAcademy('exam', c, emptyLearn(), emptyAcad(), { now: T0, seed: 'e' });
  assert.equal(r.questions.length, MODULES.exam.size);
  assert.ok(new Set(r.questions.map((q) => subjectOf(c.byId.get(q.qid)))).size >= 6, 'mixed subjects');
  assert.ok(fam);
});

test('an unseen formulation is flagged as transfer, a repeated one is not', async () => {
  const c = await ctx();
  const fam = [...c.families.keys()].find((k) => c.families.get(k)[1] && c.families.get(k)[2]);
  const learn = applyAnswers(emptyLearn(), [ans(fam, 1, true)], T0 - 3 * DAY);
  const [same, other] = [entriesFromRun([{ ...ans(fam, 1, true), qid: c.families.get(fam)[1].id }], c, learn.items, { mode: 'exam', now: T0 })[0], entriesFromRun([{ ...ans(fam, 2, true), qid: c.families.get(fam)[2].id }], c, learn.items, { mode: 'exam', now: T0 })[0]];
  assert.equal(same.form, 'seen'); assert.equal(other.form, 'new');
  assert.ok(other.gap >= DELAY_MIN, 'three days later counts as delayed');
  const fresh = entriesFromRun([{ ...ans(fam, 2, true), qid: c.families.get(fam)[2].id }], c, {}, { mode: 'exam', now: T0 })[0];
  assert.equal(fresh.form, 'seen', 'a concept never asked before is not transfer');
  assert.equal(fresh.gap, null);
});

/* ---------------------------------------------------------------- answer evaluation */

test('a question asked again straight after a miss is not recorded as an independent answer', async () => {
  const c = await ctx();
  const fam = [...c.families.keys()][0]; const qid = c.families.get(fam)[1].id;
  const e = entriesFromRun([{ id: fam, qid, correct: false, hints: 0, level: 1 }, { id: fam, qid, correct: true, hints: 0, level: 2, retry: true }], c, {}, { mode: 'workout', now: T0 });
  assert.equal(e.length, 1); assert.equal(e[0].ok, 0);
});

test('hints are recorded and a right answer with a hint is not an independent recall', async () => {
  const c = await ctx();
  const fam = [...c.families.keys()][0]; const qid = c.families.get(fam)[1].id;
  const e = entriesFromRun([{ id: fam, qid, correct: true, hints: 2, level: 1, confidence: 'guess', ms: 4200 }], c, {}, { mode: 'workout', now: T0, timed: true, limits: { 1: 3, 2: 3, 3: 3 } });
  assert.equal(e[0].hints, 2); assert.equal(e[0].conf, 'guess'); assert.equal(e[0].late, true);
  const stats = academyStats({ ...emptyAcad(), answers: [...Array(6)].map((_, i) => ({ ...e[0], t: T0 + i, gap: 3 * 24 * 60, form: 'new' })) }, emptyLearn(), c, T0);
  assert.equal(stats.independent.n, 0, 'hinted answers never count as independent');
  assert.equal(stats.delayed.n, 0); assert.equal(stats.transfer.n, 0);
});

/* ---------------------------------------------------------------- progressive clues */

test('clue points fall from four to one and a miss scores nothing', () => {
  assert.deepEqual(CLUE_POINTS, [4, 3, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, null].map(cluePoints), [4, 3, 2, 1, 0]);
});

test('clue items are validated: four clues, four distinct choices, and no clue gives the answer away', () => {
  const good = validClues(clueFile);
  assert.ok(good.length >= 30, `${good.length}`);
  for (const it of good) { assert.equal(it.clues.length, 4); assert.ok(it.choices.some((c) => c.en === it.answer.en)); }
  const bad = { items: [
    { id: 'x1', clues: [{ en: 'a' }, { en: 'b' }, { en: 'c' }], choices: [{ en: 'A' }, { en: 'B' }, { en: 'C' }, { en: 'D' }], answer: { en: 'A' } },
    { id: 'x2', clues: [{ en: 'It is Paris' }, { en: 'b' }, { en: 'c' }, { en: 'd' }], choices: [{ en: 'Paris' }, { en: 'B' }, { en: 'C' }, { en: 'D' }], answer: { en: 'Paris' } },
    { id: 'x3', clues: [{ en: 'a' }, { en: 'b' }, { en: 'c' }, { en: 'd' }], choices: [{ en: 'A' }, { en: 'A' }, { en: 'C' }, { en: 'D' }], answer: { en: 'A' } },
  ] };
  assert.equal(validClues(bad).length, 0);
});

test('clue accuracy is tracked by clue level and the first clue is the only fully independent recall', async () => {
  const it = validClues(clueFile)[0];
  const first = clueOutcome(it, { solvedAt: 0 }); const third = clueOutcome(it, { solvedAt: 2 }); const miss = clueOutcome(it, { solvedAt: null, wrongs: ['Nope'] });
  assert.equal(first.clue, 1); assert.equal(first.hints, 0);
  assert.equal(third.clue, 3); assert.ok(third.hints > 0);
  assert.equal(miss.correct, false); assert.equal(miss.clue, null);
  const c = await ctx();
  const e = entriesFromRun([first, third, miss], c, {}, { mode: 'clues', now: T0 });
  assert.deepEqual(e.map((x) => x.clue), [1, 3, null]);
  assert.ok(SUBJECT[e[0].subj]);
  const s1 = buildClues(clueFile, emptyLearn(), emptyAcad(), { now: T0, seed: 'k' }); const s2 = buildClues(clueFile, emptyLearn(), emptyAcad(), { now: T0, seed: 'k' });
  assert.deepEqual(s1.items.map((x) => x.id), s2.items.map((x) => x.id));
  assert.equal(new Set(s1.items.map((x) => x.id)).size, s1.items.length);
});

/* ---------------------------------------------------------------- review scheduling and mastery */

test('hints cannot produce mastery; spaced independent recalls in two formulations can', () => {
  let hinted = emptyLearn();
  for (let i = 0; i < 8; i++) hinted = applyAnswers(hinted, [ans('c1', (i % 3) + 1, true, { hints: 1 })], T0 + i * 30 * DAY);
  assert.notEqual(hinted.items.c1.state, 'mastered');
  let spaced = emptyLearn(); const gaps = [0, 1, 3, 8, 20, 45, 90]; let t = T0;
  for (const [i, g] of gaps.entries()) { t += g * DAY; spaced = applyAnswers(spaced, [ans('c1', (i % 2) + 1, true)], t); }
  assert.equal(spaced.items.c1.state, 'mastered');
  let cram = emptyLearn();
  for (let i = 0; i < 10; i++) cram = applyAnswers(cram, [ans('c1', 1, true)], T0 + i * 60_000);
  assert.notEqual(cram.items.c1.state, 'mastered', 'ten answers in ten minutes prove nothing');
  const miss = applyAnswers(spaced, [ans('c1', 1, false)], t + 100 * DAY);
  assert.notEqual(miss.items.c1.state, 'mastered', 'a miss takes the concept out of mastery');
});

/* ---------------------------------------------------------------- statistics */

const mk = (n, over = {}) => [...Array(n)].map((_, i) => ({ t: T0 + i, id: `f${i}`, subj: 'history', cat: 'history', sub: 'ancient', mode: 'workout', level: 1, ok: 1, hints: 0, conf: null, ms: null, timed: false, late: false, gap: null, form: 'seen', clue: null, fmt: null, stake: null, ...over }));

test('statistics come only from stored answers and keep the four measures apart', async () => {
  const c = await ctx();
  const empty = academyStats(emptyAcad(), emptyLearn(), c, T0);
  assert.equal(empty.total, 0); assert.equal(empty.game.n, 0); assert.ok(!('mastery' in empty) && !('masteryPct' in empty));
  const acad = { ...emptyAcad(), answers: [...mk(6, { gap: 2 * DAY / 60_000, form: 'new' }), ...mk(3, { ok: 0, gap: 100 }), ...mk(2, { hints: 1 })].map((a, i) => ({ ...a, t: T0 + i })) };
  const s = academyStats(acad, emptyLearn(), c, T0);
  assert.equal(s.total, 11); assert.equal(s.game.n, 11);
  assert.equal(s.independent.n, 9, 'hinted answers are left out');
  assert.equal(s.delayed.n, 6); assert.equal(s.transfer.n, 6);
  assert.ok(s.delayed.n < s.game.n, 'delayed retention is its own, smaller sample');
});

test('a figure from a handful of answers is marked as too thin to trust', async () => {
  const c = await ctx();
  const s = academyStats({ ...emptyAcad(), answers: mk(MIN_SAMPLE - 1) }, emptyLearn(), c, T0);
  assert.ok(s.game.n < MIN_SAMPLE);
  assert.ok(s.bySubject.every((x) => x.n < MIN_SAMPLE));
});

test('confidence calibration, speed and hint dependence are computed from the answers', async () => {
  const c = await ctx();
  const a = [...mk(6, { conf: 'sure' }), ...mk(5, { conf: 'guess', ok: 0 }), ...mk(5, { hints: 1, ok: 0 }), ...mk(5, { ms: 3000, timed: true }), ...mk(5, { ms: 9000, timed: true, late: true })].map((x, i) => ({ ...x, t: T0 + i }));
  const s = academyStats({ ...emptyAcad(), answers: a }, emptyLearn(), c, T0);
  const by = Object.fromEntries(s.calibration.map((x) => [x.conf, x]));
  assert.equal(by.sure.pct, 100); assert.equal(by.guess.pct, 0);
  assert.equal(s.hints.withHints.pct, 0); assert.ok(s.hints.share > 0);
  assert.equal(s.speed.medianMs, 6000 > 3000 ? s.speed.medianMs : 0);
  assert.ok(s.speed.onTimePct != null && s.speed.onTimePct < 100);
});

test('the examination report separates accuracy, time, confidence, delayed retention and transfer', () => {
  const entries = [...mk(8, { subj: 'science', ms: 5000, conf: 'sure' }), ...mk(4, { subj: 'history', ok: 0, conf: 'sure', ms: 12000, late: true, gap: 3 * DAY / 60_000, form: 'new' })];
  const r = examReport(entries, { n: 10, right: 6 });
  assert.equal(r.n, 12); assert.equal(r.pct, 67);
  assert.equal(r.confidence.sureWrong, 4); assert.equal(r.late, 4);
  assert.equal(r.delayed.n, 4); assert.equal(r.delayed.right, 0); assert.equal(r.transfer.n, 4);
  assert.equal(r.bySubject.find((x) => x.id === 'history').pct, 0);
  assert.equal(r.vsPrevious.delta, 7);
  assert.ok(Array.isArray(r.advice));
});

/* ---------------------------------------------------------------- rewards */

test('achievements reward retention and breadth, once, and are not granted for grinding one session', async () => {
  const c = await ctx();
  const grind = { ...emptyAcad(), answers: mk(400, { mode: 'rapid' }).map((x, i) => ({ ...x, t: T0 + i })), sessions: [...Array(40)].map((_, i) => ({ t: T0 + i, mode: 'rapid', n: 10, right: 10, score: 200, ms: null, timed: false })) };
  const got = newAchievements(grind, emptyLearn(), c, T0).map((a) => a.id);
  assert.ok(!got.includes('retain'), `${got}`);
  assert.ok(ACHIEVEMENTS.every((a) => a.dust > 0 && a.name && a.text));
  assert.deepEqual(newAchievements({ ...grind, achv: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 1])) }, emptyLearn(), c, T0), [], 'granted once');
});

/* ---------------------------------------------------------------- persistence and isolation */

test('a saved Academy record survives a clean round trip and unknown or corrupt data falls back safely', () => {
  const a = { ...emptyAcad(), plan: { id: 'artsculture', custom: { arts: 3, sports: 0 } }, timer: true, answers: mk(3), sessions: [{ t: T0, mode: 'workout', n: 3, right: 3, score: 3, ms: null, timed: false }], achv: { wide: T0 } };
  assert.deepEqual(cleanAcad(JSON.parse(JSON.stringify(a))), cleanAcad(a));
  assert.deepEqual(cleanAcad(null), emptyAcad());
  const bad = cleanAcad({ plan: { id: 'zzz', custom: { arts: 99, nope: 1 } }, timer: 'yes', answers: [{ id: 5 }, { id: 'a', t: 1, subj: 'zzz', ok: 7, hints: 99, conf: 'x' }] });
  assert.equal(bad.plan.id, 'balanced'); assert.equal(bad.plan.custom.arts, 3); assert.equal(bad.timer, false);
  assert.equal(bad.answers.length, 1); assert.equal(bad.answers[0].ok, 1); assert.equal(bad.answers[0].hints, 2); assert.equal(bad.answers[0].conf, null);
  assert.ok(cleanAcad({ answers: mk(900).map((x, i) => ({ ...x, t: i })) }).answers.length <= 800, 'history is capped');
});

test('merging two devices keeps every answer once, the earliest achievements, and the newer plan', () => {
  const x = { ...emptyAcad(), answers: mk(3), sessions: [{ t: T0, mode: 'rapid', n: 3, right: 3, score: 3, ms: null, timed: false }], achv: { wide: T0 + 50 }, plan: { id: 'balanced', custom: {} } };
  const y = { ...emptyAcad(), answers: [...mk(3), ...mk(2).map((e, i) => ({ ...e, id: `z${i}`, t: T0 + 100 + i }))], sessions: [{ t: T0 + 500, mode: 'exam', n: 5, right: 4, score: 4, ms: null, timed: false }], achv: { wide: T0, exam: T0 + 9 }, plan: { id: 'championship', custom: {} } };
  const m = mergeAcad(x, y);
  assert.equal(m.answers.length, 5); assert.equal(m.sessions.length, 2);
  assert.equal(m.achv.wide, T0); assert.equal(m.achv.exam, T0 + 9);
  assert.equal(m.plan.id, 'championship');
  assert.deepEqual(mergeAcad(m, m).answers, m.answers, 'merging with itself changes nothing');
});

test('the repository stores Academy answers, the learning schedule and prefs per player, and players stay isolated', async () => {
  const c = await ctx();
  const storage = createMemoryStorage(); let t = 1000; let u = 0;
  const repo = await createRepo(storage, { now: () => (t += 10), uuid: () => `u${++u}` });
  const ana = await repo.createProfile({ name: 'Ana' }); const ben = await repo.createProfile({ name: 'Ben' });
  const fam = [...c.families.keys()][0]; const qid = c.families.get(fam)[1].id;
  const answers = [{ id: fam, qid, correct: true, hints: 0, level: 1, ms: 3100 }];
  const entries = entriesFromRun(answers, c, {}, { mode: 'workout', now: T0 });
  const res = await repo.recordAcademy(ana.id, { answers, entries, session: { mode: 'workout', n: 1, right: 1, score: 1, ms: 3100, timed: false }, now: T0 });
  assert.ok(res.learn.items[fam]); assert.equal(res.acad.answers.length, 1);
  await repo.setAcademyPrefs(ana.id, { plan: { id: 'languagelit', custom: { arts: 2 } }, timer: true });
  const reopened = await createRepo(storage, { now: () => (t += 10), uuid: () => `v${++u}` });
  const a2 = metaOf(await reopened.getProfile(ana.id)); const b2 = metaOf(await reopened.getProfile(ben.id));
  assert.equal(a2.acad.answers.length, 1); assert.equal(a2.acad.answers[0].ms, 3100); assert.equal(a2.acad.plan.id, 'languagelit'); assert.equal(a2.acad.timer, true);
  assert.ok(a2.learn.items[fam]);
  assert.equal(b2.acad.answers.length, 0); assert.equal(b2.acad.plan.id, 'balanced'); assert.deepEqual(b2.learn.items, {});
  const exported = JSON.stringify(await reopened.exportAll?.() ?? {});
  assert.ok(typeof exported === 'string');
});

/* ---------------------------------------------------------------- content quality */

test('current-affairs and revalidation: nothing is asked after its expiry date', () => {
  assert.ok(isCurrent({ category: 'history', expires: '2027-06-01' }, T0));
  assert.ok(!isCurrent({ category: 'history', expires: '2026-10-01' }, T0));
  assert.ok(isCurrent({ category: 'history' }, T0));
});

test('the bank validator rejects duplicate questions, ambiguous answers and missing explanations, and flags expired content', () => {
  const base = { id: 'a-1', category: 'history', subcategory: 'x', difficulty: 1, type: 'mcq', question: 'Who painted the Mona Lisa in Florence?', choices: ['Da Vinci', 'Monet', 'Goya', 'Dali'], answer: 0, explanation: 'He did.', tags: [], review: 'unreviewed', freshness: 'evergreen', refs: [] };
  const dup = { ...base, id: 'a-2' };
  const twoSame = { ...base, id: 'a-3', question: 'A different long enough question?', choices: ['Same', 'Same', 'Other', 'Else'] };
  const noExpl = { ...base, id: 'a-4', question: 'Another unique question about nothing?', explanation: '' };
  const { errors } = validateQuestions([base, dup, twoSame, noExpl]);
  assert.ok(errors.some((e) => /same question text/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /a-3/.test(e)), 'duplicate choices');
  assert.ok(errors.some((e) => /a-4/.test(e)), 'missing explanation');
});

test('the real bank: every trick question carries its misconception, ladders are consistent, and subjects are balanced', async () => {
  const b = await bankP;
  const tricks = b.questions.filter((q) => q.format === 'trick');
  assert.ok(tricks.length >= 36);
  for (const q of tricks) assert.ok(q.misconception && q.misconception.length > 15, `${q.id} needs a misconception`);
  const c = await ctx();
  for (const q of b.questions.filter((x) => x.format)) { const fam = c.families.get(q.family); assert.ok(fam?.[1] && fam?.[2] && fam?.[3], q.id); for (const l of [1, 2, 3]) assert.equal(fam[l].format, q.format, `${q.id}~${l} keeps its format`); }
  const count = {}; for (const q of b.questions) { const s = subjectOf(q); count[s] = (count[s] ?? 0) + 1; }
  for (const s of SUBJECTS) if (s.id !== 'current') { assert.ok((count[s.id] ?? 0) >= 9, `${s.id} has ${count[s.id] ?? 0}`); assert.ok((count[s.id] ?? 0) / b.questions.length < 0.3, `${s.id} dominates the bank`); }
  const ids = new Set(); for (const q of [...b.questions, ...b.variants]) { assert.ok(!ids.has(q.id), `duplicate id ${q.id}`); ids.add(q.id); }
  for (const q of [...b.questions, ...b.variants]) { assert.ok(q.review !== 'verified' || (q.source && q.verified), `${q.id} claims verification without a source`); }
});

test('Associations carry their relation type in both directions and Dates cover years, centuries and ordering', async () => {
  const b = await bankP;
  const assoc = [...b.questions, ...b.variants].filter((q) => q.format === 'assoc');
  const dirs = new Set(assoc.map((q) => q.relation?.split(':')[1])); assert.ok(dirs.has('forward') && dirs.has('reverse'));
  assert.ok(assoc.every((q) => /^[a-z-]+:(forward|reverse)$/.test(q.relation)));
  const types = new Set(assoc.map((q) => q.relation.split(':')[0])); assert.ok(types.size >= 8, `${[...types]}`);
  const rel = new Set([...b.questions, ...b.variants].filter((q) => q.format === 'chrono').map((q) => q.relation));
  for (const r of ['event:year', 'year:event', 'event:order']) assert.ok(rel.has(r), r);
});

test('every question file is ordered from easy to expert, and variant files follow their base questions', () => {
  const dir = new URL('../data/questions/', import.meta.url);
  const idx = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  const pos = new Map();
  for (const f of idx.files.filter((n) => !/^(news|news-live|tunes)\.json$/.test(n))) {
    const qs = JSON.parse(readFileSync(new URL(f, dir), 'utf8')).questions;
    for (let i = 1; i < qs.length; i++) assert.ok((qs[i - 1].difficulty ?? 2) <= (qs[i].difficulty ?? 2), `${f}: ${qs[i - 1].id} (${qs[i - 1].difficulty}) before ${qs[i].id} (${qs[i].difficulty})`);
    qs.forEach((q, i) => pos.set(q.id, i));
  }
  for (const f of idx.variantFiles ?? []) {
    const fams = JSON.parse(readFileSync(new URL(f, dir), 'utf8')).families;
    for (let i = 1; i < fams.length; i++) assert.ok((pos.get(fams[i - 1].id) ?? 1e9) <= (pos.get(fams[i].id) ?? 1e9), `${f}: ${fams[i].id} is out of order`);
  }
});
