// The bulb on the title screen is a toy. Tap it and it flickers, buzzes and your phone vibrates. Hammer it and it
// breaks: it folds up on its cord and the room goes dark. After a few seconds it stutters back on by itself.
import { h } from './dom.js';
import { sprite } from './pixel.js';
import { sfx } from './audio.js';
import { burstAt, haptic, motionReduced } from './fx.js';
import { setMood, blackout } from './lighting.js';

const WINDOW_MS = 1700;
const BREAK_AT = 7;
const REPAIR_MS = 6500;

export function interactiveBulb({ intro = false } = {}) {
  const on = sprite('bulb_on', 64);
  on.classList.add('b-on');
  const off = sprite('bulb_off', 64);
  off.classList.add('b-off');
  const wrap = h('div.bulb-wrap', {}, off, on);
  const hint = h('span.bulb-hint', { 'aria-hidden': 'true' }, 'tap the light');
  const btn = h('button.hang.bulb-btn', { type: 'button', class: intro ? 'intro' : '', 'aria-label': 'The light bulb. Tap it to make it flicker.' }, h('div.cord'), wrap, hint);
  let taps = [];
  let broken = false;
  let timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if (btn.isConnected) fn(); }, ms); timers.push(t); return t; };
  const center = () => { const r = on.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  const kick = (deg) => {
    if (motionReduced() || !btn.animate) return;
    const a = (Math.random() < 0.5 ? -1 : 1) * deg;
    btn.animate([{ rotate: '0deg' }, { rotate: `${a}deg` }, { rotate: `${-a * 0.65}deg` }, { rotate: `${a * 0.3}deg` }, { rotate: '0deg' }], { duration: 900, easing: 'ease-out' });
  };
  const stutter = (n) => {
    if (motionReduced() || !on.animate) return;
    const frames = [];
    for (let i = 0; i < n; i++) frames.push({ opacity: i % 2 ? 1 : 0.15 });
    frames.push({ opacity: 1 });
    on.animate(frames, { duration: 90 * n, easing: 'steps(1, end)' });
  };

  const breakBulb = () => {
    broken = true;
    btn.classList.add('broken');
    sfx.bulbBreak?.();
    haptic('big');
    const c = center();
    burstAt(c.x, c.y, { colors: ['#fff2c4', '#ffd98a', '#e8a33d', '#cfd6dc'], count: 26, spread: 130, gravity: 220, size: [3, 7] });
    setMood('out');
    blackout(700);
    taps = [];
    later(repair, REPAIR_MS);
  };

  const repair = () => {
    btn.classList.add('repairing');
    sfx.bulbBack?.();
    haptic('select');
    later(() => {
      btn.classList.remove('broken', 'repairing');
      broken = false;
      setMood('idle');
      stutter(8);
    }, motionReduced() ? 0 : 520);
  };

  btn.addEventListener('click', () => {
    if (broken) { sfx.tap?.(); haptic('tick'); kick(2); return; }
    btn.classList.remove('hint-on');
    const now = performance.now();
    taps = taps.filter((t) => now - t < WINDOW_MS);
    taps.push(now);
    const n = taps.length;
    sfx.bulbTap?.(n);
    haptic(n >= 5 ? 'warn' : 'tap');
    kick(4 + n * 2.5);
    stutter(3 + n);
    if (n >= 3) sfx.bulbBuzz?.();
    if (n >= 4 && !motionReduced()) blackout(160 + n * 10);
    if (n >= 3) { const c = center(); burstAt(c.x, c.y + 6, { colors: ['#fff7d6', '#ffd24a', '#ff9a3c'], count: 4 + n * 2, spread: 50 + n * 8, gravity: 30, size: [2, 4] }); }
    if (n >= BREAK_AT) breakBulb();
  });

  // a faint hint the first time the title has been sitting there for a while
  later(() => btn.classList.add('hint-on'), 5200);
  later(() => btn.classList.remove('hint-on'), 9800);
  btn.dispose = () => timers.forEach(clearTimeout);
  return btn;
}
