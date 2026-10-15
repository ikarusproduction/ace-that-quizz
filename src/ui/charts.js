// Small dependency-free SVG charts.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Line chart. points: [{ x: number, y: number|null, label?: string }].
 * yDomain defaults to [0, 1] and is formatted by yFormat.
 */
export function lineChart({ points, w = 340, h = 160, yDomain = [0, 1], yFormat = (v) => `${Math.round(v * 100)}%`, color = '#e8a33d', xLabels = null, ariaLabel = 'Chart', guides = 4, markers = true }) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart', role: 'img', 'aria-label': ariaLabel });
  const m = { l: 34, r: 10, t: 10, b: xLabels ? 22 : 12 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const [y0, y1] = yDomain;
  const sy = (v) => m.t + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  for (let i = 0; i <= guides; i++) {
    const v = y0 + ((y1 - y0) * i) / guides;
    svg.append(el('line', { x1: m.l, x2: w - m.r, y1: sy(v), y2: sy(v), stroke: '#34383c', 'stroke-width': 1, 'stroke-dasharray': i ? '2 3' : '' }));
    svg.append(el('text', { x: m.l - 4, y: sy(v) + 3, 'text-anchor': 'end' }, yFormat(v)));
  }
  const pts = points.filter((p) => p.y != null);
  if (!pts.length) return svg;
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const sx = (v) => (x1 === x0 ? m.l + pw / 2 : m.l + ((v - x0) / (x1 - x0)) * pw);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  svg.append(el('path', { d: `${d} L${sx(pts[pts.length - 1].x).toFixed(1)} ${sy(y0)} L${sx(pts[0].x).toFixed(1)} ${sy(y0)} Z`, fill: color, opacity: 0.12 }));
  svg.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'shape-rendering': 'crispEdges' }));
  if (markers && pts.length <= 40) {
    for (const p of pts) {
      const dot = el('rect', { x: sx(p.x) - 3, y: sy(p.y) - 3, width: 6, height: 6, fill: color, stroke: '#0b0c0d', 'stroke-width': 1 });
      if (p.label) dot.append(el('title', {}, p.label));
      svg.append(dot);
    }
  }
  if (xLabels) {
    svg.append(el('text', { x: m.l, y: h - 6 }, xLabels[0]));
    svg.append(el('text', { x: w - m.r, y: h - 6, 'text-anchor': 'end' }, xLabels[1]));
  }
  return svg;
}
