// In-memory storage adapter with the same async interface as the IndexedDB one.
// Used by unit tests, and as a fallback when IndexedDB is unavailable (for
// example some private-browsing modes), in which case progress lasts only until
// the tab closes and the UI says so.
import { STORE_DEFS } from './schema.js';

export function createMemoryStorage() {
  const stores = Object.fromEntries(Object.keys(STORE_DEFS).map((name) => [name, new Map()]));
  // Values are cloned on the way in and out so callers cannot mutate stored data
  // by accident, just like real structured-clone storage.
  const copy = (v) => structuredClone(v);
  const keyOf = (store, value) => value[STORE_DEFS[store].keyPath];

  return {
    kind: 'memory',
    persistent: false,

    async get(store, key) {
      const v = stores[store].get(key);
      return v === undefined ? undefined : copy(v);
    },

    async getAll(store) {
      return [...stores[store].values()].map(copy);
    },

    async getAllByIndex(store, index, value) {
      return [...stores[store].values()].filter((v) => v[index] === value).map(copy);
    },

    /** Apply a list of { op: 'put'|'delete'|'clear', store, value?, key? } atomically. */
    async transact(ops) {
      // Validate everything first so a bad op changes nothing.
      for (const o of ops) {
        if (!stores[o.store]) throw new Error(`Unknown store "${o.store}"`);
        if (o.op === 'put' && keyOf(o.store, o.value) === undefined) throw new Error(`Missing key for ${o.store}`);
      }
      for (const o of ops) {
        if (o.op === 'put') stores[o.store].set(keyOf(o.store, o.value), copy(o.value));
        else if (o.op === 'delete') stores[o.store].delete(o.key);
        else if (o.op === 'clear') stores[o.store].clear();
      }
    },

    async close() {},
  };
}
