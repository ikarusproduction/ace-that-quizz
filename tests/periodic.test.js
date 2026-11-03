import test from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENTS, BY_Z, BY_SYMBOL, CATEGORIES, AMBIGUOUS, cell, nameOf } from '../src/engine/elements.js';
import { applies, buildSession, buildQuiz, choicesFor, cardText, checkTyped, outcomeOf, progress, statusOf, cardId, parseCardId, RANGES, FACET_SETS, FACETS, CORE } from '../src/engine/periodic.js';
import { applyAnswers, cleanLearn, DAY } from '../src/engine/learning.js';
import { Rng } from '../src/engine/rng.js';
import { realBank } from './helpers.js';

const T0 = Date.UTC(2026, 10, 3, 9);

test('there are 118 elements with distinct numbers, symbols and names, in order', () => {
  assert.equal(ELEMENTS.length, 118);
  ELEMENTS.forEach((e, i) => assert.equal(e.z, i + 1));
  assert.equal(new Set(ELEMENTS.map((e) => e.symbol)).size, 118);
  assert.equal(new Set(ELEMENTS.map((e) => e.en)).size, 118);
  assert.equal(new Set(ELEMENTS.map((e) => e.fr)).size, 118);
  for (const e of ELEMENTS) assert.ok(/^[A-Z][a-z]?$/.test(e.symbol), e.symbol);
});

test('well-known facts: symbols from Latin names, positions, families and states', () => {
  const sym = (s) => BY_SYMBOL[s];
  assert.equal(sym('Fe').en, 'Iron'); assert.equal(sym('Au').en, 'Gold'); assert.equal(sym('W').en, 'Tungsten'); assert.equal(sym('Hg').en, 'Mercury'); assert.equal(sym('Pb').z, 82);
  assert.equal(sym('Na').origin, 'natrium'); assert.equal(sym('Sn').origin, 'stannum');
  const at = { H: [1, 1], He: [1, 18], C: [2, 14], Ne: [2, 18], Al: [3, 13], Fe: [4, 8], Zn: [4, 12], Kr: [4, 18], Ag: [5, 11], Lu: [6, 3], Au: [6, 11], Hg: [6, 12], Pb: [6, 14], Rn: [6, 18], Lr: [7, 3], Rf: [7, 4], Nh: [7, 13], Og: [7, 18], Cs: [6, 1] };
  for (const [s, [p, g]] of Object.entries(at)) { assert.equal(sym(s).period, p, s); assert.equal(sym(s).group, g, s); }
  for (const s of ['La', 'Ce', 'Yb', 'Ac', 'U', 'No']) assert.equal(sym(s).group, null, `${s} is in an f-block series`);
  assert.deepEqual(ELEMENTS.filter((e) => e.state === 'gas').map((e) => e.symbol), ['H', 'He', 'N', 'O', 'F', 'Ne', 'Cl', 'Ar', 'Kr', 'Xe', 'Rn']);
  assert.deepEqual(ELEMENTS.filter((e) => e.state === 'liquid').map((e) => e.symbol), ['Br', 'Hg']);
  const count = (c) => ELEMENTS.filter((e) => e.cat === c).length;
  assert.deepEqual({ alkali: count('alkali'), alkaline: count('alkaline'), noble: count('noble'), halogen: count('halogen'), lan: count('lanthanide'), act: count('actinide'), transition: count('transition') }, { alkali: 6, alkaline: 6, noble: 7, halogen: 6, lan: 14, act: 14, transition: 40 });
  for (const e of ELEMENTS) assert.ok(CATEGORIES[e.cat], e.symbol);
});

test('every element has its own cell in the drawn table, the f-block series sit underneath', () => {
  assert.equal(new Set(ELEMENTS.map((e) => `${cell(e).row},${cell(e).col}`)).size, 118);
  for (const e of ELEMENTS) { const c = cell(e); assert.ok(c.row >= 1 && c.row <= 10 && c.col >= 1 && c.col <= 18, e.symbol); }
  assert.equal(cell(BY_SYMBOL.La).row, 9); assert.equal(cell(BY_SYMBOL.Ac).row, 10); assert.equal(cell(BY_SYMBOL.Fe).row, 4);
});

