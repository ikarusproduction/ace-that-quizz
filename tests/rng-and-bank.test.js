import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng, hashSeed } from '../src/engine/rng.js';
import { validateQuestions, normalizeQuestion, statCategory, CATEGORIES } from '../src/engine/bank.js';
import { realBank } from './helpers.js';

test('rng: same seed gives the same sequence, different seeds differ', () => {
  const a = Rng.fromSeed('abc');
  const b = Rng.fromSeed('abc');
  const c = Rng.fromSeed('abd');
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  const seqC = Array.from({ length: 10 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
});

test('rng: state can be saved and restored mid-sequence', () => {
  const a = Rng.fromSeed('resume');
  a.next();
  a.next();
  const saved = a.state;
  const expected = [a.next(), a.next(), a.next()];
  const b = new Rng(saved);
  assert.deepEqual([b.next(), b.next(), b.next()], expected);
});

test('rng: shuffle returns a permutation and does not mutate its input', () => {
  const rng = Rng.fromSeed('shuffle');
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = rng.shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...out].sort(), [...input].sort());
});

test('rng: weighted ignores zero weights and roughly follows the weights', () => {
  const rng = Rng.fromSeed('w');
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 4000; i++) counts[rng.weighted({ a: 3, b: 1, c: 0 })]++;
  assert.equal(counts.c, 0);
  assert.ok(counts.a > counts.b * 2, `a=${counts.a} b=${counts.b}`);
  assert.throws(() => rng.weighted({ a: 0 }));
});

test('hashSeed is stable', () => {
  assert.equal(hashSeed('daily-2026-10-15'), hashSeed('daily-2026-10-15'));
  assert.notEqual(hashSeed('daily-2026-10-15'), hashSeed('daily-2026-10-16'));
});

test('bank: the shipped question bank has no validation errors', async () => {
  const bank = await realBank();
  const { errors, stats } = validateQuestions(bank.questions);
  assert.deepEqual(errors, []);
  assert.ok(stats.total >= 200);
});

test('bank: nothing is marked verified, since no human review has happened', async () => {
  const bank = await realBank();
  assert.ok(bank.questions.every((q) => q.review !== 'verified'));
});

test('bank: every category used by the five-slot structure has enough questions for a full run', async () => {
  const { questions } = await realBank();
  const counts = {};
  for (const q of questions) counts[statCategory(q)] = (counts[statCategory(q)] ?? 0) + 1;
  // A full run is 9 rounds; each needs a science, a music/tune and a symbols question.
  assert.ok(counts.science + (counts.phobia ?? 0) >= 9);
  assert.ok(questions.filter((q) => q.category === 'arts' && q.subcategory === 'music').length >= 9);
  assert.ok(counts.symbols >= 9);
  for (const k of ['news', 'history', 'geography', 'nature', 'arts']) assert.ok(counts[k] >= 9, k);
});

test('bank: symbols include chemical symbols, elements, math notation and acronyms', async () => {
  const { questions } = await realBank();
  const symbols = questions.filter((q) => q.category === 'symbols');
  const subs = new Set(symbols.map((q) => q.subcategory));
  for (const s of ['element-symbol', 'periodic-table', 'math-notation', 'abbreviation']) assert.ok(subs.has(s), s);
  const text = symbols.map((q) => q.question).join(' | ');
  for (const sym of ['Fe', 'Au', 'Na']) assert.ok(text.includes(sym) || symbols.some((q) => q.choices.includes(sym)), sym);
});

test('bank: phobias are filed under science but reported as their own statistic', async () => {
  const { questions } = await realBank();
  const phobia = questions.find((q) => q.subcategory === 'phobia');
  assert.equal(phobia.category, 'science');
  assert.equal(statCategory(phobia), 'phobia');
  assert.ok(CATEGORIES.phobia);
});

test('bank: true/false questions are normalised to True/False with the right answer index', () => {
  const t = normalizeQuestion({ id: 'x-1', question: 'Is water wet in this test?', type: 'tf', answer: true, difficulty: 1, explanation: 'Because tests.' }, { category: 'nature' });
  const f = normalizeQuestion({ id: 'x-2', question: 'Is fire cold in this test?', type: 'tf', answer: false, difficulty: 1, explanation: 'Because tests.' }, { category: 'nature' });
  assert.deepEqual(t.choices, ['True', 'False']);
  assert.equal(t.answer, 0);
  assert.equal(f.answer, 1);
});

test('bank validator catches duplicates, bad answers and missing explanations', () => {
  const base = { category: 'nature', subcategory: 'x', difficulty: 2, type: 'mcq', choices: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'Valid explanation.', review: 'unreviewed', freshness: 'evergreen', asOf: null };
  const qs = [
    { ...base, id: 'a-1', question: 'What is the capital of Testland?' },
    { ...base, id: 'a-1', question: 'A completely different question text?' },
    { ...base, id: 'a-3', question: 'What is the capital of Testland?' },
    { ...base, id: 'a-4', question: 'Another unique question here?', answer: 9 },
    { ...base, id: 'a-5', question: 'Yet another question with no reason?', explanation: '' },
    { ...base, id: 'a-6', question: 'Dated question without a date?', freshness: 'dated' },
  ];
  const { errors } = validateQuestions(qs, { minPerCategory: 0 });
  const text = errors.join('\n');
  assert.match(text, /duplicate id/);
  assert.match(text, /same question text/);
  assert.match(text, /answer index out of range/);
  assert.match(text, /explanation missing/);
  assert.match(text, /asOf/);
});
