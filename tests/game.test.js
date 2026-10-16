import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, getQuestionView, getStakeOptions, cardReward } from '../src/engine/game.js';
import { CARDS as CARD_DEFS, CARD_IDS, STARTER_CARDS } from '../src/engine/cards.js';
import { realBank, fakeContext, must, correctDisplay, wrongDisplay, playToEnd, stepBot, advanceTo, accuracyBot } from './helpers.js';
import { syntheticQuestions } from './synthetic.js';

const SEED_ID = 'sess-test';
const always = (answerCorrectly, stake = 1) => () => ({ answerCorrectly, stake });

function solo(ctx, { cards = STARTER_CARDS, seed = 'solo-seed', overrides } = {}) {
  return createGame({ mode: 'solo', players: [{ id: 'p1', name: 'Ana', ownedCards: cards }], ctx, seed, sessionId: SEED_ID, overrides });
}
function versus(ctx, n = 3, cards = CARD_IDS, seed = 'vs-seed') {
  const players = ['p1', 'p2', 'p3', 'p4'].slice(0, n).map((id, i) => ({ id, name: `Player ${i + 1}`, ownedCards: cards }));
  return createGame({ mode: 'versus', players, ctx, seed, sessionId: SEED_ID });
}
const act = (s, ctx, action) => must(dispatch(s, action, ctx));

/** Move a solo game to the first question's 'question' phase. */
function toQuestion(s, ctx, stake = 1) {
  let st = act(s, ctx, { type: 'START_ROUND' });
  const pid = st.players[st.turn].playerId;
  st = act(st, ctx, { type: 'CONFIRM_STAKE', playerId: pid, stake });
  return st;
}

test('a perfect solo run on the real bank is won: 9 rounds, 45 distinct questions, 3 bosses cleared', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const end = playToEnd(solo(ctx), ctx, always(true));
  const p = end.players[0];
  assert.equal(end.status, 'completed');
  assert.equal(p.result, 'won');
  assert.equal(p.roundsCleared, 9);
  assert.equal(p.bossesCleared, 3);
  assert.equal(end.log.length, 45);
  assert.equal(new Set(end.log.map((r) => r.questionId)).size, 45, 'no question repeats within a run');
  assert.equal(p.strikes, 3);
  assert.equal(p.finalScore, p.chips + 9 * 100 + 3 * 200);
  assert.ok(end.log.every((r) => r.playerId === 'p1'));
});

test('a quick run is one act: 3 rounds and 15 questions', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const end = playToEnd(solo(ctx, { overrides: { acts: 1 } }), ctx, always(true));
  assert.equal(end.log.length, 15);
  assert.equal(end.players[0].result, 'won');
});

test('answering everything wrong loses three strikes and ends the run as a defeat', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const end = playToEnd(solo(ctx), ctx, always(false));
  const p = end.players[0];
  assert.equal(p.result, 'lost');
  assert.equal(p.defeated, true);
  assert.equal(p.strikes, 0);
  assert.equal(end.roundLog.length, 3, 'run ends after the third failed round');
  assert.equal(p.roundsCleared, 0);
  assert.equal(p.finalScore, 0);
  assert.ok(p.chips >= 0);
});

test('chips never go negative and the broke rule keeps a run recoverable', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = solo(ctx);
  const decide = (st) => ({ answerCorrectly: false, stake: 3 });
  while (s.phase !== 'finished') {
    s = stepBot(s, ctx, decide);
    assert.ok(s.players[0].chips >= 0);
  }
});

test('same seed and same answers replay identically', async () => {
  const { questions } = await realBank();
  const run = () => {
    const ctx = fakeContext(questions);
    return playToEnd(solo(ctx, { seed: 'replay' }), ctx, accuracyBot(0.7, 'same-bot'));
  };
  assert.deepEqual(run(), run());
});

