// The "juice": haptics, confetti, coin showers, floating hype text and a
// slot-machine reel. All of it respects the Reduce motion and Sound settings
// and degrades silently where an API (vibration, WebAudio) is missing.
import { h, sleep } from './dom.js';
import { sfx } from './audio.js';

let hapticsOn = true;
let reduce = false;
export function configureFx({ haptics, reduceMotion }) {
  hapticsOn = haptics !== false;
  reduce = Boolean(reduceMotion);
}

export const motionReduced = () => reduce;

const PATTERNS = {
  tap: 8,
  select: 12,
  correct: [18, 40, 28],
  wrong: [90, 40, 140],
  timeout: [200],
  big: [30, 30, 30, 30, 90],
  jackpot: [40, 40, 40, 40, 40, 40, 160],
  tick: 5,
  reel: 14,
  warn: [60, 30, 60],
};
/** Vibrate with a named pattern. Does nothing on devices without vibration (iOS Safari, desktops). */
export function haptic(name) {
  if (!hapticsOn || !PATTERNS[name]) return false;
  try {
    return Boolean(navigator.vibrate?.(PATTERNS[name]));
  } catch {
    return false;
  }
}

/** One raw buzz of `ms` milliseconds (used for the pack-opening hold). */
export function buzz(ms) {
  if (!hapticsOn) return false;
  try { return Boolean(navigator.vibrate?.(Math.max(1, Math.round(ms)))); } catch { return false; }
}

const COLORS = ['#e8a33d', '#6fa86b', '#b3261e', '#e8e2d0', '#f6d77f', '#d9772b'];
let layer = null;
function fxLayer() {
  if (!layer || !layer.isConnected) {
    layer = h('div.fx-layer', { 'aria-hidden': 'true' });
    document.body.append(layer);
  }
  return layer;
}

/** Square pixel confetti falling from the top. */
export function confetti({ count = 60, duration = 1800 } = {}) {
  if (reduce) return;
  const l = fxLayer();
  const w = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const size = 6 + Math.floor(Math.random() * 3) * 3;
    const p = h('i.confetti', { style: { left: `${Math.random() * w}px`, top: '-14px', width: `${size}px`, height: `${size}px`, background: COLORS[i % COLORS.length] } });
    l.append(p);
    const dx = (Math.random() - 0.5) * 160;
    const t = duration * (0.7 + Math.random() * 0.6);
    p.animate(
      [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: `translate(${dx}px, ${window.innerHeight + 40}px) rotate(${Math.random() * 720}deg)`, opacity: 1 }],
      { duration: t, easing: 'cubic-bezier(.3,.1,.6,1)', delay: Math.random() * 250 },
    ).finished.then(() => p.remove()).catch(() => p.remove());
  }
}

/** Pixel particles bursting out of a point (hits, shards, explosions). */
export function burstAt(x, y, { colors = COLORS, count = 18, spread = 140, gravity = 120, size = [4, 9], duration = [500, 900], up = 0 } = {}) {
  if (reduce) return;
  const l = fxLayer();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = spread * (0.4 + Math.random() * 0.8);
    const sz = size[0] + Math.floor(Math.random() * (size[1] - size[0] + 1));
    const p = h('i.confetti', { style: { left: `${x}px`, top: `${y}px`, width: `${sz}px`, height: `${sz}px`, marginLeft: `${-sz / 2}px`, marginTop: `${-sz / 2}px`, background: colors[i % colors.length] } });
    l.append(p);
    const dx = Math.cos(a) * sp;
    const dy = Math.sin(a) * sp - up;
    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 1.15}px, ${dy + gravity}px) rotate(${Math.random() * 540}deg)`, opacity: 0 },
      ],
      { duration: duration[0] + Math.random() * (duration[1] - duration[0]), easing: 'cubic-bezier(.1,.7,.4,1)' },
    ).finished.then(() => p.remove()).catch(() => p.remove());
  }
}

/** Coins that burst upward from an element and fall back. */
export function coinBurst(anchor, n = 10) {
  if (reduce) return;
  const r = anchor?.getBoundingClientRect?.() ?? { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const l = fxLayer();
  for (let i = 0; i < n; i++) {
    const c = h('i.coin', { style: { left: `${cx}px`, top: `${cy}px` } });
    l.append(c);
    const dx = (Math.random() - 0.5) * 220;
    const up = 90 + Math.random() * 130;
    c.animate(
      [
        { transform: 'translate(0,0)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${-up}px)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${60 + Math.random() * 80}px)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 400, easing: 'ease-in', delay: i * 28 },
    ).finished.then(() => c.remove()).catch(() => c.remove());
  }
}

/** Big comic text that stamps onto the screen ("COMBO x3!", "JACKPOT!"). */
export function stamp(text, { kind = 'good', ms = 1100 } = {}) {
  const el = h('div.stamp', { class: kind }, text);
  document.body.append(el);
  if (reduce) {
    setTimeout(() => el.remove(), ms);
    return;
  }
  el.animate(
    [
      { transform: 'translate(-50%,-50%) scale(2.6) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1) rotate(-4deg)', opacity: 1, offset: 0.22 },
      { transform: 'translate(-50%,-52%) scale(1.06) rotate(-4deg)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%,-70%) scale(1) rotate(-4deg)', opacity: 0 },
    ],
    { duration: ms, easing: 'ease-out' },
  ).finished.finally(() => el.remove());
}

/** Quick cheer for a given streak count. */
export function streakHype(streak) {
  if (streak < 2) return;
  sfx.combo(streak);
  haptic(streak >= 5 ? 'big' : 'correct');
  const words = ['', '', 'COMBO x2', 'COMBO x3!', 'ON FIRE x4!', 'UNSTOPPABLE x5!!'];
  stamp(words[Math.min(streak, 5)] + (streak > 5 ? ` (x${streak})` : ''), { kind: 'good' });
  if (streak >= 4) confetti({ count: 40 });
}

/**
 * A slot-machine reel. `items` are { key, node(): Node }. Spins, then settles on `target` key.
 * Resolves with the key it stopped on.
 */
export async function spinReel(box, items, targetKey, { ms = 1200 } = {}) {
  const idx = Math.max(0, items.findIndex((i) => i.key === targetKey));
  if (reduce) {
    box.replaceChildren(items[idx].node());
    return items[idx].key;
  }
  const start = performance.now();
  let i = Math.floor(Math.random() * items.length);
  let delay = 55;
  while (performance.now() - start < ms) {
    i = (i + 1) % items.length;
    box.replaceChildren(items[i].node());
    box.classList.add('spinning');
    sfx.spin();
    haptic('tick');
    await sleep(delay);
    delay = Math.min(210, delay * 1.07);
  }
  box.classList.remove('spinning');
  box.replaceChildren(items[idx].node());
  sfx.reelStop();
  haptic('reel');
  box.animate?.([{ transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
  return items[idx].key;
}
