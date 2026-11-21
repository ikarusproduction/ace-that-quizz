// CONCOMBRE NINJA — slice what flies with a swipe; slice several in one stroke for a combo;
// never slice a bottle. Every phone gets the same throws (same seed).
import { sfx, vibrate } from '../audio.js';
import { makeRng } from '../../shared/rng.js';
import { nightBackdrop, wash, grain, shade, rgba } from '../paint.js';
import { segDist } from './stage.js';

const KINDS = {
  cucumber: { pts: 1, r: 0.075, w: 30, skin: '#2f8f3a', flesh: '#d8f5b0', juice: '#9fe07a' },
  lemon: { pts: 1, r: 0.062, w: 24, skin: '#ffd83a', flesh: '#fff3a6', juice: '#ffe95c' },
  watermelon: { pts: 2, r: 0.1, w: 14, skin: '#1f7a3a', flesh: '#ff4b6b', juice: '#ff5c7a' },
  olive: { pts: 3, r: 0.042, w: 12, skin: '#7aa83a', flesh: '#d9eea0', juice: '#b8d86a' },
  bottle: { pts: -5, r: 0.07, w: 20, skin: '#3d7a2a', flesh: '#3d7a2a', juice: '#c9f0ff' },
};
const PLAY_MS = 20_000;
const COMBO_GAP = 350;

/** The throw schedule for one seed: [{ at (ms), kind, x (0..1), vx, peak (0..1) }]. */
export function schedule(seed) {
  const rng = makeRng(seed);
  const out = [];
  let t = 600;
  const pickKind = (allowBottle) => {
    const list = Object.entries(KINDS).filter(([k]) => allowBottle || k !== 'bottle');
    const total = list.reduce((s, [, v]) => s + v.w, 0);
    let r = rng() * total;
    for (const [k, v] of list) { r -= v.w; if (r <= 0) return k; }
    return 'cucumber';
  };
  while (t < PLAY_MS - 1600) {
    const n = 1 + Math.floor(rng() * (t < 5000 ? 2 : t < 12000 ? 3 : 4));
    for (let i = 0; i < n; i++) {
      const x = 0.15 + rng() * 0.7;
      out.push({ at: t + i * 90, kind: pickKind(t > 2500), x, vx: (0.5 - x) * (0.5 + rng() * 0.5), peak: 0.5 + rng() * 0.32, spin: (rng() - 0.5) * 6 });
    }
    t += 700 + rng() * 650 - Math.min(300, t / 60);
  }
  return out;
}

