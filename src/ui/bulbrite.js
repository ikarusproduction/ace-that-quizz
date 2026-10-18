// Pack opening, one page. Press and HOLD the bulb: it charges in the colour of the pack, the phone buzzes harder and
// faster, the bulb shakes and glows more, until it overloads and the pack opens. The cards are then dealt side by
// side on the same page; "Next" turns the next card, "OK" leaves. "Open instantly" skips every animation.
// Reduce motion keeps the colours, sounds and the hold but drops shaking, flashes and flying glass.
import { h, sleep } from './dom.js';
import { sprite, spriteUrl } from './pixel.js';
import { sfx } from './audio.js';
import { burstAt, haptic, buzz, motionReduced } from './fx.js';
import { rarityFx } from './rarityfx.js';
import { HEXES } from '../engine/hexes.js';

export const PACK_LIGHT = { bronze: '#e0883c', silver: '#d6dde4', gold: '#ffd24a' };
export const RARITY_LIGHT = { common: '#e8e2d0', uncommon: '#7bd06a', rare: '#4f9bff', legendary: '#ffd24a' };
export const HOLD_MS = 2200;

/** The hold page. `hold()` resolves 'held' (long press done) or 'quick' (skip button). Then call `overload(rarity)`. */
export function createBulbRite({ name, from, light, count = 0 }) {
  const reduced = () => motionReduced();
  const mask = `url("${spriteUrl('bulb_on')}")`;
  const img = sprite('bulb_on', 144);
  const tint = h('div.tint');
  tint.style.maskImage = mask; tint.style.webkitMaskImage = mask;
  const shell = h('div.shell', {}, img, tint);
  const ring = h('div.rite-ring');
  const bulb = h('button.rite-bulb', { type: 'button', 'aria-label': `Press and hold to open the ${name}` }, h('div.cord'), h('div.rite-hold', {}, ring, shell));
  const hint = h('p.rite-hint', { 'aria-live': 'polite' }, 'Press and hold the bulb');
  const quickBtn = h('button.btn.ghost.small', { type: 'button' }, 'Open instantly');
  const ov = h('div.reveal-overlay.rite', { role: 'dialog', 'aria-label': name }, h('div.reveal-box', {}, h('div.tiny.dim', {}, from || 'New pack'), h('h2.rite-name', {}, name), count ? h('div.tiny.dim', {}, `${count} hexes inside`) : null, bulb, hint, quickBtn));
  ov.style.setProperty('--c', light);
  ov.style.setProperty('--lvl', '0');
  ov.style.setProperty('--p', '0');

  let p = 0; // 0..1 charge
  let holding = false;
  let done = false;
  let raf = 0;
  let last = 0;
  let nextBuzz = 0;
  let marks = 0;
  let resolveHold = null;
  const holdP = new Promise((res) => { resolveHold = res; });

  const center = () => { const r = shell.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 }; };
  const lerp = (a, b, t) => a + (b - a) * t;

  const render = () => {
    ov.style.setProperty('--lvl', p.toFixed(3));
    ov.style.setProperty('--p', p.toFixed(3));
    if (!reduced()) {
      const amp = p * p * 7;
      shell.style.transform = p > 0.02 ? `translate(${(Math.random() - 0.5) * amp}px, ${(Math.random() - 0.5) * amp}px) scale(${1 + p * 0.08})` : '';
    }
    tint.style.opacity = String(0.25 + p * 0.55);
    hint.textContent = p === 0 && !holding ? 'Press and hold the bulb' : p < 0.35 ? 'It is waking up…' : p < 0.7 ? 'Keep holding…' : 'It is about to blow!';
  };

  const tick = (t) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(64, t - (last || t));
    last = t;
    if (done) return;
    p = Math.max(0, Math.min(1, p + (holding ? dt / HOLD_MS : -dt / (HOLD_MS * 0.35))));
    if (holding && p > 0) {
      // The phone buzzes more and more: longer pulses, closer together.
      if (t >= nextBuzz) {
        buzz(lerp(14, 85, p));
        nextBuzz = t + lerp(300, 70, p);
        if (!reduced()) burstAt(center().x, center().y, { colors: [ov.style.getPropertyValue('--c') || light, '#ffffff'], count: Math.ceil(1 + p * 4), spread: 40 + p * 90, gravity: 10, size: [2, 2 + Math.ceil(p * 4)], duration: [300, 600] });
      }
      const lvl = Math.floor(p * 4);
      if (lvl > marks) { marks = lvl; sfx.bulbTap?.(lvl); sfx.charge?.(lvl); if (lvl >= 3) sfx.bulbBuzz?.(); }
    }
    render();
    if (p >= 1) finish('held');
  };

  const finish = (how) => {
    if (done) return;
    done = true; holding = false;
    cancelAnimationFrame(raf);
    ov.style.setProperty('--lvl', '1');
    resolveHold(how);
  };

  const start = (e) => {
    if (done) return;
    e?.preventDefault?.();
    holding = true;
    if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
    haptic('tap');
  };
  const stop = () => { holding = false; };
  bulb.addEventListener('pointerdown', (e) => { try { bulb.setPointerCapture(e.pointerId); } catch { /* ignore */ } start(e); });
  bulb.addEventListener('pointerup', stop);
  bulb.addEventListener('pointercancel', stop);
  bulb.addEventListener('lostpointercapture', stop);
  bulb.addEventListener('contextmenu', (e) => e.preventDefault());
  bulb.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start(e); });
  bulb.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
  quickBtn.addEventListener('click', () => finish('quick'));
  raf = requestAnimationFrame(tick);

  return {
    el: ov,
    hold: () => holdP,
    async overload(rarity) {
      const col = RARITY_LIGHT[rarity] ?? light;
      ov.style.setProperty('--c', col);
      const c = center();
      sfx.glass?.();
      haptic(rarity === 'legendary' ? 'jackpot' : 'big');
      if (!reduced()) {
        const flash = h('div.rite-flash', { style: { background: col } });
        document.body.append(flash);
        flash.animate([{ opacity: 0 }, { opacity: 0.95 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' }).finished.finally(() => flash.remove());
        shell.style.transform = '';
        shell.animate([{ transform: 'scale(1.1)', filter: 'brightness(1)' }, { transform: 'scale(1.35)', filter: 'brightness(3)' }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
        await sleep(260);
        burstAt(c.x, c.y, { colors: [col, '#ffffff', '#cfd6dc', '#fff2c4'], count: 40, spread: 230, gravity: 260, size: [4, 10], duration: [700, 1300] });
      }
      rarityFx(rarity, { at: c, quiet: true });
      await sleep(reduced() ? 100 : 380);
    },
    close: () => { cancelAnimationFrame(raf); ov.remove(); },
  };
}

const rar = (id) => HEXES[id]?.rarity ?? 'common';

/**
 * The reward page. `results` is a list of { type?, cards: [{id, dup, dust}] }. Cards sit side by side; Next turns the next one
 * face up, OK leaves. With `instant` every card is already face up and nothing animates.
 */
export function showCardsPage({ title, results, instant = false }) {
  const all = results.flatMap((r) => r.cards);
  const reduce = motionReduced();
  const instantNow = instant;
  let shown = instantNow ? all.length : 0;
  const cardEls = all.map((c) => {
    const hx = HEXES[c.id];
    const front = h('div.pc-front', { class: rar(c.id) }, sprite(hx?.icon ?? 'key', 36), h('div.pc-nm', {}, hx?.name ?? c.id), h('div.pc-rar', { class: rar(c.id) }, rar(c.id)), h('div.pc-note', {}, c.dup ? `+${c.dust} dust` : 'NEW'));
    const back = h('div.pc-back');
    return h('div.pc', { class: instantNow ? 'up' : '' }, h('div.pc-in', {}, back, front));
  });
  const grid = h('div.pc-grid', { class: all.length > 6 ? 'many' : '' }, cardEls);
  const summary = h('p.small.dim.pc-sum', {});
  const btn = h('button.btn.primary.block', { type: 'button' }, 'Next');
  const allBtn = h('button.btn.ghost.small', { type: 'button' }, 'Reveal all');
  const ov = h('div.reveal-overlay.rite.pc-page', { role: 'dialog', 'aria-label': title }, h('div.reveal-box.wide', {}, h('div.tiny.dim', {}, title), h('h2.rite-name', {}, all.length === 1 ? '1 hex' : `${all.length} hexes`), grid, summary, h('div.pc-actions', {}, btn, allBtn)));
  const best = all.map((c) => rar(c.id)).sort((a, b) => ['common', 'uncommon', 'rare', 'legendary'].indexOf(b) - ['common', 'uncommon', 'rare', 'legendary'].indexOf(a))[0] ?? 'common';
  ov.style.setProperty('--c', RARITY_LIGHT[best]);
  ov.style.setProperty('--lvl', '0.6');

  const refresh = () => {
    const finished = shown >= all.length;
    btn.textContent = finished ? 'OK' : 'Next';
    allBtn.hidden = finished || all.length < 2;
    const seen = all.slice(0, shown);
    const dust = seen.reduce((n, c) => n + (c.dup ? c.dust : 0), 0);
    const fresh = seen.filter((c) => !c.dup).length;
    summary.textContent = finished ? `${fresh} new hex${fresh === 1 ? '' : 'es'}${dust ? ` · +${dust} dust` : ''}` : `${shown} / ${all.length} turned`;
  };
  const flip = (i, quiet) => {
    const el = cardEls[i];
    el.classList.add('up');
    const r = el.getBoundingClientRect();
    if (!quiet) rarityFx(rar(all[i].id), { at: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  };

  return new Promise((res) => {
    const leave = () => { ov.remove(); res(); };
    btn.addEventListener('click', () => {
      if (shown >= all.length) return leave();
      flip(shown++, false);
      refresh();
    });
    allBtn.addEventListener('click', () => {
      sfx.select?.();
      while (shown < all.length) flip(shown++, shown < all.length);
      refresh();
    });
    document.body.append(ov);
    refresh();
    if (!instantNow && !reduce) {
      cardEls.forEach((el, i) => { el.style.animationDelay = `${i * 110}ms`; el.classList.add('deal'); });
      sfx.select?.();
    }
    if (instantNow) sfx.select?.();
  });
}
