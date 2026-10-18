// Application shell: boot, shared services (bank, storage, settings) and a tiny router.
import { loadBank } from '../engine/bank.js';
import { makeContext } from '../engine/game.js';
import { createMemoryStorage } from '../storage/memory.js';
import { openIdbStorage } from '../storage/idb.js';
import { createRepo } from '../storage/repo.js';
import { h, mount } from './dom.js';
import { configureAudio } from './audio.js';
import { configureFx } from './fx.js';
import { configureHexFx } from './hexfx.js';
import { setReducedMotion, installLighting, setMood } from './lighting.js';
import { toast } from './components.js';

export const app = {
  repo: null,
  bank: null,
  ctx: null,
  settings: null,
  storageWarning: null, // set when we had to fall back to in-memory storage
  root: null,
  current: null, // { name, params, dispose }
  screens: {},
};

export function register(name, fn) {
  app.screens[name] = fn;
}

async function openStorage() {
  try {
    const storage = await openIdbStorage();
    // Some private modes open the database but refuse writes; check with a real write.
    await storage.transact([{ op: 'put', store: 'kv', value: { key: 'probe', at: Date.now() } }, { op: 'delete', store: 'kv', key: 'probe' }]);
    return { storage };
  } catch (err) {
    console.warn('IndexedDB unavailable, using memory storage', err);
    return { storage: createMemoryStorage(), warning: err?.message ?? 'Storage unavailable' };
  }
}

export async function applySettings() {
  app.settings = await app.repo.getSettings();
  configureAudio(app.settings);
  setReducedMotion(app.settings.reduceMotion);
  configureFx(app.settings);
  configureHexFx(app.settings);
  return app.settings;
}

export async function boot(root) {
  app.root = root;
  installLighting();
  mount(root, h('div.screen', {}, h('div.gate', {}, h('p.mono.dim', {}, 'Warming up the bulb…'))));

  const readJson = async (rel) => {
    const res = await fetch(rel, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load ${rel} (${res.status})`);
    return res.json();
  };
  app.readJson = readJson;
  try {
    app.bank = await loadBank(readJson);
    app.ctx = makeContext([...app.bank.questions, ...(app.bank.variants ?? [])]);
  } catch (err) {
    console.error(err);
    mount(root, h('div.screen', {}, h('div.panel.warn', {}, h('h2', {}, 'Could not load the questions'), h('p', {}, String(err.message ?? err)), h('p.small.dim', {}, 'Check your connection and reload. If you opened index.html straight from disk, run a local server instead (npm start).'), h('button.btn.primary', { onclick: () => location.reload() }, 'Reload'))));
    return false;
  }

  const { storage, warning } = await openStorage();
  app.storageWarning = warning ?? null;
  try {
    app.repo = await createRepo(storage);
  } catch (err) {
    // A newer save or a failed migration must never be silently overwritten.
    console.error(err);
    mount(root, h('div.screen', {}, h('div.panel.warn', {}, h('h2', {}, 'Your save data needs attention'), h('p', {}, String(err.message ?? err)), h('p.small.dim', {}, 'Nothing has been changed or deleted. Update the game, or export your data from a version that can read it.'))));
    return false;
  }
  await applySettings();
  return true;
}

/* -------------------------------------------------------------- router */

async function render(name, params, { first = false } = {}) {
  const screen = app.screens[name] ?? app.screens.menu;
  app.current?.dispose?.();
  app.current = { name, params, dispose: null };
  const myToken = (app.token = (app.token ?? 0) + 1);
  let out;
  try {
    out = await screen(app, params ?? {});
  } catch (err) {
    console.error(err);
    toast(`Something went wrong: ${err.message}`, 'err');
    if (name !== 'menu') return go('menu', {}, { replace: true });
    throw err;
  }
  if (myToken !== app.token) return; // navigated away while loading
  const el = out instanceof Node ? out : out.el;
  app.current.dispose = out instanceof Node ? null : out.dispose ?? null;
  mount(app.root, el);
  if (!first) window.scrollTo(0, 0);
}

export function go(name, params = {}, { replace = false } = {}) {
  const state = { name, params };
  if (replace) history.replaceState(state, '', `#/${name}`);
  else history.pushState(state, '', `#/${name}`);
  return render(name, params);
}

export function startRouter(initial = 'menu') {
  history.replaceState({ name: initial, params: {} }, '', `#/${initial}`);
  window.addEventListener('popstate', (e) => {
    const st = e.state ?? { name: 'menu', params: {} };
    if (app.current?.name === 'game' && app.current.guardBack?.()) {
      // The game screen handled it (opened its pause menu); stay on the game.
      history.pushState({ name: 'game', params: app.current.params }, '', '#/game');
      return;
    }
    render(st.name, st.params);
  });
  return render(initial, {}, { first: true });
}

export function goBack(fallback = 'menu') {
  if (history.length > 1 && history.state?.name !== fallback) history.back();
  else go(fallback, {}, { replace: true });
}

export { setMood };
