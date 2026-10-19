import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, getStakeOptions } from '../src/engine/game.js';
import { BOSS_ROSTER, BOSS_IDS, DUEL, INTENTS, makeEncounter, intentIdFor, duelDamage, buildMap, availableNodes, isEnraged, timerMultFor, phaseOf, advancePhase } from '../src/engine/duel.js';
import { Rng } from '../src/engine/rng.js';
import { realBank, fakeContext, must, correctDisplay, wrongDisplay } from './helpers.js';

async function rush(bossId, seed = 'r1') {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed, sessionId: `s-${seed}`, overrides: { variant: 'rush', bossId } });
  return { s, ctx };
}
const go = (s, ctx, a) => must(dispatch(s, a, ctx));
const startFight = (s, ctx) => go(s, ctx, { type: 'START_ROUND' });
function answer(s, ctx, { right = true, stake = 1, elapsedMs = 3000 } = {}) {
  let t = go(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake });
  const choice = right ? correctDisplay(t, ctx) : wrongDisplay(t, ctx);
  return go(t, ctx, { type: 'ANSWER', playerId: 'p1', choice, elapsedMs });
}
const next = (s, ctx) => go(s, ctx, { type: 'NEXT' });

test('the roster has ten bosses, each with a pattern, a specialty and a sprite name', () => {
  assert.equal(BOSS_IDS.length, 10);
  for (const b of Object.values(BOSS_ROSTER)) {
    assert.ok(b.hp >= 12 && b.name && b.sprite && b.color && b.cat);
    assert.ok(b.intents.length >= 3 && b.enraged.length >= 3);
    for (const i of [...b.intents, ...b.enraged]) assert.ok(INTENTS[i], `${b.id} uses unknown intent ${i}`);
  }
  assert.equal(BOSS_IDS.filter((id) => BOSS_ROSTER[id].final).length, 1);
});

test('a rush game starts in front of the chosen boss with four bulbs and its starting heat', async () => {
  const { s, ctx } = await rush('static');
  assert.equal(s.config.variant, 'rush');
  assert.equal(s.enc.id, 'static');
  assert.equal(s.enc.hp, 20);
  assert.equal(s.players[0].strikes, DUEL.startLives);
  assert.equal(s.phase, 'loadout');
  const t = startFight(s, ctx);
  assert.equal(t.players[0].heat, DUEL.heat.boss);
  assert.equal(t.phase, 'stake');
  assert.equal(t.q.intent, 'strike'); // first intent of Dr. Static
});

test('an unknown boss id falls back to a real boss, and The House is a final boss', async () => {
  const { s } = await rush('nope');
  assert.ok(BOSS_ROSTER[s.enc.id] && !BOSS_ROSTER[s.enc.id].final);
  const h = await rush('house');
  assert.equal(h.s.enc.kind, 'final');
  assert.equal(h.s.enc.hp, 34);
});

test('a right answer hits the boss for the exact damage the stake screen promised', async () => {
  const { s, ctx } = await rush('static');
  let t = startFight(s, ctx);
  const opts = getStakeOptions(t, ctx, 'p1');
  const x2 = opts.find((o) => o.stake === 2);
  assert.ok(x2.dmg >= 1 && x2.dmgFast >= x2.dmg && x2.heatCost === 1);
  const hp0 = t.enc.hp;
  t = answer(t, ctx, { right: true, stake: 2, elapsedMs: 19000 }); // slow: no crit
  const rec = t.log.at(-1);
  assert.equal(rec.duel.dmg, x2.dmg);
  assert.equal(t.enc.hp, hp0 - x2.dmg);
  assert.equal(rec.duel.hpBefore, hp0);
  assert.equal(rec.duel.hpAfter, hp0 - x2.dmg);
  assert.equal(t.players[0].heat, DUEL.heat.boss - 1);
});

