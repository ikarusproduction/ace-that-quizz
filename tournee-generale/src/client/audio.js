// Synthesized sound effects (no audio files). Unlocked by the first touch.
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('tg.mute') === '1'; } catch { /* */ }

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}
export const isMuted = () => muted;
export function setMuted(m) { muted = m; try { localStorage.setItem('tg.mute', m ? '1' : '0'); } catch { /* */ } }

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, attack = 0.005 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, { vol = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  tap: () => tone(660, 0.06, { type: 'triangle', vol: 0.2 }),
  step: () => { tone(380, 0.07, { type: 'square', vol: 0.08 }); tone(760, 0.05, { type: 'sine', vol: 0.08, delay: 0.01 }); },
  dice: () => { for (let i = 0; i < 4; i++) noise(0.05, { vol: 0.25, freq: 2500 + i * 400, q: 4, delay: i * 0.06 }); },
  land: () => { tone(520, 0.12, { type: 'triangle', vol: 0.25 }); tone(780, 0.18, { type: 'triangle', vol: 0.2, delay: 0.08 }); },
  coin: () => { tone(988, 0.08, { type: 'square', vol: 0.12 }); tone(1319, 0.25, { type: 'square', vol: 0.12, delay: 0.08 }); },
  bad: () => { tone(300, 0.3, { type: 'sawtooth', vol: 0.15, slide: -180 }); },
  hit: () => { tone(120, 0.35, { type: 'sine', vol: 0.5, slide: -60 }); noise(0.25, { vol: 0.35, freq: 600, q: 0.7 }); },
  ko: () => { [0, 1, 2, 3].forEach((i) => tone(500 - i * 90, 0.28, { type: 'sawtooth', vol: 0.16, delay: i * 0.16, slide: -40 })); },
  crown: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.08 })); },
  boom: () => { noise(1.1, { vol: 0.8, freq: 900, q: 0.4, type: 'lowpass', sweep: -800 }); tone(70, 0.8, { vol: 0.6, slide: -30 }); },
  slice: () => noise(0.14, { vol: 0.3, freq: 3000, q: 1.5, sweep: 3000, type: 'bandpass' }),
  splat: () => noise(0.18, { vol: 0.25, freq: 500, q: 1, type: 'lowpass' }),
  tick: () => tone(880, 0.08, { type: 'square', vol: 0.1 }),
  go: () => { tone(660, 0.12, { type: 'square', vol: 0.15 }); tone(1320, 0.3, { type: 'square', vol: 0.15, delay: 0.1 }); },
  reel: () => tone(1200 + Math.random() * 300, 0.03, { type: 'square', vol: 0.05 }),
  win: () => { [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.1, delay: i * 0.1 })); },
  pour: () => noise(0.12, { vol: 0.12, freq: 700, q: 2 }),
  creak: (k = 0) => tone(90 + k * 120, 0.12, { type: 'sawtooth', vol: 0.05 + k * 0.08, slide: 40 }),
};

export function vibrate(pattern) {
  try { if (!muted && navigator.vibrate) navigator.vibrate(pattern); } catch { /* iOS has none */ }
}
