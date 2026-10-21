import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, getStakeOptions } from '../src/engine/game.js';
import { BOSS_ROSTER, BOSS_IDS, PRIVATE_CATEGORIES, availableNodes, makeEncounter } from '../src/engine/duel.js';
import { THEMES } from '../src/engine/themes.js';
import { statCategory } from '../src/engine/bank.js';
import { Rng } from '../src/engine/rng.js';
import { realBank, fakeContext, must, correctDisplay, wrongDisplay } from './helpers.js';

const go = (s, ctx, a) => must(dispatch(s, a, ctx));
function answer(s, ctx, { right = true, stake = 1 } = {}) {
  const t = go(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake });
  return go(t, ctx, { type: 'ANSWER', playerId: 'p1', choice: right ? correctDisplay(t, ctx) : wrongDisplay(t, ctx), elapsedMs: 800 });
}
async function rush(bossId, seed) {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed, sessionId: `s-${seed}`, overrides: { variant: 'rush', bossId } });
  return { s, ctx };
}
/** Play a whole fight with a perfect or hopeless bot and return every question id that was asked. */
function playFight(s, ctx, right = true) {
  const asked = [];
  s = go(s, ctx, { type: 'START_ROUND' });
  for (let i = 0; i < 40 && s.phase !== 'round-summary'; i++) {
    if (s.phase === 'stake') { asked.push(s.round.slots[s.qIndex].questionId); s = answer(s, ctx, { right }); } else if (s.phase === 'reveal') s = go(s, ctx, { type: 'NEXT' });
    else break;
  }
  return { s, asked };
}

test('the Whispering Hat is a private, specialist boss of the Harry Potter films', () => {
  const b = BOSS_ROSTER.hat;
  assert.equal(b.cat, 'hpfilms'); assert.equal(b.sprite, 'boss_hat');
  assert.ok(b.only && b.private);
  assert.deepEqual(PRIVATE_CATEGORIES, ['hpfilms']);
  const elite = makeEncounter({ kind: 'elite', enemyId: 'hat', rng: Rng.fromSeed('e') });
  assert.ok(elite.only && elite.private, 'even its champion form asks only about the films');
});

test('the Hat asks only questions about the Harry Potter films', async () => {
  const bank = await realBank();
  const pool = bank.questions.filter((q) => q.category === 'hpfilms');
  assert.ok(pool.length >= 80, `${pool.length} film questions`);
  for (const seed of ['h1', 'h2', 'h3']) {
    const { s, ctx } = await rush('hat', seed);
    const { asked } = playFight(s, ctx, true);
    assert.ok(asked.length >= 5);
    for (const id of asked) assert.equal(ctx.byId.get(id).category, 'hpfilms', `${seed}: ${id}`);
  }
});

test('no other boss, contestant, champion or theme ever draws a Harry Potter film question', async () => {
  const bank = await realBank();
  for (const id of BOSS_IDS.filter((x) => x !== 'hat')) {
    for (const seed of ['a', 'b']) {
      const { s, ctx } = await rush(id, `${id}-${seed}`);
      const { asked } = playFight(s, ctx, seed === 'a');
      for (const q of asked) assert.notEqual(statCategory(ctx.byId.get(q)), 'hpfilms', `${id} asked ${q}`);
    }
  }
  for (const [name, t] of Object.entries(THEMES)) assert.ok(!bank.questions.filter((q) => q.category === 'hpfilms').some((q) => t.match(q, Date.now())), `theme ${name} matches film questions`);
  const ctx = fakeContext(bank.questions);
  for (let i = 0; i < 6; i++) {
    let s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed: `m${i}`, sessionId: `m${i}`, overrides: { variant: 'map' } });
    for (let guard = 0; guard < 400 && s.phase !== 'finished'; guard++) {
      if (s.phase === 'map') { const n = availableNodes(s.map)[0]; s = go(s, ctx, { type: 'MAP_PICK', layer: n.layer, index: n.index }); } else if (s.phase === 'loadout') s = go(s, ctx, { type: 'START_ROUND' });
      else if (s.phase === 'stake') { assert.notEqual(ctx.byId.get(s.round.slots[s.qIndex].questionId).category === 'hpfilms' && s.enc.id !== 'hat', true, `${s.enc.id} drew a film question`); s = answer(s, ctx, { right: true }); } else if (s.phase === 'reveal') s = go(s, ctx, { type: 'NEXT' });
      else if (s.phase === 'round-summary') s = go(s, ctx, { type: 'CONTINUE' });
      else if (s.phase === 'shop') s = go(s, ctx, { type: 'LEAVE_SHOP' });
      else if (s.phase === 'rest') s = go(s, ctx, { type: 'REST', choice: 'train' });
      else if (s.phase === 'event') s = go(s, ctx, { type: 'EVENT', choice: 'walk' });
      else if (s.phase === 'boss-cards') s = go(s, ctx, { type: 'BOSS_CARDS', cards: [] });
    }
  }
});

