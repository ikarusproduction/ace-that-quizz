// Reusable UI pieces shared by every screen.
import { h } from './dom.js';
import { COSMETICS } from '../engine/cosmetics.js';
import { sprite, AVATAR_SPRITES, CATEGORY_SPRITES } from './pixel.js';
import { CARDS, RARITY_ORDER } from '../engine/cards.js';
import { CATEGORIES, DIFFICULTIES } from '../engine/bank.js';
import { sfx } from './audio.js';
import { HEXES } from '../engine/hexes.js';

const FX_COUNT = { bubbles: 7, embers: 9, snow: 9, sparkle: 8, static: 6, confetti: 10, ghosts: 5 };

/**
 * A portrait. With a profile it wears the wardrobe: a frame that lights the face, an animated background, a hat that
 * moves, and a particle effect around it. Big portraits (36px and up) get the particles; small ones stay still and cheap.
 */
export function avatar(profileOrKey, px = 48) {
  const key = typeof profileOrKey === 'string' ? profileOrKey : profileOrKey?.avatar?.key;
  const name = AVATAR_SPRITES.includes(key) ? key : AVATAR_SPRITES[0];
  const eq = typeof profileOrKey === 'object' ? profileOrKey?.cos?.equipped : null;
  const body = sprite(name, px);
  if (eq?.tint && COSMETICS[eq.tint]?.filter) body.style.filter = COSMETICS[eq.tint].filter;
  const frame = eq?.frame && COSMETICS[eq.frame] ? eq.frame.slice(3) : '';
  const bg = eq?.bg && COSMETICS[eq.bg] ? eq.bg.slice(3) : '';
  const fx = eq?.fx && COSMETICS[eq.fx] ? eq.fx.slice(3) : '';
  const hatId = eq?.hat && COSMETICS[eq.hat] ? eq.hat.slice(3) : '';
  const size = px + 12;
  const inner = [h('span.av-bg', { 'aria-hidden': 'true' }), body];
  if (hatId) { const hat = sprite(COSMETICS[eq.hat].sprite, px); hat.classList.add('av-hat', `hat-${hatId}`); inner.push(hat, h('span', { class: `av-hatfx hatfx-${hatId}`, 'aria-hidden': 'true' })); }
  if (frame || bg) inner.push(h('span.av-light', { 'aria-hidden': 'true' }));
  if (frame) inner.push(h('span.av-ring', { 'aria-hidden': 'true' }));
  const face = h('span.avatar', {}, ...inner);
  const cls = ['av-wrap', frame ? `fr-${frame}` : '', bg ? `bg-${bg}` : '', fx ? `fx-${fx}` : ''].filter(Boolean).join('.');
  const kids = [];
  if (frame) kids.push(h('span.av-halo', { 'aria-hidden': 'true' }));
  kids.push(face);
  if (fx && size >= 44) kids.push(h('span.av-fx', { 'aria-hidden': 'true' }, Array.from({ length: FX_COUNT[fx] ?? 6 }, (_, i) => h('i', { style: { '--i': i } }))));
  return h(`span.${cls}`, { style: { width: `${size}px`, height: `${size}px`, '--px': `${size}px`, '--glow': frame ? COSMETICS[eq.frame].glow : '' } }, ...kids);
}

export function categoryIcon(key, px = 20) {
  return sprite(CATEGORY_SPRITES[key] ?? 'star', px);
}

export function categoryTag(key) {
  return h('span.tag', {}, categoryIcon(key, 16), CATEGORIES[key]?.short ?? key);
}

export function diffPips(level) {
  return h('span.diff-pips', { title: DIFFICULTIES[level], 'aria-label': `Difficulty: ${DIFFICULTIES[level]}` }, [1, 2, 3, 4].map((i) => h('i', { class: i <= level ? 'on' : '' })));
}

