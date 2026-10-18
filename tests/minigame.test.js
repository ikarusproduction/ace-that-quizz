import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, puzzleSeed } from '../src/engine/game.js';
import { makePuzzle, checkPuzzle, PUZZLE_RULES, solveSlide, applySlide, checkSlide, SLIDE_SOLVED } from '../src/engine/minigame.js';
import { CARD_IDS } from '../src/engine/cards.js';
import { realBank, fakeContext, must } from './helpers.js';

test('puzzles are deterministic, well-formed and language independent', () => {
  for (let i = 0; i < 600; i++) {
    const seed = `t${i}:L${1 + (i % 3)}`;
    const en = makePuzzle(seed, 'en'); const fr = makePuzzle(seed, 'fr');
    assert.deepEqual(makePuzzle(seed, 'en'), en);
    assert.equal(en.answerKey, fr.answerKey);
    const keys = en.choices.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
    if (en.input) assert.equal(en.choices.length, 0);
    else assert.ok(keys.includes(en.answerKey));
    assert.ok(checkPuzzle(seed, en.input === 'moves' ? solveSlide(en.visual.board) : en.answerKey));
    assert.ok(!/undefined|NaN/.test(en.prompt + fr.prompt));
  }
});

const answerFor = (seed) => { const p = makePuzzle(seed); return p.input === 'moves' ? solveSlide(p.visual.board) : p.answerKey; };

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


test('new visual puzzle kinds all appear, are well formed, and have unambiguous answers', () => {
  const seen = {};
  for (let i = 0; i < 1500; i++) {
    const seed = `v${i}:L${1 + (i % 3)}`;
    const p = makePuzzle(seed, i % 2 ? 'fr' : 'en');
    seen[p.kind] = (seen[p.kind] ?? 0) + 1;
    if (p.kind === 'oddgrid') {
      const odd = p.visual.cells.filter((c, j) => JSON.stringify(c) !== JSON.stringify(p.visual.cells[(j + 1) % p.visual.cells.length]) || false);
      const counts = new Map(); for (const c of p.visual.cells) counts.set(JSON.stringify(c), (counts.get(JSON.stringify(c)) ?? 0) + 1);
      assert.equal(counts.size, 2); assert.equal(Math.min(...counts.values()), 1); void odd;
      assert.equal(JSON.stringify(p.visual.cells[Number(p.answerKey)]), [...counts].find(([, n]) => n === 1)[0]);
    }
    if (p.kind === 'scatter') {
      assert.equal(p.visual.items.filter((it) => it.shape === p.visual.target).length, Number(p.answerKey));
      assert.ok(p.visual.items.every((it) => it.x >= 0 && it.x <= 1 && it.y >= 0 && it.y <= 1));
    }
    if (p.kind === 'pattern') { assert.equal(p.visual.seq.length, 4); assert.ok(p.choices.length >= 3); assert.ok(p.choices.every((c) => c.figure)); }
    if (p.kind === 'memory') { assert.equal(p.answerKey.length, p.visual.length); assert.equal(checkPuzzle(seed, p.answerKey), true); assert.equal(checkPuzzle(seed, '9'.repeat(p.visual.length)), false); }
    if (p.kind === 'riddle') { assert.equal(p.choices.length, 4); assert.ok(p.choices.every((c) => c.label)); }
  }
  for (const k of ['slide', 'oddgrid', 'scatter', 'pattern', 'memory', 'riddle', 'sequence', 'equation', 'logic', 'fact']) assert.ok(seen[k] > 20, `${k}: ${seen[k]}`);
});

test('sliding tiles: scrambles are solvable, solutions are checked by simulation, junk is rejected', () => {
  for (let i = 0; i < 60; i++) {
    const seed = `sl${i}:L${1 + (i % 3)}`;
    let p = makePuzzle(seed);
    for (let k = 0; p.kind !== 'slide' && k < 50; k++) p = makePuzzle(`sl${i}x${k}:L${1 + (i % 3)}`);
    const sol = solveSlide(p.visual.board);
    assert.ok(sol && sol.length > 0 && sol.length <= 20);
    assert.deepEqual(applySlide(p.visual.board, sol), SLIDE_SOLVED);
    assert.equal(checkSlide(p.visual.board, sol), true);
    assert.equal(checkSlide(p.visual.board, sol.slice(0, -1)), false);
    assert.equal(checkSlide(p.visual.board, 'x'), false);
    assert.equal(checkSlide(p.visual.board, ''), false);
    assert.equal(checkSlide(p.visual.board, 'U'.repeat(500)), false);
  }
  assert.equal(applySlide(SLIDE_SOLVED, 'D'), null); // the gap is in the bottom row
  assert.equal(applySlide(SLIDE_SOLVED, 'R'), null); // and the right column
  assert.deepEqual(applySlide(SLIDE_SOLVED, 'UD'), SLIDE_SOLVED);
});
