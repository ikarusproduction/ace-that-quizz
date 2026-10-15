// Round hazards, boss rounds, shop items and the numbers that tune the economy.
// Hazards and boss rules are always shown before a round starts, never hidden.

export const RULES = {
  startChips: 50,
  startStrikes: 3,
  maxStrikes: 5,
  baseWager: 10, // chips per stake unit
  stakes: [1, 2, 3],
  difficultyMult: { 1: 1.0, 2: 1.25, 3: 1.5, 4: 2.0 },
  speedThreshold: 0.4, // answered within 40% of the clock
  speedBonus: 1.2,
  streakBonusPerStep: 0.1,
  streakBonusMaxSteps: 5,
  passThreshold: 3, // correct answers needed to clear a normal round
  perfectRoundBonus: 50,
  roundClearScore: 100,
  bossClearScore: 200,
  bankFraction: 0.5,
  pushMult: 1.5,
  questionsPerRound: 5,
  roundsPerAct: 2, // plus one boss round
  acts: 3,
  versusRounds: 3,
  answerGraceMs: 1500,
  baseTimerMs: { mcq: 20000, tf: 12000, tune: 25000 },
  minTimerMs: 5000,
};

/** Difficulty mix by act (index 0 = act 1). Weights, not percentages. */
export const ACT_DIFFICULTY = [
  { 1: 45, 2: 40, 3: 15, 4: 0 },
  { 1: 10, 2: 35, 3: 45, 4: 10 },
  { 1: 0, 2: 20, 3: 50, 4: 30 },
];

export const HAZARDS = {
  none: { id: 'none', name: 'Steady Hands', text: 'No hazard this round.' },
  short_fuse: { id: 'short_fuse', name: 'Short Fuse', text: 'Every clock is 30% shorter.', timerMult: 0.7 },
  hot_slot: { id: 'hot_slot', name: 'Hot Slot', text: 'One marked question pays double.', slotGainMult: 2 },
  rigged: { id: 'rigged', name: 'Rigged', text: 'One marked question pays double, but a miss costs double.', slotGainMult: 2, slotLossMult: 2 },
  cold_table: { id: 'cold_table', name: 'Cold Table', text: 'Clue cards (Scalpel, Peek, Ghost Note) are locked.', cluesLocked: true },
  streak_fever: { id: 'streak_fever', name: 'Streak Fever', text: 'Streak bonuses are doubled.', streakMult: 2 },
  loaded_chamber: { id: 'loaded_chamber', name: 'Loaded Chamber', text: 'Every miss costs 25% more.', lossMult: 1.25 },
};

export const NORMAL_HAZARD_IDS = Object.keys(HAZARDS).filter((id) => id !== 'none');

export const BOSSES = {
  gauntlet: {
    id: 'gauntlet', name: 'The Gauntlet',
    text: 'Clocks are 40% shorter. Winnings ×1.5.',
    timerMult: 0.6, gainMult: 1.5,
  },
  sudden_death: {
    id: 'sudden_death', name: 'Sudden Death',
    text: 'Every wrong answer costs a Strike. Winnings ×2.',
    gainMult: 2, strikeOnWrong: true,
  },
  blackout: {
    id: 'blackout', name: 'Blackout',
    text: 'Cards are locked. Winnings ×1.5.',
    cardsLocked: true, gainMult: 1.5,
  },
  examiner: {
    id: 'examiner', name: 'The Examiner',
    text: 'Only Hard and Expert questions. Winnings ×1.5.',
    minDifficulty: 3, gainMult: 1.5,
  },
  all_in: {
    id: 'all_in', name: 'All In',
    text: 'Every stake is locked at 3×.',
    lockStake: 3,
  },
  chain: {
    id: 'chain', name: 'The Chain',
    text: 'Answer all five correctly for a 100 chip bonus.',
    chainBonus: 100,
  },
};

/** Which bosses can appear in which act (0-indexed). Never repeated within a run. */
export const ACT_BOSSES = [
  ['gauntlet', 'chain', 'blackout'],
  ['examiner', 'all_in', 'blackout', 'gauntlet'],
  ['sudden_death', 'examiner', 'all_in', 'gauntlet'],
];

export const SHOP_ITEMS = {
  spare_bulb: {
    id: 'spare_bulb', name: 'Spare Bulb', cost: 100,
    text: 'Restore one Strike (max 5). Once per act.',
  },
  spare_battery: {
    id: 'spare_battery', name: 'Spare Battery', cost: 60,
    text: 'Both equipped cards get +1 charge next round.',
  },
  slow_clock: {
    id: 'slow_clock', name: 'Slow Clock', cost: 60,
    text: 'Every clock is 3 seconds longer next round.',
  },
};
export const SLOW_CLOCK_MS = 3000;
