// PILE POIL — hold to pour, release exactly on the line. The foam keeps climbing a little
// after you let go, and settles at the end. One try. Closest to the line wins.
import { sfx, vibrate } from '../audio.js';
import { makeRng } from '../../shared/rng.js';
import { nightBackdrop, grain, glow } from '../paint.js';
import { frNum } from './stage.js';

const GLASS_MM = 160;
const HEAD = 0.035;        // foam head left once it settles (fraction of the glass)

export async function play(stage, { seed }) {
  const rng = makeRng(seed);
  const target = 0.56 + rng() * 0.28;
  const { durationMs } = stage;
  let liquid = 0;
  let foam = 0;
  let rate = 0;
  let holding = false;
  let holdT = 0;
  let started = false;
  let released = false;
  let releasedAt = 0;
  let overflow = false;
  let result = null;
  let elapsed = 0;
  let lastPour = 0;
  const bubbles = Array.from({ length: 26 }, () => ({ x: rng(), y: rng(), s: 1.5 + rng() * 3, v: 0.08 + rng() * 0.15 }));

  const bg = document.createElement('canvas');
  bg.width = stage.w * stage.dpr;
  bg.height = stage.h * stage.dpr;
  {
    const c = bg.getContext('2d');
    c.scale(stage.dpr, stage.dpr);
    nightBackdrop(c, stage.w, stage.h, seed + 9);
    glow(c, stage.w / 2, stage.h * 0.55, stage.w * 0.7, '#ffc93c', 0.18);
    grain(c, stage.w, stage.h, 0.5);
  }

  const down = (e) => {
    e.preventDefault();
    if (released || result) return;
    holding = true;
    started = true;
    sfx.tap();
  };
  const up = () => {
    if (!holding) return;
    holding = false;
    released = true;
    releasedAt = elapsed;
  };
  const cv = stage.canvas;
  cv.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  stage.setMsg('Maintiens le doigt pour tirer… relâche sur le trait !');
  stage.setScore('');

  await stage.loop((dt, t) => {
    elapsed = t;
    const W = stage.w;
    const H = stage.h;
    if (!result) {
      if (holding && t >= durationMs - 400) up();
      if (holding) {
        holdT += dt;
        rate = Math.min(0.42, 0.08 + 0.22 * holdT);
        if (t - lastPour > 110) { lastPour = t; sfx.pour(); }
      } else rate *= Math.exp(-dt * 5);
      liquid += rate * dt;
      // foam grows with the flow and settles back to a thin head once it stops
      const want = HEAD + rate * 0.28;
      foam += (want - foam) * Math.min(1, dt * (holding ? 6 : 2.4));
      if (liquid + foam >= 1 && !overflow) {
        overflow = true;
        holding = false;
        released = true;
        releasedAt = t;
        sfx.bad();
        vibrate([60, 40, 60]);
      }
      const settled = released && rate < 0.003 && Math.abs(foam - HEAD) < 0.004 && t - releasedAt > 700;
      if (overflow && t - releasedAt > 900) result = { overflow: true };
      else if (settled) result = { top: liquid + HEAD };
      else if (!started && t >= durationMs) result = { empty: true };
      if (result) {
        if (result.top != null) {
          const diff = (result.top - target) * GLASS_MM;
          result.diff = diff;
          if (Math.abs(diff) < 1.5) { sfx.win(); vibrate([40, 30, 40, 30, 120]); } else sfx.land();
        }
        result.at = t;
      }
      stage.setTime(1 - t / durationMs);
    }

    const ctx = stage.ctx;
    ctx.drawImage(bg, 0, 0, W, H);
    drawScene(ctx, W, H, { liquid, foam, rate, holding, target, overflow, t, bubbles, dt, result });
    if (result) {
      const label = result.overflow ? 'ÇA DÉBORDE !' : result.empty ? 'VERRE VIDE' : Math.abs(result.diff) < 1.5 ? 'PILE POIL !' : `${frNum(Math.abs(result.diff))} mm`;
      stage.setScore(label);
      if (t - result.at > 1300) return false;
    }
    return true;
  });

  cv.removeEventListener('pointerdown', down);
  window.removeEventListener('pointerup', up);
  window.removeEventListener('pointercancel', up);
  // A miss is at most 160 mm (-16 000): overflowing is worse than any miss, an empty glass worse still.
  if (!result || result.empty) return { score: -30_000, display: 'Verre vide 😱' };
  if (result.overflow) return { score: -20_000, display: 'Ça déborde ! 💦' };
  const d = Math.abs(result.diff);
  const where = result.diff > 0 ? 'au-dessus' : 'en dessous';
  return { score: -Math.round(d * 100), display: d < 1.5 ? `Pile poil ! (${frNum(d)} mm)` : `${frNum(d)} mm ${where}` };
}

