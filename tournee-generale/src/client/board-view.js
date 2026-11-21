// The island board on a canvas. The static art (sea, island, path, cases, decor) is painted
// once per size; pawns, the golden bar and movement are drawn every frame. Movement is a
// pure function of the time elapsed in the "move" phase, so every phone shows the same thing.
import { BOARD, WORLD } from '../shared/board.js';
import { RULES } from '../shared/rules.js';
import { characterById } from '../shared/characters.js';
import { makeRng } from '../shared/rng.js';
import { wash, blobPath, glow, grain, fitCanvas, emoji, shade, splatter } from './paint.js';
import { getTilt } from './sensors.js';
import { sfx } from './audio.js';

const CASE_R = 30;
const CASE_COLORS = { blue: '#3d8bff', red: '#ff4b5c', start: '#2fd38a' };
const DECOR = [
  { e: '🌋', x: 500, y: 520, s: 120, c: '#ff8a1f' },
  { e: '🎰', x: 380, y: 860, s: 74, c: '#a65bff' },
  { e: '🍻', x: 610, y: 1010, s: 78, c: '#ffc93c' },
  { e: '🌴', x: 610, y: 760, s: 70, c: '#2fd38a' },
  { e: '🌴', x: 360, y: 1150, s: 60, c: '#2fd38a' },
  { e: '🛖', x: 640, y: 1230, s: 60, c: '#ff3d9a' },
  { e: '🗿', x: 400, y: 640, s: 62, c: '#21d4e8' },
  { e: '🍹', x: 120, y: 300, s: 54, c: '#ff3d9a' },
  { e: '⛵', x: 880, y: 1240, s: 60, c: '#21d4e8' },
  { e: '🐙', x: 120, y: 1330, s: 54, c: '#a65bff' },
  { e: '🦩', x: 900, y: 420, s: 50, c: '#ff3d9a' },
];

