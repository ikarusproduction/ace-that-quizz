// Domain operations on top of a storage adapter: profiles, sessions, results,
// settings, the saved game, and export/import.
//
// Principles:
//  * Profiles are keyed by a stable id. A display name is only a label, so
//    renaming never touches results or history.
//  * Results are the source of truth. Nothing here stores a counter that could
//    disagree with them.
//  * Writing the same result twice is harmless: result ids are deterministic.
import { isLanguage, DEFAULT_LANGUAGE } from '../i18n/languages.js';
import { SCHEMA_VERSION, DATA_STORES } from './schema.js';
import { levelOf, cleanWardrobe, buyCheck, COSMETICS } from '../engine/cosmetics.js';
import { applyAnswers } from '../engine/learning.js';
import { metaOf, mergeMeta, daysBetween, cleanFriends, MAX_FRIENDS } from './meta.js';
import { newFriendCode, newFriendSecret, normalizeFriendCode, FRIEND_CODE_RE, buildCard, cleanCard } from '../stats/card.js';
import { HEXES, PACKS, openPack, FORGE_COST, HEX_NUMBERS } from '../engine/hexes.js';
import { Rng } from '../engine/rng.js';
import { ADVENTURES, packForStep, xpForStep } from '../engine/adventure.js';
import { runMigrations, migrateSnapshot, SchemaError, MIGRATIONS } from './migrations.js';
import { STARTER_CARDS, CARDS } from '../engine/cards.js';

export const AVATAR_KEYS = ['gasmask', 'welder', 'radio', 'owl', 'fox', 'crow', 'miner', 'jester'];
export const NAME_MAX = 20;
export const EXPORT_FORMAT = 'the-house-knows.export';
export const RECENT_MAX = 8;

export const DEFAULT_SETTINGS = {
  minSample: 10, // answers needed before a category is ranked
  confidentSample: 25, // answers before an observation stops being "provisional"
  sound: true,
  volume: 0.7,
  reduceMotion: false,
  haptics: true,
};

export class RepoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RepoError';
    this.code = code;
  }
}

/** Collapse whitespace, strip control characters, trim. */
export function normalizeName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sameName = (a, b) => normalizeName(a).toLocaleLowerCase() === normalizeName(b).toLocaleLowerCase();

function defaultUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The small per-game summary stored in `sessions`. Built from a game state. */
export function sessionRecord(state) {
  const players = state.players.map((p) => {
    const mine = state.log.filter((r) => r.playerId === p.playerId);
    return {
      playerId: p.playerId,
      name: p.name,
      result: p.result,
      score: p.finalScore,
      placement: p.placement ?? null,
      answered: mine.length,
      correct: mine.filter((r) => r.correct).length,
      roundsCleared: p.roundsCleared,
      bossesCleared: p.bossesCleared,
      longestStreak: p.longestStreak,
      strikes: p.strikes,
      chips: p.chips,
      vault: p.vault,
    };
  });
  const totalRounds = state.config.noBoss ? state.config.rounds : state.config.acts * (state.config.roundsPerAct + 1);
  return {
    schema: SCHEMA_VERSION,
    sessionId: state.sessionId,
    mode: state.mode,
    variant: state.config.variant ?? null,
    seed: state.seed,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    status: state.status, // active | completed | abandoned
    totalRounds,
    roundsPlayed: state.roundLog.length,
    players,
  };
}