export function chipsLine(n, { sign = false, cls = '' } = {}) {
  const txt = sign ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}` : String(n);
  return h('span.chips-line', { class: cls }, sprite('chip', 16), txt);
}

export function bulbs(strikes, max = 3) {
  const shown = Math.max(max, strikes);
  return h('span.bulbs', { 'aria-label': `${strikes} bulbs left` }, Array.from({ length: shown }, (_, i) => sprite(i < strikes ? 'bulb_on' : 'bulb_off', 24)));
}

const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
const rarityTagClass = { common: '', uncommon: 'green', rare: 'blue', legendary: 'amber' };
export const rarityLabel = (r) => RARITY_LABEL[r] ?? r;
export const rarityRank = (id) => RARITY_ORDER.indexOf(CARDS[id]?.rarity);

/** Full card tile. opts: { charges, locked, selected, onclick, disabled, compact } */
export function cardTile(id, opts = {}) {
  const c = CARDS[id] ?? HEXES[id];
  if (!c) return h('div');
  const tag = h('span.tag', { class: rarityTagClass[c.rarity] }, rarityLabel(c.rarity));
  const when = HEXES[id] ? (c.kind === 'defense' ? 'Hex · shield' : c.targets === 'rival' ? 'Hex · rival' : 'Hex · you or a rival') : c.kind === 'attack' ? 'Attack · Versus' : c.timing === 'pre-stake' ? 'Before staking' : c.timing === 'run' ? 'Once per run' : 'During question';
  const body = [
    h('div.row', { style: { gap: '8px' } }, sprite(c.icon, 32), h('span.nm', {}, c.name)),
    opts.compact ? null : h('div.tx', {}, c.text),
    opts.compact ? null : h('div.dr', {}, `Drawback: ${c.drawback}`),
    h('div.foot', {}, tag, opts.compact ? null : h('span.tiny.mute', {}, when), opts.charges != null ? h('span.uses', {}, `×${opts.charges}`) : null),
  ];
  const el = h('button.card-tile', {
    class: [c.rarity, opts.locked ? 'locked' : '', opts.selected ? 'sel' : '', opts.disabled ? 'used' : ''].join(' '),
    type: 'button',
    disabled: opts.disabled || (!opts.onclick && !opts.interactive),
    'aria-pressed': opts.selected == null ? null : String(Boolean(opts.selected)),
    onclick: opts.onclick ? () => { sfx.card(); opts.onclick(id); } : null,
    title: `${c.name}: ${c.text} Drawback: ${c.drawback}`,
  }, body);
  return el;
}

export function emptySlot(label = 'Empty slot', onclick) {
  return h('button.card-tile.empty', { type: 'button', onclick, disabled: !onclick }, h('span.tiny', {}, label));
}

/* ---------------------------------------------------------------- modal */

let toastBox = null;
export function toast(message, kind = '') {
  if (!toastBox) {
    toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const el = h('div.toast', { class: kind }, message);
  toastBox.append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2800);
}

/** Show a modal and resolve with whatever `done(value)` is called with. */
export function modal(build, { dismissible = true } = {}) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) close(undefined);
    };
    const box = h('div.modal-box', { role: 'dialog', 'aria-modal': 'true' });
    const overlay = h('div.modal', { onclick: (e) => e.target === overlay && dismissible && close(undefined) }, box);
    box.append(...[].concat(build(close)));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    (box.querySelector('[autofocus], input, button') ?? box).focus?.();
  });
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, requireText = null }) {
  return modal((close) => {
    let input = null;
    const ok = h('button.btn.block', { class: danger ? 'danger' : 'primary', type: 'button', onclick: () => close(true), disabled: Boolean(requireText) }, confirmLabel);
    if (requireText) {
      input = h('input', { type: 'text', placeholder: requireText, 'aria-label': `Type ${requireText} to confirm`, autocomplete: 'off', oninput: () => { ok.disabled = input.value.trim().toLowerCase() !== requireText.toLowerCase(); } });
    }
    return [
      h('h2', {}, title),
      ...[].concat(body).map((b) => (typeof b === 'string' ? h('p', {}, b) : b)),
      requireText ? h('label.field', {}, h('span', {}, `Type "${requireText}" to confirm`), input) : null,
      ok,
      h('button.btn.block.ghost', { type: 'button', onclick: () => close(false) }, cancelLabel),
    ];
  }).then((v) => v === true);
}

export function infoDialog(title, body, label = 'OK') {
  return modal((close) => [h('h2', {}, title), ...[].concat(body).map((b) => (typeof b === 'string' ? h('p', {}, b) : b)), h('button.btn.primary.block', { type: 'button', onclick: () => close(true) }, label)]);
}

export function floatText(text, kind, anchor) {
  const rect = anchor?.getBoundingClientRect?.();
  const el = h('div.float', { class: kind, style: { top: `${Math.max(80, (rect?.top ?? 260) + 20)}px` } }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
}

export function backButton(onclick) {
  return h('button.btn.icon.ghost.back', { type: 'button', 'aria-label': 'Back', onclick: () => { sfx.tap(); onclick(); } }, '←');
}

export function screenHeader(title, onBack, right = null) {
  return h('div.topbar', {}, onBack ? backButton(onBack) : null, h('h2', {}, title), right);
}

export function pct(x, digits = 0) {
  return x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`;
}
export function secs(ms) {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}