test('a run starts with both bonus slots empty; each boss offers cards, you take two, and they stay', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: ['scalpel', 'stopwatch', 'peek'] }], ctx, seed: 'slots', sessionId: 'slots', overrides: { variant: 'map' } });
  assert.deepEqual(s.players[0].loadout, [null, null], 'owned cards are not equipped for you');
  // a boss fight, straight away, with the owned cards still empty-slotted
  let boss = 0; let picked = [];
  for (let guard = 0; guard < 700 && s.phase !== 'finished'; guard++) {
    if (s.phase === 'map') { const order = ['fight', 'elite', 'boss', 'final', 'event', 'rest', 'shop']; const n = availableNodes(s.map).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0]; s = go(s, ctx, { type: 'MAP_PICK', layer: n.layer, index: n.index }); }
    else if (s.phase === 'loadout') { if (boss) assert.deepEqual(s.players[0].loadout.filter(Boolean).sort(), picked.sort(), 'the picks are remembered into the next fight'); s = go(s, ctx, { type: 'START_ROUND' }); }
    else if (s.phase === 'stake') s = answer(s, ctx, { right: true });
    else if (s.phase === 'reveal') s = go(s, ctx, { type: 'NEXT' });
    else if (s.phase === 'round-summary') s = go(s, ctx, { type: 'CONTINUE' });
    else if (s.phase === 'boss-cards') {
      boss += 1;
      assert.equal(s.draft.options.length, 4); assert.equal(new Set(s.draft.options).size, 4);
      assert.ok(!s.draft.options.some((id) => s.players[0].loadout.includes(id)), 'never offers what is already equipped');
      assert.equal(dispatch(s, { type: 'BOSS_CARDS', cards: [...s.draft.options.slice(0, 3)] }, ctx).ok, false, 'at most two');
      assert.equal(dispatch(s, { type: 'BOSS_CARDS', cards: ['not_a_card'] }, ctx).ok, false);
      picked = s.draft.options.slice(0, 2);
      s = go(s, ctx, { type: 'BOSS_CARDS', cards: picked });
      assert.deepEqual(s.players[0].loadout.slice().sort(), picked.slice().sort());
      assert.ok(picked.every((id) => s.players[0].owned.includes(id)));
      assert.equal(s.phase, 'map');
    } else if (s.phase === 'shop') s = go(s, ctx, { type: 'LEAVE_SHOP' });
    else if (s.phase === 'rest') s = go(s, ctx, { type: 'REST', choice: 'train' });
    else if (s.phase === 'event') s = go(s, ctx, { type: 'EVENT', choice: 'walk' });
  }
  assert.ok(boss >= 1, 'the map has a boss before the House');
});

test('taking nothing keeps the slots as they were, and one pick leaves the other slot alone', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const base = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed: 'k', sessionId: 'k', overrides: { variant: 'map' } });
  const withDraft = (loadout) => { const s = structuredClone(base); s.phase = 'boss-cards'; s.players[0].loadout = loadout; s.players[0].owned = loadout.filter(Boolean); s.draft = { options: ['safety_net', 'peek', 'scalpel', 'stopwatch'].filter((id) => !loadout.includes(id)).slice(0, 4), from: 'static' }; return s; };
  let s = withDraft(['scalpel', null]);
  s = go(s, ctx, { type: 'BOSS_CARDS', cards: [] });
  assert.deepEqual(s.players[0].loadout, ['scalpel', null]);
  s = withDraft(['scalpel', 'stopwatch']);
  s = go(s, ctx, { type: 'BOSS_CARDS', cards: ['peek'] });
  assert.equal(s.players[0].loadout[0], 'peek'); assert.equal(s.players[0].loadout[1], 'scalpel');
});
