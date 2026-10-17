import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, puzzleSeed } from '../src/engine/game.js';
import { makePuzzle, checkPuzzle, PUZZLE_RULES } from '../src/engine/minigame.js';
import { CARD_IDS } from '../src/engine/cards.js';
import { realBank, fakeContext, must } from './helpers.js';

test('puzzles are deterministic, well-formed and language independent', () => {
  for (let i = 0; i < 600; i++) {
    const seed = `t${i}:L${1 + (i % 3)}`;
    const en = makePuzzle(seed, 'en'); const fr = makePuzzle(seed, 'fr');
    assert.deepEqual(makePuzzle(seed, 'en'), en);
    assert.equal(en.answerKey, fr.answerKey);
    const keys = en.choices.map((c) => c.key);
    assert.ok(keys.includes(en.answerKey));
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(checkPuzzle(seed, en.answerKey));
    assert.ok(!/undefined|NaN/.test(en.prompt + fr.prompt));
  }
});

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
  const ans = makePuzzle(seed0).answerKey;
  st = must(dispatch(st, { type: 'PUZZLE', playerId: w, level: 3, seed: seed0, choice: ans }, ctx));
  assert.equal(st.players.find((p) => p.playerId === w).chips, start + PUZZLE_RULES.reward[3]);
  assert.equal(dispatch(st, { type: 'PUZZLE', playerId: w, level: 3, seed: seed0, choice: ans }, ctx).ok, false); // replay
  for (let n = 1; n < 12; n++) { // spam: stays under the round cap
    const sd = puzzleSeed(st, w, n, 3);
    st = must(dispatch(st, { type: 'PUZZLE', playerId: w, level: 3, seed: sd, choice: makePuzzle(sd).answerKey }, ctx));
  }
  assert.equal(st.players.find((p) => p.playerId === w).chips, start + PUZZLE_RULES.roundCap);
  const sw = puzzleSeed(st, w, 12, 1);
  const before = st.players.find((p) => p.playerId === w).chips;
  st = must(dispatch(st, { type: 'PUZZLE', playerId: w, level: 1, seed: sw, choice: 'definitely-wrong' }, ctx));
  assert.equal(st.players.find((p) => p.playerId === w).chips, before);
});
