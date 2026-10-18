// Duels: the solo game. Every encounter is a fight against an enemy with hit points. A right answer hits it, a wrong
// one costs you a bulb (or, against a plain contestant, a miss). Bosses telegraph what they do before every question,
// so the player can plan. Stakes cost heat, and heat is limited, so you cannot push every question to the maximum.
//
// Everything here is pure data and pure functions; game.js owns the state.

export const DUEL = {
  startLives: 4,
  maxLives: 5,
  /** Heat you start each fight with. A x2 stake costs 1 heat, a x3 stake costs 2, a x1 stake is free. */
  heat: { minion: 3, elite: 5, boss: 7, final: 8 },
  heatCost: { 1: 0, 2: 1, 3: 2 },
  heatCap: 10,
  heatOnStreak: 3,   // a streak of this many right answers earns +1 heat (once per streak, at exactly this count)
  heatOnFast: 1,     // a fast right answer (first 40% of the clock) refunds heat
  minionMisses: 3,   // a plain contestant beats you after this many misses in one fight
  questionCap: 14,   // a fight that drags on this long is lost
  dmgByDifficulty: { 1: 1, 2: 1, 3: 2, 4: 3 },
  dmgByStake: { 1: 0, 2: 1, 3: 2 },
  guardWindow: 0.6,  // against Armor, only answers inside this share of the clock hit at full strength
  enrageAt: 0.4,     // bosses enrage at this share of their health
  enrageTimer: 0.85,
  rewards: {
    minion: { chips: 15, hex: false, heal: 0 },
    elite: { chips: 30, hex: true, heal: 0 },
    boss: { chips: 60, hex: true, heal: 1 },
    final: { chips: 100, hex: false, heal: 0 },
  },
  restChips: 25,
  endScore: { lifeBonus: 50, clearBonus: 100, bossBonus: 200 },
};

/**
 * What a boss can do on a question. `curse` reuses the hex screen effects, `timer` shortens the clock, `guard`
 * demands a quick answer, `mend` heals the boss on a miss, `twin` doubles both the damage and the cost.
 */
export const INTENTS = {
  strike: { id: 'strike', label: 'Strike', icon: 'cross', text: 'A miss costs you a bulb.' },
  surge: { id: 'surge', label: 'Surge', icon: 'quake', timer: 0.7, text: 'Your clock is 30% shorter.' },
  accel: { id: 'accel', label: 'Accelerando', icon: 'hourglass', timer: 'accel', text: 'The clock shrinks with every question.' },
  ink: { id: 'ink', label: 'Ink cloud', icon: 'ink', curse: 'ink', text: 'Ink hides the question. Wipe it away. A hit through it deals +1.' },
  goo: { id: 'goo', label: 'Slime', icon: 'goo', curse: 'goo', text: 'Slime drips over the screen. A hit through it deals +1.' },
  quake: { id: 'quake', label: 'Tremor', icon: 'quake', curse: 'quake', text: 'The screen shakes. A hit through it deals +1.' },
  blur: { id: 'blur', label: 'Fog', icon: 'blur', curse: 'blur', text: 'The answers blur until you tap to focus. A hit through it deals +1.' },
  flip: { id: 'flip', label: 'Upside down', icon: 'flip', curse: 'flip', text: 'The question flips over. A hit through it deals +1.' },
  guard: { id: 'guard', label: 'Armor', icon: 'shield', guard: true, text: 'Only a fast answer (first 60% of the clock) hits at full strength.' },
  mend: { id: 'mend', label: 'Mend', icon: 'sponge', mend: 2, text: 'A miss heals it by 2.' },
  regrow: { id: 'regrow', label: 'Regrow', icon: 'bulb_on', healNow: 1, mend: 1, text: 'It heals 1 before the question, and 1 more on a miss.' },
  leech: { id: 'leech', label: 'Leech', icon: 'siphon', leech: 10, text: 'A miss also costs you 10 chips.' },
  twin: { id: 'twin', label: 'Breaking news', icon: 'news', twin: true, text: 'Double damage both ways. A miss costs two bulbs.' },
};

