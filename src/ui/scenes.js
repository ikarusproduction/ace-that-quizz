// Animated backdrops for the Adventure. One scene per chapter; the step inside the chapter (its `phase`, 0 to 1)
// shifts the light and the hue, so every level looks a little different from the one before. The scenes are pure CSS
// (see the "scenes" block in styles.css); this file builds the elements and makes the floating props poppable.
import { h } from './dom.js';
import { Rng } from '../engine/rng.js';
import { burstAt, motionReduced } from './fx.js';
import { sfx } from './audio.js';

export const SCENE_COLORS = {
  bench: ['#6fe0c8', '#2a7f8c'], greenhouse: ['#b4e86b', '#4f9a45'], clinic: ['#8fe3ff', '#e86a7a'], workshop: ['#ffb347', '#d9772b'],
  observatory: ['#cfd8ff', '#7a8cff'], reactor: ['#7dffb0', '#2ee6d6'], fearlab: ['#c58cff', '#7a3fb0'], deep: ['#59d0ff', '#2a6fd0'],
  orbit: ['#ffd9a0', '#6fa8ff'], paradox: ['#ff7ad9', '#7a5cff'],
};

/**
 * Build a scene. `phase` is 0..1 inside the chapter; `arena` adds the red boss light. Props pop when touched.
 * Returns { el, set(sceneName, phase, arena), react('good'|'bad') }.
 */
export function createScene() {
  const el = h('div.scene', { 'aria-hidden': 'true' });
  let name = null; let seedKey = '';
  const build = (scene, step) => {
    const rng = Rng.fromSeed(`scene:${scene}:${step}`);
    const n = 16;
    const props = Array.from({ length: n }, (_, i) => h('i.pt', {
      class: `pt${i % 4}`,
      style: { '--x': `${rng.int(100)}%`, '--y': `${10 + rng.int(80)}%`, '--s': `${6 + rng.int(14)}px`, '--d': `${6 + rng.int(9)}s`, '--dl': `${-rng.int(12)}s`, '--dx': `${rng.int(60) - 30}px` },
      onpointerdown: (e) => pop(e, scene, i),
    }));
    el.replaceChildren(h('div.sc-sky'), h('div.sc-far'), h('div.sc-mid'), h('div.sc-near'), h('div.sc-fx'), ...props);
  };
  function pop(e, scene, i) {
    const t = e.currentTarget; if (t.classList.contains('popped')) return;
    t.classList.add('popped'); sfx.tick?.();
    const [c1, c2] = SCENE_COLORS[scene] ?? ['#fff', '#aaa'];
    if (!motionReduced()) burstAt(e.clientX, e.clientY, { colors: [c1, c2, '#fff'], count: 10, spread: 70, gravity: 60, size: [3, 6], duration: [300, 600] });
    setTimeout(() => t.classList.remove('popped'), 2200 + (i % 5) * 300);
  }
  return {
    el,
    set(scene, phase = 0, { arena = false, step = 1 } = {}) {
      const key = `${scene}:${step}`;
      if (scene !== name || key !== seedKey) { name = scene; seedKey = key; el.className = `scene sc-${scene}`; build(scene, step); }
      el.classList.toggle('arena', Boolean(arena));
      el.style.setProperty('--ph', String(phase));
      const [c1, c2] = SCENE_COLORS[scene] ?? ['#fff', '#aaa'];
      el.style.setProperty('--c1', c1); el.style.setProperty('--c2', c2);
    },
    /** A short flash of light (right) or a dimming shake (wrong). */
    react(kind) {
      el.classList.remove('r-good', 'r-bad'); void el.offsetWidth;
      el.classList.add(kind === 'good' ? 'r-good' : 'r-bad');
    },
  };
}
