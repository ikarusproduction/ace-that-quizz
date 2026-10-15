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
