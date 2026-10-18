// Sound. Every effect is synthesised with WebAudio, so there are no audio assets
// to license or download. Tune questions play a real clip only if the question
// supplies an `audio` file; the clip is never invented.
let ctx = null;
let enabled = true;
let volume = 0.7;

export function configureAudio({ sound, volume: v }) {
  enabled = sound !== false;
  volume = typeof v === 'number' ? v : 0.7;
}

function ac() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Call from a user gesture so mobile browsers allow sound. */
export const unlockAudio = () => void ac();

function tone({ f = 440, f2 = null, dur = 0.12, type = 'square', gain = 0.12, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * volume), t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, gain = 0.1, delay = 0, low = 400 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = low;
  const g = c.createGain();
  g.gain.value = gain * volume;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  tap: () => tone({ f: 520, dur: 0.05, gain: 0.07 }),
  select: () => tone({ f: 330, f2: 440, dur: 0.07, gain: 0.08 }),
  tick: () => tone({ f: 880, dur: 0.03, gain: 0.04, type: 'square' }),
  warn: () => tone({ f: 220, dur: 0.08, gain: 0.08, type: 'sawtooth' }),
  lightsOn: () => {
    noise({ dur: 0.12, gain: 0.25, low: 700 });
    tone({ f: 60, f2: 45, dur: 0.25, gain: 0.3, type: 'sine', delay: 0.02 });
    tone({ f: 120, dur: 0.8, gain: 0.025, type: 'sawtooth', delay: 0.12 });
  },
  flicker: () => noise({ dur: 0.05, gain: 0.14, low: 1200 }),
  stake: () => {
    tone({ f: 196, dur: 0.1, gain: 0.1 });
    tone({ f: 147, dur: 0.18, gain: 0.1, delay: 0.09 });
  },
  correct: () => {
    tone({ f: 523, dur: 0.1, gain: 0.1 });
    tone({ f: 659, dur: 0.1, gain: 0.1, delay: 0.09 });
    tone({ f: 784, dur: 0.22, gain: 0.1, delay: 0.18 });
  },
  wrong: () => {
    tone({ f: 180, f2: 90, dur: 0.35, gain: 0.14, type: 'sawtooth' });
    noise({ dur: 0.25, gain: 0.12, low: 300 });
  },
  timeout: () => {
    tone({ f: 300, f2: 120, dur: 0.5, gain: 0.12, type: 'triangle' });
  },
  coin: () => {
    tone({ f: 988, dur: 0.06, gain: 0.08 });
    tone({ f: 1319, dur: 0.18, gain: 0.08, delay: 0.06 });
  },
  card: () => {
    noise({ dur: 0.06, gain: 0.1, low: 2500 });
    tone({ f: 700, f2: 1100, dur: 0.1, gain: 0.05, delay: 0.03 });
  },
  boss: () => {
    tone({ f: 82, dur: 0.5, gain: 0.2, type: 'sawtooth' });
    tone({ f: 77, dur: 0.5, gain: 0.2, type: 'sawtooth', delay: 0.02 });
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.2, gain: 0.1, delay: i * 0.12 }));
  },
  // --- rarity: the better the card, the bigger the sound ---
  rarity: (r = 'common') => {
    if (r === 'common') { tone({ f: 660, dur: 0.1, gain: 0.08 }); tone({ f: 880, dur: 0.14, gain: 0.08, delay: 0.08 }); }
    else if (r === 'uncommon') { [523, 659, 784].forEach((f, i) => tone({ f, dur: 0.14, gain: 0.09, delay: i * 0.08 })); noise({ dur: 0.15, gain: 0.05, low: 2500 }); }
    else if (r === 'rare') { [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.18, gain: 0.1, delay: i * 0.08, type: 'triangle' })); tone({ f: 262, dur: 0.5, gain: 0.1, type: 'sawtooth', delay: 0.1 }); noise({ dur: 0.35, gain: 0.07, low: 3500, delay: 0.1 }); }
    else { [392, 523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ f, dur: 0.22, gain: 0.11, delay: i * 0.07, type: 'triangle' })); tone({ f: 131, f2: 196, dur: 0.9, gain: 0.14, type: 'sawtooth' }); noise({ dur: 0.7, gain: 0.09, low: 4500, delay: 0.05 }); }
  },
  packTear: () => { noise({ dur: 0.25, gain: 0.12, low: 5000 }); tone({ f: 300, f2: 120, dur: 0.2, gain: 0.08, type: 'sawtooth' }); },
  packShake: () => { noise({ dur: 0.08, gain: 0.08, low: 700 }); tone({ f: 120, dur: 0.06, gain: 0.08, type: 'square' }); },
  splat: () => { noise({ dur: 0.22, gain: 0.14, low: 900 }); tone({ f: 220, f2: 70, dur: 0.18, gain: 0.12, type: 'sine' }); },
  steal: () => { tone({ f: 1318, dur: 0.05, gain: 0.07 }); tone({ f: 988, dur: 0.05, gain: 0.07, delay: 0.05 }); tone({ f: 740, dur: 0.1, gain: 0.07, delay: 0.1 }); },
  shield: () => { tone({ f: 400, f2: 800, dur: 0.12, gain: 0.09, type: 'triangle' }); tone({ f: 1200, dur: 0.1, gain: 0.06, delay: 0.1 }); },
  // --- duels: hits, hurt, glass, bosses ---
  hit: (power = 1) => {
    noise({ dur: 0.12, gain: 0.16 + 0.03 * Math.min(power, 5), low: 1400 });
    tone({ f: 190 - 14 * Math.min(power, 5), f2: 60, dur: 0.16, gain: 0.2, type: 'sine' });
    tone({ f: 420 + 90 * Math.min(power, 5), f2: 220, dur: 0.07, gain: 0.06, type: 'square', delay: 0.01 });
  },
  crit: () => {
    noise({ dur: 0.18, gain: 0.2, low: 2600 });
    tone({ f: 120, f2: 45, dur: 0.26, gain: 0.26, type: 'sine' });
    [1318, 1760, 2349].forEach((f, i) => tone({ f, dur: 0.1, gain: 0.07, type: 'triangle', delay: 0.04 + i * 0.05 }));
  },
  clang: () => {
    tone({ f: 880, dur: 0.2, gain: 0.1, type: 'triangle' });
    tone({ f: 1330, dur: 0.16, gain: 0.07, type: 'triangle', delay: 0.01 });
    noise({ dur: 0.06, gain: 0.1, low: 6000 });
  },
  hurt: () => {
    tone({ f: 130, f2: 55, dur: 0.45, gain: 0.2, type: 'sawtooth' });
    noise({ dur: 0.3, gain: 0.14, low: 500 });
    tone({ f: 70, dur: 0.5, gain: 0.18, type: 'sine', delay: 0.05 });
  },
  glass: () => {
    for (let i = 0; i < 6; i++) noise({ dur: 0.05 + Math.random() * 0.05, gain: 0.1, low: 5000 + Math.random() * 2500, delay: i * 0.035 });
    [3136, 2637, 2093, 1760].forEach((f, i) => tone({ f, f2: f * 0.7, dur: 0.12, gain: 0.05, type: 'triangle', delay: 0.02 + i * 0.045 }));
  },
  bossDown: () => {
    noise({ dur: 0.9, gain: 0.22, low: 900 });
    tone({ f: 110, f2: 28, dur: 0.9, gain: 0.26, type: 'sawtooth' });
    [392, 523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.22, gain: 0.1, type: 'triangle', delay: 0.5 + i * 0.1 }));
  },
  roar: () => {
    tone({ f: 64, f2: 40, dur: 0.9, gain: 0.26, type: 'sawtooth' });
    tone({ f: 67, f2: 42, dur: 0.9, gain: 0.2, type: 'sawtooth', delay: 0.03 });
    noise({ dur: 0.7, gain: 0.14, low: 700 });
  },
  heal: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.14, gain: 0.07, type: 'triangle', delay: i * 0.06 })),
  heat: () => { noise({ dur: 0.1, gain: 0.07, low: 3500 }); tone({ f: 440, f2: 880, dur: 0.12, gain: 0.06, type: 'triangle' }); },
  telegraph: () => { tone({ f: 98, dur: 0.18, gain: 0.12, type: 'sawtooth' }); tone({ f: 131, dur: 0.22, gain: 0.1, type: 'sawtooth', delay: 0.14 }); },
  node: () => { tone({ f: 330, f2: 392, dur: 0.08, gain: 0.08 }); tone({ f: 494, dur: 0.1, gain: 0.07, delay: 0.07 }); },
  rest: () => [392, 330, 392, 523].forEach((f, i) => tone({ f, dur: 0.2, gain: 0.06, type: 'sine', delay: i * 0.14 })),
  // --- goofy / casino extras ---
  spin: () => tone({ f: 1100 + Math.random() * 300, dur: 0.025, gain: 0.05, type: 'square' }),
  reelStop: () => {
    tone({ f: 140, f2: 90, dur: 0.12, gain: 0.16, type: 'triangle' });
    noise({ dur: 0.05, gain: 0.1, low: 1800 });
  },
  boing: () => tone({ f: 200, f2: 700, dur: 0.28, gain: 0.12, type: 'sine' }),
  pop: () => {
    tone({ f: 900, f2: 300, dur: 0.07, gain: 0.1, type: 'sine' });
  },
  whoosh: () => noise({ dur: 0.3, gain: 0.12, low: 1500 }),
  cash: () => {
    [1568, 1976, 2349, 3136].forEach((f, i) => tone({ f, dur: 0.07, gain: 0.07, delay: i * 0.05 }));
  },
  combo: (n = 2) => {
    const base = 440 * Math.pow(2, Math.min(n, 8) / 12);
    tone({ f: base, dur: 0.07, gain: 0.09 });
    tone({ f: base * 1.5, dur: 0.14, gain: 0.09, delay: 0.07 });
  },
  jackpot: () => {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone({ f, dur: 0.14, gain: 0.11, delay: i * 0.09 }));
    noise({ dur: 0.5, gain: 0.08, low: 3000, delay: 0.1 });
  },
  sadTrombone: () => {
    [233, 220, 208].forEach((f, i) => tone({ f, dur: 0.32, gain: 0.12, type: 'sawtooth', delay: i * 0.3 }));
    tone({ f: 196, f2: 150, dur: 0.7, gain: 0.12, type: 'sawtooth', delay: 0.9 });
  },
  kazoo: () => {
    [392, 440, 392, 330].forEach((f, i) => tone({ f, f2: f * 1.04, dur: 0.1, gain: 0.07, type: 'sawtooth', delay: i * 0.1 }));
  },
  drumroll: () => {
    for (let i = 0; i < 14; i++) noise({ dur: 0.05, gain: 0.06 + i * 0.004, low: 900, delay: i * 0.06 });
  },
  lose: () => {
    [392, 330, 262, 196].forEach((f, i) => tone({ f, dur: 0.3, gain: 0.1, type: 'triangle', delay: i * 0.18 }));
  },
};

let clip = null;
/** Play a question's reveal clip. Returns the Audio element, or null if there is none. */
export function playClip(src) {
  stopClip();
  if (!src || !enabled) return null;
  clip = new Audio(src);
  clip.volume = volume;
  clip.play().catch(() => {});
  return clip;
}

export function stopClip() {
  if (clip) {
    clip.pause();
    clip = null;
  }
}