/**
 * The roster. `cat` is the specialty (most of its questions come from there), `tier` is how hard the questions run,
 * `intents` is the pattern it repeats and `enraged` the faster pattern once it is hurt.
 */
export const BOSS_ROSTER = {
  static: {
    id: 'static', name: 'Dr. Static', title: 'Professor of Everything Electric', cat: 'science', tier: 1, hp: 20, sprite: 'boss_static', color: '#6fd1ff', arena: 'static',
    blurb: 'Crackles with energy. Zaps your clock and spits slime.',
    intents: ['strike', 'surge', 'strike', 'goo'], enraged: ['surge', 'goo', 'surge', 'strike'],
  },
  cartographer: {
    id: 'cartographer', name: 'The Cartographer', title: 'Keeper of Every Border', cat: 'geography', tier: 1, hp: 20, sprite: 'boss_cartographer', color: '#d9a441', arena: 'map',
    blurb: 'Draws fog across the map. You will read blind.',
    intents: ['strike', 'blur', 'strike', 'ink'], enraged: ['blur', 'ink', 'blur', 'strike'],
  },
  archivist: {
    id: 'archivist', name: 'The Archivist', title: 'Rewrites What Already Happened', cat: 'history', tier: 2, hp: 24, sprite: 'boss_archivist', color: '#c9a26b', arena: 'archive',
    blurb: 'Rewrites the record: every miss mends its wounds.',
    intents: ['strike', 'mend', 'strike', 'mend'], enraged: ['mend', 'leech', 'mend', 'strike'],
  },
  maestro: {
    id: 'maestro', name: 'The Maestro', title: 'Conductor of the Last Concert', cat: 'arts', tier: 2, hp: 24, sprite: 'boss_maestro', color: '#e07b9b', arena: 'stage',
    blurb: 'The tempo only ever speeds up. Keep up or fall behind.',
    intents: ['strike', 'accel', 'accel', 'strike'], enraged: ['accel', 'surge', 'accel', 'surge'],
  },
  cipher: {
    id: 'cipher', name: 'Count Cipher', title: 'Armored in Symbols', cat: 'symbols', tier: 2, hp: 24, sprite: 'boss_cipher', color: '#b5b9c4', arena: 'cipher',
    blurb: 'Armor plating: slow answers barely scratch it.',
    intents: ['guard', 'strike', 'guard', 'quake'], enraged: ['guard', 'guard', 'quake', 'strike'],
  },
  anchor: {
    id: 'anchor', name: 'The Anchor', title: 'Live. Always Live.', cat: 'news', tier: 3, hp: 26, sprite: 'boss_anchor', color: '#ff5a4f', arena: 'news',
    blurb: 'Breaking news! Some questions pay double, and cost double.',
    intents: ['strike', 'twin', 'strike', 'flip'], enraged: ['twin', 'strike', 'twin', 'flip'],
  },
  overgrowth: {
    id: 'overgrowth', name: 'The Overgrowth', title: 'It Has Always Been Here', cat: 'nature', tier: 3, hp: 28, sprite: 'boss_overgrowth', color: '#7bd06a', arena: 'vines',
    blurb: 'It grows back. Keep the pressure on or it will heal.',
    intents: ['strike', 'regrow', 'strike', 'goo'], enraged: ['regrow', 'goo', 'regrow', 'strike'],
  },
  dread: {
    id: 'dread', name: 'The Dread', title: 'What You Are Afraid Of', cat: 'phobia', tier: 3, hp: 28, sprite: 'boss_dread', color: '#9b6bff', arena: 'dread',
    blurb: 'Curses stack. Two bulbs ride on its biggest moments.',
    intents: ['ink', 'strike', 'twin', 'goo'], enraged: ['ink', 'twin', 'blur', 'twin'],
  },
  house: {
    id: 'house', name: 'The House', title: 'The House Always Knows', cat: 'any', tier: 4, hp: 34, sprite: 'boss_house', color: '#ffd24a', arena: 'house', final: true,
    blurb: 'Every subject, every trick. The last room.',
    intents: ['strike', 'twin', 'mend', 'ink', 'guard', 'surge'], enraged: ['twin', 'surge', 'mend', 'blur', 'guard', 'twin'],
    // The last room has three faces. Each one is a different fight; the sprite and the moves change with the health left.
    phases: [
      { at: 1, sprite: 'boss_house', name: 'The House', title: 'The House Always Knows', intents: ['strike', 'twin', 'mend', 'ink', 'guard', 'surge'], enraged: ['twin', 'surge', 'mend', 'blur', 'guard', 'twin'] },
      { at: 0.66, sprite: 'boss_house_open', name: 'The House', title: 'The roof is gone. Something is awake.', intents: ['goo', 'strike', 'guard', 'quake', 'twin', 'mend'], enraged: ['goo', 'twin', 'quake', 'guard', 'twin', 'blur'] },
      { at: 0.33, sprite: 'boss_jester', name: 'The Jester', title: 'The one who lives inside', intents: ['ink', 'flip', 'twin', 'blur', 'surge', 'quake'], enraged: ['twin', 'flip', 'ink', 'twin', 'blur', 'surge'] },
    ],
  },
};
export const BOSS_IDS = Object.keys(BOSS_ROSTER);

