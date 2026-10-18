// Checks one difficulty-ladder file: node scripts/check-variants.mjs data/questions/variants/<name>.json
// Every primary question listed in the matching source file must have a family with all three levels,
// 4 distinct choices, a valid answer, and sensible text. Exits non-zero on errors.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { loadBank, validateQuestions, applyVariants, levelOfDifficulty } from '../src/engine/bank.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));
const target = process.argv[2];
if (!target) { console.error('usage: check-variants.mjs <variants file>'); process.exit(2); }
const rel = resolve(target).replace(root, '').replace(/^\//, '');
const file = await readJson(rel);
const bank = await loadBank(readJson);
const mine = bank.questions.filter((q) => q.category === file.category && !['news', 'news-live', 'tunes'].includes(q.category));
const variants = applyVariants(bank.questions, [file]);
const errors = [];
const warnings = [];
const fams = new Map((file.families ?? []).map((f) => [f.id, f]));
for (const q of mine) {
  const fam = fams.get(q.id);
  if (!fam) { errors.push(`${q.id}: no family in the variants file`); continue; }
  const own = levelOfDifficulty(q.difficulty);
  for (const l of [1, 2, 3]) {
    if (!fam.ask?.[l] || fam.ask[l].length > 28) errors.push(`${q.id}: ask[${l}] missing or longer than 28 chars`);
    if (l !== own && !variants.some((v) => v.family === q.id && v.level === l)) errors.push(`${q.id}: missing level ${l} variant`);
  }
}
for (const id of fams.keys()) if (!mine.some((q) => q.id === id)) errors.push(`${id}: family for a question that does not exist in ${file.category}`);
const r = validateQuestions([...mine, ...variants], { minPerCategory: 0 });
errors.push(...r.errors);
warnings.push(...r.warnings.filter((w) => !w.startsWith('category ')));
const pos = [0, 0, 0, 0];
for (const v of variants) pos[v.answer]++;
console.log(`${file.category}: ${mine.length} questions, ${variants.length} variants, answer positions ${pos.join('/')}`);
if (warnings.length) console.log(warnings.slice(0, 20).map((w) => '  warn: ' + w).join('\n'));
if (errors.length) { console.error(errors.slice(0, 60).map((e) => '  ERROR: ' + e).join('\n')); process.exit(1); }
console.log('OK');
