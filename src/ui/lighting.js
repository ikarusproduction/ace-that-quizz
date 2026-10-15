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