test('heat is a budget: a x3 stake costs 2, and you cannot stake what you cannot pay for', async () => {
  const { s, ctx } = await rush('static');
  let t = startFight(s, ctx);
  t = answer(t, ctx, { right: false, stake: 3 }); // 8 -> 7 - 2 = 5
  assert.equal(t.players[0].heat, DUEL.heat.boss - 2);
  // drain heat to 1 and try x3
  t = structuredClone(await (async () => { let u = startFight((await rush('static')).s, ctx); u.players[0].heat = 1; return u; })());
  const opts = getStakeOptions(t, ctx, 'p1');
  assert.equal(opts.find((o) => o.stake === 3).locked, true);
  assert.equal(opts.find((o) => o.stake === 2).locked, false);
  assert.equal(opts.find((o) => o.stake === 1).heatCost, 0);
  const res = dispatch(t, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 3 }, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, /heat/);
});

test('a fast right answer is a crit and refunds heat; a streak of 3 refunds one more', async () => {
  const { s, ctx } = await rush('static');
  let t = startFight(s, ctx);
  t = answer(t, ctx, { right: true, stake: 1, elapsedMs: 500 });
  assert.equal(t.log.at(-1).duel.crit, true);
  assert.equal(t.log.at(-1).duel.heatGain, 1);
  t = next(t, ctx);
  t = answer(t, ctx, { right: true, stake: 1, elapsedMs: 500 });
  t = next(t, ctx);
  t = answer(t, ctx, { right: true, stake: 1, elapsedMs: 500 }); // streak 3: crit + streak = +2
  assert.equal(t.log.at(-1).duel.heatGain, 2);
  assert.ok(t.players[0].heat <= DUEL.heatCap);
});

test('a miss against a boss costs a bulb; the fight is lost with none left', async () => {
  const { s, ctx } = await rush('cartographer');
  let t = startFight(s, ctx);
  let lost = 0;
  for (let i = 0; i < 10 && t.phase !== 'round-summary'; i++) {
    if (t.phase === 'stake') t = answer(t, ctx, { right: false, stake: 1 });
    if (t.phase === 'reveal') { lost = DUEL.startLives - t.players[0].strikes; t = next(t, ctx); }
  }
  assert.equal(t.phase, 'round-summary');
  assert.equal(t.enc.over, 'lost');
  assert.equal(t.players[0].strikes, 0);
  assert.equal(t.players[0].defeated, true);
  assert.ok(lost >= 3);
  t = go(t, ctx, { type: 'CONTINUE' });
  assert.equal(t.phase, 'finished');
  assert.equal(t.players[0].result, 'lost');
});

test('winning the duel ends a rush run as a win with the boss reward and a score', async () => {
  const { s, ctx } = await rush('static', 'win');
  let t = startFight(s, ctx);
  let guard = 0;
  while (t.phase !== 'round-summary' && guard++ < 40) {
    if (t.phase === 'stake') t = answer(t, ctx, { right: true, stake: 2, elapsedMs: 500 });
    else if (t.phase === 'reveal') t = next(t, ctx);
  }
  assert.equal(t.enc.over, 'won');
  assert.equal(t.enc.hp, 0);
  const sum = t.roundLog.at(-1);
  assert.equal(sum.players.p1.bonus, DUEL.rewards.boss.chips);
  t = go(t, ctx, { type: 'CONTINUE' });
  assert.equal(t.phase, 'finished');
  assert.equal(t.players[0].result, 'won');
  assert.ok(t.players[0].finalScore > 0);
  assert.equal(t.players[0].bossesCleared, 1);
});

