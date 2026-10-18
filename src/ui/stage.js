// The fight stage: the enemy, its health bar, its telegraphed move, your bulbs and your heat. The reveal screen calls
// `play(duel)` to animate what just happened: a hit, a crit, a block, a heal, a lunge that cracks a bulb, a rage, a death.
import { h, sleep } from './dom.js';
import { sprite } from './pixel.js';
import { sfx } from './audio.js';
import { burstAt, haptic, motionReduced } from './fx.js';
import { shake, pulse, blackout } from './lighting.js';
import { INTENTS, DUEL, intentIdFor } from '../engine/duel.js';

const GLYPHS = {
  static: ['ϟ', '~', '·', '+'], map: ['N', '+', '·', '↑'], archive: ['§', '¶', '·', '“'], stage: ['♪', '♫', '·', '♪'],
  cipher: ['01', '#', '?', 'Ω'], news: ['!', '▮', '▬', '·'], vines: ['~', '"', ',', '·'], dread: ['?', '·', '!', '·'],
  house: ['★', '?', '·', '♠'], plain: ['·', '·', '+'],
};

const rect = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
};

/** Small reusable row of bulbs where individual ones can crack and shatter. */
function livesRow(count, max) {
  const shown = Math.max(max, count);
  const row = h('span.lives', { role: 'img', 'aria-label': `${count} bulbs` });
  for (let i = 0; i < shown; i++) row.append(h('span.life', { class: i < count ? 'on' : 'off' }, sprite(i < count ? 'bulb_on' : 'bulb_off', 28)));
  return row;
}

function heatRow(heat, cap) {
  const row = h('span.heat', { role: 'img', 'aria-label': `${heat} heat` });
  for (let i = 0; i < cap; i++) row.append(h('i', { class: i < heat ? 'on' : '' }));
  return row;
}

/**
 * @param {object} o
 * @param {object} o.enc       the encounter (state.enc)
 * @param {number} o.hp        health to show now (the reveal passes the health before the hit, then plays)
 * @param {number} o.lives
 * @param {number} o.heat
 * @param {number} o.qIndex    question index, used to show what the boss does next
 * @param {string} o.intent    the move for this question
 * @param {boolean} o.compact  smaller stage for the stake and question screens
 */