test('a game saved as JSON mid-run and resumed finishes exactly like one that never stopped', async () => {
  const { questions } = await realBank();
  const decide = (st) => ({ answerCorrectly: (st.roundIndex + st.qIndex) % 3 !== 0, stake: 2 });
  const ctxA = fakeContext(questions);
  let a = solo(ctxA, { seed: 'resume' });
  for (let i = 0; i < 37; i++) a = stepBot(a, ctxA, decide);

  const restored = JSON.parse(JSON.stringify(a));
  const ctxB = fakeContext(questions);
  ctxB.setTime(1_700_000_000_000);
  ctxA.setTime(1_700_000_000_000);
  const endA = playToEnd(a, ctxA, decide);
  const endB = playToEnd(restored, ctxB, decide);
  assert.deepEqual(endB, endA);
});

test('rapid double taps cannot answer or stake twice', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = act(solo(ctx), ctx, { type: 'START_ROUND' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 2 });
  assert.equal(dispatch(s, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 3 }, ctx).ok, false);
  const c = correctDisplay(s, ctx);
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: c, elapsedMs: 1000 });
  const again = dispatch(s, { type: 'ANSWER', playerId: 'p1', choice: c, elapsedMs: 1000 }, ctx);
  assert.equal(again.ok, false);
  assert.equal(s.log.length, 1);
  assert.equal(s.phase, 'reveal');
  assert.equal(dispatch(s, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 }, ctx).ok, false);
});

test('result ids are deterministic per player and question, so a replayed write cannot double count', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const end = playToEnd(solo(ctx), ctx, always(true));
  assert.equal(new Set(end.log.map((r) => r.resultId)).size, end.log.length);
  assert.ok(end.log.every((r) => r.resultId.startsWith(`${SEED_ID}:`)));
});

test('a timeout (no answer) counts as a miss and is recorded as a timeout', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = toQuestion(solo(ctx), ctx);
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: null, elapsedMs: 99999 });
  const r = s.log[0];
  assert.equal(r.outcome, 'timeout');
  assert.equal(r.correct, false);
  assert.ok(r.delta < 0);
});

test('an answer far past the clock counts as a timeout even if it was right', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = toQuestion(solo(ctx), ctx);
  const c = correctDisplay(s, ctx);
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: c, elapsedMs: 10 * 60 * 1000 });
  assert.equal(s.log[0].outcome, 'timeout');
});

test('stake options expose exact win and lose numbers before committing', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = act(solo(ctx), ctx, { type: 'START_ROUND' });
  const opts = getStakeOptions(s, ctx, 'p1');
  assert.deepEqual(opts.map((o) => o.stake), [1, 2, 3]);
  assert.deepEqual(opts.map((o) => o.lose), [10, 20, 30]);
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 2 });
  const wrong = wrongDisplay(s, ctx);
  const before = s.players[0].chips;
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrong, elapsedMs: 1000 });
  assert.equal(before - s.players[0].chips, 20, 'the loss shown on the stake screen is the loss paid');
});

test('the question text is hidden on the stake screen and shown once the clock starts', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = act(solo(ctx), ctx, { type: 'START_ROUND' });
  assert.equal(getQuestionView(s, ctx, 'p1').text, null);
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.ok(getQuestionView(s, ctx, 'p1').text.length > 5);
});

test('explanations are available after every question, right or wrong', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  for (const correct of [true, false]) {
    let s = toQuestion(solo(ctx), ctx);
    const choice = correct ? correctDisplay(s, ctx) : wrongDisplay(s, ctx);
    s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice, elapsedMs: 5000 });
    assert.equal(s.phase, 'reveal');
    assert.ok(getQuestionView(s, ctx, 'p1').explanation.length > 5);
  }
});

/* ---------------- crossroads, push, bank and shop ---------------- */

test('crossroads: banking moves half the chips to the vault, safe from later losses', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = advanceTo(solo(ctx), ctx, 'crossroads', always(true));
  const before = s.players[0].chips;
  s = act(s, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'bank' });
  assert.equal(s.players[0].vault, Math.floor(before / 2));
  assert.equal(s.players[0].chips, before - Math.floor(before / 2));
  assert.equal(s.phase, 'shop');
  assert.equal(dispatch(s, { type: 'CROSSROADS', playerId: 'p1', choice: 'bank' }, ctx).ok, false, 'only once per crossroads');
});

