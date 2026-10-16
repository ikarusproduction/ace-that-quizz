// Theme picker: fill five slots with themes (or spin for a random set), then play.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { screenHeader, toast } from '../components.js';
import { sfx } from '../audio.js';
import { haptic, spinReel, confetti } from '../fx.js';
import { THEMES, SLOT_COUNT, DEFAULT_THEMES, availableThemes, themeCounts, NEWS_WINDOW_DAYS } from '../../engine/themes.js';
import { Rng } from '../../engine/rng.js';

const GROUPS = ['Brain', 'Culture', 'Life', 'Sport'];
const KEY = 'thk-last-themes';

function loadLast(avail) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(v) && v.length === SLOT_COUNT && v.every((t) => avail.includes(t))) return v;
  } catch { /* storage unavailable */ }
  return null;
}
function saveLast(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

export async function themesScreen(app, params) {
  setMood('calm');
  const now = Date.now();
  const avail = availableThemes(app.bank.questions, now);
  const counts = themeCounts(app.bank.questions, now);
  const defaults = DEFAULT_THEMES.filter((t) => avail.includes(t));
  /** @type {(string|null)[]} */
  let slots = loadLast(avail) ?? Array.from({ length: SLOT_COUNT }, (_, i) => defaults[i] ?? null);
  let busy = false;

  const root = h('div.screen');

  const slotNode = (id, i) => {
    const t = THEMES[id];
    return h('button.slot', {
      type: 'button',
      class: id ? 'filled' : 'empty',
      'aria-label': id ? `Slot ${i + 1}: ${t.label}. Tap to clear.` : `Slot ${i + 1}: empty`,
      dataset: { slot: String(i) },
      onclick: () => {
        if (busy || !id) return;
        slots[i] = null; sfx.tap(); haptic('tap'); paint();
      },
    }, id ? [sprite(t.sprite, 40), h('span.slot-name', {}, t.short)] : [h('span.slot-q', {}, '?'), h('span.slot-name', {}, `Slot ${i + 1}`)]);
  };

  const randomise = async () => {
    if (busy) return;
    busy = true;
    sfx.drumroll();
    haptic('big');
    const rng = new Rng(Rng.fromSeed(`${Math.random()}-${now}`).state);
    const bag = rng.shuffle([...avail]);
    const picks = Array.from({ length: SLOT_COUNT }, (_, i) => bag[i % bag.length]);
    const boxes = [...root.querySelectorAll('.slot')];
    const items = avail.map((id) => ({ key: id, node: () => h('span.reel-item', {}, sprite(THEMES[id].sprite, 40), h('span.slot-name', {}, THEMES[id].short)) }));
    await Promise.all(boxes.map((box, i) => {
      box.classList.add('reeling');
      return spinReel(box, items, picks[i], { ms: 700 + i * 380 });
    }));
    slots = picks;
    busy = false;
    sfx.jackpot();
    confetti({ count: 40 });
    haptic('jackpot');
    paint();
  };

  const add = (id) => {
    if (busy) return;
    let i = slots.indexOf(null);
    if (i < 0) {
      // All full: replace the slot that has been there longest (first), shifting the rest left.
      slots = [...slots.slice(1), id];
      i = SLOT_COUNT - 1;
    } else slots[i] = id;
    sfx.select(); haptic('select');
    paint();
    root.querySelector(`.slot[data-slot="${i}"]`)?.animate?.([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
  };

  const start = () => {
    if (busy || slots.some((s) => !s)) return;
    saveLast(slots);
    sfx.stake(); haptic('big');
    go('game', { ...params, themes: [...slots] });
  };

  function paint() {
    const full = slots.every(Boolean);
    const used = {};
    for (const s of slots) if (s) used[s] = (used[s] ?? 0) + 1;
    mount(root,
      screenHeader('Pick 5 themes', () => goBack(params.online ? 'online' : 'setup')),
      h('p.small.dim', {}, 'Every round asks one question from each slot. Tap a theme to fill the next slot, or spin for a random mix. You can repeat a theme.'),
      h('div.slots', {}, slots.map(slotNode)),
      h('button.btn.block.spin-btn', { type: 'button', disabled: busy, onclick: randomise }, '🎲  Spin random'),
      ...GROUPS.map((g) => {
        const ids = avail.filter((id) => THEMES[id].group === g);
        if (!ids.length) return null;
        return h('div.theme-group', {}, h('h3', {}, g), h('div.theme-grid', {}, ids.map((id) => h('button.theme', {
          type: 'button', disabled: busy, 'aria-pressed': String(Boolean(used[id])), dataset: { theme: id },
          onclick: () => add(id),
        }, sprite(THEMES[id].sprite, 32), h('span.theme-name', {}, THEMES[id].label), used[id] ? h('span.badge', {}, `×${used[id]}`) : null))));
      }),
      !avail.includes('news') ? h('p.tiny.mute', {}, `Current Affairs is hidden: it only uses news from the last ${NEWS_WINDOW_DAYS} days and none is loaded right now.`) : h('p.tiny.mute', {}, `Current Affairs only asks about news from the last ${NEWS_WINDOW_DAYS} days (${counts.news} loaded).`),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', disabled: !full || busy, onclick: start }, full ? 'Start game' : `Fill ${slots.filter((s) => !s).length} more slot${slots.filter((s) => !s).length === 1 ? '' : 's'}`)),
    );
  }
  paint();
  return root;
}