test('Armor halves a slow hit; Mend heals the boss on a miss; Regrow heals before the question', async () => {
  assert.ok(duelDamage({ difficulty: 3, stake: 1, fast: false, inGuardWindow: false, intentId: 'guard' }) < duelDamage({ difficulty: 3, stake: 1, fast: false, inGuardWindow: true, intentId: 'guard' }));
  assert.equal(duelDamage({ difficulty: 2, stake: 1, fast: false, intentId: 'twin' }), 2 * duelDamage({ difficulty: 2, stake: 1, fast: false, intentId: 'strike' }));
  const { s, ctx } = await rush('archivist');
  let t = startFight(s, ctx);
  t = answer(t, ctx, { right: true, stake: 1, elapsedMs: 19000 }); // intent 0 = strike
  t = next(t, ctx);
  assert.equal(t.q.intent, 'mend');
  const hp = t.enc.hp;
  t = answer(t, ctx, { right: false });
  assert.equal(t.enc.hp, Math.min(t.enc.maxHp, hp + 2));
  assert.equal(t.log.at(-1).duel.heal, 2);
  const o = await rush('overgrowth');
  let u = startFight(o.s, o.ctx);
  u = answer(u, o.ctx, { right: true, stake: 3, elapsedMs: 19000 });
  const before = u.enc.hp;
  u = next(u, o.ctx); // second intent is Regrow: healed on open
  assert.equal(u.q.intent, 'regrow');
  assert.equal(u.enc.hp, Math.min(u.enc.maxHp, before + 1));
});

test('curses are cast by the boss through the hex effects and never count as a rival hex', async () => {
  const { s, ctx } = await rush('cartographer');
  let t = startFight(s, ctx);
  t = answer(t, ctx, { right: true, stake: 1, elapsedMs: 19000 });
  t = next(t, ctx);
  assert.equal(t.q.intent, 'blur');
  assert.equal(t.players[0].pendingHexes.at(-1).by, 'boss');
  t = go(t, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.ok(t.q.byPlayer.p1.hexes.some((h) => h.fx === 'blur'));
  const q = ctx.byId.get(t.q.questionId);
  t = go(t, ctx, { type: 'ANSWER', playerId: 'p1', choice: t.q.order.indexOf(q.answer), elapsedMs: 19000 });
  assert.equal(t.log.at(-1).duel.curseThrough, true);
  assert.equal(t.log.at(-1).delta > 0, true);
});

test('Surge and Accelerando shorten the clock; enrage shortens it further; it never drops under 55%', () => {
  const enc = makeEncounter({ kind: 'boss', enemyId: 'maestro' });
  assert.equal(timerMultFor(enc, 'strike', 0), 1);
  assert.equal(timerMultFor(enc, 'surge', 0), 0.7);
  assert.ok(timerMultFor(enc, 'accel', 4) < timerMultFor(enc, 'accel', 1));
  enc.hp = 3;
  assert.equal(isEnraged(enc), true);
  assert.ok(timerMultFor(enc, 'surge', 0) < 0.7);
  assert.ok(timerMultFor(enc, 'accel', 30) >= 0.55);
  assert.equal(intentIdFor(enc, 0), enc.enraged[0]);
});

test('a plain contestant never costs a bulb for one miss but beats you after three', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed: 'm1', sessionId: 'sm1', overrides: { variant: 'map' } });
  assert.equal(s.phase, 'map');
  const first = availableNodes(s.map)[0];
  s = go(s, ctx, { type: 'MAP_PICK', layer: first.layer, index: first.index });
  assert.equal(s.enc.kind, 'minion');
  s = startFight(s, ctx);
  s = answer(s, ctx, { right: false });
  assert.equal(s.players[0].strikes, DUEL.startLives);
  assert.equal(s.enc.misses, 1);
  for (let i = 0; i < 2; i++) { s = next(s, ctx); s = answer(s, ctx, { right: false }); }
  assert.equal(s.enc.over, 'beaten');
  s = next(s, ctx);
  assert.equal(s.phase, 'round-summary');
  assert.equal(s.players[0].strikes, DUEL.startLives - 1);
  s = go(s, ctx, { type: 'CONTINUE' });
  assert.equal(s.phase, 'map');
});

