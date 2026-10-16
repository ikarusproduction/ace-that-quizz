// Cloud save on the game's own website. Every device has a random SAVE CODE (like AB12-CD34-EF56-GH78); the
// website keeps one copy of the player data under that code, so clearing the browser or switching phones does not
// lose profiles, cards or progress. Restoring merges (never deletes). Needs the PHP relay on the same site.
import { apiUrl, isPollBase } from '../net/session.js';

const KEY_STORE = 'thk-save-key';
const META_STORE = 'thk-save-meta';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const mem = new Map(); // fallback when localStorage is unavailable
const lsGet = (k) => { try { return localStorage.getItem(k) ?? mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } };
const lsSet = (k, v) => { mem.set(k, v); try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const formatKey = (raw) => {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return c.match(/.{1,4}/g)?.join('-') ?? '';
};
export const isValidKey = (k) => /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(k);
export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return formatKey(Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join(''));
}

async function gzipB64(text) {
  if (typeof CompressionStream === 'undefined') return { enc: 'json', data: text };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { enc: 'gzip-b64', data: btoa(bin) };
}
async function ungzipB64(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Is cloud save available with this config? (needs the PHP relay base) */
export const cloudAvailable = (config) => Boolean(config?.relay && isPollBase(config.relay) && config.cloud !== false);

export function createCloud({ repo, base, getAccess = () => '', fetchImpl = globalThis.fetch?.bind(globalThis), now = Date.now }) {
  let timer = null;
  let lastPrint = lsGet(`${META_STORE}-print`) ?? '';
  let busy = null;
  const listeners = new Set();
  const meta = () => { try { return JSON.parse(lsGet(META_STORE) ?? '{}'); } catch { return {}; } };
  const setMeta = (m) => { lsSet(META_STORE, JSON.stringify({ ...meta(), ...m })); listeners.forEach((f) => f(meta())); };

  async function call(path, { method = 'GET', query, body } = {}) {
    const url = apiUrl(base, path, method === 'GET' ? { ...query, access: getAccess() } : undefined);
    const res = await fetchImpl(url, method === 'GET' ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, access: getAccess() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error ?? `Server error (${res.status})`), { status: res.status });
    return j;
  }

  async function fingerprint() {
    const [profiles, sessions, results] = await Promise.all([repo.storage.getAll('profiles'), repo.storage.getAll('sessions'), repo.storage.getAll('results')]);
    return `${profiles.map((p) => `${p.id}:${p.updatedAt}:${(p.ownedCards ?? []).length}`).join(',')}|${sessions.length}|${results.length}`;
  }

  const api = {
    key() { return lsGet(KEY_STORE); },
    setKey(k) { lsSet(KEY_STORE, k); },
    ensureKey() {
      let k = lsGet(KEY_STORE);
      if (!k || !isValidKey(k)) { k = newKey(); lsSet(KEY_STORE, k); }
      return k;
    },
    meta,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Upload everything now. Resolves { ok, at } or throws. */
    async push({ force = false } = {}) {
      if (busy) return busy;
      busy = (async () => {
        try {
          const key = api.ensureKey();
          const profiles = await repo.storage.getAll('profiles');
          if (!profiles.length && !force) return { ok: false, skipped: 'nothing to save yet' };
          const fp = await fingerprint();
          const data = await repo.exportData();
          const { enc, data: packed } = await gzipB64(JSON.stringify(data));
          const at = now();
          await call('/api/save', { method: 'POST', body: { key, enc, data: packed, updatedAt: at, force } });
          lastPrint = fp;
          lsSet(`${META_STORE}-print`, fp);
          setMeta({ lastSavedAt: at, error: null, players: profiles.length });
          return { ok: true, at };
        } catch (e) {
          setMeta({ error: e.message });
          throw e;
        } finally { busy = null; }
      })();
      return busy;
    },

    /** Download the save for a code and merge it into this device. */
    async restore(rawKey) {
      const key = formatKey(rawKey);
      if (!isValidKey(key)) throw new Error('That save code is not valid. It looks like AB12-CD34-EF56-GH78.');
      const j = await call('/api/save', { query: { key } });
      const text = j.enc === 'gzip-b64' ? await ungzipB64(j.data) : j.data;
      const summary = await repo.importData(JSON.parse(text), { mode: 'merge' });
      api.setKey(key);
      setMeta({ lastSavedAt: j.updatedAt, restoredAt: now(), error: null });
      lastPrint = '';
      return summary;
    },

    /** Push when something changed. Cheap enough to call often. */
    async pushIfChanged() {
      try {
        const fp = await fingerprint();
        if (fp === lastPrint) return null;
        return await api.push();
      } catch { return null; }
    },

    /** Start background syncing: on a timer, when the tab is hidden, and shortly after any change. */
    start() {
      if (timer) return;
      const tick = () => api.pushIfChanged();
      timer = setInterval(tick, 20000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(); });
      setTimeout(tick, 4000);
    },
    stop() { clearInterval(timer); timer = null; },
  };
  return api;
}
