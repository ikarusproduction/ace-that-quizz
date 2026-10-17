import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, getQuestionView } from '../src/engine/game.js';
import { HEXES, STARTER_HEXES, tierForStreak, drawHex, openPack, PACKS, packsEarned, evaluateMissions, MISSIONS, missionsFor } from '../src/engine/hexes.js';
import { CARDS } from '../src/engine/cards.js';
import { Rng } from '../src/engine/rng.js';
import { realBank, fakeContext, must } from './helpers.js';

const ALL = Object.keys(HEXES);
async function game(n = 2, { owned = ALL, deck } = {}) {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const players = ['p1', 'p2', 'p3'].slice(0, n).map((id) => ({ id, name: id, ownedCards: [], ownedHexes: owned, hexDeck: deck }));
  let s = createGame({ mode: n === 1 ? 'solo' : 'versus', players, ctx, seed: 'hx', sessionId: 'sess' });
  s = must(dispatch(s, { type: 'START_ROUND' }, ctx));
  return { s, ctx };
}
const give = (s, pid, ...ids) => { const t = structuredClone(s); t.players.find((p) => p.playerId === pid).hexHand.push(...ids); return t; };
const answerRight = (s, ctx, pid) => {
  let t = must(dispatch(s, { type: 'CONFIRM_STAKE', playerId: pid, stake: 1 }, ctx));
  const q = ctx.byId.get(t.q.questionId);
  return must(dispatch(t, { type: 'ANSWER', playerId: pid, choice: t.q.order.indexOf(q.answer), elapsedMs: 3000 }, ctx));
};

test('hexes are their own deck: no hex lives in the bonus cards, starters are the basic set', () => {
  assert.ok(Object.values(CARDS).every((c) => c.kind !== 'hex'));
  assert.deepEqual(STARTER_HEXES.sort(), ['goo_splat', 'ink_blast', 'pickpocket', 'sponge']);
  assert.equal(tierForStreak(2), 'common'); assert.equal(tierForStreak(4), 'uncommon'); assert.equal(tierForStreak(6), 'rare');
  assert.equal(tierForStreak(8), 'legendary'); assert.equal(tierForStreak(10), 'legendary'); assert.equal(tierForStreak(3), null);
});

test('a streak of 2 earns a common hex from your deck; a wrong answer breaks the chain', async () => {
  const { s, ctx } = await game(1, { deck: ['ink_blast', 'quake', 'flip_table', 'kraken'] });
  const pid = 'p1';
  let t = s;
  const qs = [];
  for (let i = 0; i < 2; i++) { t = answerRight(t, ctx, pid); qs.push(t.players[0].hexHand.length); if (i < 1) t = must(dispatch(t, { type: 'NEXT' }, ctx)); }
  assert.deepEqual(qs, [0, 1]);
  assert.equal(t.players[0].hexHand[0], 'ink_blast');
  assert.equal(t.lastEarn.tier, 'common');
});

const turnOf = (s) => s.players[s.turn].playerId;
const other = (s) => s.players.find((p) => p.playerId !== turnOf(s)).playerId;

test('turn player: hex on a rival lands on their question (-15%), on yourself pays +20%; one hex per question', async () => {
  const { s, ctx } = await game(2);
  const me = turnOf(s); const rival = other(s);
  let t = give(s, me, 'ink_blast', 'goo_splat');
  t = must(dispatch(t, { type: 'USE_HEX', playerId: me, hexId: 'ink_blast', targetId: rival }, ctx));
  assert.deepEqual(t.players.find((p) => p.playerId === rival).pendingHexes.map((h) => h.fx), ['ink']);
  assert.equal(dispatch(t, { type: 'USE_HEX', playerId: me, hexId: 'goo_splat', targetId: me }, ctx).ok, false, 'one hex per question');
  t = answerRight(t, ctx, me);
  t = must(dispatch(t, { type: 'CONFIRM_STAKE', playerId: rival, stake: 1 }, ctx));
  assert.deepEqual(getQuestionView(t, ctx, rival).hexes, ['ink']);
});

test('hexes you do not hold, wrong phase and wrong targets are refused', async () => {
  const { s, ctx } = await game(2);
  const me = turnOf(s); const rival = other(s);
  assert.equal(dispatch(s, { type: 'USE_HEX', playerId: me, hexId: 'ink_blast', targetId: rival }, ctx).ok, false, 'not in hand');
  const t = give(s, me, 'heist');
  assert.equal(dispatch(t, { type: 'USE_HEX', playerId: me, hexId: 'heist', targetId: me }, ctx).ok, false, 'heist needs a rival');
});

test('steals move chips; heist costs the thief 1', async () => {
  const { s, ctx } = await game(2);
  const me = turnOf(s); const rival = other(s);
  let t = give(s, me, 'heist');
  const a = t.players.find((p) => p.playerId === me).chips; const b = t.players.find((p) => p.playerId === rival).chips;
  t = must(dispatch(t, { type: 'USE_HEX', playerId: me, hexId: 'heist', targetId: rival }, ctx));
  const take = Math.min(b, Math.max(3, Math.min(12, Math.round(b * 0.15))));
  assert.equal(t.players.find((p) => p.playerId === rival).chips, b - take);
  assert.equal(t.players.find((p) => p.playerId === me).chips, a + take - 1);
  assert.equal(t.players.find((p) => p.playerId === me).stats.chipsStolen, take);
});