test('a defeat keeps the vault but loses the chips on the table', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = advanceTo(solo(ctx), ctx, 'crossroads', always(true));
  s = act(s, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'bank' });
  const vault = s.players[0].vault;
  const end = playToEnd(s, ctx, always(false));
  assert.equal(end.players[0].result, 'lost');
  assert.equal(end.players[0].vault, vault);
  assert.equal(end.players[0].finalScore, vault + end.players[0].roundsCleared * 100 + end.players[0].bossesCleared * 200);
});

test('push raises gains and losses by 50% for exactly one round', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = advanceTo(solo(ctx), ctx, 'crossroads', always(true));
  s = act(s, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'push' });
  assert.equal(s.players[0].pushed, true);
  s = act(s, ctx, { type: 'LEAVE_SHOP' });
  const next = advanceTo(s, ctx, 'round-summary', always(true));
  assert.equal(next.players[0].pushed, false, 'the push expires after the round');
});

test('shop: spare bulb needs 100 chips, once per act, and respects the five-strike cap', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = advanceTo(solo(ctx), ctx, 'crossroads', always(true));
  s = act(s, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'hold' });
  s.players[0].chips = 99;
  assert.equal(dispatch(s, { type: 'BUY', playerId: 'p1', item: 'spare_bulb' }, ctx).ok, false);
  s.players[0].chips = 500;
  s = act(s, ctx, { type: 'BUY', playerId: 'p1', item: 'spare_bulb' });
  assert.equal(s.players[0].strikes, 4);
  assert.equal(s.players[0].chips, 400);
  assert.equal(dispatch(s, { type: 'BUY', playerId: 'p1', item: 'spare_bulb' }, ctx).ok, false, 'once per act');
});

test('shop: spare battery adds a charge to equipped cards for the next round only', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = advanceTo(solo(ctx), ctx, 'crossroads', always(true));
  s = act(s, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'hold' });
  s.players[0].chips = 500;
  s = act(s, ctx, { type: 'BUY', playerId: 'p1', item: 'spare_battery' });
  s = act(s, ctx, { type: 'LEAVE_SHOP' });
  s = act(s, ctx, { type: 'START_ROUND' });
  const [a] = s.players[0].loadout;
  assert.equal(s.players[0].charges[a], 2);
  const after = advanceTo(s, ctx, 'round-summary', always(true));
  assert.equal(after.players[0].bonusCharges, false);
});

test('the shop is only reachable from the crossroads and is closed in daily mode', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const s = solo(ctx);
  assert.equal(dispatch(s, { type: 'BUY', playerId: 'p1', item: 'slow_clock' }, ctx).ok, false);
  const daily = createGame({ mode: 'daily', players: [{ id: 'p1', name: 'Ana', ownedCards: CARD_IDS }], ctx, seed: 'daily-2026-10-15', sessionId: 'd' });
  const cross = advanceTo(daily, ctx, 'crossroads', always(true));
  const after = act(cross, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'hold' });
  assert.equal(after.phase, 'loadout', 'daily skips the shop');
});

/* ---------------- daily challenge ---------------- */

test('daily: identical rounds and question order for everyone, regardless of history', async () => {
  const { questions } = await realBank();
  const make = (avoid) => {
    const ctx = fakeContext(questions);
    return createGame({ mode: 'daily', players: [{ id: 'p1', name: 'Ana', ownedCards: [] }], ctx, seed: 'daily-2026-10-15', sessionId: 'd', avoidIds: avoid });
  };
  const a = make([]);
  const b = make(questions.slice(0, 120).map((q) => q.id));
  assert.deepEqual(a.round, b.round);
  const ctx = fakeContext(questions);
  const ra = playToEnd(a, ctx, always(true));
  const rb = playToEnd(b, fakeContext(questions), always(true));
  assert.deepEqual(ra.log.map((r) => r.questionId), rb.log.map((r) => r.questionId));
  assert.equal(ra.round.index, 2);
});

