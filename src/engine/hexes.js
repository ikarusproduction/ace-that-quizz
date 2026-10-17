// Hexes: the dirty-trick deck. It is separate from the bonus cards. You earn hex charges in a game by
// answering in a row (streak 2 / 4 / 6 / 8), and you unlock new hexes by opening packs after games.
import { RARITY_WEIGHT } from './cards.js';

/**
 * kind:  'visual' (screen effect on the target's question), 'steal' (chips move now), 'defense' (armed shield),
 *        'combo' (visual + steal).
 * targets: 'any' (yourself or a rival), 'rival', 'self'.
 */
export const HEXES = {
  ink_blast: { id: 'ink_blast', name: 'Ink Blast', rarity: 'common', kind: 'visual', targets: 'any', fx: ['ink'], icon: 'ink', starter: true,
    text: "Squirts ink over the target's question. They have to wipe it away to read.",
    drawback: 'On yourself it pays +20% if you still get it right. On a rival it costs them 15% of their win.' },
  goo_splat: { id: 'goo_splat', name: 'Goo Splat', rarity: 'common', kind: 'visual', targets: 'any', fx: ['goo'], icon: 'goo', starter: true,
    text: "Splats slime across the target's screen. It drips slowly.",
    drawback: 'On yourself it pays +20% if you still get it right. On a rival it costs them 15% of their win.' },
  pickpocket: { id: 'pickpocket', name: 'Pickpocket', rarity: 'common', kind: 'steal', targets: 'rival', steal: 'pickpocket', icon: 'hand', starter: true, versusOnly: true,
    text: 'Lifts 2 chips from a rival right now.', drawback: 'Only takes what they carry in hand. Versus only.' },
  sponge: { id: 'sponge', name: 'Sponge', rarity: 'common', kind: 'defense', targets: 'self', shield: 'sponge', icon: 'sponge', starter: true,
    text: 'Soaks up the next hex a rival plays on you. It does nothing to you.', drawback: 'Used up after one hex. It does not stop a Heist or Pickpocket that already landed.' },
  quake: { id: 'quake', name: 'Quake', rarity: 'uncommon', kind: 'visual', targets: 'any', fx: ['quake'], icon: 'quake', starter: false,
    text: "Shakes the target's screen while they answer.",
    drawback: 'On yourself it pays +20% if you still get it right. On a rival it costs them 15% of their win.' },
  blur_out: { id: 'blur_out', name: 'Blur Out', rarity: 'uncommon', kind: 'visual', targets: 'any', fx: ['blur'], icon: 'blur', starter: false,
    text: "Blurs the target's answers until they tap to focus.",
    drawback: 'On yourself it pays +20% if you still get it right. On a rival it costs them 15% of their win.' },
  cloth: { id: 'cloth', name: 'Wet Cloth', rarity: 'uncommon', kind: 'defense', targets: 'self', shield: 'cloth', icon: 'sponge', starter: false,
    text: 'Wipes every hex off your current question and shields you from the next one.', drawback: 'Used up after one hex.' },
  flip_table: { id: 'flip_table', name: 'Flip the Table', rarity: 'rare', kind: 'visual', targets: 'any', fx: ['flip'], icon: 'flip', starter: false,
    text: "Turns the target's question upside down.",
    drawback: 'On yourself it pays +20% if you still get it right. On a rival it costs them 15% of their win.' },
  heist: { id: 'heist', name: 'Heist', rarity: 'rare', kind: 'steal', targets: 'rival', steal: 'heist', icon: 'bag', starter: false, versusOnly: true,
    text: "Robs 15% of a rival's chips (at least 3, at most 12).", drawback: 'The job costs you 1 chip. Versus only.' },
  mirror: { id: 'mirror', name: 'Mirror', rarity: 'rare', kind: 'defense', targets: 'self', shield: 'mirror', icon: 'mirror', starter: false,
    text: 'The next hex a rival plays on you bounces back at them.', drawback: 'Used up after one hex.' },
  kraken: { id: 'kraken', name: 'The Kraken', rarity: 'legendary', kind: 'combo', targets: 'rival', fx: ['ink', 'goo', 'quake'], steal: 'kraken', icon: 'squid', starter: false, versusOnly: true,
    text: 'Ink, slime and a quake on a rival, and it grabs 4 chips on the way out.', drawback: 'Versus only.' },
};
export const HEX_IDS = Object.keys(HEXES);
export const STARTER_HEXES = HEX_IDS.filter((id) => HEXES[id].starter);
export const HEX_RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

/** Streak needed to earn a hex of each rarity. Beyond 8, every further even streak earns a legendary. */
export const STREAK_TIERS = { 2: 'common', 4: 'uncommon', 6: 'rare', 8: 'legendary' };
export const HEX_NUMBERS = { deckSize: 4, handMax: 3, puzzlesPerPrank: 3 };

export function tierForStreak(streak) {
  if (STREAK_TIERS[streak]) return STREAK_TIERS[streak];
  if (streak > 8 && streak % 2 === 0) return 'legendary';
  return null;
}

/** Which hexes a player may put in the deck in a given mode. */
export function usableHexes(owned, mode) {
  return owned.filter((id) => HEXES[id] && !(HEXES[id].versusOnly && mode !== 'versus'));
}