test('shields: sponge absorbs, mirror bounces back, cloth absorbs and wipes', async () => {
  for (const [shield, check] of [['sponge', (t, me, rv) => { assert.equal(t.players.find((p) => p.playerId === rv).pendingHexes.length, 0); assert.equal(t.lastHex.blocked, 'sponge'); }],
    ['mirror', (t, me) => { assert.equal(t.players.find((p) => p.playerId === me).pendingHexes.length, 1); assert.equal(t.lastHex.blocked, 'mirror'); }],
    ['cloth', (t, me, rv) => { assert.equal(t.players.find((p) => p.playerId === rv).pendingHexes.length, 0); }]]) {
    const { s, ctx } = await game(2);
    const me = turnOf(s); const rv = other(s);
    let t = give(give(s, rv, shield), me, 'ink_blast');
    // the rival arms a shield from the sidelines (defence hexes are allowed any time)
    t = must(dispatch(t, { type: 'USE_HEX', playerId: rv, hexId: shield }, ctx));
    assert.equal(t.players.find((p) => p.playerId === rv).shield, shield);
    t = must(dispatch(t, { type: 'USE_HEX', playerId: me, hexId: 'ink_blast', targetId: rv }, ctx));
    check(t, me, rv);
    assert.equal(t.players.find((p) => p.playerId === rv).shield, null);
  }
});

test('a waiting player can prank the answerer live, once per question, never themselves', async () => {
  const { s, ctx } = await game(3);
  const turn = turnOf(s); const [w1, w2] = s.players.map((p) => p.playerId).filter((id) => id !== turn);
  let t = give(give(s, w1, 'goo_splat'), w2, 'ink_blast');
  assert.equal(dispatch(t, { type: 'USE_HEX', playerId: w1, hexId: 'goo_splat', targetId: w1 }, ctx).ok, false);
  assert.equal(dispatch(t, { type: 'USE_HEX', playerId: w1, hexId: 'goo_splat', targetId: w2 }, ctx).ok, false);
  t = must(dispatch(t, { type: 'USE_HEX', playerId: w1, hexId: 'goo_splat', targetId: turn }, ctx));
  assert.deepEqual(t.q.byPlayer[turn].hexes.map((h) => h.fx), ['goo']);
  assert.equal(t.lastHex.live, true);
  t = must(dispatch(t, { type: 'USE_HEX', playerId: w2, hexId: 'ink_blast', targetId: turn }, ctx));
  assert.equal(t.q.byPlayer[turn].hexes.length, 2);
});

test('puzzles fill the prank meter: three right answers give a common hex', async () => {
  const { makePuzzle } = await import('../src/engine/minigame.js');
  const { puzzleSeed } = await import('../src/engine/game.js');
  const { s, ctx } = await game(2);
  const w = other(s);
  let t = s;
  for (let n = 0; n < 3; n++) { const seed = puzzleSeed(t, w, n, 1); t = must(dispatch(t, { type: 'PUZZLE', playerId: w, level: 1, seed, choice: makePuzzle(seed).answerKey }, ctx)); }
  assert.equal(t.players.find((p) => p.playerId === w).hexHand.length, 1);
  assert.equal(t.lastEarn.from, 'puzzles');
});

test('hex deck: at most four, only owned hexes, set during loadout', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const players = ['p1', 'p2'].map((id) => ({ id, name: id, ownedCards: [], ownedHexes: ['quake', 'blur_out'] }));
  const s = createGame({ mode: 'versus', players, ctx, seed: 'd', sessionId: 'x' });
  assert.ok(s.players[0].hexOwned.includes('quake') && s.players[0].hexOwned.includes('ink_blast'));
  const t = must(dispatch(s, { type: 'SET_HEXDECK', playerId: 'p1', deck: ['quake', 'ink_blast'] }, ctx));
  assert.deepEqual(t.players[0].hexDeck, ['quake', 'ink_blast']);
  assert.equal(dispatch(s, { type: 'SET_HEXDECK', playerId: 'p1', deck: ['kraken'] }, ctx).ok, false);
  assert.equal(dispatch(s, { type: 'SET_HEXDECK', playerId: 'p1', deck: ['ink_blast', 'goo_splat', 'quake', 'blur_out', 'sponge'] }, ctx).ok, false);
});

test('packs are deterministic, reach their minimum rarity, and duplicates become dust', () => {
  const a = openPack(Rng.fromSeed('pack1'), 'gold', ['ink_blast']);
  assert.deepEqual(openPack(Rng.fromSeed('pack1'), 'gold', ['ink_blast']), a);
  assert.equal(a.length, PACKS.gold.count);
  assert.ok(['rare', 'legendary'].includes(HEXES[a.at(-1).id].rarity));
  const dupes = openPack(Rng.fromSeed('pack2'), 'bronze', ALL);
  assert.ok(dupes.every((c) => c.dup && c.dust > 0));
});

test('missions: three per player per game, evaluated from the finished game', async () => {
  const ids = missionsFor(Rng.fromSeed('sess:p1:missions'));
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(ids, missionsFor(Rng.fromSeed('sess:p1:missions')));
  assert.ok(ids.every((id) => MISSIONS.some((m) => m.id === id)));
  const { s } = await game(1);
  const ev = evaluateMissions(s, 'p1', ['streak3', 'hex2']);
  assert.deepEqual(ev.map((m) => m.done), [false, false]);
});

test('regression: a perfect run never repeats a question, even when a small category runs dry', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const { playToEnd } = await import('./helpers.js');
  for (let i = 0; i < 12; i++) {
    const s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'A', ownedCards: [] }], ctx, seed: `dup${i}`, sessionId: `dup${i}` });
    const e = playToEnd(s, ctx, () => ({ answerCorrectly: true, stake: 1 }));
    assert.equal(new Set(e.log.map((r) => r.questionId)).size, e.log.length, `seed dup${i}`);
  }
});
