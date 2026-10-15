// Storage layout shared by both adapters.
//
//   profiles  one record per player identity (stable id; the name can change)
//   sessions  one record per game played, with a small summary per participant
//   results   one record per answered question per player: the source of truth
//             for every statistic. Aggregates are derived, never stored.
//   kv        small singletons: schema meta, the active game, settings, recents
export const DB_NAME = 'the-house-knows';
export const IDB_VERSION = 1; // IndexedDB structure version (stores and indexes)
export const SCHEMA_VERSION = 1; // data shape version, migrated by migrations.js

export const STORE_DEFS = {
  profiles: { keyPath: 'id', indexes: [] },
  sessions: { keyPath: 'sessionId', indexes: [] },
  results: { keyPath: 'resultId', indexes: ['playerId', 'sessionId'] },
  kv: { keyPath: 'key', indexes: [] },
};

export const DATA_STORES = ['profiles', 'sessions', 'results'];