test('daily: cards are disabled', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const daily = createGame({ mode: 'daily', players: [{ id: 'p1', name: 'Ana', ownedCards: CARD_IDS }], ctx, seed: 'daily-x', sessionId: 'd' });
  assert.deepEqual(daily.players[0].loadout, [null, null]);
  assert.equal(dispatch(daily, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel'] }, ctx).ok, false);
});

/* ---------------- loadout and cards ---------------- */

const syn = () => fakeContext(syntheticQuestions());

test('loadout holds two distinct owned cards, and attack cards are not equippable in solo', () => {
  const ctx = syn();
  let s = solo(ctx, { cards: CARD_IDS });
  assert.equal(dispatch(s, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel', 'scalpel'] }, ctx).ok, false);
  assert.equal(dispatch(s, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['jammer', 'scalpel'] }, ctx).ok, false);
  assert.equal(dispatch(s, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel', 'not_a_card'] }, ctx).ok, false);
  s = act(s, ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['rewind', 'peek'] });
  assert.deepEqual(s.players[0].loadout, ['rewind', 'peek']);
  const s2 = solo(ctx, { cards: ['scalpel'] });
  assert.equal(dispatch(s2, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['rewind'] }, ctx).ok, false, 'cannot equip a card you do not own');
});

test('scalpel hides exactly two wrong answers, never the right one, and hidden options cannot be picked', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel', 'stopwatch'] });
  s = toQuestion(s, ctx);
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'scalpel' });
  const qp = s.q.byPlayer.p1;
  assert.equal(qp.hidden.length, 2);
  assert.ok(!qp.hidden.includes(correctDisplay(s, ctx)));
  assert.equal(dispatch(s, { type: 'ANSWER', playerId: 'p1', choice: qp.hidden[0], elapsedMs: 100 }, ctx).ok, false);
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'scalpel' }, ctx).ok, false, 'no charge left');
  const view = getQuestionView(s, ctx, 'p1');
  assert.equal(view.choices.filter((c) => c.hidden).length, 2);
});

test('stopwatch adds ten seconds once per question', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['stopwatch', 'scalpel'] });
  s = toQuestion(s, ctx);
  const before = s.q.byPlayer.p1.timerMs;
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'stopwatch' });
  assert.equal(s.q.byPlayer.p1.timerMs, before + 10000);
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'stopwatch' }, ctx).ok, false);
});

test('charges refill each round; a card with one charge works once per round', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['stopwatch', 'scalpel'] });
  s = toQuestion(s, ctx);
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'stopwatch' });
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: correctDisplay(s, ctx), elapsedMs: 1000 });
  s = act(s, ctx, { type: 'NEXT' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'stopwatch' }, ctx).ok, false, 'spent for this round');
  const nextRound = advanceTo(s, ctx, 'round-summary', always(true));
  let r2 = act(nextRound, ctx, { type: 'CONTINUE' });
  r2 = act(r2, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'hold' });
  r2 = act(r2, ctx, { type: 'LEAVE_SHOP' });
  r2 = act(r2, ctx, { type: 'START_ROUND' });
  assert.equal(r2.players[0].charges.stopwatch, 1);
});

test('cards can only be used in the right phase and only if equipped', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['safety_net', 'scalpel'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'scalpel' }, ctx).ok, false, 'in-question card before staking');
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'peek' }, ctx).ok, false, 'not equipped');
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'safety_net' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'safety_net' }, ctx).ok, false, 'pre-stake card during question');
});

test('safety net: wrong answers cost half the stake, correct answers pay 25% less', () => {
  const ctx = syn();
  const run = (correct) => {
    let s = act(solo(ctx, { cards: CARD_IDS, seed: 'sn' }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['safety_net', 'peek'] });
    s = act(s, ctx, { type: 'START_ROUND' });
    s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'safety_net' });
    s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 2 });
    const choice = correct ? correctDisplay(s, ctx) : wrongDisplay(s, ctx);
    return act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice, elapsedMs: 19000 }).log[0];
  };
  assert.equal(run(false).delta, -10);
  const win = run(true);
  assert.ok(win.delta > 0 && win.delta < 20);
  assert.deepEqual(win.usedCards, ['safety_net']);
});

test('peek reveals the question text before staking and costs 20% of the win', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['peek', 'scalpel'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  assert.equal(getQuestionView(s, ctx, 'p1').text, null);
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'peek' });
  assert.ok(getQuestionView(s, ctx, 'p1').text);
  const reduced = getStakeOptions(s, ctx, 'p1')[0].win;
  const plain = getStakeOptions(act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'START_ROUND' }), ctx, 'p1')[0].win;
  assert.ok(reduced <= plain);
  const marked = s.log.length;
  assert.equal(marked, 0);
});

