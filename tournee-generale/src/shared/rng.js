// Seeded random numbers (mulberry32). The generator state lives in a plain
// object so it can be saved inside the game state and sent over the network.

/** Next float in [0, 1) and advance `holder.s`. */
export function rand(holder) {
  let t = (holder.s = (holder.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export const randInt = (holder, min, max) => min + Math.floor(rand(holder) * (max - min + 1));

/** Random element of a non-empty array. */
export const pick = (holder, arr) => arr[Math.floor(rand(holder) * arr.length)];

/** A standalone generator for code that does not keep state elsewhere (mini-games). */
export function makeRng(seed) {
  const holder = { s: seed | 0 };
  const f = () => rand(holder);
  f.int = (min, max) => randInt(holder, min, max);
  f.pick = (arr) => pick(holder, arr);
  f.range = (min, max) => min + rand(holder) * (max - min);
  return f;
}

/** Hash a string to a 32-bit seed. */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h | 0;
}
