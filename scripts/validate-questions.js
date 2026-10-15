// Validates the question bank in /data/questions. Exits non-zero on errors.
// Usage: npm run validate:questions
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadBank, validateQuestions, DIFFICULTIES } from '../src/engine/bank.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));

const bank = await loadBank(readJson);
const { errors, warnings, stats } = validateQuestions(bank.questions);

console.log(`Question bank v${bank.version}: ${stats.total} questions`);
console.log('By category:  ', JSON.stringify(stats.byCategory));
console.log('By difficulty:', Object.entries(stats.byDifficulty).map(([d, n]) => `${DIFFICULTIES[d]}=${n}`).join('  '));
console.log('By review:    ', JSON.stringify(stats.byReview));

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