export async function play(stage, { seed }) {
  const throws = schedule(seed);
  const rng = makeRng(seed ^ 0x5bd1e995);
  let next = 0;
  let score = 0;
  const items = [];
  const halves = [];
  const drops = [];
  const pops = [];
  const trail = [];
  let chain = 0;
  let lastSlice = -1e9;
  let flash = 0;
  let elapsed = 0;
  let last = null;

  // Stains stay on the wall: a persistent watercolor layer.
  const stains = document.createElement('canvas');
  const bg = document.createElement('canvas');
  const paint = () => {
    for (const c of [stains, bg]) { c.width = stage.w * stage.dpr; c.height = stage.h * stage.dpr; }
    const c = bg.getContext('2d');
    c.scale(stage.dpr, stage.dpr);
    nightBackdrop(c, stage.w, stage.h, seed);
    // brick wall hints
    c.globalAlpha = 0.08;
    c.strokeStyle = '#fff6e4';
    c.lineWidth = 2;
    for (let y = 0; y < stage.h * 0.82; y += 34) {
      for (let x = (y / 34) % 2 ? -30 : 0; x < stage.w; x += 60) c.strokeRect(x, y, 60, 34);
    }
    c.globalAlpha = 1;
    // bar counter
    const top = stage.h * 0.86;
    const g = c.createLinearGradient(0, top, 0, stage.h);
    g.addColorStop(0, '#9a5523');
    g.addColorStop(1, '#4a2208');
    c.fillStyle = g;
    c.fillRect(0, top, stage.w, stage.h - top);
    c.fillStyle = '#150a26';
    c.fillRect(0, top - 3, stage.w, 6);
    c.fillStyle = 'rgba(255,220,170,.25)';
    c.fillRect(0, top + 5, stage.w, 4);
    grain(c, stage.w, stage.h, 0.5);
    stains.getContext('2d').scale(stage.dpr, stage.dpr);
  };
  paint();

  const pointerId = { v: null };
  const onDown = (e) => {
    e.preventDefault();
    pointerId.v = e.pointerId;
    last = { x: e.clientX, y: e.clientY };
    trail.length = 0;
    trail.push({ x: last.x, y: last.y, t: performance.now() });
    endChain();
  };
  const onMove = (e) => {
    if (pointerId.v !== e.pointerId || !last) return;
    e.preventDefault();
    const p = { x: e.clientX, y: e.clientY };
    const len = Math.hypot(p.x - last.x, p.y - last.y);
    if (len > 4) {
      cut(last.x, last.y, p.x, p.y);
      trail.push({ x: p.x, y: p.y, t: performance.now() });
      last = p;
    }
  };
  const onUp = (e) => { if (pointerId.v === e.pointerId) { pointerId.v = null; last = null; endChain(); } };
  const cv = stage.canvas;
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  stage.setMsg('Glisse ton doigt pour trancher !');
  stage.setScore('0 pt');

  function endChain() {
    if (chain >= 3) {
      const bonus = chain - 2;
      score += bonus;
      pops.push({ x: stage.w / 2, y: stage.h * 0.3, text: `COMBO ×${chain} +${bonus}`, life: 1.2, color: '#21d4e8', big: true });
      sfx.win();
    }
    chain = 0;
  }

  function cut(ax, ay, bx, by) {
    for (const it of items) {
      if (it.cut) continue;
      const r = KINDS[it.kind].r * stage.w;
      if (segDist(it.x, it.y, ax, ay, bx, by) < r * 1.05) slice(it, Math.atan2(by - ay, bx - ax));
    }
  }

  function slice(it, angle) {
    it.cut = true;
    const k = KINDS[it.kind];
    const now = elapsed;
    if (now - lastSlice > COMBO_GAP) endChain();
    lastSlice = now;
    if (it.kind === 'bottle') {
      score += k.pts;
      flash = 1;
      sfx.bad();
      vibrate([80, 40, 120]);
      pops.push({ x: it.x, y: it.y, text: '−5 🍾', life: 1.1, color: '#ff4b5c' });
      for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2;
        drops.push({ x: it.x, y: it.y, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400 - 200, r: 3 + rng() * 5, c: '#c9f0ff', life: 0.8 });
      }
      endChain();
      return;
    }
    chain += 1;
    score += k.pts;
    sfx.slice();
    vibrate(15);
    pops.push({ x: it.x, y: it.y - 20, text: `+${k.pts}`, life: 0.9, color: '#ffc93c' });
    const nx = Math.cos(angle + Math.PI / 2);
    const ny = Math.sin(angle + Math.PI / 2);
    for (const s of [-1, 1]) {
      halves.push({ kind: it.kind, x: it.x, y: it.y, vx: it.vx + nx * s * 160, vy: it.vy + ny * s * 160 - 60, rot: it.rot, vr: it.vr + s * 3, side: s, cutAngle: angle, life: 1.6 });
    }
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const v = 120 + rng() * 380;
      drops.push({ x: it.x, y: it.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 3 + rng() * 7, c: k.juice, life: 0.7 + rng() * 0.4 });
    }
    // watercolor stain on the wall
    const sc = stains.getContext('2d');
    const sr = makeRng((it.x * 1000) | 0);
    wash(sc, () => { sc.beginPath(); sc.ellipse(it.x, it.y, k.r * stage.w * (1.2 + sr()), k.r * stage.w * (0.8 + sr() * 0.6), angle, 0, Math.PI * 2); }, k.juice, { layers: 2, spread: 6, rng: sr, alpha: 0.14, edge: false });
  }

  await stage.loop((dt, t) => {
    elapsed = t;
    const W = stage.w;
    const H = stage.h;
    const g = 1.35 * H;
    while (next < throws.length && throws[next].at <= t) {
      const th = throws[next++];
      const vy = -Math.sqrt(2 * g * th.peak * H);
      items.push({ kind: th.kind, x: th.x * W, y: H + 40, vx: th.vx * W, vy, rot: 0, vr: th.spin, cut: false });
    }
    if (t - lastSlice > COMBO_GAP && chain) endChain();
    for (const it of items) { it.vy += g * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.rot += it.vr * dt; }
    for (let i = items.length - 1; i >= 0; i--) if (items[i].cut || items[i].y > H + 120) items.splice(i, 1);
    for (const hv of halves) { hv.vy += g * dt; hv.x += hv.vx * dt; hv.y += hv.vy * dt; hv.rot += hv.vr * dt; hv.life -= dt; }
    for (const d of drops) { d.vy += g * 0.6 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; }
    for (const p of pops) { p.y -= 50 * dt; p.life -= dt; }
    for (const arr of [halves, drops, pops]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].life <= 0) arr.splice(i, 1);

    const ctx = stage.ctx;
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.drawImage(stains, 0, 0, W, H);
    for (const it of items) drawItem(ctx, it, W, t);
    for (const hv of halves) drawHalf(ctx, hv, W);
    for (const d of drops) {
      ctx.globalAlpha = Math.max(0, Math.min(1, d.life * 2)) * 0.8;
      ctx.fillStyle = d.c;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // swipe trail
    const nowP = performance.now();
    while (trail.length && nowP - trail[0].t > 140) trail.shift();
    if (trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [wdt, col] of [[14, 'rgba(33,212,232,.35)'], [6, '#fff6e4']]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = wdt;
        ctx.beginPath();
        trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of pops) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.font = `${p.big ? 40 : 30}px "Luckiest Guy", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#150a26';
      ctx.fillStyle = p.color;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
    if (flash > 0) {
      ctx.fillStyle = rgba('#ff4b5c', flash * 0.45);
      ctx.fillRect(0, 0, W, H);
      flash = Math.max(0, flash - dt * 2.5);
    }
    stage.setScore(`${score} pt${Math.abs(score) > 1 ? 's' : ''}`);
    stage.setTime(1 - t / PLAY_MS);
    return t < PLAY_MS;
  });

  endChain();
  cv.removeEventListener('pointerdown', onDown);
  cv.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  return { score, display: `${score} pt${Math.abs(score) > 1 ? 's' : ''}` };
}

function shapePath(ctx, kind, r) {
  ctx.beginPath();
  if (kind === 'cucumber') ctx.ellipse(0, 0, r * 1.45, r * 0.62, 0, 0, Math.PI * 2);
  else if (kind === 'lemon') {
    ctx.moveTo(-r * 1.25, 0);
    ctx.bezierCurveTo(-r, -r * 0.95, r, -r * 0.95, r * 1.25, 0);
    ctx.bezierCurveTo(r, r * 0.95, -r, r * 0.95, -r * 1.25, 0);
  } else if (kind === 'olive') ctx.ellipse(0, 0, r * 1.2, r * 0.9, 0, 0, Math.PI * 2);
  else if (kind === 'bottle') {
    ctx.moveTo(-r * 0.18, -r * 1.7);
    ctx.lineTo(r * 0.18, -r * 1.7);
    ctx.lineTo(r * 0.2, -r * 0.9);
    ctx.quadraticCurveTo(r * 0.65, -r * 0.7, r * 0.65, -r * 0.2);
    ctx.lineTo(r * 0.65, r * 1.4);
    ctx.quadraticCurveTo(r * 0.65, r * 1.6, r * 0.4, r * 1.6);
    ctx.lineTo(-r * 0.4, r * 1.6);
    ctx.quadraticCurveTo(-r * 0.65, r * 1.6, -r * 0.65, r * 1.4);
    ctx.lineTo(-r * 0.65, -r * 0.2);
    ctx.quadraticCurveTo(-r * 0.65, -r * 0.7, -r * 0.2, -r * 0.9);
    ctx.closePath();
  } else ctx.arc(0, 0, r, 0, Math.PI * 2);
}

function drawItem(ctx, it, W, t) {
  const k = KINDS[it.kind];
  const r = k.r * W;
  ctx.save();
  ctx.translate(it.x, it.y);
  if (it.kind === 'bottle') {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(t / 90) * 0.15;
    ctx.fillStyle = '#ff4b5c';
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.rotate(it.rot);
  // shadow-ish offset wash
  ctx.fillStyle = 'rgba(21,10,38,.35)';
  ctx.save();
  ctx.translate(4, 6);
  shapePath(ctx, it.kind, r);
  ctx.fill();
  ctx.restore();
  const g = ctx.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.1, 0, 0, r * 1.5);
  g.addColorStop(0, shade(k.skin, 0.45));
  g.addColorStop(0.6, k.skin);
  g.addColorStop(1, shade(k.skin, -0.4));
  ctx.fillStyle = g;
  shapePath(ctx, it.kind, r);
  ctx.fill();
  ctx.save();
  shapePath(ctx, it.kind, r);
  ctx.clip();
  if (it.kind === 'watermelon' || it.kind === 'cucumber') {
    ctx.strokeStyle = shade(k.skin, -0.45);
    ctx.lineWidth = r * 0.16;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      if (it.kind === 'watermelon') { ctx.moveTo(i * r * 0.35, -r); ctx.quadraticCurveTo(i * r * 0.5, 0, i * r * 0.35, r); } else { ctx.moveTo(-r * 1.5, i * r * 0.22); ctx.lineTo(r * 1.5, i * r * 0.22 + r * 0.05); }
      ctx.stroke();
    }
  }
  if (it.kind === 'bottle') {
    ctx.fillStyle = '#fff6e4';
    ctx.fillRect(-r * 0.65, r * 0.1, r * 1.3, r * 0.7);
    ctx.fillStyle = '#ff4b5c';
    ctx.font = `${Math.round(r * 0.6)}px "Luckiest Guy", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 0, r * 0.47);
  }
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.28, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (it.kind === 'olive') {
    ctx.fillStyle = '#ff4b5c';
    ctx.beginPath();
    ctx.arc(r * 0.5, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 3.5;
  shapePath(ctx, it.kind, r);
  ctx.stroke();
  ctx.restore();
}

function drawHalf(ctx, hv, W) {
  const k = KINDS[hv.kind];
  const r = k.r * W;
  ctx.save();
  ctx.globalAlpha = Math.min(1, hv.life * 1.5);
  ctx.translate(hv.x, hv.y);
  ctx.rotate(hv.rot);
  // keep one side of the cut line
  ctx.save();
  ctx.rotate(hv.cutAngle - hv.rot);
  ctx.beginPath();
  ctx.rect(-r * 3, hv.side > 0 ? 0 : -r * 3, r * 6, r * 3);
  ctx.restore();
  ctx.clip();
  ctx.fillStyle = k.skin;
  shapePath(ctx, hv.kind, r);
  ctx.fill();
  ctx.fillStyle = k.flesh;
  ctx.save();
  ctx.scale(0.82, 0.82);
  shapePath(ctx, hv.kind, r);
  ctx.fill();
  ctx.restore();
  if (hv.kind === 'watermelon') {
    ctx.fillStyle = '#150a26';
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(Math.cos(i) * r * 0.5, Math.sin(i * 1.7) * r * 0.5, 3, 5, i, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 3;
  shapePath(ctx, hv.kind, r);
  ctx.stroke();
  ctx.restore();
}