export function createBoardView(canvas) {
  let bg = null;
  let size = { w: 0, h: 0, dpr: 1 };
  let view = { s: 1, ox: 0, oy: 0 };
  let cam = { x: WORLD.w / 2, y: WORLD.h / 2, z: 1 };
  let state = null;
  let clock = () => Date.now();
  let me = null;
  let raf = 0;
  let lastStepSound = -1;

  function paintBackground() {
    size = fitCanvas(canvas);
    const { w, h, dpr } = size;
    // Fit the island (with a margin) into the canvas.
    const s = Math.min(w / 860, h / 1360);
    view = { s, ox: w / 2 - (WORLD.w / 2) * s, oy: h / 2 - 760 * s };
    const pad = 40;
    bg = document.createElement('canvas');
    bg.width = Math.round((w + pad * 2) * dpr);
    bg.height = Math.round((h + pad * 2) * dpr);
    const c = bg.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(pad, pad);
    const rng = makeRng(2026);
    // Sea
    c.fillStyle = '#140c2e';
    c.fillRect(-pad, -pad, w + pad * 2, h + pad * 2);
    glow(c, w * 0.1, h * 0.05, w, '#ff3d9a', 0.28);
    glow(c, w, h, w, '#21d4e8', 0.25);
    c.save();
    c.translate(view.ox, view.oy);
    c.scale(s, s);
    for (let i = 0; i < 26; i++) {
      const x = rng() * WORLD.w;
      const y = rng() * WORLD.h;
      c.globalAlpha = 0.25;
      c.strokeStyle = rng() < 0.5 ? '#21d4e8' : '#6b4fd8';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x - 30, y);
      c.quadraticCurveTo(x - 15, y - 10, x, y);
      c.quadraticCurveTo(x + 15, y + 10, x + 30, y);
      c.stroke();
    }
    c.globalAlpha = 1;
    // Island: sand rim, then grass, then a lagoon in the middle.
    const island = (grow) => () => {
      c.beginPath();
      BOARD.path.forEach((p, i) => {
        const dx = p.x - 500;
        const dy = p.y - 760;
        const d = Math.hypot(dx, dy) || 1;
        const x = p.x + (dx / d) * grow;
        const y = p.y + (dy / d) * grow;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.closePath();
    };
    wash(c, island(95), '#ffd48a', { layers: 3, spread: 8, rng, alpha: 0.45, inkWidth: 4 });
    wash(c, island(55), '#f6b765', { layers: 2, spread: 6, rng, alpha: 0.35, edge: false });
    wash(c, island(-40), '#2a9d6a', { layers: 3, spread: 10, rng, alpha: 0.45 });
    wash(c, island(-110), '#1f7a55', { layers: 2, spread: 10, rng, alpha: 0.35, edge: false });
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      splatter(c, 500 + Math.cos(a) * 200 * rng(), 760 + Math.sin(a) * 420 * rng(), rng() < 0.5 ? '#3cc283' : '#155c3f', rng, 4, 30, 8);
    }
    for (const d of DECOR) {
      wash(c, () => blobPath(c, d.x, d.y + d.s * 0.35, d.s * 0.7, d.s * 0.28, rng, 0.2), d.c, { layers: 2, spread: 5, rng, alpha: 0.35, edge: false });
      glow(c, d.x, d.y, d.s * 1.1, d.c, 0.25);
      emoji(c, d.e, d.x, d.y, d.s);
    }
    // Path: a dashed ink trail linking the cases.
    c.save();
    c.strokeStyle = 'rgba(255,246,228,.75)';
    c.lineWidth = 9;
    c.setLineDash([2, 20]);
    c.lineCap = 'round';
    c.beginPath();
    BOARD.cases.forEach((k, i) => (i ? c.lineTo(k.x, k.y) : c.moveTo(k.x, k.y)));
    c.closePath();
    c.stroke();
    c.restore();
    // Cases
    for (const k of BOARD.cases) {
      const col = CASE_COLORS[k.type];
      c.save();
      c.fillStyle = 'rgba(21,10,38,.55)';
      c.beginPath();
      c.ellipse(k.x, k.y + 8, CASE_R, CASE_R * 0.8, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      wash(c, () => { c.beginPath(); c.arc(k.x, k.y, CASE_R, 0, Math.PI * 2); }, col, { layers: 3, spread: 2.5, rng, alpha: 0.7, inkWidth: 4.5 });
      c.save();
      c.globalAlpha = 0.55;
      c.fillStyle = shade(col, 0.55);
      c.beginPath();
      c.ellipse(k.x - 8, k.y - 10, 11, 6, -0.5, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.save();
      c.fillStyle = '#fff6e4';
      c.strokeStyle = '#150a26';
      c.lineWidth = 5;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '30px "Luckiest Guy", Impact, sans-serif';
      const label = k.type === 'blue' ? '+' : k.type === 'red' ? '−' : '★';
      c.strokeText(label, k.x, k.y + 2);
      c.fillText(label, k.x, k.y + 2);
      c.restore();
    }
    const st = BOARD.cases[0];
    c.save();
    c.font = '26px "Luckiest Guy", Impact, sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 6;
    c.strokeStyle = '#150a26';
    c.fillStyle = '#2fd38a';
    c.strokeText('DÉPART', st.x, st.y + 62);
    c.fillText('DÉPART', st.x, st.y + 62);
    c.restore();
    c.restore();
    grain(c, w, h, 0.55);
  }

  const toScreen = (x, y) => [view.ox + x * view.s, view.oy + y * view.s];

  /** Where each player stands right now, plus who is moving. */
  function pawnPositions(t) {
    const pos = new Map();
    let mover = null;
    let bar = state.bar;
    const move = state.phase === 'move' ? state.move : null;
    for (const p of state.players) pos.set(p.id, { ...BOARD.cases[p.pos], hop: 0 });
    if (!move) return { pos, mover, bar, stepKey: null };
    bar = move.barAtStart;
    let stepKey = null;
    for (const e of move.script) {
      for (const b of e.bars) if (t >= b.at) bar = b.bar;
      const from = BOARD.cases[e.from];
      if (t < e.startAt) { pos.set(e.pid, { ...from, hop: 0 }); continue; }
      if (t >= e.endAt) { pos.set(e.pid, { ...BOARD.cases[e.path[e.path.length - 1]], hop: 0 }); continue; }
      mover = e.pid;
      let clockT = e.startAt;
      let prev = from;
      let placed = false;
      for (let i = 0; i < e.path.length; i++) {
        const to = BOARD.cases[e.path[i]];
        if (t < clockT + RULES.stepMs) {
          const k = (t - clockT) / RULES.stepMs;
          const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          pos.set(e.pid, { x: prev.x + (to.x - prev.x) * ease, y: prev.y + (to.y - prev.y) * ease, hop: Math.sin(k * Math.PI) });
          stepKey = `${e.pid}:${i}`;
          placed = true;
          break;
        }
        clockT += RULES.stepMs;
        prev = to;
        if (e.crowns.some((c) => c.step === i)) {
          if (t < clockT + RULES.crownMs) { pos.set(e.pid, { ...to, hop: 0, crown: (t - clockT) / RULES.crownMs }); placed = true; break; }
          clockT += RULES.crownMs;
        }
      }
      if (!placed) pos.set(e.pid, { ...prev, hop: 0, landing: (t - e.landAt) / RULES.landMs, land: e.land });
    }
    return { pos, mover, bar, stepKey };
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!state || !bg) return;
    const ctx = canvas.getContext('2d');
    const { w, h, dpr } = size;
    const now = clock();
    const t = now - state.phaseStartedAt;
    const { pos, mover, bar, stepKey } = pawnPositions(t);
    if (stepKey && stepKey !== lastStepSound) { lastStepSound = stepKey; sfx.step(); }

    // Camera: follow the mover during movement, otherwise show the whole island.
    let target = { x: WORLD.w / 2, y: 760, z: 1 };
    if (mover) { const p = pos.get(mover); target = { x: p.x, y: p.y, z: 1.6 }; }
    cam.x += (target.x - cam.x) * 0.08;
    cam.y += (target.y - cam.y) * 0.08;
    cam.z += (target.z - cam.z) * 0.06;

    const tilt = getTilt();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#140c2e';
    ctx.fillRect(0, 0, w, h);
    // Screen = (painting - camera point) × zoom + centre. At zoom 1 the camera sits in the middle.
    // The camera point is kept far enough from the edges that the zoomed view never leaves the painting.
    const z = cam.z;
    let [cx, cy] = toScreen(cam.x, cam.y);
    const hx = w / (2 * z);
    const hy = h / (2 * z);
    cx = Math.max(hx - 30, Math.min(w - hx + 30, cx));
    cy = Math.max(hy - 30, Math.min(h - hy + 30, cy));
    const sx = (x) => (x - cx) * z + w / 2;
    const sy = (y) => (y - cy) * z + h / 2;
    // Parallax: the painting drifts a little with the phone's tilt (2.5D feel).
    ctx.drawImage(bg, sx(-40 + tilt.x * -6), sy(-40 + tilt.y * -6), (w + 80) * z, (h + 80) * z);
    ctx.save();

    // Golden bar
    const bc = BOARD.cases[bar];
    const [bx, by] = toScreen(bc.x, bc.y);
    const bob = Math.sin(now / 300) * 4;
    glow(ctx, sx(bx), sy(by), 46 * z, '#ffc93c', 0.55);
    ctx.save();
    ctx.strokeStyle = '#ffc93c';
    ctx.lineWidth = 3 * z;
    ctx.setLineDash([6 * z, 5 * z]);
    ctx.lineDashOffset = -now / 40;
    ctx.beginPath();
    ctx.arc(sx(bx), sy(by), (CASE_R + 9) * view.s * z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    emoji(ctx, '👑', sx(bx), sy(by) - 34 * view.s * z + bob, 34 * view.s * z + 10);

    // Pawns: those sharing a case fan out.
    const groups = new Map();
    for (const p of state.players) {
      const q = pos.get(p.id);
      const key = q.hop ? `m${p.id}` : `${Math.round(q.x)},${Math.round(q.y)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const order = [...state.players].sort((a, b) => (a.id === mover) - (b.id === mover) || (a.id === me) - (b.id === me));
    for (const p of order) {
      const q = pos.get(p.id);
      const key = q.hop ? `m${p.id}` : `${Math.round(q.x)},${Math.round(q.y)}`;
      const g = groups.get(key);
      const idx = g.indexOf(p);
      const spread = g.length > 1 ? 18 : 0;
      const ang = (idx / g.length) * Math.PI * 2 - Math.PI / 2;
      const [px, py] = toScreen(q.x + Math.cos(ang) * spread, q.y + Math.sin(ang) * spread * 0.6);
      drawPawn(ctx, p, sx(px), sy(py), z, q, now, p.id === mover, p.id === me);
      if (q.landing != null && q.landing >= 0 && q.landing <= 1 && q.land) {
        const k = q.landing;
        const txt = q.land.dHp ? `−${-q.land.dHp} ❤️` : q.land.dCaps > 0 ? `+${q.land.dCaps} 🪙` : q.land.dCaps < 0 ? `${q.land.dCaps} 🪙` : '';
        if (txt) floatText(ctx, txt, sx(px), sy(py) - (40 + k * 40) * z, 1 - k * k, q.land.dCaps > 0 ? '#ffc93c' : '#ff4b5c', z);
      }
      if (q.crown != null) {
        const k = q.crown;
        floatText(ctx, '+1 👑', sx(px), sy(py) - (50 + k * 50) * z, 1 - k * k * k, '#ffc93c', z * 1.2);
      }
    }
    ctx.restore();
  }

  function floatText(ctx, text, x, y, alpha, color, z) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `${Math.round(24 * Math.max(1, z * 0.8))}px "Luckiest Guy", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#150a26';
    ctx.fillStyle = color;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawPawn(ctx, p, x, y, z, q, now, moving, mine) {
    const ch = characterById(p.character);
    const r = (moving ? 24 : 19) * view.s * z + (moving ? 6 : 4);
    const lift = q.hop * 22 * z;
    // shadow
    ctx.save();
    ctx.fillStyle = 'rgba(21,10,38,.45)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r * (1 - q.hop * 0.3), r * 0.35 * (1 - q.hop * 0.3), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const yy = y - lift - r * 0.4;
    if (mine) glow(ctx, x, yy, r * 2.2, '#fff6e4', 0.35);
    // body: squash & stretch with the hop
    const sq = 1 + (q.hop ? Math.sin(q.hop * Math.PI) * 0.08 : Math.sin(now / 260 + p.order) * 0.03);
    ctx.save();
    ctx.translate(x, yy);
    ctx.scale(1 / sq, sq);
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    grad.addColorStop(0, shade(ch.color, 0.5));
    grad.addColorStop(0.6, ch.color);
    grad.addColorStop(1, shade(ch.color, -0.35));
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#150a26';
    ctx.lineWidth = Math.max(2.5, 3 * z * view.s * 2);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    emoji(ctx, ch.emoji, x, yy + 1, r * 1.15);
    if (mine) {
      ctx.save();
      ctx.font = `900 ${Math.round(13 + 3 * z)}px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff6e4';
      ctx.strokeStyle = '#150a26';
      ctx.lineWidth = 4;
      ctx.strokeText('TOI', x, yy - r - 8);
      ctx.fillText('TOI', x, yy - r - 8);
      ctx.restore();
    }
  }

  const onResize = () => paintBackground();
  window.addEventListener('resize', onResize);
  // Fonts load late on a phone: repaint once they are ready.
  document.fonts?.ready.then(() => bg && paintBackground());

  return {
    update(s, getNow, myId) {
      state = s;
      clock = getNow;
      me = myId;
      if (!bg) paintBackground();
      if (!raf) frame();
    },
    resize: paintBackground,
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', onResize);
    },
  };
}
