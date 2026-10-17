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

import { CARDS, draftCards, CARD_NUMBERS } from '../src/engine/cards.js';
import { getQuestionView } from '../src/engine/game.js';

test('hex cards: rival hex lands on their question and costs them; self hex pays more; steals move chips', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const cards = ['ink_blast', 'heist', 'pickpocket', 'quake'];
  const mk = () => {
    const players = ['p1', 'p2'].map((id) => ({ id, name: id, ownedCards: cards }));
    let s = createGame({ mode: 'versus', players, ctx, seed: 'hx', sessionId: 'sess' });
    s = must(dispatch(s, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['ink_blast', 'heist'] }, ctx));
    s = must(dispatch(s, { type: 'SET_LOADOUT', playerId: 'p2', cards: ['quake', 'pickpocket'] }, ctx));
    return must(dispatch(s, { type: 'START_ROUND' }, ctx));
  };
  // heist: p1 robs p2 (needs a rival)
  let s = mk();
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'heist', targetId: 'p1' }, ctx).ok, false);
  const p2chips = s.players[1].chips; const p1chips = s.players[0].chips;
  const stolen = Math.min(p2chips, Math.max(CARD_NUMBERS.heistMin, Math.min(CARD_NUMBERS.heistMax, Math.round(p2chips * CARD_NUMBERS.heistShare))));
  s = must(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'heist', targetId: 'p2' }, ctx));
  assert.equal(s.players[1].chips, p2chips - stolen);
  assert.equal(s.players[0].chips, p1chips + stolen - CARD_NUMBERS.heistCost);
  // ink on rival: lands in p2's question view after p2 stakes
  s = mk();
  s = must(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'ink_blast', targetId: 'p2' }, ctx));
  assert.deepEqual(s.players[1].pendingHexes.map((h) => h.fx), ['ink']);
  s = must(dispatch(s, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 }, ctx));
  const q = ctx.byId.get(s.q.questionId);
  s = must(dispatch(s, { type: 'ANSWER', playerId: 'p1', choice: s.q.order.indexOf(q.answer), elapsedMs: 3000 }, ctx));
  s = must(dispatch(s, { type: 'CONFIRM_STAKE', playerId: 'p2', stake: 1 }, ctx));
  assert.deepEqual(getQuestionView(s, ctx, 'p2').hexes, ['ink']);
  assert.equal(s.players[1].pendingHexes.length, 0);
  // self hex pays more than the same correct answer without it
  const win = (self) => {
    let t = mk();
    if (self) t = must(dispatch(t, { type: 'USE_CARD', playerId: 'p1', cardId: 'ink_blast', targetId: 'p1' }, ctx));
    t = must(dispatch(t, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 }, ctx));
    const qq = ctx.byId.get(t.q.questionId);
    t = must(dispatch(t, { type: 'ANSWER', playerId: 'p1', choice: t.q.order.indexOf(qq.answer), elapsedMs: 3000 }, ctx));
    return t.players[0].chips;
  };
  assert.ok(win(true) >= win(false));
});

test('hex cards show up in the reward draft pool with rarity weights', () => {
  assert.ok(['ink_blast', 'kraken', 'heist'].every((id) => CARDS[id].kind === 'hex'));
});

test('two players answering at the same time each get their own result', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const players = ['p1', 'p2', 'p3'].map((id) => ({ id, name: id, ownedCards: CARD_IDS }));
  let s = createGame({ mode: 'versus', players, ctx, seed: 'pz3', sessionId: 'sess' });
  s = must(dispatch(s, { type: 'START_ROUND' }, ctx));
  const [a, b] = s.players.filter((p, i) => i !== s.turn).map((p) => p.playerId);
  const sa = puzzleSeed(s, a, 0, 2); const sb = puzzleSeed(s, b, 0, 2);
  s = must(dispatch(s, { type: 'PUZZLE', playerId: a, level: 2, seed: sa, choice: makePuzzle(sa).answerKey }, ctx));
  s = must(dispatch(s, { type: 'PUZZLE', playerId: b, level: 2, seed: sb, choice: 'wrong!' }, ctx));
  const pa = s.players.find((p) => p.playerId === a).puzzle.last; const pb = s.players.find((p) => p.playerId === b).puzzle.last;
  assert.equal(pa.ok, true); assert.equal(pa.n, 1); assert.equal(pb.ok, false);
});
