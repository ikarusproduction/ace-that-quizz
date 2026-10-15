// IndexedDB storage adapter. Same interface as memory.js.
// All writes go through transact(), which is one IndexedDB transaction, so a
// question result, its session summary and the saved game state are written
// together or not at all.
import { DB_NAME, IDB_VERSION, STORE_DEFS } from './schema.js';

export function openIdbStorage({ name = DB_NAME, factory = globalThis.indexedDB } = {}) {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    let req;
    try {
      req = factory.open(name, IDB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [store, def] of Object.entries(STORE_DEFS)) {
        let os;
        if (db.objectStoreNames.contains(store)) os = req.transaction.objectStore(store);
        else os = db.createObjectStore(store, { keyPath: def.keyPath });
        for (const index of def.indexes) {
          if (!os.indexNames.contains(index)) os.createIndex(index, index, { unique: false });
        }
      }
    };
    req.onblocked = () => reject(new Error('Storage is blocked by another open tab of this game. Close it and reload.'));
    req.onerror = () => reject(req.error ?? new Error('Could not open storage'));
    req.onsuccess = () => resolve(wrap(req.result));
  });
}

const asPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function wrap(db) {
  // If another tab upgrades the database, close ours rather than blocking it.
  db.onversionchange = () => db.close();

  return {
    kind: 'indexeddb',
    persistent: true,

    async get(store, key) {
      return asPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
    },

    async getAll(store) {
      return asPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
    },

    async getAllByIndex(store, index, value) {
      return asPromise(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value));
    },

    transact(ops) {
      return new Promise((resolve, reject) => {
        if (!ops.length) {
          resolve();
          return;
        }
        const names = [...new Set(ops.map((o) => o.store))];
        let tx;
        try {
          tx = db.transaction(names, 'readwrite');
          for (const o of ops) {
            const os = tx.objectStore(o.store);
            if (o.op === 'put') os.put(o.value);
            else if (o.op === 'delete') os.delete(o.key);
            else if (o.op === 'clear') os.clear();
          }
        } catch (err) {
          try { tx?.abort(); } catch { /* already finished */ }
          reject(err);
          return;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
      });
    },

    async close() {
      db.close();
    },
  };
}