export async function createRepo(storage, { now = Date.now, uuid = defaultUuid, migrations = MIGRATIONS, schemaVersion = SCHEMA_VERSION } = {}) {
  const migration = await runMigrations(storage, { migrations, target: schemaVersion, now });

  const getProfiles = () => storage.getAll('profiles');

  async function requireProfile(id) {
    const p = await storage.get('profiles', id);
    if (!p) throw new RepoError('NOT_FOUND', 'That profile no longer exists.');
    return p;
  }

  function checkName(name, profiles, exceptId) {
    const clean = normalizeName(name);
    if (!clean) throw new RepoError('NAME_EMPTY', 'Please enter a name.');
    if ([...clean].length > NAME_MAX) throw new RepoError('NAME_TOO_LONG', `Names can be up to ${NAME_MAX} characters.`);
    if (profiles.some((p) => p.id !== exceptId && sameName(p.name, clean))) {
      throw new RepoError('NAME_TAKEN', `There is already a player called "${clean}" on this device.`);
    }
    return clean;
  }

  function checkAvatar(avatar) {
    const key = avatar?.key ?? avatar;
    return { key: AVATAR_KEYS.includes(key) ? key : AVATAR_KEYS[0] };
  }

  const repo = {
    storage,
    migration,
    storageInfo: () => ({ kind: storage.kind, persistent: storage.persistent }),

    /* ---------------- profiles ---------------- */

    async listProfiles() {
      return (await getProfiles()).sort((a, b) => a.createdAt - b.createdAt);
    },

    getProfile: (id) => storage.get('profiles', id),

    async createProfile({ name, avatar, language }) {
      const profiles = await getProfiles();
      const clean = checkName(name, profiles, null);
      const t = now();
      const profile = {
        schema: SCHEMA_VERSION,
        id: `p_${uuid()}`,
        name: clean,
        avatar: checkAvatar(avatar),
        language: isLanguage(language) ? language : DEFAULT_LANGUAGE,
        createdAt: t,
        updatedAt: t,
        ownedCards: [...STARTER_CARDS],
        ...metaOf({}),
      };
      // A new random id can never collide with, or overwrite, an existing profile.
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return profile;
    },

    async updateProfile(id, { name, avatar, language }) {
      const profile = await requireProfile(id);
      if (name !== undefined) profile.name = checkName(name, await getProfiles(), id);
      if (avatar !== undefined) profile.avatar = checkAvatar(avatar);
      if (language !== undefined) profile.language = isLanguage(language) ? language : DEFAULT_LANGUAGE;
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return profile;
    },

    /** Remove a profile and everything recorded for it. Other players' history is untouched. */
    async deleteProfile(id) {
      await requireProfile(id);
      const active = await storage.get('kv', 'activeGame');
      if (active?.state?.players?.some((p) => p.playerId === id)) {
        throw new RepoError('IN_ACTIVE_GAME', 'Finish or abandon the game in progress before deleting this player.');
      }
      const ops = await removePlayerData(id);
      ops.push({ op: 'delete', store: 'profiles', key: id });
      const recent = await storage.get('kv', 'recent');
      if (recent) {
        ops.push({ op: 'put', store: 'kv', value: { ...recent, ids: recent.ids.filter((x) => x !== id), lastGroup: recent.lastGroup?.ids.includes(id) ? null : recent.lastGroup } });
      }
      const rewards = await storage.get('kv', 'rewards');
      if (rewards) ops.push({ op: 'put', store: 'kv', value: { ...rewards, items: rewards.items.filter((r) => r.playerId !== id) } });
      await storage.transact(ops);
    },

    /** Wipe a player's statistics and history but keep the profile and its cards. */
    async resetProfileStats(id) {
      await requireProfile(id);
      const active = await storage.get('kv', 'activeGame');
      if (active?.state?.players?.some((p) => p.playerId === id)) {
        throw new RepoError('IN_ACTIVE_GAME', 'Finish or abandon the game in progress first.');
      }
      await storage.transact(await removePlayerData(id));
    },

    async addCards(id, cardIds) {
      const profile = await requireProfile(id);
      const valid = cardIds.filter((c) => CARDS[c]);
      profile.ownedCards = [...new Set([...profile.ownedCards, ...valid])];
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return profile;
    },

    /* ---------------- card rewards waiting to be claimed ---------------- */

    async listPendingRewards() {
      const rec = await storage.get('kv', 'rewards');
      const existing = new Set((await getProfiles()).map((p) => p.id));
      return (rec?.items ?? []).filter((r) => existing.has(r.playerId));
    },

    /** Offers are stored when a game ends so closing the app before picking never loses them. */
    async addPendingRewards(items) {
      const rec = (await storage.get('kv', 'rewards')) ?? { key: 'rewards', items: [] };
      const have = new Set(rec.items.map((r) => `${r.sessionId}:${r.playerId}`));
      const fresh = items.filter((r) => r.options?.length && !have.has(`${r.sessionId}:${r.playerId}`)).map((r) => ({ sessionId: r.sessionId, playerId: r.playerId, options: [...r.options], createdAt: now() }));
      if (!fresh.length) return;
      await storage.transact([{ op: 'put', store: 'kv', value: { key: 'rewards', items: [...rec.items, ...fresh] } }]);
    },

    /** Take one offered card. The profile and the offer are updated in one transaction. */
    async claimReward(sessionId, playerId, cardId) {
      const rec = (await storage.get('kv', 'rewards')) ?? { key: 'rewards', items: [] };
      const offer = rec.items.find((r) => r.sessionId === sessionId && r.playerId === playerId);
      if (!offer) throw new RepoError('NO_REWARD', 'That reward has already been claimed.');
      if (!offer.options.includes(cardId)) throw new RepoError('BAD_CARD', 'That card was not on offer.');
      const profile = await requireProfile(playerId);
      profile.ownedCards = [...new Set([...profile.ownedCards, cardId])];
      profile.updatedAt = now();
      const items = rec.items.filter((r) => r !== offer);
      await storage.transact([
        { op: 'put', store: 'profiles', value: profile },
        { op: 'put', store: 'kv', value: { key: 'rewards', items } },
      ]);
      return profile;
    },

    /* ---------------- hexes, packs, daily ---------------- */

    async getMeta(id) {
      return metaOf(await requireProfile(id));
    },

    /* ---------------- friends (the list lives inside the profile, so it follows exports and cloud saves) ---------------- */

    /** The code you give to friends, and the secret that proves a card is yours. Created on first use. */
    async friendIdentity(id) {
      const profile = await requireProfile(id);
      if (!profile.friendCode || !profile.friendSecret) {
        const used = new Set((await getProfiles()).map((p) => p.friendCode));
        let code = newFriendCode();
        while (used.has(code)) code = newFriendCode();
        profile.friendCode = code;
        profile.friendSecret = newFriendSecret();
        profile.updatedAt = now();
        await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      }
      return { code: profile.friendCode, secret: profile.friendSecret };
    },

    async listFriends(id) {
      return metaOf(await requireProfile(id)).friends;
    },

    /** Add (or refresh) a friend from a card the server returned. */
    async saveFriend(id, { code, card }) {
      const profile = await requireProfile(id);
      const c = normalizeFriendCode(code);
      if (!FRIEND_CODE_RE.test(c)) throw new RepoError('BAD_CODE', 'That friend code is not valid. It looks like K7QD-4MXP.');
      if (profile.friendCode === c) throw new RepoError('OWN_CODE', 'That is your own code.');
      const clean = cleanCard(card);
      if (!clean) throw new RepoError('BAD_CARD', 'No card for that code.');
      const friends = metaOf(profile).friends;
      const at = friends.findIndex((f) => f.code === c);
      const entry = { code: c, name: clean.name, avatar: clean.avatar, card: clean, fetchedAt: now() };
      if (at >= 0) friends[at] = entry;
      else if (friends.length >= MAX_FRIENDS) throw new RepoError('TOO_MANY', `You can have up to ${MAX_FRIENDS} friends.`);
      else friends.push(entry);
      profile.friends = cleanFriends(friends);
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return { added: at < 0, friends: profile.friends };
    },

    async removeFriend(id, code) {
      const profile = await requireProfile(id);
      profile.friends = metaOf(profile).friends.filter((f) => f.code !== code);
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return profile.friends;
    },

    /** My own card, from local results. */
    async friendCard(id) {
      const profile = await requireProfile(id);
      return buildCard({ profile, results: await storage.getAllByIndex('results', 'playerId', id), sessions: await storage.getAll('sessions') });
    },

    async setHexDeck(id, deck) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const clean = [...new Set(deck)].filter((h) => m.hexes.owned.includes(h)).slice(0, HEX_NUMBERS.deckSize);
      profile.hexes = { ...m.hexes, deck: clean };
      profile.packs = m.packs; profile.daily = m.daily;
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return clean;
    },

    /** Add packs. Ids are unique per source, so awarding the same game twice never double-pays. */
    async addPacks(id, list) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const have = new Set(m.packs.map((k) => k.id));
      const fresh = list.filter((k) => PACKS[k.type] && !have.has(k.id));
      if (!fresh.length) return 0;
      profile.hexes = m.hexes; profile.daily = m.daily;
      profile.packs = [...m.packs, ...fresh.map((k) => ({ id: k.id, type: k.type, from: k.from ?? '' }))].slice(-60);
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return fresh.length;
    },

    /** Open one pack: the same pack id always yields the same cards. Duplicates become dust. */
    async openPack(id, packId) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const pack = m.packs.find((k) => k.id === packId);
      if (!pack) throw new RepoError('NO_PACK', 'That pack has already been opened.');
      const cards = openPack(Rng.fromSeed(`pack:${pack.id}`), pack.type, m.hexes.owned);
      const owned = [...new Set([...m.hexes.owned, ...cards.map((c) => c.id)])];
      const dust = m.hexes.dust + cards.reduce((n, c) => n + c.dust, 0);
      profile.hexes = { ...m.hexes, owned, dust };
      profile.packs = m.packs.filter((k) => k.id !== packId);
      profile.daily = m.daily;
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return { type: pack.type, cards };
    },

    /** Add XP (and dust) for a finished game once; the session id is remembered. Returns { xp, before, after, gained, dust }. */
    async addXp(id, sessionId, amount, dust = 0) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      if (m.xpLog.includes(sessionId) || !(amount > 0)) return { xp: m.xp, before: levelOf(m.xp).level, after: levelOf(m.xp).level, gained: 0, dust: 0 };
      profile.xp = m.xp + Math.floor(amount);
      const d = dust > 0 ? Math.floor(dust) : 0;
      if (d) { profile.hexes = { ...m.hexes, dust: m.hexes.dust + d }; profile.packs = m.packs; profile.daily = m.daily; }
      profile.xpLog = [...m.xpLog, sessionId].slice(-30);
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return { xp: profile.xp, before: levelOf(m.xp).level, after: levelOf(profile.xp).level, gained: Math.floor(amount), dust: d };
    },

    /**
     * Record a finished adventure step. Stars only go up; XP and the boss pack are paid once, the first time.
     * Returns { first, stars, xp: {gained, before, after}, pack }.
     */
    async completeAdventureStep(id, advId, step, road, stars) {
      if (!ADVENTURES[advId] || !Number.isInteger(step) || step < 1 || step > 100 || !(stars >= 1 && stars <= 3)) throw new RepoError('BAD_STEP', 'That step does not exist.');
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const mine = m.adv[advId];
      const first = !mine.done[step];
      mine.done[step] = Math.max(mine.done[step] ?? 0, stars);
      if (first) mine.road[step] = road;
      profile.adv = { ...m.adv, [advId]: mine };
      let xp = { gained: 0, before: levelOf(m.xp).level, after: levelOf(m.xp).level };
      let pack = null;
      if (first) {
        const gain = xpForStep(step, road, stars);
        profile.xp = m.xp + gain;
        xp = { gained: gain, before: levelOf(m.xp).level, after: levelOf(profile.xp).level };
        pack = packForStep(step);
        if (pack) {
          profile.hexes = m.hexes; profile.daily = m.daily;
          profile.packs = [...m.packs, { id: `adv-${advId}-${step}`, type: pack, from: `${ADVENTURES[advId].name}, step ${step}` }].slice(-60);
        }
      }
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return { first, stars: mine.done[step], xp, pack };
    },

    /**
     * Save the answers of a training session into the player's learning record (spaced-repetition state).
     * `answers`: [{ id: conceptId, correct, hints, confidence, level, wrongText }]. Local to this device; no cloud sync.
     */
    async recordLearning(id, answers, { now: at = now(), kind = 'train', offsetMin = 0 } = {}) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      profile.learn = applyAnswers(m.learn, (Array.isArray(answers) ? answers : []).filter((a) => a && typeof a.id === 'string'), at, { kind, offsetMin });
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return profile.learn;
    },

    /** Buy a wardrobe item with dust. */
    async buyCosmetic(id, itemId) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const why = buyCheck(m.cos, itemId, m.hexes.dust);
      if (why) throw new RepoError('NO_BUY', why);
      profile.hexes = { ...m.hexes, dust: m.hexes.dust - COSMETICS[itemId].cost };
      profile.cos = { owned: [...m.cos.owned, itemId], equipped: { ...m.cos.equipped, [COSMETICS[itemId].slot]: itemId } };
      profile.packs = m.packs; profile.daily = m.daily;
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return metaOf(profile);
    },

    /** Wear an owned item, or take a slot off with itemId = null. Titles use slot 'title' with a title id. */
    async equipCosmetic(id, slot, itemId) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const equipped = { ...m.cos.equipped };
      if (itemId == null) delete equipped[slot];
      else equipped[slot] = itemId;
      profile.cos = cleanWardrobe({ owned: m.cos.owned, equipped }, levelOf(m.xp).level);
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return metaOf(profile);
    },

    /** Spend dust to craft a hex you are missing. */
    async forgeHex(id, hexId) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      const hex = HEXES[hexId];
      if (!hex) throw new RepoError('BAD_HEX', 'Unknown hex.');
      if (m.hexes.owned.includes(hexId)) throw new RepoError('HAVE_HEX', 'You already own that hex.');
      const cost = FORGE_COST[hex.rarity];
      if (m.hexes.dust < cost) throw new RepoError('NO_DUST', `You need ${cost} dust (you have ${m.hexes.dust}).`);
      profile.hexes = { ...m.hexes, owned: [...m.hexes.owned, hexId], dust: m.hexes.dust - cost };
      profile.packs = m.packs; profile.daily = m.daily;
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return profile.hexes;
    },

    /** One free pack a day. Consecutive days build a streak: day 3 and up is silver, day 7 and up is gold. */
    async claimDaily(id, dayKey) {
      const profile = await requireProfile(id);
      const m = metaOf(profile);
      if (m.daily.lastDay === dayKey) return null;
      const gap = m.daily.lastDay ? daysBetween(m.daily.lastDay, dayKey) : null;
      const streak = gap === 1 ? m.daily.streak + 1 : 1;
      const type = streak >= 7 ? 'gold' : streak >= 3 ? 'silver' : 'bronze';
      profile.hexes = m.hexes;
      profile.daily = { lastDay: dayKey, streak };
      profile.packs = [...m.packs, { id: `daily:${dayKey}`, type, from: `Day ${streak}` }].slice(-60);
      profile.updatedAt = now();
      await storage.transact([{ op: 'put', store: 'profiles', value: profile }]);
      return { type, streak };
    },

    /* ---------------- recent players ---------------- */

    async getRecent() {
      const rec = (await storage.get('kv', 'recent')) ?? { ids: [], lastGroup: null };
      const existing = new Set((await getProfiles()).map((p) => p.id));
      return {
        ids: rec.ids.filter((x) => existing.has(x)),
        lastGroup: rec.lastGroup && rec.lastGroup.ids.every((x) => existing.has(x)) ? rec.lastGroup : null,
      };
    },

    async pushRecent(ids, mode) {
      const old = (await storage.get('kv', 'recent')) ?? { ids: [] };
      const next = { key: 'recent', ids: [...ids, ...old.ids.filter((x) => !ids.includes(x))].slice(0, RECENT_MAX), lastGroup: { mode, ids: [...ids] } };
      await storage.transact([{ op: 'put', store: 'kv', value: next }]);
    },

    /* ---------------- settings ---------------- */

    async getSettings() {
      const rec = await storage.get('kv', 'settings');
      return { ...DEFAULT_SETTINGS, ...(rec?.values ?? {}) };
    },

    async saveSettings(partial) {
      const merged = { ...(await repo.getSettings()), ...partial };
      merged.minSample = Math.max(3, Math.min(50, Math.round(merged.minSample)));
      merged.confidentSample = Math.max(merged.minSample, Math.min(200, Math.round(merged.confidentSample)));
      await storage.transact([{ op: 'put', store: 'kv', value: { key: 'settings', values: merged } }]);
      return merged;
    },

    /* ---------------- games ---------------- */

    /**
     * Save progress after an action. Writes any answers not yet persisted, the
     * session summary and the resumable game state in one transaction.
     * Returns the new persisted count to pass next time. Passing 0 is always
     * safe: it just re-writes identical rows.
     */
    async saveProgress(state, persistedCount = 0, { onlyPlayers = null, resumable = true } = {}) {
      // Online games: a phone only keeps the answers of its own player(s), and cannot resume a shared game.
      const mine = (r) => !onlyPlayers || onlyPlayers.includes(r.playerId);
      const ops = state.log.slice(persistedCount).filter(mine).map((value) => ({ op: 'put', store: 'results', value }));
      if (resumable) ops.push({ op: 'put', store: 'sessions', value: sessionRecord(state) });
      if (state.status === 'active' && resumable) ops.push({ op: 'put', store: 'kv', value: { key: 'activeGame', state, savedAt: now() } });
      await storage.transact(ops);
      return state.log.length;
    },

    /** Write the final record of a finished or abandoned game and clear the saved game. */
    async finalizeSession(state, { onlyPlayers = null } = {}) {
      if (state.status === 'active') throw new RepoError('NOT_FINISHED', 'The game has not ended yet.');
      const ops = state.log.filter((r) => !onlyPlayers || onlyPlayers.includes(r.playerId)).map((value) => ({ op: 'put', store: 'results', value }));
      ops.push({ op: 'put', store: 'sessions', value: sessionRecord(state) });
      const active = await storage.get('kv', 'activeGame');
      if (active?.state?.sessionId === state.sessionId) ops.push({ op: 'delete', store: 'kv', key: 'activeGame' });
      await storage.transact(ops);
    },

    async loadActiveGame() {
      const rec = await storage.get('kv', 'activeGame');
      return rec ? rec.state : null;
    },

    async clearActiveGame() {
      await storage.transact([{ op: 'delete', store: 'kv', key: 'activeGame' }]);
    },

    listSessions: () => storage.getAll('sessions'),
    listResults: (playerId) => storage.getAllByIndex('results', 'playerId', playerId),
    listSessionResults: (sessionId) => storage.getAllByIndex('results', 'sessionId', sessionId),

    async listSessionsForPlayer(playerId) {
      return (await storage.getAll('sessions')).filter((s) => s.players.some((p) => p.playerId === playerId));
    },

    /** Delete everything stored by the game on this device (profiles, history, settings). */
    async wipeAll() {
      const ops = DATA_STORES.map((store) => ({ op: 'clear', store }));
      for (const key of ['activeGame', 'recent', 'rewards', 'settings']) ops.push({ op: 'delete', store: 'kv', key });
      await storage.transact(ops);
    },

    /* ---------------- export / import ---------------- */

    async exportData() {
      const settings = await storage.get('kv', 'settings');
      return {
        format: EXPORT_FORMAT,
        schemaVersion,
        exportedAt: now(),
        profiles: await storage.getAll('profiles'),
        sessions: await storage.getAll('sessions'),
        results: await storage.getAll('results'),
        settings: settings?.values ?? null,
      };
    },

    /**
     * Import an export file. 'merge' (default) adds to what is here and never
     * deletes. 'replace' swaps everything for the file's contents.
     */
    async importData(data, { mode = 'merge' } = {}) {
      const parsed = parseExport(data, { migrations, schemaVersion });
      const local = await getProfiles();
      const summary = { profilesAdded: 0, profilesUpdated: 0, renamed: [], resultsAdded: 0, sessionsAdded: 0, skipped: { ...parsed.skipped } };
      const ops = [];

      if (mode === 'replace') {
        for (const store of DATA_STORES) ops.push({ op: 'clear', store });
        ops.push({ op: 'delete', store: 'kv', key: 'activeGame' }, { op: 'delete', store: 'kv', key: 'recent' });
      }
      const existingProfiles = mode === 'replace' ? [] : local;
      const taken = existingProfiles.map((p) => p.name);
      const knownIds = new Set(existingProfiles.map((p) => p.id));

      for (const imp of parsed.profiles) {
        const mine = existingProfiles.find((p) => p.id === imp.id);
        if (mine) {
          const newer = imp.updatedAt > mine.updatedAt ? imp : mine;
          const nameClash = existingProfiles.some((p) => p.id !== imp.id && sameName(p.name, newer.name));
          const merged = {
            ...mine,
            name: nameClash ? mine.name : newer.name,
            avatar: newer.avatar,
            createdAt: Math.min(mine.createdAt, imp.createdAt),
            updatedAt: Math.max(mine.updatedAt, imp.updatedAt),
            ownedCards: [...new Set([...mine.ownedCards, ...imp.ownedCards])],
            ...mergeMeta(mine, imp, imp.updatedAt > mine.updatedAt),
          };
          ops.push({ op: 'put', store: 'profiles', value: merged });
          summary.profilesUpdated++;
        } else {
          let name = imp.name;
          let n = 2;
          while (taken.some((t) => sameName(t, name))) name = `${imp.name.slice(0, NAME_MAX - 4)} (${n++})`;
          if (name !== imp.name) summary.renamed.push({ from: imp.name, to: name });
          taken.push(name);
          ops.push({ op: 'put', store: 'profiles', value: { ...imp, name } });
          summary.profilesAdded++;
        }
        knownIds.add(imp.id);
      }

      const existingResultIds = new Set(mode === 'replace' ? [] : (await storage.getAll('results')).map((r) => r.resultId));
      for (const r of parsed.results) {
        if (!knownIds.has(r.playerId)) {
          summary.skipped.results++;
          continue;
        }
        if (!existingResultIds.has(r.resultId)) summary.resultsAdded++;
        ops.push({ op: 'put', store: 'results', value: r });
      }
      const existingSessionIds = new Set(mode === 'replace' ? [] : (await storage.getAll('sessions')).map((s) => s.sessionId));
      for (const s of parsed.sessions) {
        if (existingSessionIds.has(s.sessionId)) continue; // never alter a game already recorded here
        const players = s.players.filter((p) => knownIds.has(p.playerId));
        if (!players.length) {
          summary.skipped.sessions++;
          continue;
        }
        ops.push({ op: 'put', store: 'sessions', value: { ...s, players } });
        summary.sessionsAdded++;
      }
      if (mode === 'replace' && data.settings) ops.push({ op: 'put', store: 'kv', value: { key: 'settings', values: { ...DEFAULT_SETTINGS, ...data.settings } } });

      await storage.transact(ops);
      return summary;
    },
  };

  async function removePlayerData(id) {
    const ops = [];
    for (const r of await storage.getAllByIndex('results', 'playerId', id)) ops.push({ op: 'delete', store: 'results', key: r.resultId });
    for (const s of await storage.getAll('sessions')) {
      if (!s.players.some((p) => p.playerId === id)) continue;
      const players = s.players.filter((p) => p.playerId !== id);
      if (players.length) ops.push({ op: 'put', store: 'sessions', value: { ...s, players } });
      else ops.push({ op: 'delete', store: 'sessions', key: s.sessionId });
    }
    return ops;
  }

  return repo;
}