export function createStage({ enc, hp, lives, maxLives = DUEL.maxLives, heat = 0, qIndex = 0, intent = null, enraged = false, compact = false, showPattern = true, misses = 0 }) {
  const shownHp = hp ?? enc.hp;
  const arena = enc.arena ?? 'plain';
  const root = h('div.stage', { class: `arena-${arena} ${compact ? 'compact' : ''} ${enraged ? 'enraged' : ''} kind-${enc.kind}` });
  root.style.setProperty('--boss', enc.color ?? '#8a9096');

  // ambient glyphs drifting behind the boss
  const bg = h('div.stage-bg', { 'aria-hidden': 'true' });
  const glyphs = GLYPHS[arena] ?? GLYPHS.plain;
  for (let i = 0; i < 14; i++) {
    const g = h('span.glyph', {}, glyphs[i % glyphs.length]);
    g.style.left = `${(i * 37 + 11) % 100}%`;
    g.style.animationDelay = `${-((i * 1.7) % 9)}s`;
    g.style.animationDuration = `${7 + ((i * 5) % 6)}s`;
    g.style.fontSize = `${12 + ((i * 7) % 14)}px`;
    bg.append(g);
  }

  const bossImg = sprite(enc.sprite, compact ? 96 : 160, enc.name);
  const aura = h('div.aura');
  const shadow = h('div.shadow');
  const bossEl = h('div.boss', {}, aura, bossImg);
  const bossWrap = h('div.boss-wrap', {}, bossEl, shadow);
  const hitLayer = h('div.hit-layer', { 'aria-hidden': 'true' });
  const hpFill = h('i.fill');
  const hpGhost = h('i.ghost');
  const hpText = h('span.hp-text', {}, `${shownHp}/${enc.maxHp}`);
  const hpBar = h('div.hpbar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': enc.maxHp, 'aria-valuenow': shownHp, 'aria-label': `${enc.name} health` }, hpGhost, hpFill, h('i.mark'), hpText);
  const setHpBar = (v) => {
    const pct = `${Math.max(0, Math.min(100, (v / enc.maxHp) * 100))}%`;
    hpFill.style.width = pct;
    hpText.textContent = `${Math.max(0, v)}/${enc.maxHp}`;
    hpBar.setAttribute('aria-valuenow', String(v));
    return pct;
  };
  const pct0 = setHpBar(shownHp);
  hpGhost.style.width = pct0;

  const banner = h('div.intent-banner');
  const strip = h('div.pattern');
  const livesEl = livesRow(lives, maxLives);
  const heatEl = heatRow(heat, DUEL.heatCap);
  const pips = enc.kind === 'minion' ? h('span.miss-pips', { 'aria-label': `${misses} of ${DUEL.minionMisses} misses` }, Array.from({ length: DUEL.minionMisses }, (_, i) => h('i', { class: i < misses ? 'on' : '' }))) : null;

  const drawIntent = (id, isEnraged) => {
    banner.replaceChildren();
    strip.replaceChildren();
    const it = INTENTS[id];
    if (!it) return;
    banner.className = `intent-banner intent-${id}`;
    banner.append(sprite(it.icon, 28), h('div.it', {}, h('b', {}, it.label), h('span', {}, it.text)));
    if (isEnraged) banner.append(h('span.rage-tag', {}, 'ENRAGED'));
    if (showPattern && enc.kind !== 'minion') {
      const e = { ...enc, hp: isEnraged ? Math.min(enc.hp, Math.floor(enc.maxHp * DUEL.enrageAt)) : Math.max(enc.hp, Math.floor(enc.maxHp * DUEL.enrageAt) + 1) };
      strip.append(h('span.tiny.mute', {}, 'Next'));
      for (let k = 1; k <= 3; k++) {
        const nid = intentIdFor(e, qIndex + k);
        const nit = INTENTS[nid];
        if (nit) strip.append(h('span.pat', { title: `${nit.label}: ${nit.text}` }, sprite(nit.icon, 18)));
      }
    }
  };
  drawIntent(intent, enraged);

  const top = h('div.stage-top', {}, h('b.nm', {}, enc.name), h('span.tiny.dim', {}, enc.title ?? ''));
  const foot = h('div.stage-foot', {}, livesEl, pips, h('span.grow'), h('span.heat-wrap', {}, sprite('flame', 18), heatEl));
  const el = root;
  root.append(...[bg, top, hitLayer, bossWrap, hpBar, intent ? banner : null, intent && showPattern ? strip : null, foot].filter(Boolean));

  /* ---------------------------------------------------------- effects */

  const popup = (text, cls = '', dx = 0) => {
    const p = h('span.pop-text', { class: cls }, text);
    p.style.left = `calc(50% + ${dx}px)`;
    hitLayer.append(p);
    setTimeout(() => p.remove(), 1300);
  };
  const flash = (cls, ms) => {
    bossEl.classList.remove(cls);
    void bossEl.offsetWidth;
    bossEl.classList.add(cls);
    setTimeout(() => bossEl.classList.remove(cls), ms);
  };

  function setHp(v, { ghostDelay = 520 } = {}) {
    const pct = setHpBar(v);
    setTimeout(() => { hpGhost.style.width = pct; }, motionReduced() ? 0 : ghostDelay);
  }

  function setLives(n) {
    const kids = [...livesEl.children];
    kids.forEach((k, i) => {
      const on = i < n;
      k.className = `life ${on ? 'on' : 'off'}`;
      k.replaceChildren(sprite(on ? 'bulb_on' : 'bulb_off', 28));
    });
  }

  function setHeat(n) {
    [...heatEl.children].forEach((k, i) => k.classList.toggle('on', i < n));
  }

  /** Crack then shatter the bulbs from `from-1` down to `to`. */
  async function loseBulbs(from, to) {
    const kids = [...livesEl.children];
    for (let i = from - 1; i >= to; i--) {
      const k = kids[i];
      if (!k) continue;
      k.classList.add('cracking');
      sfx.hurt?.();
      haptic('wrong');
      await sleep(motionReduced() ? 0 : 380);
      const r = rect(k);
      sfx.glass?.();
      burstAt(r.x, r.y, { colors: ['#fff2c4', '#ffd98a', '#e8a33d', '#cfd6dc'], count: 16, spread: 90, gravity: 160, size: [3, 7] });
      k.className = 'life off shattered';
      k.replaceChildren(sprite('bulb_off', 28));
      await sleep(motionReduced() ? 0 : 180);
    }
  }

  /**
   * Animate one answer. `d` is `result.duel` from the engine; `ctx` has { livesBefore, livesAfter, heatAfter }.
   * Resolves when the show is over (the Continue button should not wait for it).
   */
  async function play(d, ctx = {}) {
    if (!d) return;
    const reduced = motionReduced();
    const center = rect(bossWrap);
    const killed = d.over === 'won';
    if (d.healNow) { popup(`+${d.healNow}`, 'heal'); sfx.heal?.(); }

    if (d.dmg > 0) {
      // a hit
      flash(d.guarded ? 'guarded' : 'hit', 520);
      if (d.guarded) { sfx.clang?.(); popup('ARMOR', 'guard'); } else if (d.crit) { sfx.crit?.(); popup('CRIT!', 'crit', -58); } else sfx.hit?.(d.dmg);
      haptic(d.crit ? 'big' : 'correct');
      burstAt(center.x, center.y, { colors: d.crit ? ['#fff2c4', '#ffd24a', '#ff9a3c', '#ffffff'] : ['#ffffff', '#ffd98a', enc.color], count: 10 + d.dmg * 5, spread: 90 + d.dmg * 22, size: [4, 9] });
      popup(`−${d.dmg}`, d.crit ? 'dmg big' : 'dmg', d.crit ? 52 : 0);
      if (d.curseThrough) popup('THROUGH THE CURSE +1', 'tiny', 0);
      shake(root);
      setHp(d.hpAfter + (d.heal || 0));
      if (d.crit && !reduced) { pulse('good'); root.classList.add('crit-flash'); setTimeout(() => root.classList.remove('crit-flash'), 420); }
      await sleep(reduced ? 0 : 520);
    } else {
      // a miss: the enemy answers
      flash('lunge', 700);
      sfx.roar?.();
      pulse('bad');
      shake(root);
      await sleep(reduced ? 0 : 340);
      if (d.heal) { popup(`+${d.heal}`, 'heal'); sfx.heal?.(); setHp(d.hpAfter, { ghostDelay: 0 }); burstAt(center.x, center.y - 20, { colors: ['#6fa86b', '#b9e6a8', '#ffffff'], count: 12, spread: 70, gravity: -40, size: [3, 6] }); }
      if (d.leech) popup(`−${d.leech} chips`, 'leech');
      if (d.twin) popup('×2', 'crit');
    }
    if (d.dmg > 0 && d.heal) setHp(d.hpAfter, { ghostDelay: 0 });

    if (ctx.livesBefore != null && ctx.livesAfter != null && ctx.livesAfter < ctx.livesBefore) {
      await blackoutSafe();
      await loseBulbs(ctx.livesBefore, ctx.livesAfter);
    }
    if (pips && d.misses != null) [...pips.children].forEach((p, i) => p.classList.toggle('on', i < d.misses));
    if (ctx.heatAfter != null) {
      setHeat(ctx.heatAfter);
      if (d.heatGain) { popup('+1 HEAT', 'heat'); sfx.heat?.(); }
    }

    // the boss enters its rage
    if (!killed && enc.enraged && d.dmg > 0 && d.hpBefore > enc.maxHp * DUEL.enrageAt && d.hpAfter <= enc.maxHp * DUEL.enrageAt) {
      await sleep(reduced ? 0 : 260);
      root.classList.add('enraged');
      sfx.roar?.();
      popup('ENRAGED!', 'rage');
      flash('rage', 900);
      shake(root);
      burstAt(center.x, center.y, { colors: ['#ff5a4f', '#b3261e', '#ff9a3c'], count: 24, spread: 150, size: [4, 9] });
      await sleep(reduced ? 0 : 500);
    }

    if (killed) {
      await sleep(reduced ? 0 : 200);
      sfx.bossDown?.();
      haptic('jackpot');
      root.classList.add('dying');
      for (let i = 0; i < 4 && !reduced; i++) {
        burstAt(center.x + (Math.random() - 0.5) * 80, center.y + (Math.random() - 0.5) * 80, { colors: ['#ffffff', '#ffd98a', enc.color], count: 18, spread: 140, size: [4, 10] });
        await sleep(160);
      }
      burstAt(center.x, center.y, { colors: ['#ffffff', '#ffd24a', enc.color, '#e8a33d'], count: 60, spread: 260, gravity: 220, size: [5, 12], duration: [800, 1500] });
      popup(enc.kind === 'minion' ? 'BEATEN!' : 'DOWN!', 'crit');
      await sleep(reduced ? 0 : 700);
      bossEl.classList.add('gone');
    } else if (d.over === 'beaten') {
      popup('THEY WIN THIS ONE', 'leech');
      bossEl.classList.add('smug');
    } else if (d.over === 'lost') {
      popup('LIGHTS OUT', 'leech');
      root.classList.add('victorious');
    }
  }

  async function blackoutSafe() {
    await blackout(500);
  }

  return { el, root, play, setHp, setLives, setHeat, boss: bossEl };
}

/** Shorthand used by game.js: build the stage from the game state. */
export function stageFor(s, p, extra = {}) {
  const enc = s.enc;
  const enraged = Boolean(enc.enraged) && enc.hp > 0 && enc.hp <= enc.maxHp * DUEL.enrageAt;
  return createStage({ enc, hp: enc.hp, lives: p.strikes, heat: p.heat ?? 0, qIndex: s.qIndex, intent: s.q?.intent ?? null, enraged, misses: enc.misses ?? 0, ...extra });
}
