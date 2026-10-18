// The public "stat card" a player shares with friends: a few totals and per-subject accuracy, nothing about individual
// questions or sessions. Built from local results; the friends list on a profile stores copies of other people's cards.

export const FRIEND_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const rand = (n) => {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};
export function newFriendCode() {
  const c = Array.from(rand(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
export const newFriendSecret = () => Array.from(rand(24), (b) => ALPHABET[b % ALPHABET.length]).join('');
export const normalizeFriendCode = (raw) => {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

const int = (v, max = 1e9) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);

/** Keep only the card fields we know, with sane numbers. */
export function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const cats = {};
  for (const [k, v] of Object.entries(c.cats && typeof c.cats === 'object' ? c.cats : {})) {
    if (!/^[a-z]{2,16}$/.test(k) || !Array.isArray(v) || Object.keys(cats).length >= 24) continue;
    const n = int(v[0], 100000);
    cats[k] = [n, Math.min(n, int(v[1], 100000))];
  }
  return {
    v: 1,
    name: String(c.name ?? 'Player').replace(/[\u0000-\u001f<>]/g, '').slice(0, 20) || 'Player',
    avatar: String(c.avatar ?? '').slice(0, 16),
    games: int(c.games), wins: int(c.wins), best: int(c.best), streak: int(c.streak, 100000), answered: int(c.answered), correct: int(c.correct),
    bosses: int(c.bosses), rush: int(c.rush), maps: int(c.maps), hexes: int(c.hexes, 500), cards: int(c.cards, 500), cats,
  };
}

/** Build my card from local data. `profile` supplies the name, portrait and collection sizes. */
export function buildCard({ profile, results, sessions }) {
  const mine = results.filter((r) => r.playerId === profile.id);
  const cats = {};
  for (const r of mine) {
    const c = (cats[r.category] ??= [0, 0]);
    c[0] += 1;
    if (r.correct) c[1] += 1;
  }
  let games = 0; let wins = 0; let best = 0; let streak = 0; let bosses = 0; let rush = 0; let maps = 0;
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    const p = s.players?.find((x) => x.playerId === profile.id);
    if (!p) continue;
    games += 1;
    if (p.result === 'won' || p.placement === 1) wins += 1;
    if (s.mode !== 'versus' && Number.isFinite(p.score)) best = Math.max(best, p.score);
    streak = Math.max(streak, p.longestStreak ?? 0);
    if (s.mode !== 'versus') bosses += p.bossesCleared ?? 0;
    if (s.variant === 'rush' && p.result === 'won') rush += 1;
    if (s.variant === 'map' && p.result === 'won') maps += 1;
  }
  const answered = mine.length;
  return cleanCard({
    name: profile.name, avatar: profile.avatar?.key, games, wins, best, streak, answered, correct: mine.filter((r) => r.correct).length,
    bosses, rush, maps, hexes: (profile.hexes?.owned ?? []).length, cards: (profile.ownedCards ?? []).length, cats,
  });
}

export const accuracyOf = (card) => (card && card.answered ? card.correct / card.answered : null);