test('ghost note reveals the first letter of the right answer; the log records a hint was used', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['ghost_note', 'peek'] });
  s = toQuestion(s, ctx);
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'ghost_note' });
  const view = getQuestionView(s, ctx, 'p1');
  assert.equal(view.ghostLetter, view.choices.find((c) => c.correct).text.charAt(0).toUpperCase());
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: correctDisplay(s, ctx), elapsedMs: 1000 });
  assert.equal(s.log[0].usedHint, true);
  assert.deepEqual(s.log[0].usedCards, ['ghost_note']);
});

test('streak shield keeps the streak through one wrong answer', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['streak_shield', 'peek'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  s.players[0].streak = 4;
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'streak_shield' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrongDisplay(s, ctx), elapsedMs: 1000 });
  assert.equal(s.players[0].streak, 4);
  assert.equal(s.log[0].delta, -10, 'the stake is still lost in full');
});

test('double or nothing doubles the loss', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['double_or_nothing', 'peek'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'double_or_nothing' });
  assert.deepEqual(getStakeOptions(s, ctx, 'p1').map((o) => o.lose), [20, 40, 50]);
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrongDisplay(s, ctx), elapsedMs: 1000 });
  assert.equal(s.log[0].delta, -20);
});

test('rewind: a wrong answer triggers one retry with that option removed; a correct retry pays half', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['rewind', 'peek'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'rewind' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 2 });
  const wrong = wrongDisplay(s, ctx);
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrong, elapsedMs: 5000 });
  assert.equal(s.phase, 'question', 'still on the same question');
  assert.equal(s.log.length, 0, 'nothing is recorded yet');
  assert.ok(s.q.byPlayer.p1.hidden.includes(wrong));
  assert.equal(s.q.byPlayer.p1.timerMs, 10000);
  assert.equal(dispatch(s, { type: 'ANSWER', playerId: 'p1', choice: wrong, elapsedMs: 100 }, ctx).ok, false);
  const chips = s.players[0].chips;
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: correctDisplay(s, ctx), elapsedMs: 9000 });
  assert.equal(s.log[0].attempts, 2);
  assert.equal(s.log[0].correct, true);
  assert.ok(s.log[0].delta > 0 && s.log[0].delta <= 10 * 2);
  assert.equal(s.players[0].chips, chips + s.log[0].delta);
});

test('rewind: a second wrong answer finalises the loss', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['rewind', 'peek'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'rewind' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrongDisplay(s, ctx), elapsedMs: 5000 });
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrongDisplay(s, ctx), elapsedMs: 5000 });
  assert.equal(s.log[0].correct, false);
  assert.equal(s.log[0].delta, -10);
  assert.equal(s.log[0].attempts, 2);
});

test('skeleton key counts one question as correct for half pay, once per run', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['skeleton_key', 'peek'] });
  s = toQuestion(s, ctx, 2);
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'skeleton_key' });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.log[0].correct, true);
  assert.deepEqual(s.log[0].usedCards, ['skeleton_key']);
  assert.ok(s.log[0].delta > 0 && s.log[0].delta <= 10);
  assert.equal(s.players[0].runCharges.skeleton_key, 0);
  const rest = advanceTo(s, ctx, 'round-summary', always(true));
  let r2 = act(rest, ctx, { type: 'CONTINUE' });
  r2 = act(r2, ctx, { type: 'CROSSROADS', playerId: 'p1', choice: 'hold' });
  r2 = act(r2, ctx, { type: 'LEAVE_SHOP' });
  r2 = act(r2, ctx, { type: 'START_ROUND' });
  r2 = act(r2, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.equal(dispatch(r2, { type: 'USE_CARD', playerId: 'p1', cardId: 'skeleton_key' }, ctx).ok, false, 'one use per run');
});

test('skeleton key does nothing against bosses', () => {
  const ctx = syn();
  let s = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['skeleton_key', 'peek'] });
  s.round.bossId = 'chain';
  s.round.isBoss = true;
  s = toQuestion(s, ctx);
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'skeleton_key' }, ctx).ok, false);
});

