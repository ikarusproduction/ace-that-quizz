// A boss is a pixel-art body plus separate moving parts (arms, jaws, horns, shutters), glowing red eyes that
// blink and look around, and a slow creeping idle. Each part is a CSS-animated image, so the whole rig costs
// nothing to run and stops completely under Reduce motion.
import { h } from './dom.js';
import { sprite, hasSprite } from './pixel.js';
import { RIGS } from './art_bosses.js';
import { sfx } from './audio.js';
import { motionReduced } from './fx.js';

const CELLS = 32;

function partImg(name, w, h2, k) {
  const img = sprite(name, 8, '');
  img.width = Math.round(w * k);
  img.height = Math.round(h2 * k);
  return img;
}

/**
 * @param {string} name   sprite name of the body, e.g. 'boss_static'
 * @param {number} px     rendered size of the 32-cell body (use a multiple of 32 for crisp pixels)
 * @param {string} alt    accessible name
 * @returns {{ el: HTMLElement, ring(): void, setEnraged(on: boolean): void, setDread(on: boolean): void }}
 */
export function createRig(name, px, alt = '') {
  const rig = RIGS[name];
  if (!rig) {
    const plain = h('div.rig.plain', { style: { width: `${px}px`, height: `${px}px` } }, sprite(hasSprite(name) ? name : 'star', px, alt));
    return { el: plain, ring() {}, overTop: 0, overBottom: 0, setEnraged() {}, setDread() {} };
  }
  const k = px / CELLS;
  const body = sprite(name, px, alt);
  body.classList.add('rig-body');
  const el = h('div.rig', { style: { width: `${px}px`, height: `${px}px`, '--k': `${k}px` } });
  const bells = [];
  const parts = rig.parts.map((p) => {
    const dir = p.flip ? -1 : 1;
    const wrap = h('div.part', {
      class: `a-${p.a}${p.flip ? ' flip' : ''}${p.rev ? ' rev' : ''}`,
      style: {
        left: `${p.x * k}px`, top: `${p.y * k}px`, width: `${Math.round(p.w * k)}px`, height: `${Math.round(p.h * k)}px`,
        transformOrigin: p.o ?? '50% 50%', zIndex: String(p.z ?? 1), '--amp': `${p.amp ?? 10}deg`, '--ampk': `${(p.amp ?? 4) * k * 0.4}px`,
        '--dur': `${p.dur ?? 3}s`, '--delay': `${p.delay ?? 0}s`, '--dir': String(dir),
      },
    }, partImg(p.s, p.w, p.h, k));
    if (p.bell) bells.push(wrap);
    return wrap;
  });
  const behind = parts.filter((_, i) => (rig.parts[i].z ?? 1) < 0);
  const front = parts.filter((_, i) => (rig.parts[i].z ?? 1) >= 0);
  el.append(...behind, body, ...front);

  // the eyes: red, slit, glowing, blinking and drifting
  rig.eyes.forEach((e, i) => {
    const eye = h('div.eye', { style: { left: `${e.x * k}px`, top: `${e.y * k}px`, width: `${5 * k}px`, height: `${4 * k}px`, '--look-delay': `${i * -1.3}s` } }, sprite('eye_red', 5 * k));
    eye.firstChild.width = 5 * k; eye.firstChild.height = 4 * k;
    el.append(eye);
  });

  if (rig.smoke) {
    const sm = h('div.smoke', { style: { left: `${rig.smoke.x * k}px`, top: `${rig.smoke.y * k}px`, '--k': `${k}px` } });
    for (let i = 0; i < 4; i++) sm.append(h('i', { style: { animationDelay: `${-i * 1.1}s` } }));
    el.append(sm);
  }

  const overTop = Math.max(0, -Math.min(0, ...rig.parts.map((p) => p.y))) * k;
  const overBottom = Math.max(0, Math.max(32, ...rig.parts.map((p) => p.y + p.h)) - 32) * k;
  let timer = null;
  const ring = () => {
    if (motionReduced()) return;
    for (const b of bells) { b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring'); }
  };
  if (rig.bells && !motionReduced()) {
    // the bells on the jester's hat jingle every so often, quietly
    timer = setInterval(() => {
      if (!el.isConnected) { clearInterval(timer); return; }
      ring();
      sfx.bell(3 + Math.floor(Math.random() * 3), 0.035);
    }, 2400 + Math.random() * 900);
  }
  return {
    el, ring, overTop, overBottom,
    setEnraged: (on) => el.classList.toggle('enraged', on),
    setDread: (on) => el.classList.toggle('dread', on),
  };
}