/** Question difficulty mix per enemy tier. Weights, not percentages. */
export const TIER_DIFFICULTY = {
  0: { 1: 70, 2: 30 },
  1: { 1: 45, 2: 40, 3: 15 },
  2: { 1: 8, 2: 32, 3: 40, 4: 20 },
  3: { 2: 12, 3: 43, 4: 45 },
  4: { 3: 40, 4: 60 },
};

const CONTESTANT_NAMES = ['Gus', 'Mabel', 'Odile', 'Bram', 'Tilda', 'Fenn', 'Ruth', 'Cass', 'Nico', 'Wren'];
const CONTESTANT_SPRITES = ['owl', 'fox', 'crow', 'miner', 'jester', 'welder', 'gasmask'];

/** The category groups a plain contestant can specialise in. */
const MINION_CATS = ['science', 'symbols', 'news', 'history', 'geography', 'nature', 'arts'];

/** A fresh encounter. `rng` is only used for contestants and elites; bosses are fixed by their id. */
export function makeEncounter({ kind, enemyId = null, rng = null, depth = 0 }) {
  if (kind === 'minion') {
    const cat = rng.pick(MINION_CATS);
    const hp = 6 + (depth >= 3 ? 2 : depth >= 1 ? 1 : 0);
    return {
      kind, id: `minion_${cat}`, name: `${rng.pick(CONTESTANT_NAMES)}, ${cat} contestant`, title: 'A rival on the circuit', cat, tier: depth >= 3 ? 2 : depth >= 1 ? 1 : 0,
      hp, maxHp: hp, intents: ['strike'], enraged: null, sprite: rng.pick(CONTESTANT_SPRITES), color: '#8a9096', arena: 'plain', misses: 0, qCount: 0, over: null, hits: 0, healed: 0,
    };
  }
  const b = BOSS_ROSTER[enemyId];
  if (!b) throw new Error(`Unknown enemy "${enemyId}"`);
  const elite = kind === 'elite';
  const hp = elite ? Math.round(b.hp * 0.55) : b.hp;
  return {
    kind: kind === 'boss' && b.final ? 'final' : kind,
    id: b.id, name: b.name, title: b.title, cat: b.cat, tier: elite ? Math.max(1, b.tier - 1) : b.tier,
    hp, maxHp: hp, intents: elite ? b.intents.slice(0, 3) : b.intents, enraged: elite ? null : b.enraged,
    sprite: b.sprite, color: b.color, arena: b.arena, misses: 0, qCount: 0, over: null, hits: 0, healed: 0,
    ...(!elite && b.phases ? { phases: b.phases.map((p) => ({ ...p, intents: [...p.intents], enraged: p.enraged ? [...p.enraged] : null })), phase: 0 } : {}),
  };
}

