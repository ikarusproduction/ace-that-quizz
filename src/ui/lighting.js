// The lighting layer: a hanging bulb, a cone of light, vignette and film grain,
// all drawn with CSS. The "lights switch on" moment is a real flicker sequence:
// the room is black, the bulb stutters through a few partial brightness steps and
// then settles. Respects reduced motion.
import { h } from './dom.js';
import { sfx } from './audio.js';

let root = null;
let dark = null;
let reduce = false;
let current = 'idle';

const MOODS = {
  idle: { '--light': 0.9, '--lamp': '#ffd98a', '--lamp2': '#e8a33d' },
  calm: { '--light': 0.75, '--lamp': '#ffd98a', '--lamp2': '#e8a33d' },
  tense: { '--light': 0.6, '--lamp': '#ffb067', '--lamp2': '#d9772b' },
  danger: { '--light': 0.5, '--lamp': '#ff7a63', '--lamp2': '#b3261e' },
  boss: { '--light': 0.55, '--lamp': '#ff8f78', '--lamp2': '#b3261e' },
  win: { '--light': 1, '--lamp': '#fff0b8', '--lamp2': '#f2c04f' },
  out: { '--light': 0.04, '--lamp': '#3b3128', '--lamp2': '#2a2d30' },
};

export function setReducedMotion(v) {
  reduce = Boolean(v) || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduce-motion', reduce);
}

/** Create the fixed layers once. */
export function installLighting() {
  if (root) return;
  root = h('div.light-rig', { 'aria-hidden': 'true' },
    h('div.light-cone'),
    h('div.light-bloom'),
    h('div.light-vignette'),
    h('div.light-grain'),
  );
  const pressure = h('div.light-pressure', { 'aria-hidden': 'true' });
  document.body.append(pressure);
  dark = h('div.light-dark', { 'aria-hidden': 'true' });
  document.body.prepend(root);
  document.body.append(dark);
  dark.style.opacity = '0';
  setMood('idle');
}

export function setMood(name) {
  if (!root) return;
  current = name;
  const m = MOODS[name] ?? MOODS.idle;
  for (const [k, v] of Object.entries(m)) document.documentElement.style.setProperty(k, String(v));
  document.documentElement.dataset.mood = name;
}

export const getMood = () => current;

/** One bulb left: a red vignette closes in around the whole screen and breathes with the heartbeat. */
export function setPressure(on) {
  document.documentElement.classList.toggle('pressure', Boolean(on));
}

/** Black room, then the bulb stutters on. Resolves when it has settled. */
export async function lightsOn({ sound = true } = {}) {
  if (!dark) return;
  if (reduce || !dark.animate) {
    dark.style.opacity = '0';
    return;
  }
  dark.style.opacity = '1';
  if (sound) sfx.lightsOn();
  const frames = [
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: 0.12 },
    { opacity: 0.35, offset: 0.14 },
    { opacity: 1, offset: 0.2 },
    { opacity: 0.55, offset: 0.27 },
    { opacity: 1, offset: 0.31 },
    { opacity: 1, offset: 0.4 },
    { opacity: 0.15, offset: 0.42 },
    { opacity: 0.7, offset: 0.5 },
    { opacity: 0.1, offset: 0.58 },
    { opacity: 0.25, offset: 0.7 },
    { opacity: 0, offset: 1 },
  ];
  const anim = dark.animate(frames, { duration: 1100, easing: 'steps(1, end)', fill: 'forwards' });
  setTimeout(() => sound && sfx.flicker(), 150);
  setTimeout(() => sound && sfx.flicker(), 450);
  await anim.finished.catch(() => {});
  dark.style.opacity = '0';
  anim.cancel();
}

/**
 * The first time the game opens: a black room, a long buzz, then the bulb fights to come on. Several false starts,
 * a loud thunk, and it settles. About two seconds, and the title fades in as it does.
 */
export async function openingLights() {
  if (!dark) return;
  if (reduce || !dark.animate) { dark.style.opacity = '0'; return; }
  dark.style.opacity = '1';
  const frames = [
    [0, 1], [0.16, 1], [0.17, 0.45], [0.19, 1], [0.27, 1], [0.28, 0.6], [0.3, 1], [0.31, 0.3], [0.33, 1],
    [0.46, 1], [0.47, 0.2], [0.49, 0.9], [0.5, 0.1], [0.52, 0.85], [0.6, 0.85], [0.61, 0.35], [0.63, 0.7],
    [0.7, 0.7], [0.71, 0.05], [0.73, 0.6], [0.75, 0.0], [0.83, 0.0], [0.84, 0.25], [0.86, 0], [1, 0],
  ].map(([offset, opacity]) => ({ offset, opacity }));
  const anim = dark.animate(frames, { duration: 1800, easing: 'steps(1, end)', fill: 'forwards' });
  // the sounds line up with the false starts (they are silent until the browser lets the page play audio)
  [300, 500, 840, 910, 1100, 1510].forEach((t) => setTimeout(() => sfx.flicker(), t));
  setTimeout(() => sfx.lightsOn(), 1350);
  await anim.finished.catch(() => {});
  dark.style.opacity = '0';
  anim.cancel();
}

