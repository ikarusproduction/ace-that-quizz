// Small seeded random number generator (mulberry32) whose entire state is one
// 32-bit integer, so a game in progress can be saved and resumed exactly, and
// a daily challenge can be replayed identically from its seed string.

/** Hash any string into a 32-bit unsigned seed. */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  constructor(state) {
    this.state = state >>> 0;
  }

  static fromSeed(seed) {
    return new Rng(hashSeed(String(seed)));
  }

  /** Float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    if (!arr.length) throw new Error('pick() from an empty array');
    return arr[this.int(arr.length)];
  }

  /** Fisher-Yates shuffle returning a new array. */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Pick a key from an object of { key: weight }. Zero or negative weights are ignored. */
  weighted(weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    if (!entries.length) throw new Error('weighted() needs at least one positive weight');
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [key, w] of entries) {
      r -= w;
      if (r < 0) return key;
    }
    return entries[entries.length - 1][0];
  }
}

/** A fresh, unpredictable seed string for a normal (non-daily) game. */
export function randomSeed() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
