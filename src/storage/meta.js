// Per-profile extras that grow with play: the hex collection and deck, dust, unopened packs, and the daily streak.
// Everything is optional on old profiles; `metaOf` fills in safe defaults and drops anything invalid.
import { HEXES, STARTER_HEXES, PACKS, HEX_NUMBERS } from '../engine/hexes.js';
import { FRIEND_CODE_RE, cleanCard } from '../stats/card.js';

export const MAX_FRIENDS = 50;

/** Friends live inside the profile: [{ code, name, avatar, card, fetchedAt }]. */
export function cleanFriends(list) {
  const seen = new Set();
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const code = String(f?.code ?? '').toUpperCase();
    if (!FRIEND_CODE_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    const card = cleanCard(f.card);
    out.push({ code, name: String(f.name ?? card?.name ?? 'Friend').replace(/[\u0000-\u001f<>]/g, '').slice(0, 20) || 'Friend', avatar: String(f.avatar ?? card?.avatar ?? '').slice(0, 16), card, fetchedAt: Number.isFinite(f.fetchedAt) ? f.fetchedAt : 0 });
    if (out.length >= MAX_FRIENDS) break;
  }
  return out;
}

export function metaOf(p) {
  const raw = p?.hexes ?? {};
  const owned = [...new Set([...(Array.isArray(raw.owned) ? raw.owned.filter((id) => HEXES[id]) : []), ...STARTER_HEXES])];
  const deck = [...new Set(Array.isArray(raw.deck) ? raw.deck.filter((id) => owned.includes(id)) : [])].slice(0, HEX_NUMBERS.deckSize);
  const dust = Number.isFinite(raw.dust) && raw.dust > 0 ? Math.floor(raw.dust) : 0;
  const packs = (Array.isArray(p?.packs) ? p.packs : []).filter((k) => k && typeof k.id === 'string' && PACKS[k.type]).map((k) => ({ id: k.id, type: k.type, from: typeof k.from === 'string' ? k.from.slice(0, 60) : '' }));
  const d = p?.daily ?? {};
  const daily = { lastDay: typeof d.lastDay === 'string' ? d.lastDay : '', streak: Number.isFinite(d.streak) ? Math.max(0, Math.floor(d.streak)) : 0 };
  const friendCode = FRIEND_CODE_RE.test(String(p?.friendCode ?? '')) ? String(p.friendCode) : '';
  const friendSecret = typeof p?.friendSecret === 'string' && p.friendSecret.length >= 16 && p.friendSecret.length <= 80 ? p.friendSecret : '';
  return { hexes: { owned, deck, dust }, packs, daily, friendCode, friendSecret, friends: cleanFriends(p?.friends) };
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
    friendCode: a.friendCode || b.friendCode,
    friendSecret: a.friendCode ? a.friendSecret : b.friendSecret,
    friends: cleanFriends([...[...a.friends, ...b.friends].reduce((m, f) => (m.get(f.code) && m.get(f.code).fetchedAt >= f.fetchedAt ? m : m.set(f.code, f)), new Map()).values()]),
  };
}