/* ---------------- export parsing ---------------- */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function cleanProfile(p) {
  if (!isObj(p) || typeof p.id !== 'string' || !p.id) return null;
  const name = normalizeName(p.name).slice(0, NAME_MAX);
  if (!name) return null;
  return {
    schema: SCHEMA_VERSION,
    id: p.id,
    name,
    avatar: { key: AVATAR_KEYS.includes(p.avatar?.key) ? p.avatar.key : AVATAR_KEYS[0] },
    language: isLanguage(p.language) ? p.language : DEFAULT_LANGUAGE,
    createdAt: Number.isFinite(p.createdAt) ? p.createdAt : 0,
    updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
    ownedCards: [...new Set([...(Array.isArray(p.ownedCards) ? p.ownedCards.filter((c) => CARDS[c]) : []), ...STARTER_CARDS])],
    ...metaOf(p),
  };
}

function validResult(r) {
  return (
    isObj(r) &&
    typeof r.resultId === 'string' &&
    typeof r.playerId === 'string' &&
    typeof r.sessionId === 'string' &&
    typeof r.questionId === 'string' &&
    typeof r.category === 'string' &&
    [1, 2, 3, 4].includes(r.difficulty) &&
    typeof r.correct === 'boolean' &&
    Number.isFinite(r.timestamp)
  );
}

