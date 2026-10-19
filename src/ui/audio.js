// Sound. Every effect is synthesised with WebAudio, so there are no audio assets
// to license or download. Tune questions play a real clip only if the question
// supplies an `audio` file; the clip is never invented.
let ctx = null;
let enabled = true;
let volume = 0.7;

export function configureAudio({ sound, volume: v }) {
  enabled = sound !== false;
  volume = typeof v === 'number' ? v : 0.7;
  if (!enabled) stopMusic(0);
  else if (music) music.bus.gain.setTargetAtTime(MUSIC_LEVEL * volume, music.c.currentTime, 0.05);
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
/** True once a user gesture has let the browser play sound (and sound is on). */
export const audioRunning = () => enabled && ctx?.state === 'running';

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
  // --- bosses: bells, heartbeat, the house coming apart ---
  bell: (n = 4, gain = 0.045) => {
    for (let i = 0; i < n; i++) {
      const f = 2300 + Math.random() * 1900;
      tone({ f, f2: f * 0.985, dur: 0.35 + Math.random() * 0.25, gain: gain * (0.6 + Math.random() * 0.5), type: 'sine', delay: i * (0.05 + Math.random() * 0.05) });
      tone({ f: f * 2.4, dur: 0.12, gain: gain * 0.4, type: 'sine', delay: i * 0.07 });
    }
  },
  heartbeat: () => {
    tone({ f: 70, f2: 38, dur: 0.16, gain: 0.3, type: 'sine' });
    tone({ f: 62, f2: 34, dur: 0.18, gain: 0.22, type: 'sine', delay: 0.19 });
  },
  houseBreak: () => {
    noise({ dur: 1.4, gain: 0.3, low: 1800 });
    tone({ f: 90, f2: 24, dur: 1.2, gain: 0.34, type: 'sawtooth' });
    tone({ f: 60, f2: 20, dur: 1.4, gain: 0.3, type: 'sine', delay: 0.05 });
    for (let i = 0; i < 9; i++) noise({ dur: 0.07, gain: 0.12, low: 3000 + Math.random() * 3000, delay: 0.25 + i * 0.09 });
    [220, 233, 311].forEach((f, i) => tone({ f, dur: 1.1, gain: 0.07, type: 'sawtooth', delay: 0.4 + i * 0.02 }));
  },
  creak: () => { tone({ f: 140, f2: 90, dur: 0.7, gain: 0.07, type: 'sawtooth' }); tone({ f: 143, f2: 93, dur: 0.7, gain: 0.05, type: 'sawtooth' }); },
  jesterLaugh: () => {
    [392, 349, 392, 330, 392, 294, 392, 262].forEach((f, i) => tone({ f, f2: f * 0.92, dur: 0.11, gain: 0.1, type: 'square', delay: i * 0.15 }));
    sfx.bell(8, 0.06);
  },
  // --- the lamp: menu bulb and pack opening ---
  bulbTap: (n = 1) => {
    noise({ dur: 0.05, gain: 0.12, low: 2200 + n * 200 });
    tone({ f: 1500 + n * 120, f2: 900, dur: 0.06, gain: 0.05, type: 'square' });
    tone({ f: 100, dur: 0.18, gain: 0.04, type: 'sawtooth', delay: 0.01 });
  },
  bulbBuzz: () => { for (let i = 0; i < 5; i++) { noise({ dur: 0.04, gain: 0.1, low: 1800, delay: i * 0.07 + Math.random() * 0.03 }); tone({ f: 120 + Math.random() * 30, dur: 0.05, gain: 0.05, type: 'sawtooth', delay: i * 0.07 }); } },
  bulbBreak: () => { sfx.glass(); tone({ f: 200, f2: 40, dur: 0.5, gain: 0.2, type: 'sawtooth' }); noise({ dur: 0.4, gain: 0.14, low: 900, delay: 0.05 }); },
  bulbBack: () => { noise({ dur: 0.1, gain: 0.14, low: 900 }); tone({ f: 60, f2: 48, dur: 0.22, gain: 0.2, type: 'sine', delay: 0.02 }); sfx.flicker(); setTimeout(sfx.flicker, 110); setTimeout(sfx.flicker, 260); tone({ f: 120, dur: 0.6, gain: 0.02, type: 'sawtooth', delay: 0.3 }); },
  charge: (level = 1) => {
    const base = 220 * Math.pow(1.26, level);
    tone({ f: base, f2: base * 1.5, dur: 0.35, gain: 0.1, type: 'triangle' });
    noise({ dur: 0.25, gain: 0.06 + level * 0.02, low: 1500 + level * 1400 });
    if (level >= 2) tone({ f: base * 2, f2: base * 3, dur: 0.4, gain: 0.05, type: 'sine', delay: 0.05 });
  },
  focusTick: () => tone({ f: 1400, dur: 0.02, gain: 0.05, type: 'square' }),
  focusLock: () => { tone({ f: 660, dur: 0.07, gain: 0.08, type: 'triangle' }); tone({ f: 990, dur: 0.12, gain: 0.08, type: 'triangle', delay: 0.07 }); },
};

