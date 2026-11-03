// Generates the Periodic Table question category from src/engine/elements.js, so the questions can never disagree with the
// trainer. Writes data/questions/periodic.json, data/questions/variants/periodic.json and the French entries in data/i18n/fr.json.
// Run: node scripts/build-periodic.mjs   then   node scripts/sort-bank.mjs
//
// Every element gets two three-level concepts:
//   per-NNNa  recall: level 1 "which element has the symbol X?", level 2 "what is the symbol of Y?", level 3 "which element has number Z?"
//   per-NNNb  place:  level 1 family, level 2 period, level 3 group (only where all three have one defensible answer)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELEMENTS, CATEGORIES, nameOf } from '../src/engine/elements.js';
import { applies, choicesFor, cardText } from '../src/engine/periodic.js';
import { Rng } from '../src/engine/rng.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pad = (z) => String(z).padStart(3, '0');
const EASY = new Set([1, 2, 6, 7, 8, 11, 12, 13, 14, 16, 17, 19, 20, 26, 29, 47, 50, 53, 78, 79, 80, 82, 92]); // the ones everyone has met

const LEVEL_FACET_A = { 1: 'name', 2: 'sym', 3: 'elz' };
const LEVEL_FACET_B = { 1: 'cat', 2: 'per', 3: 'grp' };
const ASK_A = ['Symbol to element', 'Element to symbol', 'Number to element'];
const ASK_B = ['Its family', 'Its period', 'Its group'];

/** French rendering of an English choice, for the facet it belongs to. */
function frChoice(facet, en) {
  if (facet === 'name' || facet === 'elz') return ELEMENTS.find((e) => e.en === en)?.fr ?? en;
  if (facet === 'cat') return Object.values(CATEGORIES).find((c) => c.en === en)?.fr ?? en;
  if (facet === 'grp') return en.replace('Group', 'Groupe');
  if (facet === 'per') return en.replace('Period', 'Période');
  return en;
}
function build(e, facet, suffix) {
  const rng = Rng.fromSeed(`periodic:${e.z}:${facet}`);
  const en = cardText(e, facet, 'en');
  const frT = cardText(e, facet, 'fr');
  // the bank asks the number question as a count of protons, so it never repeats the older element questions word for word
  if (facet === 'elz') { en.question = `Which element has ${e.z} protons in its nucleus?`; frT.question = `Quel élément a ${e.z} protons dans son noyau ?`; }
  const { choices, answer } = choicesFor(e, facet, rng, 'en');
  return { facet, question: en.question, choices, answer, explanation: en.explain, fr: { q: frT.question, c: choices.map((c) => frChoice(facet, c)), e: frT.explain }, suffix };
}

const questions = []; const families = []; const fr = JSON.parse(readFileSync(join(root, 'data/i18n/fr.json'), 'utf8'));
for (const e of ELEMENTS) {
  const concepts = [{ id: `per-${pad(e.z)}a`, sub: 'recall', map: LEVEL_FACET_A, asks: ASK_A, base: EASY.has(e.z) ? 1 : e.z <= 54 ? 2 : e.z <= 92 ? 3 : 4 }];
  if (['cat', 'per', 'grp'].every((f) => applies(e, f))) concepts.push({ id: `per-${pad(e.z)}b`, sub: 'place', map: LEVEL_FACET_B, asks: ASK_B, base: e.z <= 20 ? 1 : e.z <= 54 ? 2 : 3 });
  for (const c of concepts) {
    const lvl0 = Math.min(c.base, 3);
    const byLevel = Object.fromEntries([1, 2, 3].map((l) => [l, build(e, c.map[l])]));
    const b = byLevel[lvl0];
    questions.push({ id: c.id, subcategory: c.sub === 'recall' ? 'elements-recall' : 'elements-place', difficulty: c.base, question: b.question, choices: b.choices, answer: b.answer, explanation: b.explanation, tags: [c.sub] });
    fr[c.id] = b.fr;
    families.push({ id: c.id, ask: { 1: c.asks[0], 2: c.asks[1], 3: c.asks[2] }, variants: [1, 2, 3].filter((l) => l !== lvl0).map((l) => ({ level: l, question: byLevel[l].question, choices: byLevel[l].choices, answer: byLevel[l].answer, explanation: byLevel[l].explanation })) });
  }
}
// drop stale entries of an earlier run
const ids = new Set(questions.map((q) => q.id));
for (const k of Object.keys(fr)) if (k.startsWith('per-') && !ids.has(k)) delete fr[k];

writeFileSync(join(root, 'data/questions/periodic.json'), JSON.stringify({ category: 'periodic', review: 'unreviewed', questions }, null, 1));
writeFileSync(join(root, 'data/questions/variants/periodic.json'), JSON.stringify({ category: 'periodic', review: 'unreviewed', note: 'Difficulty ladders: the original question keeps its own level, these are the other levels. Generated from src/engine/elements.js. Unreviewed.', families }, null, 1));
writeFileSync(join(root, 'data/i18n/fr.json'), JSON.stringify(fr));
console.log(`periodic: ${questions.length} concepts, ${families.reduce((n, f) => n + f.variants.length, 0)} variants`);
