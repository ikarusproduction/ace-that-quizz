// Pack opening, built around a light bulb. Three taps: the bulb wakes up in the colour of the pack, buzzes harder,
// then overloads and shatters in the colour of the best card inside, which is the rarity colour. Reduce motion keeps
// the colours, sounds and the three taps and drops the shaking, flicker and flying glass.
import { h, sleep } from './dom.js';
import { sprite, spriteUrl } from './pixel.js';
import { sfx } from './audio.js';
import { burstAt, haptic, motionReduced } from './fx.js';
import { rarityFx } from './rarityfx.js';

export const PACK_LIGHT = { bronze: '#e0883c', silver: '#d6dde4', gold: '#ffd24a' };
export const RARITY_LIGHT = { common: '#e8e2d0', uncommon: '#7bd06a', rare: '#4f9bff', legendary: '#ffd24a' };

/**
 * Shows the ritual and resolves `taps` (a promise) when the player has tapped twice. Then call `overload(rarity)`.
 * The third tap is held until `finish` so the caller can open the pack in between.
 */
export function createBulbRite({ name, from, light }) {
  const reduced = () => motionReduced();
  const mask = `url("${spriteUrl('bulb_on')}")`;
  const img = sprite('bulb_on', 144);
  const tint = h('div.tint');
  tint.style.maskImage = mask; tint.style.webkitMaskImage = mask;
  const shell = h('div.shell', {}, img, tint);
  const bulb = h('button.rite-bulb', { type: 'button', 'aria-label': `Tap the bulb to open the ${name}` }, h('div.cord'), shell);
  const pips = [0, 1, 2].map(() => h('i'));
  const hint = h('p.rite-hint', { 'aria-live': 'polite' }, 'Tap the bulb 3 times');
  const ov = h('div.reveal-overlay.rite', { role: 'dialog', 'aria-label': name }, h('div.reveal-box', {}, h('div.tiny.dim', {}, from || 'New pack'), h('h2.rite-name', {}, name), bulb, h('div.rite-pips', {}, pips), hint));
  ov.style.setProperty('--c', light);
  ov.style.setProperty('--lvl', '0');
  let level = 0;
  let locked = false;
  let onTap = null;

  const setLevel = (n) => {
    level = n;
    ov.style.setProperty('--lvl', String(n));
    pips.forEach((p, i) => p.classList.toggle('on', i < n));
  };
  const center = () => { const r = shell.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 }; };
  const jolt = (px) => {
    if (reduced() || !bulb.animate) return;
    const a = (Math.random() < 0.5 ? -1 : 1) * px;
    bulb.animate([{ rotate: '0deg' }, { rotate: `${a}deg` }, { rotate: `${-a * 0.7}deg` }, { rotate: `${a * 0.35}deg` }, { rotate: '0deg' }], { duration: 650, easing: 'ease-out' });
  };
  const flicker = (steps) => {
    if (reduced() || !tint.animate) return;
    const frames = [];
    for (let i = 0; i < steps; i++) frames.push({ opacity: i % 2 ? 1 : 0.2 });
    frames.push({ opacity: 1 });
    tint.animate(frames, { duration: 120 * steps, easing: 'steps(1, end)' });
  };

  bulb.addEventListener('click', () => {
    if (locked) return;
    const n = level + 1;
    setLevel(n);
    const c = center();
    sfx.bulbTap?.(n);
    sfx.charge?.(n);
    if (n === 1) {
      hint.textContent = 'It is waking up. Again!';
      haptic('select');
      flicker(5); jolt(7);
      burstAt(c.x, c.y, { colors: [light, '#ffffff'], count: 8, spread: 60, gravity: 20, size: [3, 5] });
    } else if (n === 2) {
      hint.textContent = 'It is about to blow. Once more!';
      haptic('big');
      sfx.bulbBuzz?.();
      flicker(9); jolt(13);
      burstAt(c.x, c.y, { colors: [light, '#ffffff', '#fff2c4'], count: 16, spread: 90, gravity: 40, size: [3, 6] });
    } else {
      locked = true;
      hint.textContent = '';
    }
    onTap?.(n);
  });

  return {
    el: ov,
    /** Resolves once the second tap landed (the bulb is charged), then again on the third. */
    nextTap: () => new Promise((res) => { onTap = res; }),
    async overload(rarity) {
      const col = RARITY_LIGHT[rarity] ?? light;
      ov.style.setProperty('--c', col);
      const c = center();
      sfx.glass?.();
      haptic(rarity === 'legendary' ? 'jackpot' : 'big');
      if (!reduced()) {
        const flash = h('div.rite-flash', { style: { background: col } });
        document.body.append(flash);
        flash.animate([{ opacity: 0 }, { opacity: 0.95 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' }).finished.finally(() => flash.remove());
        shell.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.35)', filter: 'brightness(3)' }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
        await sleep(300);
        burstAt(c.x, c.y, { colors: [col, '#ffffff', '#cfd6dc', '#fff2c4'], count: 46, spread: 240, gravity: 260, size: [4, 10], duration: [800, 1500] });
      }
      rarityFx(rarity, { at: c, quiet: true });
      await sleep(reduced() ? 150 : 650);
    },
    close: () => ov.remove(),
    shake: () => jolt(10),
  };
}
