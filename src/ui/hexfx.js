// Screen effects for hex cards: ink wipe, goo drip, quake, blur, flip. Everything honours Reduce motion
// (no movement; ink and goo are lighter and fade on their own) and nothing flashes.
import { h } from './dom.js';
import { sfx } from './audio.js';
import { haptic } from './fx.js';

let reduce = false;
export const configureHexFx = ({ reduceMotion }) => { reduce = Boolean(reduceMotion); };

let layer = null;
function hexLayer() {
  if (!layer || !layer.isConnected) {
    layer = h('div.hex-layer', { 'aria-hidden': 'true' });
    document.body.append(layer);
  }
  return layer;
}
export function clearHexFx() {
  layer?.replaceChildren();
  document.body.classList.remove('hex-quake');
}

function blots(color, n, { drip = false } = {}) {
  const w = window.innerWidth; const hgt = window.innerHeight;
  return Array.from({ length: n }, (_, i) => {
    const size = 90 + Math.random() * 140;
    return h('i.hex-blot', {
      class: drip ? 'goo' : 'ink',
      style: {
        left: `${Math.random() * (w - size * 0.6)}px`, top: `${Math.random() * (hgt * 0.7)}px`, width: `${size}px`, height: `${size * (0.8 + Math.random() * 0.4)}px`,
        background: color, animationDelay: reduce ? '0s' : `${i * 70}ms`,
        borderRadius: `${40 + Math.random() * 20}% ${40 + Math.random() * 20}% ${40 + Math.random() * 20}% ${40 + Math.random() * 20}%`,
      },
    });
  });
}

/**
 * Splash the screen for a list of effects ("ink","goo","quake","blur","flip").
 * Ink: blots you wipe away by touching them (they also fade by themselves).
 * Goo: slime that drips off after a few seconds. Quake: a gentle shake. Blur/flip are CSS classes on the question.
 */
export function splash(effects) {
  const l = hexLayer();
  if (effects.includes('ink')) {
    sfx.wrong?.(); haptic('big');
    const bs = blots('#0b0c0d', reduce ? 4 : 9);
    for (const b of bs) {
      const wipe = () => { b.classList.add('gone'); setTimeout(() => b.remove(), 250); haptic('tap'); };
      b.addEventListener('pointerdown', wipe);
      b.addEventListener('pointerenter', (e) => { if (e.buttons) wipe(); });
      l.append(b);
      setTimeout(() => b.classList.add('gone'), reduce ? 2500 : 9000);
      setTimeout(() => b.remove(), reduce ? 2800 : 9300);
    }
  }
  if (effects.includes('goo')) {
    sfx.card?.(); haptic('select');
    const bs = blots('#6fa86b', reduce ? 3 : 6, { drip: true });
    for (const b of bs) { l.append(b); setTimeout(() => b.classList.add('gone'), reduce ? 2500 : 7000); setTimeout(() => b.remove(), reduce ? 2800 : 7400); }
  }
  if (effects.includes('quake') && !reduce) {
    document.body.classList.add('hex-quake');
    haptic('warn');
    setTimeout(() => document.body.classList.remove('hex-quake'), 2400);
  }
}

/** Classes applied to the question screen for lasting effects. Returns attrs for the choices wrapper. */
export function lastingClasses(effects) {
  return { flip: effects.includes('flip'), blur: effects.includes('blur') };
}

/** First tap on a blurred area focuses it instead of answering. */
export function unblurOnFirstTap(el) {
  const handler = (e) => { e.stopPropagation(); e.preventDefault(); el.classList.remove('hex-blur'); el.removeEventListener('click', handler, true); };
  el.addEventListener('click', handler, true);
}
