// Player level, XP, titles and the dust-priced wardrobe. Pure data and maths, no DOM.
// Dust used to be good for one thing (forging hexes). Now it also dresses your portrait: frames, backgrounds, colours,
// costume pieces. Titles come with your level and are free.

/** XP needed to go from level n to n+1. */
export const xpToNext = (n) => 80 + 30 * (n - 1);
export const MAX_LEVEL = 50;

/** Total XP at which a level begins (level 1 starts at 0). */
export function xpAtLevel(level) {
  let t = 0;
  for (let n = 1; n < Math.min(level, MAX_LEVEL); n++) t += xpToNext(n);
  return t;
}

/** { level, into, need, pct } for a total XP figure. */
export function levelOf(xp) {
  let level = 1; let left = Math.max(0, Math.floor(xp) || 0);
  while (level < MAX_LEVEL && left >= xpToNext(level)) { left -= xpToNext(level); level++; }
  const need = level >= MAX_LEVEL ? 0 : xpToNext(level);
  return { level, into: left, need, pct: need ? left / need : 1 };
}

/** XP for one finished game, from the engine state. Kept modest so levels stay meaningful. */
export function xpForGame(s, playerId) {
  const p = s.players.find((x) => x.playerId === playerId);
  if (!p || s.status !== 'completed') return 0;
  const mine = s.log.filter((r) => r.playerId === playerId);
  const right = mine.filter((r) => r.correct).length;
  const won = p.result === 'won' || p.placement === 1;
  return Math.min(400, 15 + right * 3 + (won ? 40 : 0) + (p.bossesCleared ?? 0) * 25 + Math.min(10, p.longestStreak ?? 0) * 2);
}

export const TITLES = [
  { id: 't1', level: 1, name: 'Newcomer' },
  { id: 't3', level: 3, name: 'Contestant' },
  { id: 't6', level: 6, name: 'Regular' },
  { id: 't10', level: 10, name: 'Sharp Mind' },
  { id: 't15', level: 15, name: 'Bulb Whisperer' },
  { id: 't20', level: 20, name: 'House Guest' },
  { id: 't30', level: 30, name: 'Veteran' },
  { id: 't40', level: 40, name: 'Light Keeper' },
  { id: 't50', level: 50, name: 'Master of the House' },
];
export const titleById = (id) => TITLES.find((t) => t.id === id);
export const bestTitle = (level) => [...TITLES].reverse().find((t) => t.level <= level) ?? TITLES[0];
export const unlockedTitles = (level) => TITLES.filter((t) => t.level <= level);

/**
 * Wardrobe. slot: frame | bg | tint | hat | fx. Everything is bought with dust only, there is no level gate: dust comes
 * from duplicate cards in packs, from finished games and from Adventure clears, so collecting is what dresses you.
 * Visuals live in CSS (`.fr-*`, `.bg-*`, `.fx-*`, `.hat-*`), in `tint` (a CSS filter) and in `hat` (a sprite name).
 * `glow` is the light a frame casts (frames only); `level` is kept at 1 for old saves and is not checked.
 */