/** A one-shot flash of the whole room: 'good' warms it, 'bad' dips and reddens it. */
export function pulse(kind) {
  if (!root || reduce) return;
  const el = h('div.light-flash', { class: kind });
  document.body.append(el);
  el.animate(
    kind === 'good'
      ? [{ opacity: 0 }, { opacity: 0.35 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 0.5 }, { opacity: 0.1 }, { opacity: 0.4 }, { opacity: 0 }],
    { duration: kind === 'good' ? 520 : 650, easing: 'ease-out' },
  ).finished.finally(() => el.remove());
}

/** The room goes dark for a moment, then comes back (used when a bulb is lost). */
export async function blackout(ms = 900) {
  if (!dark || reduce || !dark.animate) return;
  const a = dark.animate([{ opacity: 0 }, { opacity: 0.92, offset: 0.12 }, { opacity: 0.85, offset: 0.6 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out' });
  await a.finished.catch(() => {});
}

/** Shake an element. */
export function shake(el) {
  if (reduce || !el?.animate) return;
  el.animate(
    [{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,2px)' }, { transform: 'translate(5px,-2px)' }, { transform: 'translate(-3px,1px)' }, { transform: 'translate(0,0)' }],
    { duration: 320, easing: 'ease-out' },
  );
}

/**
 * The boss loses its temper. `strength` 1 is an enrage, 2 is the House changing phase: the whole screen shakes hard, flashes red,
 * the lights cut out and stutter back, and the picture glitches for a few frames. Reduce motion gets one soft red pulse.
 */
export async function rageStorm(strength = 1) {
  const app = document.getElementById('app') ?? document.body;
  if (reduce) { pulse('bad'); return; }
  const n = strength >= 2 ? 14 : 9;
  const amp = strength >= 2 ? 16 : 10;
  const jitter = [{ transform: 'translate(0,0)' }];
  for (let i = 0; i < n; i++) jitter.push({ transform: `translate(${((Math.random() - 0.5) * 2 * amp * (1 - i / n)).toFixed(1)}px, ${((Math.random() - 0.5) * 2 * amp * 0.6 * (1 - i / n)).toFixed(1)}px) rotate(${((Math.random() - 0.5) * 1.2 * (1 - i / n)).toFixed(2)}deg)` });
  jitter.push({ transform: 'translate(0,0)' });
  app.animate?.(jitter, { duration: strength >= 2 ? 900 : 600, easing: 'linear' });
  // red strobes
  const flash = h('div.light-flash.rage');
  document.body.append(flash);
  const fr = [{ opacity: 0 }];
  for (let i = 0; i < (strength >= 2 ? 5 : 3); i++) fr.push({ opacity: 0.75 - i * 0.1 }, { opacity: 0.08 });
  fr.push({ opacity: 0 });
  flash.animate(fr, { duration: strength >= 2 ? 1100 : 800, easing: 'steps(1, end)' }).finished.finally(() => flash.remove());
  // the lights die and sputter back
  if (dark?.animate) {
    const f = [{ offset: 0, opacity: 0 }, { offset: 0.08, opacity: 0.95 }, { offset: 0.2, opacity: 0.1 }, { offset: 0.28, opacity: 0.9 }, { offset: 0.45, opacity: 0.95 }, { offset: 0.55, opacity: 0.3 }, { offset: 0.7, opacity: 0.85 }, { offset: 0.82, opacity: 0.2 }, { offset: 1, opacity: 0 }];
    dark.animate(f, { duration: strength >= 2 ? 1500 : 1000, easing: 'steps(1, end)' });
    [60, 330, 640].forEach((t) => setTimeout(() => sfx.flicker?.(), t));
  }
  // a few frames of glitch: hue flips and an inverted flicker
  if (app.animate) {
    app.animate([
      { filter: 'none', offset: 0 }, { filter: 'hue-rotate(160deg) saturate(2.5)', offset: 0.1 }, { filter: 'none', offset: 0.18 },
      { filter: 'invert(1) hue-rotate(180deg)', offset: 0.3 }, { filter: 'none', offset: 0.36 }, { filter: 'contrast(2) saturate(3)', offset: 0.6 }, { filter: 'none', offset: 0.68 }, { filter: 'none', offset: 1 },
    ], { duration: strength >= 2 ? 1100 : 700, easing: 'steps(1, end)' });
  }
}

/** A short random lights-out stutter, used now and then while a boss stays enraged. */
export function rageFlicker() {
  if (reduce || !dark?.animate) return;
  const a = dark.animate([{ opacity: 0, offset: 0 }, { opacity: 0.8, offset: 0.1 }, { opacity: 0.05, offset: 0.25 }, { opacity: 0.9, offset: 0.4 }, { opacity: 0, offset: 0.6 }, { opacity: 0, offset: 1 }], { duration: 420 + Math.random() * 300, easing: 'steps(1, end)' });
  sfx.flicker?.();
  return a.finished.catch(() => {});
}
