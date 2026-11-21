// Small DOM helpers and the shared bits of interface: avatars, hearts, toasts, banners, confetti.
import { characterById } from '../shared/characters.js';
import { RULES } from '../shared/rules.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function avatar(characterId, { size, off, badge, cls } = {}) {
  const c = characterById(characterId);
  return h('div', { class: `avatar ${off ? 'off' : ''} ${cls ?? ''}`, style: { '--c': c.color, ...(size ? { '--s': `${size}px` } : {}) }, title: c.name },
    c.emoji, badge ? h('span', { class: 'badge' }, badge) : null);
}

export function hearts(hp, max = RULES.maxHp) {
  const wrap = h('div', { class: 'hearts', 'aria-label': `${hp} points de vie sur ${max}` });
  for (let i = 0; i < max; i++) wrap.append(h('span', { class: `h ${i < hp ? '' : 'empty'}` }, '❤️'));
  return wrap;
}

export function toast(text, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, text);
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 2900);
}

export function banner(text, sub) {
  const b = h('div', { class: 'banner' }, text, sub ? h('small', {}, sub) : null);
  document.body.append(b);
  setTimeout(() => b.remove(), 1900);
}

/** Full-screen moment (drink, K.O., crown). Tap to close early. */
export function bigMoment({ cls = '', emoji, t1, t2, t3, ms = 2600 }) {
  const el = h('div', { class: `big-hit ${cls}`, onclick: () => el.remove() },
    emoji ? h('div', { class: 'emoji' }, emoji) : null,
    h('div', { class: 't1' }, t1),
    t2 ? h('div', { class: 't2' }, t2) : null,
    t3 ? h('div', { class: 't3' }, t3) : null);
  document.getElementById('overlays').append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

/** Confetti burst on a throwaway canvas. */
export function confetti(n = 90, colors = ['#ff3d9a', '#21d4e8', '#ffc93c', '#2fd38a', '#a65bff', '#fff6e4']) {
  const c = h('canvas', { style: { position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 80 } });
  document.body.append(c);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth;
  const H = innerHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: n }, () => ({
    x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.45,
    vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 12,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 8, hh: 4 + Math.random() * 6, col: colors[(Math.random() * colors.length) | 0],
  }));
  let t = 0;
  (function f() {
    t++;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.hh / 2, p.w, p.hh);
      ctx.restore();
    }
    if (t < 160) requestAnimationFrame(f); else c.remove();
  })();
}