export const COSMETICS = {
  // frames (they light the portrait)
  fr_rust: { slot: 'frame', name: 'Rusty Plate', cost: 25, level: 1, glow: '#a8561f' },
  fr_steel: { slot: 'frame', name: 'Bunker Steel', cost: 50, level: 1, glow: '#9aa6b2' },
  fr_amber: { slot: 'frame', name: 'Amber Glow', cost: 90, level: 1, glow: '#e8a33d' },
  fr_blood: { slot: 'frame', name: 'Blood Line', cost: 120, level: 1, glow: '#e0392e' },
  fr_neon: { slot: 'frame', name: 'Neon Sign', cost: 160, level: 1, glow: '#78beff' },
  fr_storm: { slot: 'frame', name: 'Storm Cage', cost: 210, level: 1, glow: '#b9d4ff' },
  fr_gold: { slot: 'frame', name: 'Gold Leaf', cost: 280, level: 1, glow: '#f6d77f' },
  fr_aurora: { slot: 'frame', name: 'Aurora', cost: 340, level: 1, glow: '#6bffb8' },
  fr_house: { slot: 'frame', name: 'House Seal', cost: 450, level: 1, glow: '#e8a33d' },
  // backgrounds (they have their own light and moving particles)
  bg_dusk: { slot: 'bg', name: 'Dusk', cost: 25, level: 1 },
  bg_stripes: { slot: 'bg', name: 'Hazard Stripes', cost: 45, level: 1 },
  bg_spot: { slot: 'bg', name: 'Spotlight', cost: 70, level: 1 },
  bg_grid: { slot: 'bg', name: 'Blueprint', cost: 90, level: 1 },
  bg_rain: { slot: 'bg', name: 'Night Rain', cost: 120, level: 1 },
  bg_fire: { slot: 'bg', name: 'Furnace', cost: 140, level: 1 },
  bg_snow: { slot: 'bg', name: 'Snowfall', cost: 150, level: 1 },
  bg_stars: { slot: 'bg', name: 'Night Sky', cost: 190, level: 1 },
  bg_void: { slot: 'bg', name: 'The Void', cost: 330, level: 1 },
  // colours (costume dye)
  tn_ember: { slot: 'tint', name: 'Ember', cost: 30, level: 1, filter: 'hue-rotate(-25deg) saturate(1.4)' },
  tn_frost: { slot: 'tint', name: 'Frost', cost: 30, level: 1, filter: 'hue-rotate(150deg) saturate(1.1)' },
  tn_toxic: { slot: 'tint', name: 'Toxic', cost: 50, level: 1, filter: 'hue-rotate(75deg) saturate(1.5)' },
  tn_violet: { slot: 'tint', name: 'Violet', cost: 50, level: 1, filter: 'hue-rotate(230deg) saturate(1.3)' },
  tn_rose: { slot: 'tint', name: 'Rose', cost: 70, level: 1, filter: 'hue-rotate(300deg) saturate(1.4)' },
  tn_ghost: { slot: 'tint', name: 'Ghost', cost: 140, level: 1, filter: 'grayscale(1) brightness(1.35) contrast(.9)' },
  // costume pieces (animated)
  ht_cap: { slot: 'hat', name: 'Flat Cap', cost: 40, level: 1, sprite: 'hat_cap' },
  ht_tophat: { slot: 'hat', name: 'Top Hat', cost: 90, level: 1, sprite: 'hat_top' },
  ht_shades: { slot: 'hat', name: 'Dark Shades', cost: 120, level: 1, sprite: 'hat_shades' },
  ht_antenna: { slot: 'hat', name: 'Lab Antenna', cost: 150, level: 1, sprite: 'hat_antenna' },
  ht_horns: { slot: 'hat', name: 'Devil Horns', cost: 180, level: 1, sprite: 'hat_horns' },
  ht_halo: { slot: 'hat', name: 'Halo', cost: 220, level: 1, sprite: 'hat_halo' },
  ht_wizard: { slot: 'hat', name: 'Star Wizard', cost: 260, level: 1, sprite: 'hat_wizard' },
  ht_crown: { slot: 'hat', name: 'Little Crown', cost: 300, level: 1, sprite: 'hat_crown' },
  // particle effects around the portrait
  fx_bubbles: { slot: 'fx', name: 'Bubbles', cost: 100, level: 1 },
  fx_embers: { slot: 'fx', name: 'Embers', cost: 110, level: 1 },
  fx_snow: { slot: 'fx', name: 'Flurry', cost: 130, level: 1 },
  fx_sparkle: { slot: 'fx', name: 'Sparkle', cost: 150, level: 1 },
  fx_static: { slot: 'fx', name: 'Static', cost: 180, level: 1 },
  fx_confetti: { slot: 'fx', name: 'Confetti', cost: 200, level: 1 },
  fx_ghosts: { slot: 'fx', name: 'Wisps', cost: 240, level: 1 },
};
export const SLOTS = [['frame', 'Frames'], ['bg', 'Backgrounds'], ['fx', 'Effects'], ['tint', 'Colours'], ['hat', 'Costume']];
export const WARDROBE_SLOTS = SLOTS.map(([k]) => k);
export const cosmeticsIn = (slot) => Object.entries(COSMETICS).filter(([, c]) => c.slot === slot).map(([id, c]) => ({ id, ...c }));

/** Clean the saved wardrobe: owned ids that exist, equipped ones that are owned (or a title unlocked at this level). */
export function cleanWardrobe(raw, level = MAX_LEVEL) {
  const owned = [...new Set((Array.isArray(raw?.owned) ? raw.owned : []).filter((id) => COSMETICS[id]))];
  const eq = raw?.equipped ?? {};
  const equipped = {};
  for (const slot of WARDROBE_SLOTS) {
    const id = eq[slot];
    if (typeof id === 'string' && owned.includes(id) && COSMETICS[id].slot === slot) equipped[slot] = id;
  }
  const t = titleById(eq.title);
  if (t && t.level <= level) equipped.title = t.id;
  return { owned, equipped };
}

export function buyCheck(wardrobe, id, dust) {
  const c = COSMETICS[id];
  if (!c) return 'Unknown item.';
  if (wardrobe.owned.includes(id)) return 'You already own that.';
  if (dust < c.cost) return `You need ${c.cost} dust (you have ${dust}).`;
  return null;
}

/** Dust for one finished game: small and steady, so cards (duplicates) and Adventure stay the main sources. */
export function dustForGame(s, playerId) {
  const p = s.players.find((x) => x.playerId === playerId);
  if (!p || s.status !== 'completed') return 0;
  const won = p.result === 'won' || p.placement === 1;
  return Math.min(30, 4 + (won ? 6 : 0) + (p.bossesCleared ?? 0) * 5);
}
