// The launch board, "L'Île de la Gueule de Bois": one closed loop of 32 cases.
// World coordinates: 1000 × 1500. Phones scale the whole island to the screen.
export const WORLD = { w: 1000, h: 1500 };
export const CASE_COUNT = 32;
export const START = 0;
export const BAR_START = 16;

const RED = new Set([3, 7, 10, 14, 19, 22, 26, 29]);

function curve(t) {
  return {
    x: 500 + 360 * Math.sin(t) + 70 * Math.sin(3 * t),
    y: 760 + 590 * Math.cos(t) + 90 * Math.sin(2 * t),
  };
}

function layout() {
  const N = 2400;
  const pts = [];
  const acc = [0];
  for (let i = 0; i <= N; i++) pts.push(curve((i / N) * Math.PI * 2));
  for (let i = 1; i <= N; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = acc[N];
  const cases = [];
  let j = 0;
  for (let k = 0; k < CASE_COUNT; k++) {
    const target = (k / CASE_COUNT) * total;
    while (acc[j + 1] < target) j++;
    const p = pts[j];
    cases.push({
      id: k,
      x: Math.round(p.x),
      y: Math.round(p.y),
      type: k === START ? 'start' : RED.has(k) ? 'red' : 'blue',
    });
  }
  return { cases, path: pts.filter((_, i) => i % 8 === 0) };
}

export const BOARD = layout();

/** Cases visited when walking `steps` from `from` (excludes the start, includes the end). */
export function walk(from, steps) {
  const out = [];
  for (let i = 1; i <= steps; i++) out.push((from + i) % CASE_COUNT);
  return out;
}
