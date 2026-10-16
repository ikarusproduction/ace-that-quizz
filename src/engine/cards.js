// Bonus cards. Players collect these across runs and equip TWO before each round.
// Every card has a unique effect AND a drawback, so none is strictly better than
// another. Effects are resolved in game.js and scoring.js; this file is the
// single source of truth for names, rules text and balance numbers.

/**
 * timing:
 *  - 'pre-stake'   used while choosing a stake, applies to the coming question
 *  - 'in-question' used while the question is on screen
 *  - 'run'         once per run, used in-question
 * kind: 'self' helps you; 'attack' targets a rival (Versus only); 'hex' is a dirty trick on a rival or (visual hexes) yourself.
 * uses: charges per round (or per run for timing 'run').
 */
export const CARDS = {
  scalpel: {
    id: 'scalpel',
    name: 'Scalpel',
    rarity: 'common',
    kind: 'self',
    timing: 'in-question',
    uses: 1,
    starter: true,
    clue: true,
    icon: 'scalpel',
    text: 'Removes two wrong answers.',
    drawback: 'Payout on that question has no speed or streak bonus.',
    needs: 'Multiple choice with 4 options',
  },
  stopwatch: {
    id: 'stopwatch',
    name: 'Stopwatch',
    rarity: 'common',
    kind: 'self',
    timing: 'in-question',
    uses: 1,
    starter: true,
    clue: false,
    icon: 'hourglass',
    text: 'Adds 10 seconds to the clock.',
    drawback: 'No speed bonus on that question.',
  },
  safety_net: {
    id: 'safety_net',
    name: 'Safety Net',
    rarity: 'common',
    kind: 'self',
    timing: 'pre-stake',
    uses: 1,
    starter: true,
    clue: false,
    icon: 'net',
    text: 'If you answer wrong, you lose only half your stake.',
    drawback: 'If you answer right, you win 25% less.',
  },
  peek: {
    id: 'peek',
    name: 'Peek',
    rarity: 'common',
    kind: 'self',
    timing: 'pre-stake',
    uses: 1,
    starter: false,
    clue: true,
    icon: 'eye',
    text: 'See the question text before you choose your stake.',
    drawback: 'You win 20% less on that question.',
  },
  ghost_note: {
    id: 'ghost_note',
    name: 'Ghost Note',
    rarity: 'uncommon',
    kind: 'self',
    timing: 'in-question',
    uses: 1,
    starter: false,
    clue: true,
    icon: 'ghost',
    text: 'Reveals the first letter of the correct answer.',
    drawback: 'You win 25% less on that question.',
    needs: 'Multiple choice or Name That Tune',
  },
  streak_shield: {
    id: 'streak_shield',
    name: 'Streak Shield',
    rarity: 'uncommon',
    kind: 'self',
    timing: 'pre-stake',
    uses: 1,
    starter: false,
    clue: false,
    icon: 'shield',
    text: 'Your streak survives one wrong answer.',
    drawback: 'You still lose your full stake.',
  },
  double_or_nothing: {
    id: 'double_or_nothing',
    name: 'Double or Nothing',
    rarity: 'uncommon',
    kind: 'self',
    timing: 'pre-stake',
    uses: 1,
    starter: false,
    clue: false,
    icon: 'dice',
    text: 'Doubles both your winnings and your losses on one question.',
    drawback: 'The risk is doubled too.',
  },
  rewind: {
    id: 'rewind',
    name: 'Rewind',
    rarity: 'rare',
    kind: 'self',
    timing: 'pre-stake',
    uses: 1,
    starter: false,
    clue: false,
    icon: 'rewind',
    text: 'If you answer wrong, retry once with the wrong option removed.',
    drawback: 'A correct retry pays only half.',
    needs: 'Multiple choice',
  },
  skeleton_key: {
    id: 'skeleton_key',
    name: 'Skeleton Key',
    rarity: 'legendary',
    kind: 'self',
    timing: 'run',
    uses: 1,
    starter: false,
    clue: false,
    icon: 'key',
    text: 'Counts one question as answered correctly.',
    drawback: 'Once per run. Pays half. Useless against bosses.',
  },
  jammer: {
    id: 'jammer',
    name: 'Jammer',
    rarity: 'uncommon',
    kind: 'attack',
    timing: 'pre-stake',
    uses: 1,
    starter: false,
    clue: false,
    icon: 'jammer',
    text: "Halves a rival's clock on their next question.",
    drawback: 'Versus only.',
    versusOnly: true,
  },
  siphon: {
    id: 'siphon',
    name: 'Siphon',
    rarity: 'rare',
    kind: 'attack',
    timing: 'pre-stake',
    uses: 1,
    starter: false,
    clue: false,
    icon: 'siphon',
    text: "If a rival's next answer is right, you take 25% of their winnings.",
    drawback: 'Versus only. Nothing happens if they miss.',
    versusOnly: true,
  },
  /* ---- Hexes: dirty tricks you can play on a rival, or on yourself for a risky bonus ---- */
  ink_blast: {
    id: 'ink_blast', name: 'Ink Blast', rarity: 'common', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'ink',
    targets: 'any', hex: 'ink',
    text: "Squirts ink over the target's next question. They have to wipe it away to read.",
    drawback: 'On yourself it pays +20% if you get it right. On a rival it costs them 15% of their win.',
  },
  goo_splat: {
    id: 'goo_splat', name: 'Goo Splat', rarity: 'common', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'goo',
    targets: 'any', hex: 'goo',
    text: "Splats slime across the target's screen. It drips slowly.",
    drawback: 'On yourself it pays +20% if you get it right. On a rival it costs them 15% of their win.',
  },
  quake: {
    id: 'quake', name: 'Quake', rarity: 'uncommon', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'quake',
    targets: 'any', hex: 'quake',
    text: "Shakes the target's screen while they answer.",
    drawback: 'On yourself it pays +20% if you get it right. On a rival it costs them 15% of their win.',
  },
  blur_out: {
    id: 'blur_out', name: 'Blur Out', rarity: 'uncommon', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'blur',
    targets: 'any', hex: 'blur',
    text: "Blurs the target's answers until they tap to focus.",
    drawback: 'On yourself it pays +20% if you get it right. On a rival it costs them 15% of their win.',
  },
  flip_table: {
    id: 'flip_table', name: 'Flip the Table', rarity: 'rare', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'flip',
    targets: 'any', hex: 'flip',
    text: "Turns the target's question upside down.",
    drawback: 'On yourself it pays +20% if you get it right. On a rival it costs them 15% of their win.',
  },
  pickpocket: {
    id: 'pickpocket', name: 'Pickpocket', rarity: 'uncommon', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'hand',
    targets: 'rival', steal: 'pickpocket',
    text: 'Lifts 2 chips from a rival right now.',
    drawback: 'Only takes what they carry in hand. Versus only.',
    versusOnly: true,
  },
  heist: {
    id: 'heist', name: 'Heist', rarity: 'rare', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'bag',
    targets: 'rival', steal: 'heist',
    text: "Robs 15% of a rival's chips (at least 3, at most 12).",
    drawback: 'The job costs you 1 chip. Versus only.',
    versusOnly: true,
  },
  kraken: {
    id: 'kraken', name: 'The Kraken', rarity: 'legendary', kind: 'hex', timing: 'pre-stake', uses: 1, starter: false, clue: false, icon: 'squid',
    targets: 'rival', hex: 'ink+goo+quake', steal: 'kraken',
    text: 'Ink, slime and a quake on a rival, and it grabs 4 chips on the way out.',
    drawback: 'Versus only. They keep their full win chance.',
    versusOnly: true,
  },
};

