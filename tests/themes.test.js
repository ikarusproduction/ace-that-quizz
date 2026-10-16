import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/engine/rng.js';
import { buildRound, pickQuestion } from '../src/engine/rounds.js';
import { buildConfig, createGame, dispatch } from '../src/engine/game.js';
import { THEMES, THEME_IDS, themePool, availableThemes, isFreshNews, randomThemes, cleanThemes, SLOT_COUNT, DEFAULT_THEMES } from '../src/engine/themes.js';
import { realBank, fakeContext, must } from './helpers.js';

const NOW = Date.parse('2026-10-16T10:00:00Z');

test('every theme has enough questions in the real bank (news depends on the date)', async () => {
  const { questions } = await realBank();
  const avail = availableThemes(questions, NOW);
  for (const id of THEME_IDS) {
    if (id === 'news') continue;
    assert.ok(avail.includes(id), `${id} should have at least 8 questions, has ${themePool(id, questions, NOW).length}`);
  }
});

test('live news expires after 14 days and ignores undated or far-future items', () => {
  const q = (date) => ({ category: 'news', date });
  assert.equal(isFreshNews(q('2026-10-12'), NOW), true);
  assert.equal(isFreshNews(q('2026-10-02'), NOW), true); // 14 days
  assert.equal(isFreshNews(q('2026-10-01'), NOW), false); // 15 days
  assert.equal(isFreshNews(q('2026-12-01'), NOW), false); // future
  assert.equal(isFreshNews({ category: 'news' }, NOW), false); // undated
  assert.equal(isFreshNews(q('nonsense'), NOW), false);
});

test('the Current Affairs theme is hidden when there is no fresh news', async () => {
  const { questions } = await realBank();
  const later = Date.parse('2027-03-01T00:00:00Z');
  assert.ok(!availableThemes(questions, later).includes('news'));
  assert.ok(availableThemes(questions, NOW).includes('news'));
});

test('themed rounds take exactly one question from each slot theme', async () => {
  const { questions } = await realBank();
  const themes = ['f1', 'cooking', 'manga', 'hockey', 'finance'];
  const config = { ...buildConfig('solo', { themes }), today: NOW };
  for (let i = 0; i < 20; i++) {
    const round = buildRound({ questions, rng: Rng.fromSeed(`t${i}`), roundIndex: 0, config, usedIds: new Set(), usedBosses: [], previousHazard: null });
    assert.equal(round.slots.length, 5);
    const byId = new Map(questions.map((q) => [q.id, q]));
    assert.deepEqual(round.slots.map((s) => byId.get(s.questionId).category).sort(), [...themes].sort());
    assert.deepEqual(round.slots.map((s) => s.theme).sort(), [...themes].sort());
  }
});

test('repeated themes give distinct questions', async () => {
  const { questions } = await realBank();
  const config = { ...buildConfig('solo', { themes: ['f1', 'f1', 'f1', 'f1', 'f1'] }), today: NOW };
  const round = buildRound({ questions, rng: Rng.fromSeed('rep'), roundIndex: 0, config, usedIds: new Set(), usedBosses: [], previousHazard: null });
  assert.equal(new Set(round.slots.map((s) => s.questionId)).size, 5);
});

test('music theme draws from tunes, music and arts-music questions', async () => {
  const { questions } = await realBank();
  const pool = themePool('music', questions, NOW);
  assert.ok(pool.every((q) => q.category === 'music' || q.category === 'tunes' || (q.category === 'arts' && q.subcategory === 'music')));
  assert.ok(pool.length >= 20);
  // Arts theme must not duplicate the music questions.
  assert.ok(themePool('arts', questions, NOW).every((q) => q.subcategory !== 'music'));
});

test('least-seen weighting prefers questions the group has seen less', () => {
  const pool = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `q${i}`, difficulty: 1, category: 'x' }));
  const seen = { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 0 };
  for (let i = 0; i < 30; i++) {
    const q = pickQuestion({ pool, rng: Rng.fromSeed(`s${i}`), difficulty: 1, usedIds: new Set(), seen });
    assert.equal(q.id, 'q6');
  }
  // Once the unseen one is used, it moves on to the next-least-seen without failing.
  const q = pickQuestion({ pool, rng: Rng.fromSeed('x'), difficulty: 1, usedIds: new Set(['q6']), seen });
  assert.notEqual(q.id, 'q6');
});

test('over many games a group sees wide variety, not the same questions', async () => {
  const { questions } = await realBank();
  const themes = ['science', 'history', 'sports', 'music', 'cinema'];
  const seenCounts = {};
  const everSeen = new Set();
  for (let g = 0; g < 12; g++) {
    const ctx = fakeContext(questions, { start: NOW });
    const s0 = createGame({ mode: 'solo', players: [{ id: 'a', name: 'A' }], ctx, seed: `v${g}`, overrides: { acts: 1, themes }, seenCounts });
    for (const sl of s0.round?.slots ?? []) { seenCounts[sl.questionId] = (seenCounts[sl.questionId] ?? 0) + 1; everSeen.add(sl.questionId); }
    // Round 1 is built on START_ROUND in the real flow; emulate by starting.
    const s1 = must(dispatch(s0, { type: 'START_ROUND' }, ctx));
    for (const sl of s1.round.slots) { seenCounts[sl.questionId] = (seenCounts[sl.questionId] ?? 0) + 1; everSeen.add(sl.questionId); }
  }
  assert.ok(everSeen.size >= 40, `only ${everSeen.size} distinct questions over 12 games`);
  const max = Math.max(...Object.values(seenCounts));
  assert.ok(max <= 4, `a question repeated ${max} times`);
});

test('randomThemes and cleanThemes', () => {
  const avail = ['a', 'b', 'c', 'd', 'e', 'f'];
  const picks = randomThemes(Rng.fromSeed('r'), avail);
  assert.equal(picks.length, SLOT_COUNT);
  assert.equal(new Set(picks).size, 5); // no duplicates while enough themes exist
  assert.equal(randomThemes(Rng.fromSeed('r'), ['a', 'b']).length, SLOT_COUNT); // duplicates when few themes
  assert.equal(cleanThemes(['a', 'b', 'c', 'd'], avail), null);
  assert.equal(cleanThemes(['a', 'b', 'c', 'd', 'zzz'], avail), null);
  assert.deepEqual(cleanThemes(['a', 'a', 'c', 'd', 'e'], avail), ['a', 'a', 'c', 'd', 'e']);
  assert.ok(DEFAULT_THEMES.every((t) => THEMES[t]));
});