export const isEnraged = (enc) => Boolean(enc.enraged) && enc.hp > 0 && enc.hp <= enc.maxHp * DUEL.enrageAt;

/** Which face a phased boss (the final one) is wearing: it only ever moves forward. */
export function phaseOf(enc) {
  if (!enc.phases) return 0;
  const ratio = enc.hp / enc.maxHp;
  let k = 0;
  enc.phases.forEach((p, i) => { if (ratio <= p.at) k = i; });
  return Math.max(k, enc.phase ?? 0);
}

/** Move a phased boss to its next face when its health says so. Returns { from, to }. */
export function advancePhase(enc) {
  const from = enc.phase ?? 0;
  const to = phaseOf(enc);
  if (to > from) {
    const ph = enc.phases[to];
    enc.phase = to;
    enc.sprite = ph.sprite;
    if (ph.name) enc.name = ph.name;
    if (ph.title) enc.title = ph.title;
  }
  return { from, to: Math.max(from, to) };
}

/** The intent id for the question at this index. */
export function intentIdFor(enc, qIndex) {
  const ph = enc.phases?.[enc.phase ?? 0];
  const base = ph ? ph.intents : enc.intents;
  const rage = ph ? (ph.enraged ?? enc.enraged) : enc.enraged;
  const list = isEnraged(enc) && rage ? rage : base;
  return list[qIndex % list.length];
}

/** Clock multiplier from the intent and from enrage. Never shorter than 55% of the base. */
export function timerMultFor(enc, intentId, qIndex) {
  const it = INTENTS[intentId] ?? INTENTS.strike;
  let m = 1;
  if (it.timer === 'accel') m = Math.max(0.6, 1 - 0.07 * qIndex);
  else if (typeof it.timer === 'number') m = it.timer;
  if (isEnraged(enc)) m *= DUEL.enrageTimer;
  return Math.max(0.55, m);
}

/** Damage a right answer deals. Pure, so the stake screen and the engine agree. */
export function duelDamage({ difficulty, stake, fast, inGuardWindow = true, streak = 0, intentId = 'strike', curseThrough = false, dmgBonus = 0 }) {
  const it = INTENTS[intentId] ?? INTENTS.strike;
  let d = (DUEL.dmgByDifficulty[difficulty] ?? 1) + (DUEL.dmgByStake[stake] ?? 0);
  if (fast) d += 1;
  if (streak >= 3) d += 1;
  if (curseThrough) d += 1;
  d += dmgBonus;
  if (it.guard && !inGuardWindow) d = Math.max(1, Math.ceil(d / 2));
  if (it.twin) d *= 2;
  return Math.max(1, d);
}

/** Bulbs a miss costs. Plain contestants never cost a bulb on a single miss. */
export function bulbsLostOnMiss(enc, intentId) {
  if (enc.kind === 'minion') return 0;
  const it = INTENTS[intentId] ?? INTENTS.strike;
  return it.twin ? 2 : 1;
}

export const heatCostOf = (stake) => DUEL.heatCost[stake] ?? 0;

/** Starting heat for a fight. */
export const startHeat = (kind, bonus = 0) => Math.min(DUEL.heatCap, (DUEL.heat[kind] ?? 4) + bonus);

/** Category for the next question of a fight: the specialty most of the time, anything else otherwise. */
export function duelCategory(rng, enc, available) {
  const pool = available.filter(Boolean);
  const own = enc.cat !== 'any' && pool.includes(enc.cat) ? enc.cat : null;
  if (own && rng.chance(enc.kind === 'minion' ? 0.7 : 0.6)) return own;
  const others = pool.filter((c) => c !== own);
  return rng.pick(others.length ? others : pool);
}

/* ------------------------------------------------------------------ */
/* The map                                                             */
/* ------------------------------------------------------------------ */