function validSession(s) {
  return isObj(s) && typeof s.sessionId === 'string' && typeof s.mode === 'string' && ['active', 'completed', 'abandoned'].includes(s.status) && Array.isArray(s.players);
}

/** Validate and migrate an export file. Malformed records are skipped and counted. */
export function parseExport(data, { migrations = MIGRATIONS, schemaVersion = SCHEMA_VERSION } = {}) {
  if (!isObj(data) || data.format !== EXPORT_FORMAT) {
    throw new RepoError('INVALID_IMPORT', 'This file is not a The House Knows export.');
  }
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 0) {
    throw new RepoError('INVALID_IMPORT', 'The export file has no valid version.');
  }
  for (const key of ['profiles', 'sessions', 'results']) {
    if (!Array.isArray(data[key])) throw new RepoError('INVALID_IMPORT', `The export file is missing its ${key} list.`);
  }
  let snap;
  try {
    snap = migrateSnapshot({ profiles: data.profiles, sessions: data.sessions, results: data.results, kv: [] }, data.schemaVersion, schemaVersion, migrations);
  } catch (err) {
    if (err instanceof SchemaError) throw new RepoError(err.code, err.message);
    throw err;
  }
  const skipped = { profiles: 0, sessions: 0, results: 0 };
  const profiles = [];
  const seen = new Set();
  for (const p of snap.profiles) {
    const c = cleanProfile(p);
    if (!c || seen.has(c.id)) skipped.profiles++;
    else {
      seen.add(c.id);
      profiles.push(c);
    }
  }
  const results = snap.results.filter((r) => (validResult(r) ? true : (skipped.results++, false)));
  const sessions = snap.sessions.filter((s) => (validSession(s) ? true : (skipped.sessions++, false)));
  return { profiles, results, sessions, skipped };
}