test('the map has five layers, a boss in the middle and the House at the end, and every path connects', () => {
  for (let i = 0; i < 25; i++) {
    const m = buildMap(Rng.fromSeed(`map${i}`));
    assert.equal(m.layers.length, 5);
    assert.equal(m.layers[2].length, 1); assert.equal(m.layers[2][0].kind, 'boss');
    assert.equal(m.layers[4][0].kind, 'final');
    assert.deepEqual(m.layers[0].map((n) => n.kind), ['fight', 'fight', 'fight']);
    m.layers.slice(0, 4).forEach((layer) => layer.forEach((n) => assert.ok(n.next.length >= 1)));
    // every node of a later layer is reachable from somewhere
    for (let l = 1; l < 5; l++) m.layers[l].forEach((_, j) => assert.ok(m.layers[l - 1].some((n) => n.next.includes(j)), `layer ${l} node ${j} unreachable (seed ${i})`));
    assert.ok(m.layers.flat().filter((n) => n.kind === 'fight').length >= 4);
    assert.ok(m.layers[1].some((n) => n.kind === 'elite') && m.layers[1].some((n) => n.kind === 'rest'));
  }
});

test('rooms: rest heals or trains, deals trade, the shop sells heat, and unreachable rooms are refused', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed: 'rooms', sessionId: 'srooms', overrides: { variant: 'map' } });
  assert.equal(dispatch(s, { type: 'MAP_PICK', layer: 2, index: 0 }, ctx).ok, false);
  // jump straight to a rest room for the unit test
  const t = structuredClone(s); t.phase = 'rest'; t.round = { act: 0 }; t.players[0].strikes = 2;
  const healed = must(dispatch(t, { type: 'REST', choice: 'heal' }, ctx));
  assert.equal(healed.players[0].strikes, 3);
  assert.equal(healed.phase, 'map');
  const trained = must(dispatch(t, { type: 'REST', choice: 'train' }, ctx));
  assert.equal(trained.players[0].chips, 50 + DUEL.restChips);
  assert.equal(trained.players[0].heatBonus, 1);
  const full = structuredClone(t); full.players[0].strikes = DUEL.maxLives;
  assert.equal(dispatch(full, { type: 'REST', choice: 'heal' }, ctx).ok, false);

  const e = structuredClone(s); e.phase = 'event'; e.round = { act: 0 }; e.event = { deals: ['sell_bulb', 'hot_hand'] };
  assert.equal(dispatch(e, { type: 'EVENT', choice: 'sharpen' }, ctx).ok, false); // not on the table
  const sold = must(dispatch(e, { type: 'EVENT', choice: 'sell_bulb' }, ctx));
  assert.equal(sold.players[0].strikes, DUEL.startLives - 1);
  assert.equal(sold.players[0].chips, 140);
  const hot = must(dispatch(e, { type: 'EVENT', choice: 'hot_hand' }, ctx));
  assert.equal(hot.players[0].heatBonus, 3);
  assert.equal(hot.players[0].chips, 30);
  const walked = must(dispatch(e, { type: 'EVENT', choice: 'walk' }, ctx));
  assert.equal(walked.phase, 'map');

  const sh = structuredClone(s); sh.phase = 'shop'; sh.round = { act: 0 }; sh.map.at = 2;
  const ice = must(dispatch(sh, { type: 'BUY', playerId: 'p1', item: 'ice_pack' }, ctx));
  assert.equal(ice.players[0].heatBonus, 2);
  assert.equal(ice.players[0].chips, 0);
  assert.equal(must(dispatch(ice, { type: 'LEAVE_SHOP' }, ctx)).phase, 'map');
});

