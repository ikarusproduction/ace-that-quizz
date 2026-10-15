// Pure scoring rules. The stake preview shown before the player commits and the
// real resolution after they answer both call computeOutcome(), so what the UI
// promises is exactly what the engine pays.
import { RULES, HAZARDS, SLOW_CLOCK_MS } from './modifiers.js';
import { CARD_NUMBERS } from './cards.js';

/**
 * @typedef {Object} OutcomeInput
 * @property {boolean} correct
 * @property {1|2|3} stake            stake level chosen
 * @property {number} chips           chips the player holds BEFORE this question
 * @property {1|2|3|4} difficulty
 * @property {number} elapsedMs
 * @property {number} timerMs         the clock the player actually had
 * @property {number} streakBefore    consecutive correct answers before this one
 * @property {Object} [hazard]        HAZARDS entry (default none)
 * @property {Object|null} [boss]     BOSSES entry or null
 * @property {boolean} [markedSlot]   this question is the hazard's marked slot
 * @property {boolean} [pushed]       the player pushed at the last crossroads
 * @property {Object} [cards]         card flags active on this question
 */

const r = (n) => Math.round(n);

export function stakeChipsFor(chips, stake) {
  if (chips <= 0) return 0;
  return Math.min(chips, stake * RULES.baseWager);
}

/** @param {OutcomeInput} i */
export function computeOutcome(i) {
  const hazard = i.hazard ?? HAZARDS.none;
  const boss = i.boss ?? null;
  const cards = i.cards ?? {};
  const stake = boss?.lockStake ?? i.stake;

  // Broke rule: with 0 chips you play for free at 1x so a run can always recover.
  const broke = i.chips <= 0;
  const stakeChips = broke ? 0 : stakeChipsFor(i.chips, stake);
  const virtualStake = broke ? RULES.baseWager : stakeChips;

  const noSpeed = cards.scalpel || cards.stopwatch || cards.skeletonKey;
  const noStreak = cards.scalpel || cards.skeletonKey;
  const fast = !noSpeed && i.elapsedMs <= RULES.speedThreshold * i.timerMs;

  const speed = fast ? RULES.speedBonus : 1;
  const streakSteps = Math.min(i.streakBefore, RULES.streakBonusMaxSteps);
  const streak = noStreak ? 1 : 1 + RULES.streakBonusPerStep * streakSteps * (hazard.streakMult ?? 1);
  const diff = RULES.difficultyMult[i.difficulty] ?? 1;
  const slotGain = i.markedSlot ? hazard.slotGainMult ?? 1 : 1;
  const bossGain = boss?.gainMult ?? 1;
  const push = i.pushed ? RULES.pushMult : 1;

  let cardGain = 1;
  if (cards.safetyNet) cardGain *= CARD_NUMBERS.safetyNetGainFactor;
  if (cards.peek) cardGain *= CARD_NUMBERS.peekGainFactor;
  if (cards.ghostNote) cardGain *= CARD_NUMBERS.ghostNoteGainFactor;
  if (cards.doubleOrNothing) cardGain *= CARD_NUMBERS.doubleFactor;
  if (cards.rewindRetry) cardGain *= CARD_NUMBERS.rewindGainFactor;
  if (cards.skeletonKey) cardGain *= CARD_NUMBERS.skeletonKeyGainFactor;

  const slotLoss = i.markedSlot ? hazard.slotLossMult ?? 1 : 1;
  const hazardLoss = hazard.lossMult ?? 1;
  let cardLoss = 1;
  if (cards.safetyNet) cardLoss *= CARD_NUMBERS.safetyNetLossFactor;
  if (cards.doubleOrNothing) cardLoss *= CARD_NUMBERS.doubleFactor;

  const gain = Math.max(1, r(virtualStake * diff * speed * streak * slotGain * bossGain * push * cardGain));
  const lossRaw = r(stakeChips * slotLoss * hazardLoss * push * cardLoss);
  const loss = Math.min(lossRaw, Math.max(0, i.chips));

  return {
    stake,
    stakeChips,
    broke,
    fast,
    gain,
    loss,
    delta: i.correct ? gain : loss === 0 ? 0 : -loss, // avoid -0 leaking into stored data
    parts: { diff, speed, streak, slotGain, bossGain, push, cardGain, slotLoss, hazardLoss, cardLoss },
  };
}

/** What the stake screen shows for each option: exact win (without speed bonus) and exact loss. */
export function previewStake(input) {
  const base = { ...input, elapsedMs: Number.POSITIVE_INFINITY, timerMs: input.timerMs ?? 1 };
  const win = computeOutcome({ ...base, correct: true });
  const lose = computeOutcome({ ...base, correct: false });
  const fast = computeOutcome({ ...base, correct: true, elapsedMs: 0 });
  return { stake: win.stake, win: win.gain, winFast: fast.gain, lose: lose.loss, broke: win.broke };
}

/** Clock for a question, in milliseconds. */
export function timerFor({ type, hazard, boss, slowClock = false, jammed = false, stopwatch = false }) {
  const base = RULES.baseTimerMs[type] ?? RULES.baseTimerMs.mcq;
  let ms = base * (hazard?.timerMult ?? 1) * (boss?.timerMult ?? 1);
  if (slowClock) ms += SLOW_CLOCK_MS;
  if (jammed) ms *= CARD_NUMBERS.jammerTimerFactor;
  ms = Math.max(RULES.minTimerMs, Math.round(ms));
  if (stopwatch) ms += CARD_NUMBERS.stopwatchBonusMs;
  return ms;
}

export function nextStreak(streak, correct, shielded) {
  if (correct) return streak + 1;
  return shielded ? streak : 0;
}

/**
 * Final score for a Solo or Daily run. Banked chips are safe; chips still on the
 * table are only kept if the run is won.
 */
export function runScore({ vault, chips, won, roundsCleared, bossesCleared }) {
  return (
    vault +
    (won ? chips : 0) +
    roundsCleared * RULES.roundClearScore +
    bossesCleared * RULES.bossClearScore
  );
}
