// The Fog curse: the answers are blurred until you pull focus. Two ways, both cost time while the clock runs:
//   - trace circles with a finger on the dial (about a lap and a quarter), clockwise or not, or
//   - tap four times (the dial, or anywhere on the blurred answers; the 1-4 keys and Enter count as taps too).
import { h } from './dom.js';
import { sfx } from './audio.js';
import { haptic, motionReduced } from './fx.js';

const LAPS = 1.25;       // laps of the dial for a full focus
const TAP_STEP = 0.26;   // four taps
const MAX_BLUR = 7;      // px

export function fogFocus(choicesEl, { progress = 0, onProgress = () => {}, onDone = () => {} } = {}) {
  let p = Math.min(0.99, progress);
  let done = false;
  let ticked = Math.floor(p * 12);

  const knob = h('i.fog-knob');
  const label = h('b.fog-pct', {}, '0%');
  const dial = h('button.fog-dial', { type: 'button', 'aria-label': 'Focus dial. Trace circles with your finger, or press it four times, to bring the answers into focus.' }, h('span.fog-ring'), knob, label);
  const note = h('div.fog-note', { role: 'status' }, h('b', {}, 'FOG'), ' Draw circles on the dial to focus, or tap 4 times');
  const ui = h('div.fog-ui', {}, note, dial);
  const wrap = h('div.fog-wrap', {}, choicesEl, ui);
  choicesEl.classList.add('hex-blur');

  const paint = () => {
    choicesEl.style.setProperty('--blur', `${(MAX_BLUR * (1 - p)).toFixed(2)}px`);
    dial.style.setProperty('--p', String(p));
    label.textContent = `${Math.round(p * 100)}%`;
    onProgress(p);
  };
  const add = (amount, { tap = false } = {}) => {
    if (done) return;
    p = Math.max(0, Math.min(1, p + amount));
    const step = Math.floor(p * 12);
    if (step > ticked) { ticked = step; sfx.focusTick?.(); haptic('tick'); }
    if (tap) { sfx.focusTick?.(); haptic('tap'); }
    paint();
    if (p >= 1) finish();
  };
  const finish = () => {
    done = true;
    choicesEl.classList.remove('hex-blur');
    choicesEl.style.removeProperty('--blur');
    choicesEl.removeEventListener('click', capture, true);
    sfx.focusLock?.();
    haptic('correct');
    note.textContent = 'In focus';
    ui.classList.add('done');
    setTimeout(() => ui.remove(), motionReduced() ? 200 : 700);
    onDone();
  };
  // taps on the blurred answers (or the number keys) only pull focus; they never answer
  const capture = (e) => { e.stopPropagation(); e.preventDefault(); add(TAP_STEP, { tap: true }); };
  choicesEl.addEventListener('click', capture, true);

  // tracing circles
  let prev = null; let moved = 0; let t0 = 0; let dragging = false;
  const angleOf = (e) => { const r = dial.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  const place = (a) => { knob.style.transform = `rotate(${a}rad) translate(46px) rotate(${-a}rad)`; };
  dial.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; t0 = performance.now(); prev = angleOf(e); try { dial.setPointerCapture(e.pointerId); } catch { /* not all engines */ } });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging || done) return;
    const r = dial.getBoundingClientRect();
    const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const a = angleOf(e);
    place(a);
    if (dist < 14) { prev = a; return; }
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    prev = a;
    moved += Math.abs(d) * dist;
    add(Math.abs(d) / (2 * Math.PI * LAPS));
  });
  const up = () => { dragging = false; prev = null; };
  dial.addEventListener('pointerup', (e) => { if (moved < 6 && performance.now() - t0 < 400) { add(TAP_STEP, { tap: true }); } up(e); e.preventDefault(); });
  dial.addEventListener('pointercancel', up);
  // keyboard: Enter or Space on the dial is a tap (the button's click, when it was not a pointer press)
  dial.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(TAP_STEP, { tap: true }); } });
  place(-Math.PI / 2);
  paint();
  return wrap;
}
