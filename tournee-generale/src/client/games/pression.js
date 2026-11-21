// PRESSION MAX — shake the phone until the keg blows. First to blow wins.
import { onMotion, motionSeen } from '../sensors.js';
import { sfx, vibrate } from '../audio.js';
import { makeRng } from '../../shared/rng.js';
import { nightBackdrop, wash, glow, grain } from '../paint.js';
import { frNum } from './stage.js';

const GAIN = 0.0095;      // pressure per (m/s² above the floor) per second
const FLOOR = 4;          // ignore small movements
const LEAK = 0.025;       // pressure lost per second when you stop
const TAP_GAIN = 0.014;   // fallback without motion sensor

export async function play(stage, { seed }) {
  const rng = makeRng(seed);
  const { durationMs } = stage;
  let p = 0;
  let level = 0;
  let exploded = false;
  let tBoom = 0;
  let elapsed = 0;
  let tapMode = false;
  let tooHard = 0;
  let lastCreak = 0;
  const parts = [];
  const cracks = [];

  const off = onMotion(({ mag, dt }) => {
    if (exploded) return;
    dt = Math.min(0.05, Math.max(0.005, dt));
    if (mag > 60) { tooHard = 1; return; }
    const m = Math.min(mag, 40);
    p += Math.max(0, m - FLOOR) * dt * GAIN;
    level = level * 0.85 + m * 0.15;
  });
  const onTap = (e) => {
    e.preventDefault();
    if (!tapMode || exploded) return;
    p += TAP_GAIN;
    level = Math.min(40, level + 8);
  };
  stage.canvas.addEventListener('pointerdown', onTap);
  stage.setMsg('SECOUE ! SECOUE ! SECOUE !');

  // Background painted once.
  const bg = document.createElement('canvas');
  const paintBg = () => {
    bg.width = stage.w * stage.dpr;
    bg.height = stage.h * stage.dpr;
    const c = bg.getContext('2d');
    c.scale(stage.dpr, stage.dpr);
    nightBackdrop(c, stage.w, stage.h, seed);
    const r2 = makeRng(5);
    // bar shelves with bottles
    for (let row = 0; row < 3; row++) {
      const y = stage.h * (0.2 + row * 0.11);
      c.fillStyle = 'rgba(21,10,38,.55)';
      c.fillRect(0, y, stage.w, 7);
      for (let x = 12; x < stage.w; x += 22 + r2() * 18) {
        const hgt = 26 + r2() * 30;
        const col = ['#2fd38a', '#ff8a1f', '#a65bff', '#21d4e8', '#ff3d9a'][(r2() * 5) | 0];
        wash(c, () => { c.beginPath(); c.roundRect(x, y - hgt, 12, hgt, 4); }, col, { layers: 2, spread: 1.5, rng: r2, alpha: 0.35, edge: false });
      }
    }
    grain(c, stage.w, stage.h, 0.5);
  };
  paintBg();

  const cx = () => stage.w / 2;
  const cy = () => stage.h * 0.6;

  function addCrack() {
    const a = rng() * Math.PI * 2;
    const pts = [[Math.cos(a) * 0.2, Math.sin(a) * 0.3]];
    for (let i = 0; i < 4; i++) {
      const [x, y] = pts[pts.length - 1];
      pts.push([x + (rng() - 0.5) * 0.35, y + (rng() - 0.5) * 0.35]);
    }
    cracks.push(pts);
  }

  function boom() {
    exploded = true;
    tBoom = elapsed;
    stage.setScore('BOUM !');
    stage.setTime(0);
    sfx.boom();
    vibrate([220, 80, 260]);
    for (let i = 0; i < 180; i++) {
      const a = rng() * Math.PI * 2;
      const v = 200 + rng() * 900;
      parts.push({ x: cx(), y: cy() - 40, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 300, r: 6 + rng() * 22, c: rng() < 0.7 ? '#fff6e4' : rng() < 0.5 ? '#ffc93c' : '#ff9d2a', life: 1 });
    }
  }

  await stage.loop((dt, t) => {
    elapsed = t;
    const ctx = stage.ctx;
    const W = stage.w;
    const H = stage.h;
    if (!exploded) {
      if (!tapMode && t > 900 && !motionSeen()) { tapMode = true; stage.setMsg('Pas de capteur ici : TAPE comme un fou !'); }
      p = Math.max(0, p - LEAK * dt);
      level *= 0.96;
      if (tooHard > 0) { tooHard -= dt; stage.setMsg('Doucement ! Tiens bien ton téléphone 🙏'); } else if (!tapMode) stage.setMsg(p > 0.75 ? 'ENCORE ! ÇA VA PÉTER !' : 'SECOUE ! SECOUE ! SECOUE !');
      while (cracks.length < Math.floor(Math.max(0, p - 0.45) * 14)) addCrack();
      if (level > 12 && t - lastCreak > 260) { lastCreak = t; sfx.creak(p); }
      if (p >= 1) boom();
      stage.setScore(`${Math.min(99, Math.round(p * 100))} %`);
      stage.setTime(1 - t / durationMs);
    }
    ctx.drawImage(bg, 0, 0, W, H);
    // red heat as pressure rises
    glow(ctx, cx(), cy(), W * 0.9, '#ff4b5c', exploded ? 0 : p * 0.5);

    if (!exploded) drawKeg(ctx, W, H, p, level, t, cracks, rng);
    else {
      const k = (t - tBoom) / 1000;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.9 - k * 2);
      ctx.fillStyle = '#fff6e4';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      for (const q of parts) {
        q.vy += 900 * dt; q.vx *= 0.99; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * 0.45;
        if (q.life <= 0) continue;
        ctx.save();
        ctx.globalAlpha = Math.min(1, q.life * 1.4) * 0.85;
        ctx.fillStyle = q.c;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (0.6 + q.life * 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(W / 2, H * 0.42);
      ctx.rotate(-0.08);
      const s = 1 + Math.max(0, 0.4 - k) * 2;
      ctx.scale(s, s);
      ctx.font = `${Math.round(W * 0.2)}px "Luckiest Guy", Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#150a26';
      ctx.fillStyle = '#ffc93c';
      ctx.strokeText('BOUM !', 0, 0);
      ctx.fillText('BOUM !', 0, 0);
      ctx.restore();
      if (t - tBoom > 1400) return false;
    }
    if (!exploded && t >= durationMs) return false;
    return true;
  });

  off();
  stage.canvas.removeEventListener('pointerdown', onTap);
  if (exploded) return { score: 2_000_000 - Math.round(tBoom), display: `BOUM en ${frNum(tBoom / 1000)} s` };
  return { score: Math.round(Math.min(p, 0.999) * 1_000_000), display: `Pression ${Math.round(p * 100)} %` };
}

function drawKeg(ctx, W, H, p, level, t, cracks, rng) {
  const base = Math.min(W * 0.36, H * 0.22);
  const jitter = Math.min(14, level * 0.45);
  const x = W / 2 + (Math.random() - 0.5) * jitter;
  const y = H * 0.6 + (Math.random() - 0.5) * jitter;
  const swell = 1 + p * 0.14 + Math.sin(t / 60) * p * 0.02;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(swell, 1 + p * 0.06);
  ctx.rotate((Math.random() - 0.5) * jitter * 0.004);
  const rw = base;
  const rh = base * 1.35;
  // shadow
  ctx.fillStyle = 'rgba(21,10,38,.5)';
  ctx.beginPath();
  ctx.ellipse(0, rh + 8, rw * 1.05, rw * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-rw * 0.8, -rh);
    ctx.bezierCurveTo(-rw * 1.15, -rh * 0.4, -rw * 1.15, rh * 0.4, -rw * 0.8, rh);
    ctx.lineTo(rw * 0.8, rh);
    ctx.bezierCurveTo(rw * 1.15, rh * 0.4, rw * 1.15, -rh * 0.4, rw * 0.8, -rh);
    ctx.closePath();
  };
  // wood
  const g = ctx.createLinearGradient(-rw, 0, rw, 0);
  g.addColorStop(0, '#6b3412');
  g.addColorStop(0.35, '#c9773a');
  g.addColorStop(0.55, '#e0985a');
  g.addColorStop(1, '#5a2a0c');
  ctx.fillStyle = g;
  body();
  ctx.fill();
  // staves
  ctx.save();
  body();
  ctx.clip();
  ctx.strokeStyle = 'rgba(60,25,5,.45)';
  ctx.lineWidth = 2.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * rw * 0.27, -rh);
    ctx.quadraticCurveTo(i * rw * 0.36, 0, i * rw * 0.27, rh);
    ctx.stroke();
  }
  // watercolor bloom
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ffd9a0';
  ctx.beginPath();
  ctx.ellipse(-rw * 0.3, -rh * 0.3, rw * 0.25, rh * 0.5, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // metal bands
  for (const by of [-0.72, 0.72]) {
    ctx.fillStyle = '#9aa0bf';
    ctx.strokeStyle = '#150a26';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    const yy = by * rh;
    const ww = rw * (1.02 - Math.abs(by) * 0.05);
    ctx.roundRect(-ww, yy - 9, ww * 2, 18, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(-ww * 0.6, yy - 6, ww * 0.5, 4);
  }
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 5;
  body();
  ctx.stroke();
  // cracks with light behind
  ctx.save();
  body();
  ctx.clip();
  for (const c of cracks) {
    ctx.strokeStyle = '#ffe9a8';
    ctx.shadowColor = '#ffc93c';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 4;
    ctx.beginPath();
    c.forEach(([u, v], i) => (i ? ctx.lineTo(u * rw * 2, v * rh * 2) : ctx.moveTo(u * rw * 2, v * rh * 2)));
    ctx.stroke();
  }
  ctx.restore();
  // tap
  ctx.fillStyle = '#d6d9ea';
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.roundRect(-14, rh * 0.15, 28, 18, 5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-6, rh * 0.15 + 16, 12, 22, 4);
  ctx.fill();
  ctx.stroke();
  // foam leaking on top
  if (p > 0.6) {
    const n = Math.floor((p - 0.6) * 20);
    for (let i = 0; i < n; i++) {
      const fx = (Math.sin(i * 7.3) * 0.6) * rw;
      ctx.fillStyle = '#fff6e4';
      ctx.strokeStyle = '#150a26';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx, -rh - 4 - Math.abs(Math.sin(t / 200 + i)) * 10, 9 + (i % 3) * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
  // pressure gauge
  const gx = W / 2;
  const gy = H * 0.26;
  const gr = Math.min(W * 0.17, 74);
  ctx.save();
  ctx.translate(gx, gy);
  ctx.fillStyle = '#fff6e4';
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, gr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const a0 = Math.PI * 0.8;
  const a1 = Math.PI * 2.2;
  ctx.lineWidth = gr * 0.16;
  ctx.strokeStyle = '#2fd38a';
  ctx.beginPath();
  ctx.arc(0, 0, gr * 0.74, a0, a0 + (a1 - a0) * 0.55);
  ctx.stroke();
  ctx.strokeStyle = '#ffc93c';
  ctx.beginPath();
  ctx.arc(0, 0, gr * 0.74, a0 + (a1 - a0) * 0.55, a0 + (a1 - a0) * 0.8);
  ctx.stroke();
  ctx.strokeStyle = '#ff4b5c';
  ctx.beginPath();
  ctx.arc(0, 0, gr * 0.74, a0 + (a1 - a0) * 0.8, a1);
  ctx.stroke();
  const wob = (Math.random() - 0.5) * Math.min(0.12, level * 0.004);
  const na = a0 + (a1 - a0) * Math.min(1, p) + wob;
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(na) * gr * 0.82, Math.sin(na) * gr * 0.82);
  ctx.stroke();
  ctx.fillStyle = '#ff3d9a';
  ctx.beginPath();
  ctx.arc(0, 0, gr * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