export const CARD_IDS = Object.keys(CARDS);
export const STARTER_CARDS = CARD_IDS.filter((id) => CARDS[id].starter);
export const RARITY_WEIGHT = { common: 60, uncommon: 28, rare: 10, legendary: 2 };
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

/** Balance constants kept in one place so tests and UI text stay in sync. */
export const CARD_NUMBERS = {
  stopwatchBonusMs: 10000,
  safetyNetLossFactor: 0.5,
  safetyNetGainFactor: 0.75,
  peekGainFactor: 0.8,
  ghostNoteGainFactor: 0.75,
  doubleFactor: 2,
  rewindGainFactor: 0.5,
  rewindRetryMs: 10000,
  skeletonKeyGainFactor: 0.5,
  jammerTimerFactor: 0.5,
  siphonShare: 0.25,
  hexSelfBonus: 1.2,
  hexVictimFactor: 0.85,
  pickpocketChips: 2,
  heistShare: 0.15,
  heistMin: 3,
  heistMax: 12,
  heistCost: 1,
  krakenChips: 4,
  maxPendingHexes: 3,
};

/** Cards a profile may equip in a given mode. Attack cards need Versus. */
export function equippableCards(ownedIds, mode) {
  return ownedIds.filter((id) => {
    const c = CARDS[id];
    if (!c) return false;
    if (c.versusOnly && mode !== 'versus') return false;
    return true;
  });
}

/**
 * Pick `count` distinct cards a player does not own yet, weighted by rarity.
 * If they own everything, returns an empty list.
 */
export function draftCards(rng, ownedIds, count, { guaranteeRare = false } = {}) {
  const pool = CARD_IDS.filter((id) => !ownedIds.includes(id));
  const picks = [];
  const remaining = pool.slice();
  const take = (id) => {
    picks.push(id);
    remaining.splice(remaining.indexOf(id), 1);
  };
  if (guaranteeRare && remaining.length) {
    const rare = remaining.filter((id) => ['rare', 'legendary'].includes(CARDS[id].rarity));
    if (rare.length) take(rng.pick(rare));
  }
  while (picks.length < count && remaining.length) {
    const weights = {};
    for (const id of remaining) weights[id] = RARITY_WEIGHT[CARDS[id].rarity];
    take(rng.weighted(weights));
  }
  return picks;
}