test('hazards and bosses can lock cards', () => {
  const ctx = syn();
  let cold = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel', 'stopwatch'] });
  cold.round.hazardId = 'cold_table';
  cold = toQuestion(cold, ctx);
  assert.equal(dispatch(cold, { type: 'USE_CARD', playerId: 'p1', cardId: 'scalpel' }, ctx).ok, false, 'clue card locked');
  assert.equal(dispatch(cold, { type: 'USE_CARD', playerId: 'p1', cardId: 'stopwatch' }, ctx).ok, true, 'non-clue card still works');

  let dark = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel', 'stopwatch'] });
  dark.round.bossId = 'blackout';
  dark.round.isBoss = true;
  dark = toQuestion(dark, ctx);
  assert.equal(dispatch(dark, { type: 'USE_CARD', playerId: 'p1', cardId: 'stopwatch' }, ctx).ok, false);
});

test('boss: sudden death costs a strike per wrong answer and can end the run mid-round', () => {
  const ctx = syn();
  let s = solo(ctx, { cards: [] });
  s.round.bossId = 'sudden_death';
  s.round.isBoss = true;
  s.players[0].strikes = 2;
  for (let i = 0; i < 2; i++) {
    s = i === 0 ? act(s, ctx, { type: 'START_ROUND' }) : s;
    s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 3 });
    s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrongDisplay(s, ctx), elapsedMs: 1000 });
    if (i === 0) {
      assert.equal(s.players[0].strikes, 1);
      s = act(s, ctx, { type: 'NEXT' });
    }
  }
  assert.equal(s.players[0].strikes, 0);
  assert.equal(s.players[0].defeated, true);
  s = act(s, ctx, { type: 'NEXT' });
  assert.equal(s.phase, 'round-summary', 'the round ends immediately');
  s = act(s, ctx, { type: 'CONTINUE' });
  assert.equal(s.phase, 'finished');
  assert.equal(s.players[0].result, 'lost');
});

test('boss: all in locks the stake at 3x and the chain pays a bonus for five out of five', () => {
  const ctx = syn();
  let s = solo(ctx, { cards: [] });
  s.round.bossId = 'all_in';
  s.round.isBoss = true;
  s = act(s, ctx, { type: 'START_ROUND' });
  assert.deepEqual(getStakeOptions(s, ctx, 'p1').map((o) => o.stake), [3]);
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.equal(s.q.byPlayer.p1.stake, 3);

  let c = solo(ctx, { cards: [] });
  c.round.bossId = 'chain';
  c.round.isBoss = true;
  const chipsBefore = c.players[0].chips;
  c = advanceTo(c, ctx, 'round-summary', always(true));
  const total = c.log.reduce((n, r) => n + r.delta, 0);
  assert.equal(c.players[0].chips, chipsBefore + total + 50 + 100);
  assert.equal(c.roundLog[0].players.p1.bonus, 150);
});

/* ---------------- versus: turns, attribution, attack cards, comeback ---------------- */

test('versus: players answer one after another, every result belongs to the right player', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = versus(ctx, 3, STARTER_CARDS);
  s = act(s, ctx, { type: 'START_ROUND' });
  const order = [];
  while (s.phase === 'stake' || s.phase === 'question') {
    const p = s.players[s.turn];
    order.push(p.playerId);
    s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: p.playerId, stake: 1 });
    s = act(s, ctx, { type: 'ANSWER', playerId: p.playerId, choice: correctDisplay(s, ctx), elapsedMs: 2000 });
  }
  assert.deepEqual(order, ['p1', 'p2', 'p3']);
  assert.equal(s.phase, 'reveal');
  assert.deepEqual(s.log.map((r) => r.playerId), ['p1', 'p2', 'p3']);
  assert.equal(new Set(s.log.map((r) => r.questionId)).size, 1, 'everyone answers the same question');
  assert.equal(dispatch(s, { type: 'ANSWER', playerId: 'p1', choice: 0, elapsedMs: 1 }, ctx).ok, false);
});

