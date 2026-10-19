// Validates the question bank in /data/questions. Exits non-zero on errors.
// Usage: npm run validate:questions
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadBank, validateQuestions, DIFFICULTIES } from '../src/engine/bank.js';
import { SUBJECTS, subjectOf } from '../src/engine/academy.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));

const bank = await loadBank(readJson);
const { errors, warnings, stats } = validateQuestions([...bank.questions, ...bank.variants]);

console.log(`Question bank v${bank.version}: ${stats.total} questions`);
console.log('By category:  ', JSON.stringify(stats.byCategory));
console.log('By difficulty:', Object.entries(stats.byDifficulty).map(([d, n]) => `${DIFFICULTIES[d]}=${n}`).join('  '));
console.log('By review:    ', JSON.stringify(stats.byReview));

// Champion's Academy checks: expiry, trick misconceptions, honest verification, subject coverage.
const today = Date.now(); const academyErrors = []; const academyWarnings = [];
for (const q of [...bank.questions, ...bank.variants]) {
  if (q.expires && Date.parse(q.expires) <= today) academyWarnings.push(`${q.id} expired on ${q.expires}: it is no longer asked; revalidate or remove it`);
  if (q.verified && !q.source) academyErrors.push(`${q.id} claims verification on ${q.verified} but names no source`);
  if (q.review === 'verified' && !(q.source && q.verified)) academyErrors.push(`${q.id} is marked verified without a source and date`);
  if (q.format === 'trick' && !q.misconception) academyErrors.push(`${q.id} is a precision question without its common misconception`);
}
const perSubject = Object.fromEntries(SUBJECTS.map((x) => [x.id, 0]));
for (const q of bank.questions) perSubject[subjectOf(q)]++;
const total = bank.questions.length;
for (const x of SUBJECTS) {
  if (x.id === 'current') continue;
  if (perSubject[x.id] < 30) academyWarnings.push(`subject "${x.label}" has only ${perSubject[x.id]} concepts (aim for 30 or more)`);
  if (perSubject[x.id] / total > 0.3) academyWarnings.push(`subject "${x.label}" is ${Math.round((100 * perSubject[x.id]) / total)}% of the bank: the rest is under-represented`);
}
console.log('By subject:   ', JSON.stringify(perSubject));
warnings.push(...academyWarnings); errors.push(...academyErrors);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log('  - ' + w);
}
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\nOK: no errors.');
