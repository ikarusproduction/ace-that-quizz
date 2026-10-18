// Little SVG figures for the visual puzzles. Everything is drawn from plain data ({ shape, n, rot, color }), so the same
// puzzle looks the same on every phone and nothing needs an image file.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  kids.forEach((c) => e.append(c));
  return e;
};
const poly = (pts) => pts.map((p) => p.join(',')).join(' ');
const star = () => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.2 : 0.5; const a = (Math.PI / 5) * i - Math.PI / 2; pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]); }
  return pts;
};
const SHAPE_NODE = {
  circle: (c) => el('circle', { cx: 0.5, cy: 0.5, r: 0.38, fill: c }),
  square: (c) => el('rect', { x: 0.14, y: 0.14, width: 0.72, height: 0.72, fill: c }),
  triangle: (c) => el('polygon', { points: poly([[0.5, 0.12], [0.9, 0.86], [0.1, 0.86]]), fill: c }),
  diamond: (c) => el('polygon', { points: poly([[0.5, 0.06], [0.92, 0.5], [0.5, 0.94], [0.08, 0.5]]), fill: c }),
  cross: (c) => el('polygon', { points: poly([[0.36, 0.1], [0.64, 0.1], [0.64, 0.36], [0.9, 0.36], [0.9, 0.64], [0.64, 0.64], [0.64, 0.9], [0.36, 0.9], [0.36, 0.64], [0.1, 0.64], [0.1, 0.36], [0.36, 0.36]]), fill: c }),
  star: (c) => el('polygon', { points: poly(star()), fill: c }),
  // asymmetric, so a turn is visible
  arrow: (c) => el('polygon', { points: poly([[0.5, 0.08], [0.88, 0.48], [0.64, 0.48], [0.64, 0.92], [0.36, 0.92], [0.36, 0.48], [0.12, 0.48]]), fill: c }),
};
const GRID = [[0.2, 0.2], [0.5, 0.2], [0.8, 0.2], [0.2, 0.5], [0.5, 0.5], [0.8, 0.5], [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]];
const ORDER = [4, 0, 8, 2, 6, 1, 7, 3, 5]; // fill the middle first, then the corners

/** One figure inside a square viewBox. n > 1 draws n smaller copies on a 3x3 layout. */
export function figure(f, px = 48) {
  const svg = el('svg', { viewBox: '0 0 1 1', width: px, height: px, role: 'img', 'aria-hidden': 'true', class: 'fig' });
  const make = SHAPE_NODE[f.shape] ?? SHAPE_NODE.circle;
  const n = Math.max(1, Math.min(9, f.n ?? 1));
  if (n === 1) {
    const g = el('g', { transform: `rotate(${f.rot ?? 0} 0.5 0.5)` }, [make(f.color)]);
    svg.append(g);
  } else {
    for (let i = 0; i < n; i++) {
      const [x, y] = GRID[ORDER[i]];
      svg.append(el('g', { transform: `translate(${x - 0.5 * 0.34} ${y - 0.5 * 0.34}) scale(0.34) rotate(${f.rot ?? 0} 0.5 0.5)` }, [make(f.color)]));
    }
  }
  return svg;
}

/** A scatter picture: many small shapes at positions in 0..1. */
export function scatter(items, px = 280) {
  const svg = el('svg', { viewBox: '0 0 1 1', width: px, height: px, role: 'img', 'aria-label': 'A scatter of shapes', class: 'scatter-pic' });
  svg.append(el('rect', { x: 0, y: 0, width: 1, height: 1, fill: '#0b0c0d' }));
  const s = 0.13;
  for (const it of items) {
    const make = SHAPE_NODE[it.shape] ?? SHAPE_NODE.circle;
    svg.append(el('g', { transform: `translate(${it.x - s / 2} ${it.y - s / 2}) scale(${s})` }, [make(it.color)]));
  }
  return svg;
}
