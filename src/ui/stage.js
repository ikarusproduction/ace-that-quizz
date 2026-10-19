// The fight stage: the enemy, its health bar, its telegraphed move, your string of bulbs and your heat. The reveal screen
// calls `play(duel)` to animate what just happened: a hit, a crit, a block, a heal, a lunge that cracks a bulb, a rage,
// a death, and, for the last room, the house tearing itself open.
import { h, sleep } from './dom.js';
import { sprite } from './pixel.js';
import { sfx, setMusicIntensity } from './audio.js';
import { burstAt, haptic, motionReduced } from './fx.js';
import { shake, pulse, blackout, rageStorm, rageFlicker } from './lighting.js';
import { createRig } from './bossrig.js';
import { INTENTS, DUEL, intentIdFor } from '../engine/duel.js';

const GLYPHS = {
  static: ['ϟ', '~', '·', '+'], map: ['N', '+', '·', '↑'], archive: ['§', '¶', '·', '“'], stage: ['♪', '♫', '·', '♪'],
  cipher: ['01', '#', '?', 'Ω'], news: ['!', '▮', '▬', '·'], vines: ['~', '"', ',', '·'], dread: ['?', '·', '!', '·'],
  house: ['★', '?', '·', '♠'], clinic: ['+', '✚', '·', '♥'], plain: ['·', '·', '+'],
};
const ATTACK_COLORS = { static: ['#6fd1ff', '#effcff'], map: ['#e8a33d', '#f0e4bf'], archive: ['#8a5fb0', '#e8e2d0'], stage: ['#e07b9b', '#ffffff'], cipher: ['#6fd1ff', '#bfc7d1'], news: ['#4f78b4', '#ff5a4f'], vines: ['#6fa86b', '#e0709a'], dread: ['#5c4a86', '#e4dfee'], house: ['#ffd24a', '#c4302b'], clinic: ['#6fa86b', '#e8e2d0'], plain: ['#ffffff', '#8a9096'] };

const rect = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
};

/** The bulbs you have left, hanging from a wire. Individual ones can crack and shatter. */
function livesRow(count, max) {
  const shown = Math.max(max, count);
  const row = h('span.lives', { role: 'img', 'aria-label': `${count} bulbs` });
  for (let i = 0; i < shown; i++) row.append(h('span.life', { class: i < count ? 'on' : 'off' }, sprite(i < count ? 'bulb_on' : 'bulb_broken', 32)));
  return row;
}

function heatRow(heat, cap) {
  const row = h('span.heat', { role: 'img', 'aria-label': `${heat} heat` });
  for (let i = 0; i < cap; i++) row.append(h('i', { class: i < heat ? 'on' : '' }));
  return row;
}

const entered = new Set();
const bossSize = (enc, compact) => (compact ? 96 : enc.kind === 'final' ? 192 : 160);

/**
 * @param {object} o
 * @param {object} o.enc       the encounter (state.enc)
 * @param {number} o.hp        health to show now (the reveal passes the health before the hit, then plays)
 * @param {number} o.lives
 * @param {number} o.heat
 * @param {number} o.qIndex    question index, used to show what the boss does next
 * @param {string} o.intent    the move for this question
 * @param {boolean} o.compact  smaller stage for the stake and question screens
 * @param {string} o.spriteName  show this face instead of the encounter's current one (phase changes play on the reveal)
 * @param {string} o.enterKey  the first time a key is seen the boss rises out of the dark
 */
