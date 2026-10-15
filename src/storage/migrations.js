// Save-data migrations.
//
// SCHEMA_VERSION is the version of the *shape of the data* (as opposed to the
// IndexedDB structure version). Version 1 is the first release, so there is no
// legacy data and MIGRATIONS is empty today. The machinery exists, and is tested
// with synthetic migrations, so the first real schema change has a safe path:
//
//   1. add { from: 1, to: 2, up(snapshot) { ...return snapshot; } } below,
//   2. bump SCHEMA_VERSION in schema.js.
//
// A migration works on a plain snapshot { profiles, sessions, results, kv } so
// the same code upgrades both stored data and an imported export file.
import { DATA_STORES } from './schema.js';

export const MIGRATIONS = [];

export class SchemaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SchemaError';
    this.code = code;
  }
}

/** Upgrade a snapshot from `from` to `target`, one step at a time. */
export function migrateSnapshot(snapshot, from, target, migrations = MIGRATIONS) {
  if (from > target) {
    throw new SchemaError('NEWER_SCHEMA', `This data was saved by a newer version of the game (data v${from}, app v${target}).`);
  }
  let current = from;
  let data = snapshot;
  while (current < target) {
    const step = migrations.find((m) => m.from === current);
    if (!step) throw new SchemaError('NO_MIGRATION', `No migration path from data v${current} to v${target}.`);
    data = step.up(structuredClone(data));
    current = step.to;
  }
  return data;
}

export async function loadSnapshot(storage) {
  const snap = {};
  for (const store of DATA_STORES) snap[store] = await storage.getAll(store);
  snap.kv = await storage.getAll('kv');
  return snap;
}

/** Replace everything in storage with `snapshot` in one transaction. */
export async function writeSnapshot(storage, snapshot) {
  const ops = [];
  for (const store of [...DATA_STORES, 'kv']) {
    ops.push({ op: 'clear', store });
    for (const value of snapshot[store] ?? []) ops.push({ op: 'put', store, value });
  }
  await storage.transact(ops);
}

/**
 * Make sure stored data matches `target`. Writes a safety copy of the old data
 * to kv before changing anything. Returns { from, to, migrated }.
 */
export async function runMigrations(storage, { migrations = MIGRATIONS, target, now = Date.now } = {}) {
  const meta = await storage.get('kv', 'meta');
  if (!meta) {
    const profiles = await storage.getAll('profiles');
    const results = await storage.getAll('results');
    const hasLegacy = profiles.length > 0 || results.length > 0;
    // Brand new database: stamp it. Data with no stamp predates versioning: treat as v0.
    if (!hasLegacy) {
      await storage.transact([{ op: 'put', store: 'kv', value: { key: 'meta', schemaVersion: target, createdAt: now() } }]);
      return { from: target, to: target, migrated: false };
    }
    return migrateStored(storage, 0, target, migrations, now);
  }
  if (meta.schemaVersion === target) return { from: target, to: target, migrated: false };
  return migrateStored(storage, meta.schemaVersion, target, migrations, now);
}

async function migrateStored(storage, from, target, migrations, now) {
  const before = await loadSnapshot(storage);
  // Throws (changing nothing) if there is no path or the data is from a newer app.
  const migrated = migrateSnapshot(before, from, target, migrations);
  // Keep only the most recent safety copy, and never nest older backups inside it.
  const isBackup = (r) => r.key.startsWith('backup-');
  const backup = {
    key: `backup-v${from}`,
    savedAt: now(),
    snapshot: { ...before, kv: before.kv.filter((r) => !isBackup(r)) },
  };
  const kv = (migrated.kv ?? []).filter((r) => r.key !== 'meta' && !isBackup(r));
  kv.push({ key: 'meta', schemaVersion: target, createdAt: now(), migratedFrom: from }, backup);
  // One transaction: either the old data stays untouched, or the migrated data
  // and its backup are both written.
  await writeSnapshot(storage, { ...migrated, kv });
  return { from, to: target, migrated: true };
}