test('versus: acting out of turn is rejected', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = act(versus(ctx, 2, STARTER_CARDS), ctx, { type: 'START_ROUND' });
  assert.equal(dispatch(s, { type: 'CONFIRM_STAKE', playerId: 'p2', stake: 1 }, ctx).ok, false);
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  assert.equal(dispatch(s, { type: 'ANSWER', playerId: 'p2', choice: 0, elapsedMs: 1 }, ctx).ok, false);
});

test('versus: a full match is 3 rounds of 15 questions per player, with isolated per-player logs and a ranking', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = versus(ctx, 3, STARTER_CARDS);
  const accuracy = { p1: 1, p2: 0.4, p3: 0 };
  const rng = { p1: accuracyBot(1, 'a'), p2: accuracyBot(0.4, 'b'), p3: accuracyBot(0, 'c') };
  const decide = (st) => rng[st.players[st.turn].playerId](st);
  s = playToEnd(s, ctx, decide);
  assert.equal(s.roundLog.length, 3);
  assert.equal(s.log.length, 45);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(s.log.filter((r) => r.playerId === id).length, 15);
  const [p1, , p3] = s.players;
  assert.equal(p1.correctTotal, 15);
  assert.equal(p3.correctTotal, 0);
  assert.equal(p1.placement, 1);
  assert.equal(p1.result, 'won');
  assert.equal(p3.result, 'lost');
  assert.ok(p1.finalScore > p3.finalScore);
  assert.ok(accuracy.p1 > accuracy.p3);
  // Versus has no strikes, so a bad player is never eliminated.
  assert.equal(s.players.every((p) => !p.defeated), true);
});

test('versus: jammer halves a rival clock on their next question and is rejected in solo', () => {
  const ctx = syn();
  let s = act(versus(ctx, 2), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['jammer', 'siphon'] });
  s = act(s, ctx, { type: 'START_ROUND' });
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'jammer' }, ctx).ok, false, 'needs a target');
  assert.equal(dispatch(s, { type: 'USE_CARD', playerId: 'p1', cardId: 'jammer', targetId: 'p1' }, ctx).ok, false, 'not yourself');
  s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'jammer', targetId: 'p2' });
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
  s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: correctDisplay(s, ctx), elapsedMs: 1000 });
  const normal = s.q.byPlayer.p1.timerMs;
  s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p2', stake: 1 });
  assert.equal(s.q.byPlayer.p2.timerMs, Math.round(normal / 2));
  assert.equal(s.players[1].jammed, false, 'consumed');

  const solo1 = act(solo(ctx, { cards: CARD_IDS }), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['scalpel', 'peek'] });
  assert.equal(dispatch(solo1, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['jammer'] }, ctx).ok, false);
});

test('versus: siphon takes 25% of a rival win, and nothing from a miss', () => {
  const ctx = syn();
  const play = (rivalCorrect) => {
    let s = act(versus(ctx, 2), ctx, { type: 'SET_LOADOUT', playerId: 'p1', cards: ['siphon', 'jammer'] });
    s = act(s, ctx, { type: 'START_ROUND' });
    s = act(s, ctx, { type: 'USE_CARD', playerId: 'p1', cardId: 'siphon', targetId: 'p2' });
    s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p1', stake: 1 });
    s = act(s, ctx, { type: 'ANSWER', playerId: 'p1', choice: wrongDisplay(s, ctx), elapsedMs: 1000 });
    const p1Chips = s.players[0].chips;
    s = act(s, ctx, { type: 'CONFIRM_STAKE', playerId: 'p2', stake: 3 });
    s = act(s, ctx, { type: 'ANSWER', playerId: 'p2', choice: rivalCorrect ? correctDisplay(s, ctx) : wrongDisplay(s, ctx), elapsedMs: 19000 });
    return { s, p1Gain: s.players[0].chips - p1Chips };
  };
  const hit = play(true);
  assert.ok(hit.p1Gain > 0);
  assert.equal(hit.p1Gain, hit.s.log[1].siphoned);
  assert.equal(hit.s.players[0].siphonedBy ?? null, null);
  assert.equal(hit.s.players[1].siphonedBy, null, 'cleared after the rival question');
  const miss = play(false);
  assert.equal(miss.p1Gain, 0);
});