export function createStage({ enc, hp, lives, maxLives = DUEL.maxLives, heat = 0, qIndex = 0, intent = null, enraged = false, compact = false, showPattern = true, misses = 0, spriteName = null, enterKey = null }) {
  const shownHp = hp ?? enc.hp;
  const arena = enc.arena ?? 'plain';
  const lastBulb = lives === 1;
  const root = h('div.stage', { class: `arena-${arena} ${compact ? 'compact' : ''} ${enraged ? 'enraged' : ''} ${lastBulb ? 'last-bulb' : ''} kind-${enc.kind}` });
  root.style.setProperty('--boss', enc.color ?? '#8a9096');
  if (enc.rank > 0) { root.classList.add('evolved', `evo-${enc.rank}`); root.append(h('div.rank-pips', { title: `Rank ${enc.rank}`, 'aria-label': `Evolved, rank ${enc.rank}` }, '★'.repeat(enc.rank))); }

  // ambient glyphs and embers drifting behind the boss
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
  for (let i = 0; i < 10; i++) {
    const e = h('i.ember');
    e.style.left = `${(i * 53 + 7) % 100}%`;
    e.style.animationDelay = `${-((i * 1.3) % 6)}s`;
    e.style.animationDuration = `${3.5 + ((i * 3) % 4)}s`;
    bg.append(e);
  }

  const px = bossSize(enc, compact);
  let rig = createRig(spriteName ?? enc.sprite, px, enc.name);
  rig.setEnraged(enraged);
  rig.setDread(lastBulb);
  const aura = h('div.aura');
  const shadow = h('div.shadow');
  const bossEl = h('div.boss', { class: intent ? `i-${intent}` : '' }, aura, rig.el);
  const bossWrap = h('div.boss-wrap', {}, bossEl, shadow);
  bossWrap.style.paddingTop = `${6 + rig.overTop}px`; bossWrap.style.paddingBottom = `${rig.overBottom}px`;
  if (enterKey != null && !entered.has(enterKey)) { entered.add(enterKey); bossEl.classList.add('enter'); setTimeout(() => bossEl.classList.remove('enter'), 1500); }
  const hitLayer = h('div.hit-layer', { 'aria-hidden': 'true' });
  const hpFill = h('i.fill');
  const hpGhost = h('i.ghost');
  const hpText = h('span.hp-text', {}, `${shownHp}/${enc.maxHp}`);
  const hpBar = h('div.hpbar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': enc.maxHp, 'aria-valuenow': shownHp, 'aria-label': `${enc.name} health` }, hpGhost, hpFill, h('i.mark'), hpText);
  // phase notches on the health bar of the last boss
  if (enc.phases) for (const ph of enc.phases.slice(1)) hpBar.append(h('i.notch', { style: { left: `${ph.at * 100}%` } }));
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
  // the HUD: your string of bulbs on its wire, your misses (contestants) and your heat
  const lastTag = h('span.last-tag', { 'aria-live': 'polite' }, lastBulb ? 'ONE LIGHT LEFT' : '');
  const foot = h('div.life-hud', {}, h('span.lights-label', {}, 'Your lights'), livesEl, pips, h('span.grow'), lastTag, h('span.heat-wrap', {}, sprite('flame', 18), heatEl));
  const veil = h('div.veil', { 'aria-hidden': 'true' });
  const el = root;
  root.append(...[bg, top, hitLayer, bossWrap, hpBar, intent ? banner : null, intent && showPattern ? strip : null, foot, veil].filter(Boolean));

  /* ----------------------------------------------- pressure: the last bulb */

  let pressureTimer = null;
  const sparkOne = () => {
    const bulb = livesEl.querySelector('.life.on');
    if (!bulb || motionReduced()) return;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = h('i.spark');
      const a = Math.random() * Math.PI * 2; const d = 10 + Math.random() * 26;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * d - 8}px`);
      s.style.left = `${40 + Math.random() * 20}%`; s.style.top = `${20 + Math.random() * 30}%`;
      bulb.append(s);
      setTimeout(() => s.remove(), 700);
    }
  };
  const startPressure = () => {
    if (pressureTimer) return;
    pressureTimer = setInterval(() => {
      if (!root.isConnected) { clearInterval(pressureTimer); pressureTimer = null; return; }
      if (document.hidden) return;
      sfx.heartbeat?.();
      sparkOne();
      if (Math.random() < 0.35) sfx.flicker?.();
    }, 1250);
  };
  let rageTimer = null;
  const stopPressure = () => { clearInterval(pressureTimer); pressureTimer = null; };
  if (lastBulb) startPressure();

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
  const overlay = (cls, ms, style = {}) => {
    const o = h('i', { class: `fx ${cls}`, style });
    root.append(o);
    setTimeout(() => o.remove(), ms);
    return o;
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
      k.replaceChildren(sprite(on ? 'bulb_on' : 'bulb_broken', 32));
    });
    const last = n === 1;
    root.classList.toggle('last-bulb', last);
    lastTag.textContent = last ? 'ONE LIGHT LEFT' : '';
    rig.setDread(last);
    if (last) startPressure(); else stopPressure();
  }

  function setHeat(n) {
    [...heatEl.children].forEach((k, i) => k.classList.toggle('on', i < n));
  }

  function setSprite(name) {
    const old = rig;
    rig = createRig(name, px, enc.name);
    rig.setEnraged(root.classList.contains('enraged'));
    rig.setDread(root.classList.contains('last-bulb'));
    bossEl.replaceChild(rig.el, old.el);
    bossWrap.style.paddingTop = `${6 + rig.overTop}px`; bossWrap.style.paddingBottom = `${rig.overBottom}px`;
    rig.el.classList.add('rig-arrive');
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
      k.className = 'life off shattered snap';
      k.replaceChildren(sprite('bulb_broken', 32));
      await sleep(motionReduced() ? 0 : 180);
    }
    // all that is left is one flickering bulb: the room closes in
    const left = kids.filter((k) => k.classList.contains('on')).length;
    if (left === 1) {
      root.classList.add('last-bulb');
      lastTag.textContent = 'ONE LIGHT LEFT';
      rig.setDread(true);
      startPressure();
      popup('ONE LIGHT LEFT', 'leech');
      sfx.heartbeat?.();
    }
  }

  /** What the enemy does when you miss: one signature effect per move. */
  function attackFx(id, center) {
    if (motionReduced()) return;
    const cols = ATTACK_COLORS[arena] ?? ATTACK_COLORS.plain;
    const glyphBurst = () => {
      for (let i = 0; i < 7; i++) {
        const g = h('span.fly-glyph', { style: { left: `calc(50% + ${(i - 3) * 22}px)`, color: cols[i % 2], animationDelay: `${i * 60}ms`, '--sway': `${(i - 3) * 8}px` } }, (GLYPHS[arena] ?? GLYPHS.plain)[i % 3]);
        hitLayer.append(g);
        setTimeout(() => g.remove(), 1200);
      }
    };
    switch (id) {
      case 'surge': case 'accel':
        for (let i = 0; i < 4; i++) setTimeout(() => overlay('zap', 360, { '--r': `${-50 + i * 34 + Math.random() * 14}deg`, left: `${18 + i * 20}%`, background: cols[0] }), i * 70);
        break;
      case 'ink': burstAt(center.x, center.y + 20, { colors: ['#0b0c0d', '#1b1224', '#3a2a4a'], count: 26, spread: 120, gravity: 80, size: [6, 14] }); break;
      case 'goo': burstAt(center.x, center.y + 10, { colors: ['#6fa86b', '#b9e6a8', '#3f6b44'], count: 24, spread: 100, gravity: 220, size: [5, 11] }); break;
      case 'quake': overlay('crack', 900); setTimeout(() => shake(root), 160); break;
      case 'blur': overlay('ripple', 900); overlay('ripple', 900, { animationDelay: '150ms' }); break;
      case 'flip': flash('spin', 800); break;
      case 'twin': overlay('slash', 500, { '--r': '28deg' }); setTimeout(() => overlay('slash', 500, { '--r': '-28deg', background: cols[1] }), 160); break;
      case 'mend': case 'regrow': case 'leech': glyphBurst(); break;
      default: overlay('slash', 500, { '--r': '-24deg', background: cols[1] }); glyphBurst();
    }
  }

  /** The last room comes apart: the roof leaves, then the walls, and the jester steps out. */
  /** While a boss stays enraged the lights stutter at random. */
  function startRageTicks() {
    if (rageTimer || motionReduced()) return;
    const tick = () => {
      if (!root.isConnected) { rageTimer = null; return; }
      rageFlicker();
      rageTimer = setTimeout(tick, 2800 + Math.random() * 4200);
    };
    rageTimer = setTimeout(tick, 2200);
  }
  if (enraged || enc.phase >= 1) startRageTicks();

  async function phaseShift(to) {
    const ph = enc.phases?.[to];
    if (!ph) return;
    const reduced = motionReduced();
    const c = rect(bossWrap);
    root.classList.add('phase-shift');
    sfx.houseBreak?.();
    haptic('jackpot');
    shake(root);
    popup(to === 1 ? 'THE ROOF TEARS OFF' : 'THE WALLS FALL', 'rage');
    burstAt(c.x, c.y - 20, { colors: ['#ecdcb4', '#bda26e', '#92302a', '#ffd24a'], count: 46, spread: 220, gravity: 260, size: [4, 11], duration: [800, 1500] });
    if (!reduced) { rageStorm(2); await sleep(900); }
    setSprite(ph.sprite);
    setMusicIntensity?.(to);
    burstAt(c.x, c.y, { colors: ['#ff3b2a', '#ffd0c4', '#ffd24a'], count: 24, spread: 150, size: [3, 8] });
    if (to === 2) {
      await sleep(reduced ? 0 : 350);
      sfx.jesterLaugh?.();
      popup('HA HA HA', 'leech');
      rig.ring();
      haptic('warn');
    }
    root.classList.remove('phase-shift');
    await sleep(reduced ? 0 : 500);
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
      if (!d.guarded) overlay('player-strike', 420, { '--r': `${-30 + Math.random() * 60}deg` });
      setHp(d.hpAfter + (d.heal || 0));
      if (d.crit && !reduced) { pulse('good'); root.classList.add('crit-flash'); setTimeout(() => root.classList.remove('crit-flash'), 420); }
      await sleep(reduced ? 0 : 520);
    } else {
      // a miss: the enemy answers
      flash('lunge', 700);
      sfx.roar?.();
      pulse('bad');
      shake(root);
      attackFx(d.intent, center);
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

    // the boss changes face
    if (!killed && d.phaseTo > d.phaseFrom) {
      await sleep(reduced ? 0 : 200);
      for (let to = d.phaseFrom + 1; to <= d.phaseTo; to++) await phaseShift(to);
    }

    // the boss enters its rage
    if (!killed && enc.enraged && d.dmg > 0 && d.hpBefore > enc.maxHp * DUEL.enrageAt && d.hpAfter <= enc.maxHp * DUEL.enrageAt) {
      await sleep(reduced ? 0 : 260);
      root.classList.add('enraged');
      rig.setEnraged(true);
      sfx.roar?.();
      popup('ENRAGED!', 'rage');
      flash('rage', 900);
      rageStorm(1);
      startRageTicks();
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
      stopPressure();
    } else if (d.over === 'beaten') {
      popup('THEY WIN THIS ONE', 'leech');
      bossEl.classList.add('smug');
    } else if (d.over === 'lost') {
      popup('LIGHTS OUT', 'leech');
      root.classList.add('victorious');
      stopPressure();
    }
  }

  async function blackoutSafe() {
    await blackout(500);
  }

  return { el, root, play, setHp, setLives, setHeat, setSprite, boss: bossEl, get rig() { return rig; } };
}

/** Shorthand used by game.js: build the stage from the game state. */
export function stageFor(s, p, extra = {}) {
  const enc = s.enc;
  const enraged = Boolean(enc.enraged) && enc.hp > 0 && enc.hp <= enc.maxHp * DUEL.enrageAt;
  return createStage({ enc, hp: enc.hp, lives: p.strikes, heat: p.heat ?? 0, qIndex: s.qIndex, intent: s.q?.intent ?? null, enraged, misses: enc.misses ?? 0, enterKey: `${s.roundIndex}:${enc.id}`, ...extra });
}
