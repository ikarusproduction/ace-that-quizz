// Minimal DOM helpers. No framework: screens are plain functions that return elements.

/**
 * h('button.btn.primary', { onclick }, 'Play')
 * Props: class/className, dataset, style (object), on* handlers, aria-*, any attribute.
 * Children: strings, numbers, nodes, arrays (flattened); null/false are skipped.
 */
export function h(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = `${el.className} ${v}`.trim();
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null || sv === '') continue; if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(root, ...nodes) {
  root.replaceChildren();
  append(root, nodes);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Resolve after `ms` unless the signal aborts first. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function formatDate(ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(ts).toLocaleDateString(undefined, opts);
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** Download JSON as a file. */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = 'application/json,.json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => resolve(null));
    document.body.append(input);
    input.click();
  });
}

export const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });

/** Local calendar date as YYYY-MM-DD (used for the daily seed). */
export function localDateKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
