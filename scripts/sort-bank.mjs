// Orders every question file by difficulty (easy to expert), then subcategory, then id, and orders each variants file the same way
// (by its base question). Ids never change, so saved progress is untouched. Idempotent: running it twice changes nothing.
// Usage: node scripts/sort-bank.mjs [--check]   (--check exits 1 if a file is out of order and writes nothing)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
const idx = JSON.parse(await readFile(join(root, 'data/questions/index.json'), 'utf8'));
const SKIP = /^(news|news-live|tunes)\.json$/;
const num = (id) => id.split('-').map((p) => (/^\d+$/.test(p) ? p.padStart(6, '0') : p)).join('-');
const cmp = (a, b) => (a.difficulty ?? 2) - (b.difficulty ?? 2) || String(a.subcategory ?? '').localeCompare(String(b.subcategory ?? '')) || (num(a.id) < num(b.id) ? -1 : num(a.id) > num(b.id) ? 1 : 0);
const rank = new Map(); let bad = 0;

for (const f of idx.files.filter((n) => !SKIP.test(n))) {
  const path = join(root, 'data/questions', f); const raw = await readFile(path, 'utf8'); const j = JSON.parse(raw);
  const sorted = [...j.questions].sort(cmp);
  sorted.forEach((q, i) => rank.set(q.id, i));
  if (sorted.some((q, i) => q.id !== j.questions[i].id)) { bad++; if (!check) await writeFile(path, JSON.stringify({ ...j, questions: sorted }, null, 1)); }
}
for (const f of idx.variantFiles ?? []) {
  const path = join(root, 'data/questions', f); const j = JSON.parse(await readFile(path, 'utf8'));
  const sorted = [...j.families].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  if (sorted.some((x, i) => x.id !== j.families[i].id)) { bad++; if (!check) await writeFile(path, JSON.stringify({ ...j, families: sorted }, null, 1)); }
}
if (check) { console.log(bad ? `${bad} file(s) out of order: run node scripts/sort-bank.mjs` : 'question files are in difficulty order'); process.exit(bad ? 1 : 0); }
console.log(`reordered ${bad} file(s)`);