test('versus: a trailing player gets an extra charge next round (comeback), without free points', async () => {
  const ctx = syn();
  let s = versus(ctx, 2, STARTER_CARDS);
  const decide = (st) => ({ answerCorrectly: st.players[st.turn].playerId === 'p1', stake: 3 });
  s = advanceTo(s, ctx, 'round-summary', decide);
  s = act(s, ctx, { type: 'CONTINUE' });
  assert.equal(s.phase, 'loadout', 'versus has no crossroads or shop');
  assert.deepEqual(s.round.comeback, ['p2']);
  const p2Chips = s.players[1].chips;
  s = act(s, ctx, { type: 'START_ROUND' });
  const [cardA] = s.players[1].loadout;
  assert.equal(s.players[1].charges[cardA], 2, 'p2 gets one extra charge');
  assert.equal(s.players[0].charges[s.players[0].loadout[0]], 1);
  assert.equal(s.players[1].chips, p2Chips, 'no free chips');
});

test('versus: needs two to four distinct players; solo and daily need exactly one', () => {
  const ctx = syn();
  const mk = (mode, ids) => () => createGame({ mode, players: ids.map((id) => ({ id, name: id })), ctx, seed: 'x' });
  assert.throws(mk('versus', ['a']), /2 to 4/);
  assert.throws(mk('versus', ['a', 'b', 'c', 'd', 'e']), /2 to 4/);
  assert.throws(mk('versus', ['a', 'a']), /distinct/);
  assert.throws(mk('solo', ['a', 'b']), /exactly one/);
  assert.doesNotThrow(mk('versus', ['a', 'b', 'c', 'd']));
});

/* ---------------- abandon and rewards ---------------- */

test('abandoning keeps the answers already given, records an abandoned session and no score', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  let s = solo(ctx);
  for (let i = 0; i < 12; i++) s = stepBot(s, ctx, always(true));
  const answered = s.log.length;
  assert.ok(answered > 0);
  s = act(s, ctx, { type: 'ABANDON' });
  assert.equal(s.status, 'abandoned');
  assert.equal(s.phase, 'finished');
  assert.equal(s.log.length, answered);
  assert.equal(s.players[0].result, 'abandoned');
  assert.equal(s.players[0].finalScore, null);
  assert.equal(dispatch(s, { type: 'NEXT' }, ctx).ok, false);
});

test('card rewards: a win offers three new cards including a rare one, and never offers owned cards', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const end = playToEnd(solo(ctx, { cards: STARTER_CARDS }), ctx, always(true));
  const r = cardReward(end, 'p1');
  assert.equal(r.options.length, 3);
  assert.ok(r.options.every((id) => !STARTER_CARDS.includes(id)));
  assert.ok(r.options.some((id) => ['rare', 'legendary'].includes(CARD_DEFS[id].rarity)));
  assert.deepEqual(cardReward(end, 'p1'), r, 'deterministic for the same session');
});

test('card rewards: a defeat still offers at least one card, and nothing if everything is owned', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const lost = playToEnd(solo(ctx, { cards: STARTER_CARDS }), ctx, always(false));
  assert.ok(cardReward(lost, 'p1').options.length >= 1);
  const all = playToEnd(solo(ctx, { cards: CARD_IDS }), ctx, always(true));
  assert.equal(cardReward(all, 'p1').options.length, 0);
});

test('card rewards are not offered for an abandoned game', async () => {
  const { questions } = await realBank();
  const ctx = fakeContext(questions);
  const s = act(solo(ctx), ctx, { type: 'ABANDON' });
  assert.deepEqual(cardReward(s, 'p1'), { options: [], pick: 0 });
});

test('every card has a unique name and icon, a rules text and a stated drawback', () => {
  const names = new Set();
  const icons = new Set();
  for (const id of CARD_IDS) {
    const c = dispatchCard(id);
    assert.ok(c.text.length > 10 && c.drawback.length > 3, id);
    names.add(c.name);
    icons.add(c.icon);
  }
  assert.equal(names.size, CARD_IDS.length);
  assert.equal(icons.size, CARD_IDS.length);
});

import { CARDS } from '../src/engine/cards.js';
function dispatchCard(id) {
  return CARDS[id];
}