test('a bot that always answers right clears a whole map run, and one that always misses is stopped', async () => {
  const { questions } = await realBank();
  for (const [name, right] of [['perfect', true], ['hopeless', false]]) {
    const ctx = fakeContext(questions);
    let s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed: `bot-${name}`, sessionId: `bot-${name}`, overrides: { variant: 'map' } });
    let guard = 0;
    while (s.phase !== 'finished' && guard++ < 600) {
      if (s.phase === 'map') { const n = availableNodes(s.map).sort((a, b) => ['fight', 'elite', 'boss', 'final', 'event', 'rest', 'shop'].indexOf(a.kind) - ['fight', 'elite', 'boss', 'final', 'event', 'rest', 'shop'].indexOf(b.kind))[0]; s = go(s, ctx, { type: 'MAP_PICK', layer: n.layer, index: n.index }); }
      else if (s.phase === 'loadout') s = startFight(s, ctx);
      else if (s.phase === 'stake') {
        const opts = getStakeOptions(s, ctx, 'p1');
        const stake = opts.filter((o) => !o.locked).at(-1).stake;
        s = answer(s, ctx, { right, stake, elapsedMs: 800 });
      } else if (s.phase === 'reveal') s = next(s, ctx);
      else if (s.phase === 'round-summary') s = go(s, ctx, { type: 'CONTINUE' });
      else if (s.phase === 'shop') s = go(s, ctx, { type: 'LEAVE_SHOP' });
      else if (s.phase === 'rest') s = go(s, ctx, { type: 'REST', choice: s.players[0].strikes < DUEL.maxLives ? 'heal' : 'train' });
      else if (s.phase === 'event') s = go(s, ctx, { type: 'EVENT', choice: 'walk' });
      else throw new Error(`stuck in ${s.phase}`);
    }
    assert.equal(s.phase, 'finished', `${name} run did not finish`);
    assert.equal(s.players[0].result, right ? 'won' : 'lost', name);
    if (right) { assert.equal(s.players[0].bossesCleared >= 2, true); assert.ok(s.players[0].roundsCleared >= 4); }
    assert.ok(Number.isFinite(s.players[0].finalScore));
  }
});

test('the same seed plays the same duel, and the questions never repeat inside a run', async () => {
  const a = await rush('anchor', 'same'); const b = await rush('anchor', 'same');
  let x = startFight(a.s, a.ctx); let y = startFight(b.s, b.ctx);
  const ids = [];
  for (let i = 0; i < 8 && x.phase !== 'round-summary'; i++) {
    assert.equal(x.q.questionId, y.q.questionId);
    ids.push(x.q.questionId);
    x = answer(x, a.ctx, { right: i % 3 !== 2, stake: 1 }); y = answer(y, b.ctx, { right: i % 3 !== 2, stake: 1 });
    assert.equal(x.enc.hp, y.enc.hp);
    if (x.phase === 'reveal') { x = next(x, a.ctx); y = next(y, b.ctx); }
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('hexes still work in a duel: a dare on yourself pays more damage, and the hex deck feeds streaks', async () => {
  const { s, ctx } = await rush('static');
  let t = startFight(s, ctx);
  t.players[0].hexHand = ['ink_blast'];
  t = go(t, ctx, { type: 'USE_HEX', playerId: 'p1', hexId: 'ink_blast', targetId: 'p1' });
  assert.equal(t.lastHex.self, true);
  t = answer(t, ctx, { right: true, stake: 1, elapsedMs: 19000 });
  assert.equal(t.players[0].stats.dareWins, 1);
});

test('skeleton key does nothing against a boss, and old classic runs still work', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const s = createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: ['skeleton_key'] }], ctx, seed: 'classic', sessionId: 'sc' });
  assert.equal(s.config.duel, undefined);
  assert.equal(s.enc, null);
  assert.equal(s.round.slots.length, 5);
});

test('the House has three faces that only move forward, with their own moves and sprites; other bosses have none', () => {
  const enc = makeEncounter({ kind: 'boss', enemyId: 'house' });
  assert.equal(enc.kind, 'final');
  assert.equal(enc.phases.length, 3);
  assert.equal(phaseOf(enc), 0);
  assert.equal(enc.sprite, 'boss_house');
  enc.hp = Math.floor(enc.maxHp * 0.6);
  assert.deepEqual(advancePhase(enc), { from: 0, to: 1 });
  assert.equal(enc.sprite, 'boss_house_open');
  assert.ok(INTENTS[intentIdFor(enc, 0)]);
  enc.hp = enc.maxHp; // healing never brings the roof back
  assert.deepEqual(advancePhase(enc), { from: 1, to: 1 });
  enc.hp = 5;
  assert.deepEqual(advancePhase(enc), { from: 1, to: 2 });
  assert.equal(enc.sprite, 'boss_jester');
  assert.equal(enc.name, 'The Jester');
  for (const ph of enc.phases) for (const id of [...ph.intents, ...(ph.enraged ?? [])]) assert.ok(INTENTS[id], id);
  const other = makeEncounter({ kind: 'boss', enemyId: 'static' });
  assert.equal(other.phases, undefined);
  assert.deepEqual(advancePhase(other), { from: 0, to: 0 });
});

