// Rarity juice: the better the card, the bigger the sound, glow and particle burst.
// Reduce motion keeps the sound and a soft static glow but drops particles and movement. Nothing flashes.
import { h, sleep } from './dom.js';
import { sfx } from './audio.js';
import { haptic, motionReduced } from './fx.js';
import { cardTile } from './components.js';
import { HEXES } from '../engine/hexes.js';
import { CARDS } from '../engine/cards.js';

export const RARITY_COLORS = {
  common: ['#e8e2d0', '#8a9096'],
  uncommon: ['#6fa86b', '#b8e0b3', '#3f6b44'],
  rare: ['#4a7bb0', '#9cc2ee', '#e8e2d0'],
  legendary: ['#e8a33d', '#f6d77f', '#fbf8ee', '#d9772b'],
};
const COUNT = { common: 14, uncommon: 28, rare: 52, legendary: 110 };

let layer = null;
function rarityLayer() {
  if (!layer || !layer.isConnected) {
    layer = h('div.rarity-layer', { 'aria-hidden': 'true' });
    document.body.append(layer);
  }
  return layer;
}

/** Sound, vibration, particles and a soft glow for one reveal. `at` is the burst centre in viewport pixels. */
export function rarityFx(rarity = 'common', { at, quiet = false } = {}) {
  if (!quiet) { sfx.rarity?.(rarity); haptic(rarity === 'legendary' ? 'jackpot' : rarity === 'rare' ? 'big' : rarity === 'uncommon' ? 'correct' : 'select'); }
  const l = rarityLayer();
  const colors = RARITY_COLORS[rarity] ?? RARITY_COLORS.common;
  const glow = h('i.rarity-glow', { class: rarity, style: { background: `radial-gradient(circle at ${at ? `${at.x}px ${at.y}px` : '50% 45%'}, ${colors[0]}55, transparent 60%)` } });
  l.append(glow);
  setTimeout(() => glow.remove(), motionReduced() ? 900 : 1400);
  if (motionReduced()) return;
  const cx = at?.x ?? window.innerWidth / 2; const cy = at?.y ?? window.innerHeight * 0.42;
  const n = COUNT[rarity] ?? 14;
  for (let i = 0; i < n; i++) {
    const size = 4 + Math.floor(Math.random() * 3) * 3;
    const ang = Math.random() * Math.PI * 2;
    const dist = (rarity === 'legendary' ? 140 : 80) + Math.random() * (rarity === 'legendary' ? 240 : 120);
    const p = h('i.rarity-bit', { style: { left: `${cx}px`, top: `${cy}px`, width: `${size}px`, height: `${size}px`, background: colors[i % colors.length] } });
    l.append(p);
    const dur = 700 + Math.random() * 700;
    p.animate(
      [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 60}px) rotate(${Math.random() * 540}deg) scale(.4)`, opacity: 0 }],
      { duration: dur, easing: 'cubic-bezier(.15,.7,.4,1)' },
    ).finished.then(() => p.remove()).catch(() => p.remove());
  }
  if (rarity === 'legendary') { document.body.classList.add('legend-shake'); setTimeout(() => document.body.classList.remove('legend-shake'), 500); }
}

/** A full-screen card reveal. Tap to continue. Resolves when dismissed. */
export async function cardReveal(id, { title = 'New card', sub = '' } = {}) {
  const c = HEXES[id] ?? CARDS[id];
  if (!c) return;
  const done = new Promise((res) => {
    const tile = cardTile(id, { interactive: false });
    const box = h('div.reveal-box', { class: c.rarity }, h('div.tiny.dim', {}, title), h('div.reveal-card', {}, tile), h('div.reveal-rarity', { class: c.rarity }, c.rarity), sub ? h('p.small.dim', {}, sub) : null, h('button.btn.primary', { type: 'button', onclick: () => { ov.remove(); res(); } }, 'Nice'));
    const ov = h('div.reveal-overlay', { role: 'dialog', 'aria-label': title }, box);
    document.body.append(ov);
    sleep(160).then(() => rarityFx(c.rarity));
  });
  return done;
}