test('a card is only asked where the answer is beyond dispute', () => {
  for (const e of ELEMENTS) {
    if (AMBIGUOUS.group.has(e.z) || e.group == null) assert.equal(applies(e, 'grp'), false, `${e.symbol} group`);
    if (AMBIGUOUS.category.has(e.z)) assert.equal(applies(e, 'cat'), false, `${e.symbol} family`);
    if (e.z > 96) assert.equal(applies(e, 'state'), false, `${e.symbol} state`);
    for (const f of ['sym', 'name', 'num', 'elz', 'per']) assert.equal(applies(e, f), true);
  }
});

test('multiple choice: four distinct choices (three for a state) with exactly one right answer, the same every time', () => {
  for (const e of ELEMENTS) for (const f of FACETS) {
    if (!applies(e, f)) continue;
    const a = choicesFor(e, f, Rng.fromSeed(`${e.z}${f}`), 'en'); const b = choicesFor(e, f, Rng.fromSeed(`${e.z}${f}`), 'en');
    assert.deepEqual(a, b);
    assert.equal(a.choices.length, f === 'state' ? 3 : 4, `${e.symbol} ${f}`);
    assert.equal(new Set(a.choices).size, a.choices.length, `${e.symbol} ${f} ${a.choices}`);
    assert.equal(a.choices[a.answer], cardText(e, f, 'en').answer);
    const fr = choicesFor(e, f, Rng.fromSeed(`${e.z}${f}`), 'fr');
    assert.equal(fr.choices[fr.answer], cardText(e, f, 'fr').answer);
  }
});

test('typed answers: case, accents and the other language do not matter; common spellings are accepted', () => {
  assert.ok(checkTyped(BY_SYMBOL.Fe, 'sym', 'fe')); assert.ok(checkTyped(BY_SYMBOL.Fe, 'sym', ' FE ')); assert.ok(!checkTyped(BY_SYMBOL.Fe, 'sym', 'f'));
  assert.ok(checkTyped(BY_SYMBOL.He, 'name', 'helium')); assert.ok(checkTyped(BY_SYMBOL.He, 'name', 'Hélium')); assert.ok(checkTyped(BY_SYMBOL.Fe, 'name', 'fer'));
  assert.ok(checkTyped(BY_SYMBOL.Al, 'elz', 'aluminum')); assert.ok(checkTyped(BY_SYMBOL.Cs, 'name', 'cesium')); assert.ok(checkTyped(BY_SYMBOL.S, 'name', 'sulphur'));
  assert.ok(checkTyped(BY_SYMBOL.Fe, 'num', '26')); assert.ok(!checkTyped(BY_SYMBOL.Fe, 'num', '27')); assert.ok(!checkTyped(BY_SYMBOL.Fe, 'sym', ''));
});

test('the first session teaches the first elements in table order, all four cards of each together', () => {
  const s = buildSession({ learn: { items: {} }, now: T0, seed: 'a', size: 20 });
  assert.equal(s.length, 20);
  assert.deepEqual([...new Set(s.map((c) => c.z))], [1, 2, 3, 4, 5]);
  assert.ok(s.every((c) => c.fresh));
  assert.equal(new Set(s.map((c) => c.id)).size, 20);
  const r = buildSession({ learn: { items: {} }, now: T0, seed: 'a', size: 20, range: RANGES[2] }); // 21 to 54
  assert.deepEqual([...new Set(r.map((c) => c.z))], [21, 22, 23, 24, 25]);
  const names = buildSession({ learn: { items: {} }, now: T0, seed: 'a', size: 20, facets: FACET_SETS.names.facets });
  assert.ok(names.every((c) => ['sym', 'name'].includes(c.facet)));
});

