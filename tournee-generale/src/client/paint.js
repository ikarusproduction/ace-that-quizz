// Watercolor-ish drawing helpers for canvas: soft layered washes, darker pooled edges,
// wobbly ink outlines, paper grain. Placeholder art until the Higgsfield assets land.
import { makeRng } from '../shared/rng.js';

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; } else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Irregular closed blob path around (x, y). */
export function blobPath(ctx, x, y, rx, ry, rng, wobble = 0.12, points = 14) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const k = 1 + (rng() - 0.5) * 2 * wobble;
    pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
  }
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % points];
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(p[0], p[1], mx, my);
  }
  const p = pts[0];
  const q = pts[1];
  ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  ctx.closePath();
}

/** Watercolor wash: several translucent offset layers, a pooled darker edge, then optional ink. */
export function wash(ctx, path, color, { layers = 3, spread = 3, rng = Math.random, edge = true, ink = '#150a26', inkWidth = 0, alpha = 0.55 } = {}) {
  ctx.save();
  for (let i = 0; i < layers; i++) {
    ctx.save();
    ctx.translate((rng() - 0.5) * spread * 2, (rng() - 0.5) * spread * 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    path();
    ctx.fill();
    ctx.restore();
  }
  if (edge) {
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color.startsWith('#') ? shade(color, -0.35) : color;
    ctx.lineWidth = Math.max(2, spread);
    path();
    ctx.stroke();
  }
  if (inkWidth) {
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = ink;
    ctx.lineWidth = inkWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    path();
    ctx.stroke();
  }
  ctx.restore();
}

/** Scattered paint droplets. */
export function splatter(ctx, x, y, color, rng, n = 10, radius = 40, size = 5) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * radius;
    ctx.globalAlpha = 0.25 + rng() * 0.45;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.3 + rng()), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

let paperTile = null;
/** A repeating paper-grain pattern. */
export function paperPattern(ctx) {
  if (!paperTile) {
    paperTile = document.createElement('canvas');
    paperTile.width = paperTile.height = 256;
    const c = paperTile.getContext('2d');
    const img = c.createImageData(256, 256);
    const rng = makeRng(77);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (rng() - 0.5) * 120;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 40;
    }
    c.putImageData(img, 0, 0);
    // fibres
    c.globalAlpha = 0.08;
    c.strokeStyle = '#fff';
    for (let i = 0; i < 120; i++) {
      c.beginPath();
      const x = rng() * 256;
      const y = rng() * 256;
      c.moveTo(x, y);
      c.lineTo(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 30);
      c.stroke();
    }
  }
  return ctx.createPattern(paperTile, 'repeat');
}

/** Lay the paper grain over the whole canvas. */
export function grain(ctx, w, h, strength = 0.5) {
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = paperPattern(ctx);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Soft glowing light pool. */
export function glow(ctx, x, y, r, color, a = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Night background shared by the mini-games: indigo wash with magenta and teal light. */
export function nightBackdrop(ctx, w, h, seed = 3) {
  const rng = makeRng(seed);
  ctx.fillStyle = '#1a1036';
  ctx.fillRect(0, 0, w, h);
  glow(ctx, w * 0.15, h * 0.12, w * 0.9, '#ff3d9a', 0.35);
  glow(ctx, w * 0.95, h * 0.8, w * 0.9, '#21d4e8', 0.28);
  glow(ctx, w * 0.8, h * 0.2, w * 0.5, '#ffc93c', 0.12);
  for (let i = 0; i < 9; i++) {
    wash(ctx, () => blobPath(ctx, rng() * w, rng() * h, 40 + rng() * 120, 30 + rng() * 90, rng, 0.3), rng() < 0.5 ? '#35206b' : '#2a1858', { layers: 2, spread: 6, rng, alpha: 0.35, edge: false });
  }
}

/** Fit a canvas to its CSS box at device pixel ratio. Returns { w, h, dpr }. */
export function fitCanvas(canvas, maxDpr = 2) {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

/** Emoji drawn centred, with an ink drop shadow. */
export function emoji(ctx, ch, x, y, size) {
  ctx.save();
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(21,10,38,.55)';
  ctx.shadowOffsetY = size * 0.08;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#000';
  ctx.fillText(ch, x, y);
  ctx.restore();
}
