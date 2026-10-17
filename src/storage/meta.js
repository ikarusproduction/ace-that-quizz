// Per-profile extras that grow with play: the hex collection and deck, dust, unopened packs, and the daily streak.
// Everything is optional on old profiles; `metaOf` fills in safe defaults and drops anything invalid.
import { HEXES, STARTER_HEXES, PACKS, HEX_NUMBERS } from '../engine/hexes.js';

export function metaOf(p) {
  const raw = p?.hexes ?? {};
  const owned = [...new Set([...(Array.isArray(raw.owned) ? raw.owned.filter((id) => HEXES[id]) : []), ...STARTER_HEXES])];
  const deck = [...new Set(Array.isArray(raw.deck) ? raw.deck.filter((id) => owned.includes(id)) : [])].slice(0, HEX_NUMBERS.deckSize);
  const dust = Number.isFinite(raw.dust) && raw.dust > 0 ? Math.floor(raw.dust) : 0;
  const packs = (Array.isArray(p?.packs) ? p.packs : []).filter((k) => k && typeof k.id === 'string' && PACKS[k.type]).map((k) => ({ id: k.id, type: k.type, from: typeof k.from === 'string' ? k.from.slice(0, 60) : '' }));
  const d = p?.daily ?? {};
  const daily = { lastDay: typeof d.lastDay === 'string' ? d.lastDay : '', streak: Number.isFinite(d.streak) ? Math.max(0, Math.floor(d.streak)) : 0 };
  return { hexes: { owned, deck, dust }, packs, daily };
}

/** Day keys look like "2026-10-17" (local date). */
export function daysBetween(a, b) {
  const t = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function mergeMeta(mine, theirs, theirsIsNewer) {
  const a = metaOf(mine); const b = metaOf(theirs);
  const ids = new Set(a.packs.map((k) => k.id));
  return {
    hexes: {
      owned: [...new Set([...a.hexes.owned, ...b.hexes.owned])],
      deck: (theirsIsNewer ? b.hexes.deck : a.hexes.deck),
      dust: Math.max(a.hexes.dust, b.hexes.dust),
    },
    packs: [...a.packs, ...b.packs.filter((k) => !ids.has(k.id))],
    daily: a.daily.lastDay >= b.daily.lastDay ? a.daily : b.daily,
  };
}