test('what is due comes before anything new, and nothing is asked twice in a session', () => {
  const first = buildSession({ learn: { items: {} }, now: T0, seed: 'a', size: 8 });
  let learn = applyAnswers({}, first.map((c) => outcomeOf(c, 'good')), T0);
  const later = T0 + 2 * DAY;
  const s = buildSession({ learn, now: later, seed: 'b', size: 20 });
  const dueIds = new Set(first.map((c) => c.id));
  assert.ok(s.slice(0, 8).every((c) => dueIds.has(c.id) && !c.fresh), 'the eight due cards lead');
  assert.ok(s.slice(8).every((c) => c.fresh));
  assert.equal(new Set(s.map((c) => c.id)).size, s.length);
  const notDue = buildSession({ learn, now: T0 + 60000, seed: 'c', size: 20 });
  assert.ok(notDue.every((c) => c.fresh || dueIds.has(c.id)));
});

test('a miss is tracked as a miss; a success schedules the next review; ids survive the learning record', () => {
  const id = cardId(26, 'sym'); assert.deepEqual(parseCardId(id), { z: 26, facet: 'sym' });
  assert.match(id, /^[\w~.-]{1,40}$/, 'the learning record accepts the id');
  let learn = applyAnswers({}, [outcomeOf({ id }, 'good')], T0);
  assert.equal(cleanLearn(learn).items[id].state, 'learning');
  learn = applyAnswers(learn, [outcomeOf({ id }, 'again', { wrongText: 'F' })], T0 + 20 * 60000);
  assert.equal(learn.items[id].wrongs.F, 1);
  assert.equal(outcomeOf({ id }, 'hard').hints, 1); assert.equal(outcomeOf({ id }, 'easy').confidence, 'sure');
});

test('the table fills in: known needs symbol, name, number and element recalled on a spaced schedule', () => {
  assert.equal(progress({ items: {} }, T0).fresh, 118);
  const ids = CORE.map((f) => cardId(8, f));
  let learn = applyAnswers({}, ids.map((id) => outcomeOf({ id }, 'good')), T0);
  assert.equal(statusOf(learn, 8, T0).state, 'learning');
  for (let d = 1; d <= 8; d++) learn = applyAnswers(learn, ids.map((id) => outcomeOf({ id }, 'good')), T0 + d * 3 * DAY);
  const st = statusOf(learn, 8, T0 + 30 * DAY);
  assert.ok(['review', 'mastered'].includes(st.state), st.state);
  const p = progress(learn, T0 + 30 * DAY);
  assert.equal(p.known, 1); assert.equal(p.fresh, 117);
});

test('quizzes: every question has one right answer, typed rounds only for facets that can be typed', () => {
  const q = buildQuiz({ learn: { items: {} }, now: T0, seed: 'q', size: 12, lang: 'en' });
  assert.equal(q.length, 12);
  for (const x of q) { assert.equal(x.type, 'choice'); assert.equal(x.choices[x.answer], x.correct); }
  const t = buildQuiz({ learn: { items: {} }, now: T0, seed: 'q', size: 12, typed: true, facets: FACET_SETS.all.facets, newLimit: 6 });
  for (const x of t) assert.equal(x.type, ['sym', 'name', 'elz', 'num'].includes(x.facet) ? 'type' : 'choice');
});

test('the Periodic Table category: every element has a recall question, French included, never mixed into the duel bosses', async () => {
  const bank = await realBank();
  const per = bank.questions.filter((q) => q.category === 'periodic');
  assert.ok(per.length >= 190, `${per.length} concepts`);
  for (const e of ELEMENTS) assert.ok(per.some((q) => q.id === `per-${String(e.z).padStart(3, '0')}a`), e.symbol);
  const fam = bank.variants.filter((q) => q.family && q.family.startsWith('per-'));
  assert.ok(fam.length >= 380);
  const fr = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/i18n/fr.json', import.meta.url), 'utf8'));
  for (const q of per) { assert.ok(fr[q.id], `${q.id} has French`); assert.equal(fr[q.id].c.length, q.choices.length); }
  // the generated answers agree with the trainer's own data
  for (const q of per.filter((x) => x.id.endsWith('a'))) {
    const e = BY_Z[Number(q.id.slice(4, 7))];
    assert.ok([e.symbol, e.en].includes(q.choices[q.answer]), `${q.id}: ${q.choices[q.answer]}`);
  }
});