/* ------------------------------------------------------------------ music
 * Two looping tracks, played by a small step sequencer on WebAudio (no audio files):
 *   'boss'  a driving minor-key pulse for every boss and champion
 *   'menu'  a slow music-box lullaby for the main menu, quiet enough to sit under the UI
 *   'house' a warped music-box waltz for the last room, that grows teeth as the house breaks apart
 * They stop on their own when sound is turned off and fade out on request.
 */
const MUSIC_LEVEL = 0.5;
let music = null;
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'A3' -> midi. A trailing # or b after the letter shifts it. */
const midi = (name) => { const m = /^([A-G])([#b]?)(\d)$/.exec(name); return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
const F = (name) => hz(midi(name));

function mNote(m, { f, t, dur, type = 'square', gain = 0.05, f2 = null, detune = 0 }) {
  const o = m.c.createOscillator(); const g = m.c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); if (detune) o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(m.lp); o.start(t); o.stop(t + dur + 0.03);
}
function mNoise(m, { t, dur = 0.05, gain = 0.03, hp = 6000 }) {
  const n = Math.max(1, Math.floor(m.c.sampleRate * dur));
  const buf = m.c.createBuffer(1, n, m.c.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = m.c.createBufferSource(); src.buffer = buf;
  const f = m.c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = m.c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(m.lp); src.start(t);
}

const TRACKS = {
  boss: {
    steps: 64,
    stepDur: (m) => 60 / (m.intensity ? 150 : 128) / 4,
    play(m, k, t) {
      const bar = Math.floor(k / 16) % 4; const s = k % 16;
      const root = ['A1', 'F1', 'G1', 'E1'][bar]; const tones = [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4'], ['E3', 'G#3', 'B3']][bar];
      if (s % 4 === 0 || (s === 10 && bar % 2)) mNote(m, { f: 130, f2: 38, t, dur: 0.14, type: 'sine', gain: 0.28 });
      if (s === 4 || s === 12) { mNoise(m, { t, dur: 0.11, gain: 0.07, hp: 1800 }); mNote(m, { f: 190, f2: 120, t, dur: 0.08, type: 'triangle', gain: 0.06 }); }
      if (s % 2 === 0) mNote(m, { f: F(root) * 2, t, dur: 0.13, type: 'sawtooth', gain: 0.07 });
      if (s % 2 === 0) mNoise(m, { t, dur: 0.03, gain: 0.022, hp: 7000 });
      const arp = [0, 1, 2, 1, 2, 1, 0, 2][s % 8];
      mNote(m, { f: F(tones[arp]) * 2, t, dur: 0.1, type: 'square', gain: m.intensity ? 0.034 : 0.022 });
      if (m.intensity && s % 4 === 2) mNote(m, { f: F(tones[0]), t, dur: 0.18, type: 'sawtooth', gain: 0.05 });
      if (s === 0 && bar === 0 && Math.floor(k / 64) % 2 === 1) mNote(m, { f: F('A4'), f2: F('Bb4'), t, dur: 0.9, type: 'triangle', gain: 0.04 });
    },
  },
  menu: {
    // a slow, warm music-box lullaby in A minor, 4/4, eight bars: lamp-lit and a little uneasy
    steps: 128,
    stepDur: () => 60 / 72 / 4,
    play(m, k, t) {
      const bar = Math.floor(k / 16) % 8; const s = k % 16;
      const chord = [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['C4', 'E4', 'G4'], ['G3', 'B3', 'D4'], ['A3', 'C4', 'E4'], ['D3', 'F3', 'A3'], ['E3', 'G#3', 'B3'], ['A3', 'C4', 'E4']][bar];
      const rootN = ['A2', 'F2', 'C2', 'G2', 'A2', 'D2', 'E2', 'A2'][bar];
      const tune = [
        { 0: 'E5', 6: 'C5', 8: 'D5', 12: 'E5' }, { 0: 'F5', 4: 'E5', 8: 'C5', 12: 'A4' }, { 0: 'G5', 6: 'E5', 8: 'G5', 12: 'C6' }, { 0: 'B5', 4: 'A5', 8: 'G5', 12: 'D5' },
        { 0: 'E5', 6: 'C5', 8: 'D5', 12: 'E5' }, { 0: 'F5', 6: 'A5', 8: 'F5', 12: 'D5' }, { 0: 'E5', 4: 'G#5', 8: 'B5', 12: 'G#5' }, { 0: 'A5', 12: 'A4' },
      ][bar];
      if (s === 0) mNote(m, { f: F(rootN), t, dur: 1.4, type: 'triangle', gain: 0.12 });
      if (s % 4 === 0) mNote(m, { f: F(chord[(s / 4) % 3]) * 2, t, dur: 0.5, type: 'sine', gain: 0.03 });
      if (s === 8) chord.forEach((n) => mNote(m, { f: F(n), t, dur: 0.9, type: 'triangle', gain: 0.022 }));
      if (tune[s]) {
        const f = F(tune[s]);
        mNote(m, { f, t, dur: 0.85, type: 'sine', gain: 0.07 });
        mNote(m, { f: f * 3, t, dur: 0.08, type: 'sine', gain: 0.016 });
        mNote(m, { f: f * 2.003, t, dur: 0.4, type: 'sine', gain: 0.012 });
      }
      if (s === 14 && bar % 2) mNoise(m, { t, dur: 0.05, gain: 0.008, hp: 8000 });
    },
  },
  house: {
    steps: 96,
    stepDur: (m) => 60 / [92, 104, 132][m.intensity] / 4,
    play(m, k, t) {
      // 3/4: twelve sixteenths per bar, eight bars
      const bar = Math.floor(k / 12) % 8; const s = k % 12;
      const chord = [['D3', 'F3', 'A3'], ['D3', 'F3', 'A3'], ['G3', 'Bb3', 'D4'], ['A3', 'C#4', 'E4'], ['D3', 'F3', 'A3'], ['Bb2', 'D3', 'F3'], ['A3', 'C#4', 'E4'], ['D3', 'F3', 'A3']][bar];
      const rootN = ['D2', 'D2', 'G2', 'A2', 'D2', 'Bb1', 'A2', 'D2'][bar];
      const bars = [
        { 0: 'A5', 4: 'F5', 8: 'D5' }, { 0: 'E5', 4: 'F5', 6: 'G5', 8: 'A5' }, { 0: 'Bb5', 4: 'A5', 8: 'G5' }, { 0: 'A5', 4: 'E5', 8: 'C#5' },
        { 0: 'D6', 4: 'A5', 8: 'F5' }, { 0: 'G5', 4: 'Bb5', 6: 'A5', 8: 'F5' }, { 0: 'E5', 4: 'G5', 8: 'C#6' }, { 0: 'D5', 8: 'D5' },
      ][bar];
      if (s === 0) mNote(m, { f: F(rootN), t, dur: 0.5, type: 'triangle', gain: 0.13 });
      if (s === 4 || s === 8) chord.forEach((n) => mNote(m, { f: F(n), t, dur: 0.22, type: 'triangle', gain: 0.035 }));
      if (bars[s]) {
        const f = F(bars[s]);
        const bend = bar === 3 && s === 8 ? f * 0.94 : null;
        mNote(m, { f, f2: bend, t, dur: 0.7, type: 'sine', gain: 0.07 });
        mNote(m, { f: f * 1.004, f2: bend ? bend * 1.004 : null, t, dur: 0.7, type: 'sine', gain: 0.05, detune: 9 });
        mNote(m, { f: f * 3, t, dur: 0.09, type: 'sine', gain: 0.018 });
      }
      if (m.intensity >= 1 && (s === 0 || s === 6)) mNote(m, { f: 82, f2: 36, t, dur: 0.16, type: 'sine', gain: 0.22 });
      if (m.intensity >= 2) {
        if (s % 4 === 0) chord.forEach((n) => mNote(m, { f: F(n) * 2, t, dur: 0.16, type: 'sawtooth', gain: 0.022 }));
        if (s === 2 || s === 10) mNote(m, { f: 2500 + Math.random() * 1800, t, dur: 0.25, type: 'sine', gain: 0.03 });
      }
      if (s === 0 && bar % 4 === 3 && Math.random() < 0.6) mNote(m, { f: 61, t, dur: 2.2, type: 'sawtooth', gain: 0.025, detune: -15 });
    },
  },
};

export function startMusic(kind = 'boss', { intensity = 0 } = {}) {
  if (music?.kind === kind) { music.intensity = intensity; return; }
  stopMusic(0.3);
  const c = ac();
  const track = TRACKS[kind];
  if (!c || !track) return;
  const bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(c.destination);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'house' ? 3600 : kind === 'menu' ? 3000 : 2400; lp.connect(bus);
  const m = { kind, c, bus, lp, intensity, k: 0, next: c.currentTime + 0.08, track, timer: null };
  bus.gain.setTargetAtTime(MUSIC_LEVEL * volume, c.currentTime, 0.4);
  m.timer = setInterval(() => {
    if (music !== m) return;
    while (m.next < c.currentTime + 0.3) {
      track.play(m, m.k, m.next);
      m.next += track.stepDur(m);
      m.k = (m.k + 1) % track.steps;
    }
  }, 50);
  music = m;
}

export function setMusicIntensity(n) { if (music) music.intensity = n; }
export const musicKind = () => music?.kind ?? null;

/** Fade the track out (seconds) and stop it. */
export function stopMusic(fade = 0.6) {
  const m = music;
  if (!m) return;
  music = null;
  clearInterval(m.timer);
  try {
    if (fade > 0) { m.bus.gain.cancelScheduledValues(m.c.currentTime); m.bus.gain.setTargetAtTime(0.0001, m.c.currentTime, fade / 3); setTimeout(() => m.bus.disconnect(), fade * 1000 + 200); } else m.bus.disconnect();
  } catch { /* already gone */ }
}

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
