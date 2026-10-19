import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, puzzleSeed } from '../src/engine/game.js';
import { existsSync } from 'node:fs';
import { makePuzzle, checkPuzzle, PUZZLE_RULES } from '../src/engine/minigame.js';
import { COUNTRIES, COUNTRY, isCountry, isCapital } from '../src/engine/geo.js';
import { CARD_IDS } from '../src/engine/cards.js';
import { realBank, fakeContext, must } from './helpers.js';

test('puzzles are deterministic, well-formed and language independent', () => {
  const kinds = {};
  for (let i = 0; i < 600; i++) {
    const seed = `t${i}:L${1 + (i % 3)}`;
    const en = makePuzzle(seed, 'en'); const fr = makePuzzle(seed, 'fr');
    assert.deepEqual(makePuzzle(seed, 'en'), en);
    assert.equal(en.answerKey, fr.answerKey);
    assert.equal(en.input, 'text');
    kinds[en.kind] = (kinds[en.kind] ?? 0) + 1;
    assert.ok(['flag', 'capital'].includes(en.kind));
    assert.ok(COUNTRY[en.iso]);
    assert.ok(checkPuzzle(seed, en.answerKey), `${seed} ${en.answerKey}`);
    assert.ok(!/undefined|NaN/.test(en.prompt + fr.prompt + en.fact + fr.fact));
    assert.equal(en.kind === 'capital' ? Boolean(en.visual.name) : en.visual.name === undefined, true);
  }
  assert.ok(kinds.flag > 200 && kinds.capital > 200, 'both kinds appear');
});

test('flags and capitals are the only puzzles, and every flag file exists', () => {
  for (const c of COUNTRIES) assert.ok(existsSync(new URL(`../assets/flags/${c.iso}.svg`, import.meta.url)), c.iso);
  assert.equal(new Set(COUNTRIES.map((c) => c.iso)).size, COUNTRIES.length);
  assert.ok(COUNTRIES.every((c) => c.en && c.fr && c.capEn && c.capFr && [1, 2, 3].includes(c.tier)));
});

test('typed answers: either language, accents, case and small typos; never another country', () => {
  assert.ok(isCountry('de', 'Germany') && isCountry('de', 'allemagne') && isCountry('de', '  ALLEMAGNE '));
  assert.ok(isCountry('ci', "cote d'ivoire") && isCountry('ci', 'Ivory Coast'));
  assert.ok(isCountry('us', 'usa') && isCountry('gb', 'UK'));
  assert.ok(isCountry('ie', 'irland'), 'one typo on a long name');
  assert.ok(isCountry('au', 'Australia') && !isCountry('au', 'Austria'));
  assert.ok(!isCountry('sk', 'Slovenia') && !isCountry('si', 'Slovakia'));
  assert.ok(!isCountry('ne', 'Nigeria') && !isCountry('ng', 'Niger'));
  assert.ok(isCountry('ml', 'Mali '));
  assert.ok(!isCountry('ml', 'Malu'), 'short names need an exact spelling');
  assert.ok(isCapital('fr', 'paris') && isCapital('fr', 'PARIS') && isCapital('ru', 'Moscou') && isCapital('ru', 'moscow'));
  assert.ok(isCapital('ch', 'Berne') && isCapital('ch', 'Bern'));
  assert.ok(isCapital('lu', 'Luxembourg'), 'a capital that is also another word');
  assert.ok(!isCapital('fr', 'Lyon') && !isCapital('fr', ''));
  assert.ok(isCapital('kz', 'Astana') && !isCapital('kg', 'Astana'));
  assert.ok(!checkPuzzle('t1:L1', 'x'.repeat(100)) && !checkPuzzle('t1:L1', 5) && !checkPuzzle('t1:L1', null));
});

test('levels get harder: level 3 draws mostly tier 3, level 1 mostly tier 1', () => {
  const mean = (lv) => { let n = 0; for (let i = 0; i < 400; i++) n += COUNTRY[makePuzzle(`m${i}:L${lv}`).iso].tier; return n / 400; };
  assert.ok(mean(1) < mean(2) && mean(2) < mean(3), `${mean(1)} ${mean(2)} ${mean(3)}`);
});

const answerFor = (seed) => makePuzzle(seed).answerKey;

async function setup() {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const players = ['p1', 'p2'].map((id) => ({ id, name: id, ownedCards: CARD_IDS }));
  let s = createGame({ mode: 'versus', players, ctx, seed: 'pz', sessionId: 'sess' });
  s = must(dispatch(s, { type: 'START_ROUND' }, ctx));
  return { s, ctx };
}
const waiter = (s) => s.players.find((p) => p.playerId !== s.players[s.turn].playerId).playerId;

test('a waiting player earns capped chips; the turn player cannot; replays and wrong seeds fail', async () => {
  const { s, ctx } = await setup();
  const w = waiter(s); const t = s.players[s.turn].playerId;
  const seed = puzzleSeed(s, t, 0, 1);
  assert.equal(dispatch(s, { type: 'PUZZLE', playerId: t, level: 1, seed, choice: 'x' }, ctx).ok, false);
  let st = s; const start = st.players.find((p) => p.playerId === w).chips;
  assert.equal(dispatch(st, { type: 'PUZZLE', playerId: w, level: 1, seed: 'forged:L1', choice: 'x' }, ctx).ok, false);
  const seed0 = puzzleSeed(st, w, 0, 3);
  const ans = answerFor(seed0);
  st = must(dispatch(st, { type: 'PUZZLE', playerId: w, level: 3, seed: seed0, choice: ans }, ctx));
  assert.equal(st.players.find((p) => p.playerId === w).chips, start + PUZZLE_RULES.reward[3]);
  assert.equal(dispatch(st, { type: 'PUZZLE', playerId: w, level: 3, seed: seed0, choice: ans }, ctx).ok, false); // replay
  for (let n = 1; n < 12; n++) { // spam: stays under the round cap
    const sd = puzzleSeed(st, w, n, 3);
    st = must(dispatch(st, { type: 'PUZZLE', playerId: w, level: 3, seed: sd, choice: answerFor(sd) }, ctx));
  }
  assert.equal(st.players.find((p) => p.playerId === w).chips, start + PUZZLE_RULES.roundCap);
  const sw = puzzleSeed(st, w, 12, 1);
  const before = st.players.find((p) => p.playerId === w).chips;
  st = must(dispatch(st, { type: 'PUZZLE', playerId: w, level: 1, seed: sw, choice: 'definitely-wrong' }, ctx));
  assert.equal(st.players.find((p) => p.playerId === w).chips, before);
});


