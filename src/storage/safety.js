// A second, separate copy of every player, kept in its own IndexedDB database on this device.
// It guards against the main database coming back empty or damaged (a failed upgrade, a half-cleared site, a bug): on start,
// if there are no players but a safety copy has some, they are put back. It never replaces a copy that has players with an
// empty one, and it keeps the previous copy as well, so one bad write cannot take both.
// It cannot help when the browser clears all site data or the player opens the game on another address; for that there is
// the save code (cloud) and Export in Settings.
const DB = 'the-house-knows-safety';
const STORE = 'snap';

/** A tiny key-value store on raw IndexedDB: { get(key), put(key, value) }. */
export function openSafetyStore(factory = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('IndexedDB is not available'));
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const run = (mode, fn) => new Promise((res, rej) => { const tx = db.transaction(STORE, mode); const r = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
      resolve({ get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)) });
    };
  });
}

export function createSafety({ repo, store, now = Date.now }) {
  const count = (snap) => snap?.profiles ?? 0;
  return {
    /** Copy everything now. Skips (returns false) when there is nothing worth keeping. */
    async save() {
      const profiles = await repo.storage.getAll('profiles');
      if (!profiles.length) return false;
      const latest = await store.get('latest');
      if (latest) await store.put('previous', latest);
      await store.put('latest', { at: now(), profiles: profiles.length, json: JSON.stringify(await repo.exportData()) });
      return true;
    },
    /** If the main database has no players, restore them from the newest safety copy that has some. */
    async restoreIfEmpty() {
      if ((await repo.storage.getAll('profiles')).length) return null;
      for (const key of ['latest', 'previous']) {
        const snap = await store.get(key);
        if (count(snap) > 0 && snap.json) {
          const summary = await repo.importData(JSON.parse(snap.json), { mode: 'merge' });
          return { ...summary, from: key, at: snap.at };
        }
      }
      return null;
    },
    async info() { const s = await store.get('latest'); return s ? { at: s.at, profiles: s.profiles } : null; },
  };
}