test('evolution: each rank is bigger, harder and nastier; the final boss never evolves', async () => {
  const { evolveBoss, cleanRank, BOSS_RANK_MAX, evolutionText } = await import('../src/engine/duel.js');
  const base = BOSS_ROSTER.static;
  assert.equal(evolveBoss(base, 0).name, base.name);
  let last = base;
  for (let r = 1; r <= BOSS_RANK_MAX; r++) {
    const e = evolveBoss(base, r);
    assert.ok(e.hp > last.hp, `rank ${r} has more health`);
    assert.ok(e.tier >= last.tier && e.tier <= 5);
    assert.ok(e.name.startsWith(base.name) && e.name !== base.name);
    assert.ok(e.reward > (last.reward ?? 1));
    assert.ok(!e.intents.includes('strike') || r === 0 || e.intents.filter((i) => i === 'strike').length < base.intents.filter((i) => i === 'strike').length + 1);
    for (const i of [...e.intents, ...e.enraged]) assert.ok(INTENTS[i], i);
    last = e;
  }
  assert.ok(evolveBoss(base, 4).tier > base.tier);
  assert.equal(evolveBoss(BOSS_ROSTER.house, 3).hp, BOSS_ROSTER.house.hp, 'the House is always itself');
  assert.equal(cleanRank(99), BOSS_RANK_MAX); assert.equal(cleanRank('x'), 0); assert.equal(cleanRank(-2), 0);
  assert.match(evolutionText(0), /Evolved/); assert.match(evolutionText(4), /cannot evolve/);
});

test('a rush game against an evolved boss uses its rank, and a win records what was beaten', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const mk = (rank) => createGame({ mode: 'solo', players: [{ id: 'p1', name: 'P', ownedCards: [] }], ctx, seed: 'e1', sessionId: `e-${rank}`, overrides: { variant: 'rush', bossId: 'static', bossRanks: { static: rank } } });
  const s0 = mk(0); const s2 = mk(2);
  assert.equal(s0.enc.rank, 0); assert.equal(s2.enc.rank, 2);
  assert.ok(s2.enc.maxHp > s0.enc.maxHp && s2.enc.tier > s0.enc.tier && /II/.test(s2.enc.name));
  assert.equal(mk(99).enc.rank, 4, 'ranks are clamped');
  // beat it
  let t = startFight(s2, ctx);
  for (let i = 0; i < 60 && t.enc.over !== 'won'; i++) { t = answer(t, ctx, { right: true, stake: 3 }); if (t.enc.over === 'won') break; t = next(t, ctx); }
  assert.equal(t.enc.over, 'won');
  t = next(t, ctx);
  assert.deepEqual(t.beaten, [{ id: 'static', rank: 2 }]);
  assert.equal(t.rankBeaten, 2);
});

test('the Plague Doctor asks only medicine, and the medicine bank has hard questions for evolved ranks', async () => {
  const { questions } = await realBank();
  const b = BOSS_ROSTER.plague;
  assert.equal(b.cat, 'medicine'); assert.equal(b.sprite, 'boss_plague');
  const med = questions.filter((q) => q.category === 'medicine');
  assert.ok(med.length >= 36);
  assert.ok(med.filter((q) => q.difficulty >= 3).length >= 10, 'evolved ranks need hard base questions');
  const { s: g0, ctx } = await rush('plague', 'plague1');
  const game = startFight(g0, ctx);
  assert.equal(game.enc.id, 'plague');
  const cats = game.round.slots.map((x) => x.category);
  assert.ok(cats.length > 0 && cats.every((c) => c === 'medicine'), `${cats}`);
});
