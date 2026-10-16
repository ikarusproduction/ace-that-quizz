import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTranslator, applyTranslation } from '../src/i18n/translate.js';
import { realBank } from './helpers.js';

const fr = JSON.parse(readFileSync(new URL('../data/i18n/fr.json', import.meta.url), 'utf8'));
const fetchJson = async (p) => (p.endsWith('/fr.json') ? fr : null);

test('French dictionary covers every non-tune question with matching choice counts', async () => {
  const { questions } = await realBank();
  for (const q of questions.filter((x) => x.type !== 'tune')) {
    const hit = fr[q.id];
    assert.ok(hit, `missing fr for ${q.id}`);
    assert.ok(hit.q && hit.q.length > 3, `empty fr question ${q.id}`);
    assert.equal(hit.c.length, q.choices.length, `choice count ${q.id}`);
  }
});

test('bundled translation is used and keeps the answer index untouched', async () => {
  const { questions } = await realBank();
  const q = questions.find((x) => x.id === 'sci-002');
  const tr = await createTranslator({ fetchJson }).translateQuestion(q, 'fr');
  assert.equal(tr.via, 'bundled');
  const view = { text: q.question, explanation: q.explanation, choices: q.choices.map((t, i) => ({ text: t, orig: i })) };
  const out = applyTranslation(view, tr);
  assert.equal(out.choices.length, q.choices.length);
  assert.equal(out.choices[q.answer ?? 1].orig, q.answer ?? 1);
  assert.match(out.text, /planète/);
  assert.equal(await createTranslator({ fetchJson }).translateQuestion(q, 'en'), null);
});