/**
 * Pick the hex a streak earns from the player's deck: a hex of exactly that rarity if there is one,
 * otherwise the best one below it. Returns null if nothing in the deck qualifies.
 */
export function drawHex(rng, deck, tier, mode) {
  const ok = usableHexes(deck, mode);
  const rank = HEX_RARITY_ORDER.indexOf(tier);
  for (let r = rank; r >= 0; r--) {
    const pool = ok.filter((id) => HEXES[id].rarity === HEX_RARITY_ORDER[r]);
    if (pool.length) return rng.pick(pool);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Packs                                                               */
/* ------------------------------------------------------------------ */

export const PACKS = {
  bronze: { id: 'bronze', name: 'Bronze Pack', count: 2, minRarity: 'common', luck: 1 },
  silver: { id: 'silver', name: 'Silver Pack', count: 3, minRarity: 'uncommon', luck: 1.5 },
  gold: { id: 'gold', name: 'Gold Pack', count: 3, minRarity: 'rare', luck: 2.5 },
};
export const DUST_FOR_DUPLICATE = { common: 5, uncommon: 10, rare: 25, legendary: 60 };
export const FORGE_COST = { common: 20, uncommon: 40, rare: 100, legendary: 250 };

/**
 * Open a pack deterministically from its id. Returns the cards in reveal order (best last, for drama).
 * `owned` decides which cards are duplicates (a duplicate turns into dust).
 */
export function openPack(rng, packType, owned) {
  const pack = PACKS[packType];
  if (!pack) throw new Error(`unknown pack ${packType}`);
  const have = new Set(owned);
  const minRank = HEX_RARITY_ORDER.indexOf(pack.minRarity);
  const cards = [];
  for (let i = 0; i < pack.count; i++) {
    const weights = {};
    for (const id of HEX_IDS) {
      const rank = HEX_RARITY_ORDER.indexOf(HEXES[id].rarity);
      // Better rarities get heavier with luck; the last card of a pack must reach the pack's minimum rarity.
      const w = RARITY_WEIGHT[HEXES[id].rarity] * (rank >= 2 ? pack.luck : 1);
      if (i === pack.count - 1 && rank < minRank) continue;
      weights[id] = w;
    }
    const id = rng.weighted(weights);
    const dup = have.has(id);
    have.add(id);
    cards.push({ id, dup, dust: dup ? DUST_FOR_DUPLICATE[HEXES[id].rarity] : 0 });
  }
  return cards.sort((a, b) => HEX_RARITY_ORDER.indexOf(HEXES[a.id].rarity) - HEX_RARITY_ORDER.indexOf(HEXES[b.id].rarity));
}

/** Packs a finished game earns one player. */
export function packsEarned(s, playerId) {
  const p = s.players.find((x) => x.playerId === playerId);
  if (!p || s.status !== 'completed') return [];
  const best = p.longestStreak ?? 0;
  const out = ['bronze'];
  if (best >= 5 || p.result === 'won' || p.placement === 1) out.push('silver');
  if (best >= 8 || (p.result === 'won' && best >= 5)) out.push('gold');
  return out;
}

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

/** Each mission reads only the finished-game log and the player's counters, so it is pure and testable. */
export const MISSIONS = [
  { id: 'streak3', text: 'Reach a streak of 3', test: (p) => p.longestStreak >= 3 },
  { id: 'streak5', text: 'Reach a streak of 5', test: (p) => p.longestStreak >= 5 },
  { id: 'hex2', text: 'Play 2 hexes', test: (p) => (p.stats?.hexesPlayed ?? 0) >= 2 },
  { id: 'steal5', text: 'Steal 5 chips or more', test: (p) => (p.stats?.chipsStolen ?? 0) >= 5 },
  { id: 'self_dare', text: 'Dare yourself: play a hex on yourself and answer right', test: (p) => (p.stats?.dareWins ?? 0) >= 1 },
  { id: 'fast3', text: 'Answer 3 questions in the first 40% of the clock', test: (p, log) => log.filter((r) => r.playerId === p.playerId && r.correct && r.timeLeftMs / r.timerMs >= 0.6).length >= 3 },
  { id: 'right8', text: 'Get 8 answers right', test: (p) => p.correctTotal >= 8 },
  { id: 'puzzle2', text: 'Solve 2 puzzles while you wait', test: (p) => (p.stats?.puzzlesSolved ?? 0) >= 2 },
  { id: 'no_wrong_round', text: 'Clear a whole round with no wrong answer', test: (p, log) => {
    const rounds = new Map();
    for (const r of log.filter((x) => x.playerId === p.playerId)) rounds.set(r.roundIndex, (rounds.get(r.roundIndex) ?? true) && r.correct);
    return [...rounds.values()].some(Boolean);
  } },
  { id: 'shield', text: 'Block a hex with a Sponge, Wet Cloth or Mirror', test: (p) => (p.stats?.blocked ?? 0) >= 1 },
];

/** Three missions per game per player, chosen from the session id so every phone agrees. */
export function missionsFor(rng) {
  return rng.shuffle(MISSIONS.map((m) => m.id)).slice(0, 3);
}
export function evaluateMissions(s, playerId, ids) {
  const p = s.players.find((x) => x.playerId === playerId);
  return ids.map((id) => {
    const m = MISSIONS.find((x) => x.id === id);
    return { id, text: m.text, done: Boolean(p && m.test(p, s.log)) };
  });
}
