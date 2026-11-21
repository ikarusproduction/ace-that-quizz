// Every tunable number of the game lives here.
export const RULES = {
  minPlayers: 2,          // 3 recommended; 2 allowed so a couple can test
  maxPlayers: 8,
  maxHp: 10,
  startCapsules: 10,
  crownPrice: 20,
  blueGain: 3,
  redHp: 1,
  redCapsules: 3,
  koBounty: 10,           // capsules given to whoever lands the K.O.
  maxDamagePerRound: 5,   // a player cannot lose more than this in one mini-game podium
  turnOptions: [5, 10, 15, 20],
  defaultTurns: 15,
  // Phase lengths (ms)
  rollMs: 20_000,
  introMs: 7_500,
  playGraceMs: 4_000,
  resultsMs: 4_500,
  pickMs: 12_000,
  afterPickMs: 2_600,
  recapMs: 2_500,
  // Movement script timing, used by the server for deadlines and by phones for the animation
  stepMs: 320,
  landMs: 1_300,
  crownMs: 2_200,
  playerGapMs: 450,
};

/** Damage handed out per place, depending on how many people play. */
export function damageTable(playerCount) {
  if (playerCount <= 2) return [3];
  if (playerCount <= 4) return [3, 1];
  return [3, 2, 1];
}

/** Capsules per place; everyone else who played gets the consolation prize. */
export const CAPSULE_REWARDS = [6, 4, 2];
export const CONSOLATION = 1;

export const INTENSITIES = {
  'sans-alcool': { label: 'Sans alcool', unit: ['gage', 'gages'], ko: 'Gage K.O. : chante le refrain de ton choix debout sur une chaise', perHp: 1 },
  soft: { label: 'Soft', unit: ['demi-gorgée', 'demi-gorgées'], ko: '3 gorgées', perHp: 1 },
  normal: { label: 'Normal', unit: ['gorgée', 'gorgées'], ko: '1 shot', perHp: 1 },
  hardcore: { label: 'Hardcore', unit: ['gorgée', 'gorgées'], ko: 'CUL SEC', perHp: 1 },
};

export function drinkText(intensity, n) {
  const i = INTENSITIES[intensity] ?? INTENSITIES.normal;
  return `${n} ${n > 1 ? i.unit[1] : i.unit[0]}`;
}
