import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOutcome, previewStake, timerFor, nextStreak, runScore } from '../src/engine/scoring.js';
import { HAZARDS, BOSSES } from '../src/engine/modifiers.js';

const base = { correct: true, stake: 1, chips: 50, difficulty: 1, elapsedMs: 10000, timerMs: 20000, streakBefore: 0 };

test('base stake: correct wins the stake, wrong loses it', () => {
  assert.equal(computeOutcome(base).delta, 10);
  assert.equal(computeOutcome({ ...base, correct: false }).delta, -10);
  assert.equal(computeOutcome({ ...base, stake: 3 }).delta, 30);
  assert.equal(computeOutcome({ ...base, stake: 3, correct: false }).delta, -30);
});

test('difficulty multiplies winnings but never the loss', () => {
  assert.equal(computeOutcome({ ...base, difficulty: 4 }).gain, 20);
  assert.equal(computeOutcome({ ...base, difficulty: 4, correct: false }).loss, 10);
});

test('speed bonus applies only inside 40% of the clock', () => {
  assert.equal(computeOutcome({ ...base, elapsedMs: 8000 }).gain, 12);
  assert.equal(computeOutcome({ ...base, elapsedMs: 8001 }).gain, 10);
});

test('streak bonus grows 10% per step and caps at five steps', () => {
  assert.equal(computeOutcome({ ...base, streakBefore: 3 }).gain, 13);
  assert.equal(computeOutcome({ ...base, streakBefore: 5 }).gain, 15);
  assert.equal(computeOutcome({ ...base, streakBefore: 50 }).gain, 15);
});

test('Streak Fever doubles the streak bonus', () => {
  assert.equal(computeOutcome({ ...base, streakBefore: 3, hazard: HAZARDS.streak_fever }).gain, 16);
});

test('Hot Slot pays double only on the marked question', () => {
  assert.equal(computeOutcome({ ...base, hazard: HAZARDS.hot_slot, markedSlot: true }).gain, 20);
  assert.equal(computeOutcome({ ...base, hazard: HAZARDS.hot_slot, markedSlot: false }).gain, 10);
});

test('Rigged doubles both directions on the marked question only', () => {
  const h = HAZARDS.rigged;
  assert.equal(computeOutcome({ ...base, hazard: h, markedSlot: true }).gain, 20);
  assert.equal(computeOutcome({ ...base, hazard: h, markedSlot: true, correct: false }).loss, 20);
  assert.equal(computeOutcome({ ...base, hazard: h, markedSlot: false, correct: false }).loss, 10);
});

test('Loaded Chamber makes a miss cost 25% more', () => {
  assert.equal(computeOutcome({ ...base, stake: 2, hazard: HAZARDS.loaded_chamber, correct: false }).loss, 25);
});

test('push multiplies both gain and loss by 1.5', () => {
  assert.equal(computeOutcome({ ...base, pushed: true }).gain, 15);
  assert.equal(computeOutcome({ ...base, pushed: true, correct: false }).loss, 15);
});

test('boss gain multipliers and locked stakes apply', () => {
  assert.equal(computeOutcome({ ...base, boss: BOSSES.sudden_death }).gain, 20);
  const allIn = computeOutcome({ ...base, stake: 1, boss: BOSSES.all_in });
  assert.equal(allIn.stake, 3);
  assert.equal(allIn.gain, 30);
});

test('cards: Safety Net halves the loss and trims the win', () => {
  assert.equal(computeOutcome({ ...base, cards: { safetyNet: true } }).gain, 8);
  assert.equal(computeOutcome({ ...base, correct: false, cards: { safetyNet: true } }).loss, 5);
});

test('cards: Double or Nothing doubles both sides', () => {
  assert.equal(computeOutcome({ ...base, cards: { doubleOrNothing: true } }).gain, 20);
  assert.equal(computeOutcome({ ...base, correct: false, cards: { doubleOrNothing: true } }).loss, 20);
});

test('cards: Scalpel removes both speed and streak bonuses', () => {
  const o = computeOutcome({ ...base, elapsedMs: 1000, streakBefore: 5, cards: { scalpel: true } });
  assert.equal(o.gain, 10);
  assert.equal(o.fast, false);
});