export const NODE_KINDS = {
  fight: { label: 'Contestant', text: 'A plain fight. Three misses and it beats you.', icon: 'swords' },
  elite: { label: 'Champion', text: 'A boss in training. Bulbs are on the line. Wins a hex.', icon: 'skull' },
  shop: { label: 'Shop', text: 'Spend chips on bulbs, charges and edges.', icon: 'bag' },
  rest: { label: 'Rest', text: 'Heal a bulb, or train for the next fight.', icon: 'bulb_on' },
  event: { label: 'Deal', text: 'A stranger offers a trade.', icon: 'dice' },
  boss: { label: 'Boss', text: 'A full boss fight.', icon: 'skull' },
  final: { label: 'The House', text: 'The last room.', icon: 'skull' },
};

const LAYER_PLAN = ['fight3', 'elite-shop-rest', 'boss', 'fight-event-rest', 'final'];

/**
 * Five layers: three contestants, three rooms (a champion, a shop or a rest), a boss, three rooms (a contestant, a
 * rest or a deal), then the last room. Each node lists which nodes of the next layer it connects to.
 */
export function buildMap(rng) {
  const kindsOf = (plan) => {
    switch (plan) {
      case 'fight3': return ['fight', 'fight', 'fight'];
      case 'elite-shop-rest': return rng.shuffle(['elite', 'shop', 'rest']);
      case 'fight-event-rest': return rng.shuffle(['fight', 'event', 'rest']);
      case 'boss': return ['boss'];
      default: return ['final'];
    }
  };
  const layers = LAYER_PLAN.map((plan) => kindsOf(plan).map((kind) => ({ kind, next: [] })));
  layers.forEach((layer, li) => {
    const nextLayer = layers[li + 1];
    if (!nextLayer) return;
    layer.forEach((node, i) => {
      for (let j = 0; j < nextLayer.length; j++) {
        if (nextLayer.length === 1 || layer.length === 1 || Math.abs(i - j) <= 1) node.next.push(j);
      }
    });
  });
  return { layers, at: -1, pick: null, trail: [] };
}

/** Which nodes of the next layer the player can walk to now. Returns [{ layer, index, kind }]. */
export function availableNodes(map) {
  const li = map.at + 1;
  const layer = map.layers[li];
  if (!layer) return [];
  if (map.at < 0 || map.pick == null) return layer.map((n, index) => ({ layer: li, index, kind: n.kind }));
  const from = map.layers[map.at][map.pick];
  return from.next.map((index) => ({ layer: li, index, kind: layer[index].kind }));
}

/* ------------------------------------------------------------------ */
/* Deals (the Deal rooms) and the extra shop items                     */
/* ------------------------------------------------------------------ */

export const DEALS = {
  sell_bulb: { id: 'sell_bulb', text: 'Sell a bulb for 90 chips.', detail: 'You lose one bulb. Needs two or more.', ok: (p) => p.strikes >= 2 },
  buy_bulb: { id: 'buy_bulb', text: 'Pay 60 chips for a bulb.', detail: 'Restores one bulb (max 5).', ok: (p) => p.chips >= 60 && p.strikes < DUEL.maxLives },
  hot_hand: { id: 'hot_hand', text: 'Take a hot hand.', detail: 'Next fight: +3 heat, but you lose 20 chips now.', ok: (p) => p.chips >= 20 },
  free_hex: { id: 'free_hex', text: 'Pocket a stranger\'s hex.', detail: 'A hex from your deck goes into your hand. It costs 25 chips.', ok: (p) => p.chips >= 25 },
  sharpen: { id: 'sharpen', text: 'Sharpen your edge.', detail: 'Your hits deal +1 in the next fight. It costs 40 chips.', ok: (p) => p.chips >= 40 },
  gamble: { id: 'gamble', text: 'Flip the coin.', detail: 'Win 70 chips or lose 35. Even odds.', ok: () => true },
};
export const DEAL_IDS = Object.keys(DEALS);

export const DUEL_SHOP_ITEMS = {
  ice_pack: { id: 'ice_pack', name: 'Ice Pack', cost: 50, text: '+2 heat at the start of your next fight.' },
  whetstone: { id: 'whetstone', name: 'Whetstone', cost: 70, text: 'Your hits deal +1 damage in the next fight.' },
};
