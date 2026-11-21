// Shared shell for every mini-game: a full-screen canvas, a timer bar, a score label,
// a hint line, and a frame loop that stops when the game ends or is cancelled.
import { h } from '../ui.js';
import { fitCanvas } from '../paint.js';

export function createStage({ name, durationMs }) {
  const canvas = h('canvas');
  const score = h('div', { class: 'score' }, '');
  const bar = h('i', { style: { width: '100%' } });
  const msg = h('div', { class: 'stage-msg' }, '');
  const hud = h('div', { class: 'stage-hud' },
    h('div', { class: 'row' }, h('div', { class: 'name' }, name), score),
    h('div', { class: 'timer' }, bar));
  const root = h('div', { class: 'stage' }, canvas, hud, msg);
  document.getElementById('overlays').append(root);
  let size = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  let alive = true;
  let raf = 0;
  const onResize = () => { size = fitCanvas(canvas); };
  window.addEventListener('resize', onResize);

  return {
    root, canvas, ctx,
    get w() { return size.w; },
    get h() { return size.h; },
    get dpr() { return size.dpr; },
    get alive() { return alive; },
    durationMs,
    setScore(t) { score.textContent = t; },
    setMsg(t) { msg.textContent = t; },
    setTime(frac) { bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; },
    /** Run `step(dt, elapsedMs)` every frame until it returns false or the stage is closed. */
    loop(step) {
      return new Promise((resolve) => {
        let last = performance.now();
        const t0 = last;
        const f = (now) => {
          if (!alive) return resolve();
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
          if (step(dt, now - t0) === false) return resolve();
          raf = requestAnimationFrame(f);
        };
        raf = requestAnimationFrame(f);
      });
    },
    /** Show the result card over the game. */
    done(t1, t2, extra) {
      root.append(h('div', { class: 'stage-done' }, h('div', { class: 't1' }, t1), t2 ? h('div', { class: 't2' }, t2) : null, extra ?? null));
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export const frNum = (n, d = 1) => n.toFixed(d).replace('.', ',');