function drawScene(ctx, W, H, s) {
  const gw = Math.min(W * 0.5, 230);
  const top = H * 0.38;
  const bottom = H * 0.86;
  const gh = bottom - top;
  const cx = W / 2;
  const topW = gw;
  const botW = gw * 0.74;
  const xAt = (y, side) => cx + side * (botW / 2 + (topW - botW) / 2 * ((bottom - y) / gh));
  const glass = () => {
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, top);
    ctx.lineTo(cx - botW / 2, bottom - 14);
    ctx.quadraticCurveTo(cx - botW / 2, bottom, cx - botW / 2 + 14, bottom);
    ctx.lineTo(cx + botW / 2 - 14, bottom);
    ctx.quadraticCurveTo(cx + botW / 2, bottom, cx + botW / 2, bottom - 14);
    ctx.lineTo(cx + topW / 2, top);
    ctx.closePath();
  };
  // tap
  const tapY = top - H * 0.13;
  ctx.save();
  ctx.fillStyle = '#c9cde3';
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(cx - 70, tapY - 40, 140, 26, 10);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(cx - 12, tapY - 16, 24, 34, 6);
  ctx.fill();
  ctx.stroke();
  // handle tilts while pouring
  ctx.translate(cx, tapY - 40);
  ctx.rotate(s.holding ? 0.5 : 0);
  ctx.fillStyle = '#ff3d9a';
  ctx.beginPath();
  ctx.roundRect(-10, -70, 20, 72, 8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // stream
  if (s.rate > 0.01) {
    const yTop = tapY + 18;
    const surf = bottom - s.liquid * gh;
    ctx.fillStyle = 'rgba(255,180,40,.9)';
    const sw = 4 + s.rate * 22;
    ctx.fillRect(cx - sw / 2, yTop, sw, Math.max(0, surf - yTop - s.foam * gh * 0.5));
  }
  // glass back
  ctx.save();
  ctx.fillStyle = 'rgba(255,246,228,.08)';
  glass();
  ctx.fill();
  ctx.clip();
  const surf = bottom - s.liquid * gh;
  const g = ctx.createLinearGradient(0, surf, 0, bottom);
  g.addColorStop(0, '#ffcf4a');
  g.addColorStop(1, '#d9790f');
  ctx.fillStyle = g;
  ctx.fillRect(0, surf, W, bottom - surf + 2);
  // bubbles
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (const b of s.bubbles) {
    b.y -= b.v * s.dt;
    if (b.y < 0) b.y += 1;
    const by = bottom - b.y * s.liquid * gh;
    if (by > surf) {
      ctx.beginPath();
      ctx.arc(cx - botW / 2 + b.x * botW, by, b.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // foam with a wobbly top
  const fTop = surf - s.foam * gh;
  ctx.fillStyle = '#fff6e4';
  ctx.beginPath();
  ctx.moveTo(0, surf + 4);
  ctx.lineTo(0, fTop);
  for (let x = 0; x <= W; x += 14) ctx.lineTo(x, fTop - Math.abs(Math.sin(x * 0.09 + s.t / 260)) * (4 + s.rate * 14));
  ctx.lineTo(W, surf + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (s.overflow) {
    ctx.fillStyle = '#fff6e4';
    ctx.strokeStyle = '#150a26';
    ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(cx - topW / 2 + (i / 8) * topW, top - 6 + Math.sin(i * 2 + s.t / 150) * 4, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.roundRect(cx + topW / 2 - 6, top, 16, gh * 0.4 * Math.min(1, s.t % 2000 / 600), 8);
    ctx.fill();
  }
  // glass outline and shine
  ctx.strokeStyle = '#150a26';
  ctx.lineWidth = 5;
  glass();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.45)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(xAt(top + 20, -1) + 14, top + 20);
  ctx.lineTo(xAt(bottom - 40, -1) + 14, bottom - 40);
  ctx.stroke();
  // the line to hit
  const ly = bottom - s.target * gh;
  ctx.save();
  ctx.strokeStyle = '#ffc93c';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 7]);
  ctx.beginPath();
  ctx.moveTo(xAt(ly, -1) - 18, ly);
  ctx.lineTo(xAt(ly, 1) + 18, ly);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '22px "Luckiest Guy", Impact, sans-serif';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#150a26';
  ctx.fillStyle = '#ffc93c';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.strokeText('▶', xAt(ly, -1) - 22, ly);
  ctx.fillText('▶', xAt(ly, -1) - 22, ly);
  ctx.textAlign = 'left';
  ctx.strokeText('◀', xAt(ly, 1) + 22, ly);
  ctx.fillText('◀', xAt(ly, 1) + 22, ly);
  ctx.restore();
  // result ruler
  if (s.result && s.result.top != null) {
    const ry = bottom - s.result.top * gh;
    ctx.save();
    ctx.strokeStyle = Math.abs(s.result.diff) < 1.5 ? '#2fd38a' : '#ff4b5c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(xAt(ry, 1) + 40, ry);
    ctx.lineTo(xAt(ry, 1) + 40, ly);
    ctx.stroke();
    ctx.restore();
  }
}