test('cards: Stopwatch removes the speed bonus but keeps the streak bonus', () => {
  const o = computeOutcome({ ...base, elapsedMs: 1000, streakBefore: 5, cards: { stopwatch: true } });
  assert.equal(o.gain, 15);
});

test('cards: Peek, Ghost Note, Rewind and Skeleton Key apply their trade-offs', () => {
  assert.equal(computeOutcome({ ...base, cards: { peek: true } }).gain, 8);
  assert.equal(computeOutcome({ ...base, cards: { ghostNote: true } }).gain, 8);
  assert.equal(computeOutcome({ ...base, cards: { rewindRetry: true } }).gain, 5);
  assert.equal(computeOutcome({ ...base, elapsedMs: 0, cards: { skeletonKey: true } }).gain, 5);
});

test('a miss can never cost more than the chips held', () => {
  const o = computeOutcome({ ...base, chips: 5, stake: 3, correct: false });
  assert.equal(o.loss, 5);
  const big = computeOutcome({ ...base, chips: 15, stake: 3, hazard: HAZARDS.rigged, markedSlot: true, cards: { doubleOrNothing: true }, correct: false });
  assert.equal(big.loss, 15);
});

test('stake is capped by the chips available', () => {
  assert.equal(computeOutcome({ ...base, chips: 15, stake: 3 }).stakeChips, 15);
});

test('broke rule: at zero chips you play free at 1x and can still win chips back', () => {
  const win = computeOutcome({ ...base, chips: 0, stake: 3 });
  assert.equal(win.broke, true);
  assert.equal(win.gain, 10);
  const lose = computeOutcome({ ...base, chips: 0, correct: false });
  assert.equal(lose.loss, 0);
  assert.equal(lose.delta, 0);
});

test('a correct answer always wins at least one chip', () => {
  const o = computeOutcome({ ...base, chips: 1, stake: 1 });
  assert.ok(o.gain >= 1);
});

test('previewStake matches the real resolution for loss and slow win', () => {
  const input = { stake: 2, chips: 40, difficulty: 3, streakBefore: 2, timerMs: 20000, hazard: HAZARDS.loaded_chamber };
  const p = previewStake(input);
  const real = computeOutcome({ ...input, correct: true, elapsedMs: 20000 });
  const realLoss = computeOutcome({ ...input, correct: false, elapsedMs: 20000 });
  assert.equal(p.win, real.gain);
  assert.equal(p.lose, realLoss.loss);
  assert.ok(p.winFast > p.win);
});

test('timers: base, hazards, bosses, jammer, slow clock, floor and stopwatch', () => {
  assert.equal(timerFor({ type: 'mcq' }), 20000);
  assert.equal(timerFor({ type: 'tf' }), 12000);
  assert.equal(timerFor({ type: 'tune' }), 25000);
  assert.equal(timerFor({ type: 'mcq', hazard: HAZARDS.short_fuse }), 14000);
  assert.equal(timerFor({ type: 'mcq', boss: BOSSES.gauntlet }), 12000);
  assert.equal(timerFor({ type: 'mcq', slowClock: true }), 23000);
  assert.equal(timerFor({ type: 'mcq', jammed: true }), 10000);
  assert.equal(timerFor({ type: 'tf', hazard: HAZARDS.short_fuse, jammed: true }), 5000);
  assert.equal(timerFor({ type: 'mcq', stopwatch: true }), 30000);
});

test('streak: grows on correct, resets on wrong unless shielded', () => {
  assert.equal(nextStreak(2, true, false), 3);
  assert.equal(nextStreak(2, false, false), 0);
  assert.equal(nextStreak(2, false, true), 2);
});

test('run score: banked chips are safe, table chips only count on a win', () => {
  const common = { vault: 100, chips: 60, roundsCleared: 5, bossesCleared: 1 };
  assert.equal(runScore({ ...common, won: true }), 100 + 60 + 500 + 200);
  assert.equal(runScore({ ...common, won: false }), 100 + 500 + 200);
});
