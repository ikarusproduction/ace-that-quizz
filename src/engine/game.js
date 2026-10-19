// The game state machine. Everything here is pure and serialisable: state is
// plain JSON (no Maps or Sets), so a game in progress can be saved to storage
// and resumed after a refresh, and tests can replay a game from a seed.
//
// Flow (per round):  loadout -> stake -> question -> (next player) -> reveal
//                    -> ... x5 -> round-summary -> crossroads -> shop -> loadout
//
// Usage: const { state } = dispatch(state, { type: 'ANSWER', ... }, ctx)
// Invalid or duplicate actions (for example a double tap) never throw: they
// return { ok: false, reason } with the state untouched.
import { Rng, randomSeed } from './rng.js';
import { RULES, HAZARDS, BOSSES, SHOP_ITEMS } from './modifiers.js';
import { CARDS, CARD_NUMBERS, equippableCards, draftCards } from './cards.js';
import { computeOutcome, previewStake, timerFor, nextStreak, runScore } from './scoring.js';
import { buildRound, roundInfo, roundCategories } from './rounds.js';
import { statCategory } from './bank.js';
import { checkPuzzle, PUZZLE_RULES } from './minigame.js';
import { HEXES, STARTER_HEXES, HEX_NUMBERS, tierForStreak, drawHex, usableHexes, missionsFor } from './hexes.js';
import {
  DUEL, INTENTS, BOSS_ROSTER, BOSS_IDS, TIER_DIFFICULTY, DEALS, DEAL_IDS, DUEL_SHOP_ITEMS,
  makeEncounter, cleanRank, intentIdFor, advancePhase, timerMultFor, duelDamage, bulbsLostOnMiss, heatCostOf, startHeat, duelCategory, buildMap, availableNodes, isEnraged,
} from './duel.js';
import { pickQuestion } from './rounds.js';

export const STATE_VERSION = 1;

function hexOwned(p) {
  return [...new Set([...(Array.isArray(p.ownedHexes) ? p.ownedHexes.filter((h) => HEXES[h]) : []), ...STARTER_HEXES])];
}
function hexDeck(p, mode) {
  const owned = hexOwned(p);
  const want = (Array.isArray(p.hexDeck) ? p.hexDeck : []).filter((h, i, a) => owned.includes(h) && a.indexOf(h) === i);
  const deck = usableHexes(want.length ? want : owned, mode).slice(0, HEX_NUMBERS.deckSize);
  return deck.length ? deck : usableHexes(STARTER_HEXES, mode).slice(0, HEX_NUMBERS.deckSize);
}

/** Everything the reducer needs besides state: the bank and a clock. */
export function makeContext(all, now = () => Date.now()) {
  // A question can come in three difficulty levels (a "family"). Only the primary entry is drawn into rounds;
  // the stake you choose then decides which level you are actually asked.
  const questions = all.filter((q) => !q.family || q.family === q.id);
  const families = new Map();
  for (const q of all) if (q.family && q.level) (families.get(q.family) ?? families.set(q.family, {}).get(q.family))[q.level] = q;
  return { questions, byId: new Map(all.map((q) => [q.id, q])), families, now };
}

/** Which difficulty level you are asked: your stake, +1 on a hard boss, +1 if you already saw this question in solo play. */
export function levelFor(s, q, stake) {
  let level = stake;
  if (s.enc && (s.enc.tier ?? 0) >= 3) level += 1;
  if (s.players.length === 1 && s.mode !== 'daily' && (s.seenCounts?.[q.family ?? q.id] ?? 0) > 0) level += 1;
  return Math.max(1, Math.min(3, level));
}

/** The question variant that goes with a stake (the question itself when it has no variants). */
export function variantFor(s, ctx, q, stake) {
  const fam = ctx.families?.get(q.family ?? q.id);
  return fam?.[levelFor(s, q, stake)] ?? q;
}

export function buildConfig(mode, overrides = {}) {
  if (mode === 'versus') {
    return { acts: 1, roundsPerAct: 0, noBoss: true, rounds: overrides.rounds ?? RULES.versusRounds, cardsEnabled: true, shop: false, crossroads: false, strikes: false, ...(overrides.themes ? { themes: overrides.themes } : {}) };
  }
  if (mode === 'daily') {
    return { acts: 1, roundsPerAct: RULES.roundsPerAct, noBoss: false, cardsEnabled: false, shop: false, crossroads: true, strikes: true };
  }
  if (['rush', 'map'].includes(overrides.variant)) {
    return { variant: overrides.variant, duel: true, heat: true, acts: 1, roundsPerAct: 0, noBoss: false, cardsEnabled: true, shop: overrides.variant === 'map', crossroads: false, strikes: true, startStrikes: DUEL.startLives, bossId: overrides.bossId ?? null, bossRanks: Object.fromEntries(Object.entries(overrides.bossRanks ?? {}).map(([k, v]) => [k, cleanRank(v)])) };
  }
  const acts = Math.max(1, Math.min(3, overrides.acts ?? RULES.acts));
  return { acts, roundsPerAct: RULES.roundsPerAct, noBoss: false, cardsEnabled: true, shop: true, crossroads: true, strikes: true, ...(overrides.themes ? { themes: overrides.themes } : {}) };
}

const clone = (x) => structuredClone(x);
const withRng = (s, fn) => {
  const rng = new Rng(s.rngState);
  const out = fn(rng);
  s.rngState = rng.state;
  return out;
};
const playerOf = (s, id) => s.players.find((p) => p.playerId === id);
const turnPlayer = (s) => s.players[s.turn];
const fail = (state, reason) => ({ state, ok: false, reason });
const succeed = (state) => ({ state, ok: true });

/**
 * Create a new game.
 * @param {Object} o
 * @param {'solo'|'versus'|'daily'} o.mode
 * @param {{id:string,name:string,ownedCards?:string[]}[]} o.players
 * @param {Object} o.ctx            from makeContext()
 * @param {string} [o.seed]
 * @param {string} [o.sessionId]
 * @param {Object} [o.overrides]    e.g. { acts: 1 } for a quick run
 * @param {Iterable<string>} [o.avoidIds] questions recently seen by participants
 */
export function createGame({ mode, players, ctx, seed, sessionId, overrides = {}, avoidIds = [], seenCounts = {} }) {
  if (!['solo', 'versus', 'daily'].includes(mode)) throw new Error(`Unknown mode "${mode}"`);
  const n = players.length;
  if ((mode === 'solo' || mode === 'daily') && n !== 1) throw new Error(`${mode} needs exactly one player`);
  if (mode === 'versus' && (n < 2 || n > 4)) throw new Error('versus needs 2 to 4 players');
  if (new Set(players.map((p) => p.id)).size !== n) throw new Error('players must be distinct');

  const config = buildConfig(mode, overrides);
  if (config.themes) config.today = ctx.now();
  const gameSeed = seed ?? randomSeed();
  const sessionIdFinal = sessionId ?? `s_${ctx.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const s = {
    version: STATE_VERSION,
    sessionId: sessionIdFinal,
    mode,
    seed: gameSeed,
    rngState: Rng.fromSeed(gameSeed).state,
    config,
    startedAt: ctx.now(),
    endedAt: null,
    status: 'active',
    phase: 'loadout',
    roundIndex: -1,
    round: null,
    qIndex: 0,
    turn: 0,
    q: null,
    avoidIds: mode === 'daily' ? [] : [...avoidIds],
    seenCounts: mode === 'daily' ? {} : { ...seenCounts },
    usedIds: [],
    usedBosses: [],
    previousHazard: null,
    previousCategories: [],
    crossroadsDone: false,
    players: players.map((p) => {
      const owned = config.cardsEnabled ? [...(p.ownedCards ?? [])] : [];
      return {
        playerId: p.id,
        name: p.name,
        chips: RULES.startChips,
        vault: 0,
        strikes: config.strikes ? (config.startStrikes ?? RULES.startStrikes) : 0,
        heat: 0,
        heatBonus: 0,
        edge: 0,
        edgeNow: 0,
        streak: 0,
        longestStreak: 0,
        owned,
        loadout: equippableCards(owned, mode).slice(0, 2).concat([null, null]).slice(0, 2),
        charges: {},
        runCharges: Object.fromEntries(owned.filter((id) => CARDS[id]?.timing === 'run').map((id) => [id, CARDS[id].uses])),
        roundStats: { answered: 0, correct: 0, wrong: 0 },
        pushed: false,
        slowClock: false,
        bonusCharges: false,
        comeback: false,
        jammed: false,
        siphonedBy: null,
        pendingHexes: [],
        hexOwned: hexOwned(p),
        hexDeck: hexDeck(p, mode),
        hexHand: [],
        shield: null,
        stats: { hexesPlayed: 0, chipsStolen: 0, dareWins: 0, puzzlesSolved: 0, blocked: 0 },
        missions: missionsFor(Rng.fromSeed(`${sessionIdFinal}:${p.id}:missions`)),
        puzzle: { n: 0, round: -1, roundBonus: 0, gameBonus: 0, meter: 0 },
        shopBought: {},
        roundsCleared: 0,
        bossesCleared: 0,
        correctTotal: 0,
        answeredTotal: 0,
        defeated: false,
        result: null,
        finalScore: null,
      };
    }),
    log: [],
    roundLog: [],
  };
  s.enc = null;
  s.map = null;
  s.victory = false;
  if (config.duel) {
    if (config.variant === 'map') {
      s.map = withRng(s, (rng) => buildMap(rng));
      s.round = null;
      s.phase = 'map';
    } else {
      const wanted = BOSS_ROSTER[config.bossId] ? config.bossId : withRng(s, (rng) => rng.pick(BOSS_IDS.filter((id) => !BOSS_ROSTER[id].final)));
      prepareEncounter(s, ctx, { kind: 'boss', enemyId: wanted });
    }
  } else prepareRound(s, ctx);
  return s;
}

/* ------------------------------------------------------------------ */
/* Round lifecycle                                                     */
/* ------------------------------------------------------------------ */

function prepareRound(s, ctx) {
  s.roundIndex += 1;
  s.crossroadsDone = false;
  const round = withRng(s, (rng) =>
    buildRound({
      questions: ctx.questions,
      rng,
      roundIndex: s.roundIndex,
      config: s.config,
      usedIds: new Set(s.usedIds),
      avoidIds: new Set(s.avoidIds),
      seen: s.seenCounts ?? null,
      usedBosses: s.usedBosses,
      previousHazard: s.previousHazard,
      previousCategories: s.previousCategories,
    }),
  );
  s.round = round;
  s.usedIds.push(...round.slots.map((x) => x.questionId));
  if (round.bossId) s.usedBosses.push(round.bossId);
  s.previousHazard = round.hazardId;
  s.previousCategories = roundCategories(round, ctx.byId);
  s.qIndex = 0;
  s.turn = 0;
  s.q = null;
  s.phase = 'loadout';

  // Versus comeback: trailing players get an extra charge on each equipped card.
  for (const p of s.players) p.comeback = false;
  if (s.mode === 'versus' && s.roundIndex > 0) {
    const leader = Math.max(...s.players.map((p) => p.chips));
    for (const p of s.players) {
      if (leader - p.chips >= 20 && p.chips <= leader * 0.8) p.comeback = true;
    }
  }
  round.comeback = s.players.filter((p) => p.comeback).map((p) => p.playerId);
  for (const p of s.players) {
    p.roundStats = { answered: 0, correct: 0, wrong: 0 };
    // Drop any equipped card that is no longer valid.
    p.loadout = p.loadout.map((c) => (c && equippableCards(p.owned, s.mode).includes(c) ? c : null));
  }
}

/* ------------------------------------------------------------------ */
/* Duels (the solo game)                                               */
/* ------------------------------------------------------------------ */

function statCategories(ctx) {
  if (!ctx._duelCats) {
    const have = new Set(ctx.questions.map(statCategory));
    ctx._duelCats = ['science', 'symbols', 'news', 'history', 'geography', 'nature', 'arts', 'phobia', 'medicine'].filter((c) => have.has(c));
  }
  return ctx._duelCats;
}

function prepareEncounter(s, ctx, { kind, enemyId = null, depth = 0 }) {
  s.roundIndex += 1;
  s.crossroadsDone = false;
  const rank = kind === 'boss' && enemyId ? cleanRank(s.config.bossRanks?.[enemyId]) : 0;
  s.enc = withRng(s, (rng) => makeEncounter({ kind, enemyId, rng, depth, rank }));
  if (s.enc.kind !== 'minion') s.usedBosses.push(s.enc.id);
  s.round = { index: s.roundIndex, act: 0, isBoss: s.enc.kind === 'boss' || s.enc.kind === 'final', bossId: null, hazardId: 'none', markedSlot: null, slots: [], kind: s.enc.kind, comeback: [] };
  s.qIndex = 0;
  s.turn = 0;
  s.q = null;
  s.phase = 'loadout';
  for (const p of s.players) {
    p.comeback = false;
    p.roundStats = { answered: 0, correct: 0, wrong: 0 };
    p.loadout = p.loadout.map((c) => (c && equippableCards(p.owned, s.mode).includes(c) ? c : null));
  }
}

/** Pick the next question of a fight: the enemy's specialty most of the time, at the difficulty its tier asks for. */
function addDuelSlot(s, ctx) {
  const enc = s.enc;
  const slot = withRng(s, (rng) => {
    const cats = statCategories(ctx);
    const category = duelCategory(rng, enc, cats);
    const difficulty = Number(rng.weighted(TIER_DIFFICULTY[enc.tier] ?? TIER_DIFFICULTY[1]));
    const pool = ctx.questions.filter((q) => statCategory(q) === category);
    const q = pickQuestion({ pool: pool.length ? pool : ctx.questions, rng, difficulty, usedIds: new Set(s.usedIds), avoidIds: new Set(s.avoidIds), seen: s.seenCounts ?? null, fallbackPool: ctx.questions });
    return { category: statCategory(q), theme: null, difficulty: q.difficulty, questionId: q.id, slot: s.round.slots.length };
  });
  s.round.slots.push(slot);
  s.usedIds.push(slot.questionId);
}

function chooseEnemy(s, kind) {
  return withRng(s, (rng) => {
    const pool = BOSS_IDS.filter((id) => !BOSS_ROSTER[id].final && !s.usedBosses.includes(id) && (kind === 'boss' ? BOSS_ROSTER[id].tier <= 2 : BOSS_ROSTER[id].tier <= 3));
    return rng.pick(pool.length ? pool : BOSS_IDS.filter((id) => !BOSS_ROSTER[id].final));
  });
}

function enterNode(s, ctx, kind, layer) {
  if (kind === 'fight') prepareEncounter(s, ctx, { kind: 'minion', depth: layer });
  else if (kind === 'elite') prepareEncounter(s, ctx, { kind: 'elite', enemyId: chooseEnemy(s, 'elite') });
  else if (kind === 'boss') prepareEncounter(s, ctx, { kind: 'boss', enemyId: chooseEnemy(s, 'boss') });
  else if (kind === 'final') prepareEncounter(s, ctx, { kind: 'boss', enemyId: 'house' });
  else if (kind === 'shop') s.phase = 'shop';
  else if (kind === 'rest') s.phase = 'rest';
  else if (kind === 'event') {
    s.event = { deals: withRng(s, (rng) => rng.shuffle(DEAL_IDS).slice(0, 2)) };
    s.phase = 'event';
  }
}

function endEncounter(s) {
  const enc = s.enc;
  const p = s.players[0];
  const rw = DUEL.rewards[enc.kind] ?? DUEL.rewards.minion;
  const won = enc.over === 'won';
  let healed = 0;
  let hex = null;
  let bulbLost = 0;
  if (won) {
    p.chips += Math.round(rw.chips * (enc.reward ?? 1));
    p.roundsCleared += 1;
    if (s.round.isBoss) p.bossesCleared += 1;
    if (enc.kind === 'boss' && enc.id !== 'house') { (s.beaten ??= []).push({ id: enc.id, rank: enc.rank ?? 0 }); s.rankBeaten = Math.max(s.rankBeaten ?? 0, enc.rank ?? 0); }
    if (rw.heal && p.strikes < DUEL.maxLives) { p.strikes += rw.heal; healed = rw.heal; }
    if (rw.hex && s.config.cardsEnabled && p.hexHand.length < HEX_NUMBERS.handMax) {
      const id = drawHex(Rng.fromSeed(`${s.sessionId}:${p.playerId}:hex:${(s.earnSeq ?? 0) + 1}`), p.hexDeck, 'uncommon', s.mode);
      if (id) { p.hexHand.push(id); hex = id; s.lastEarn = { seq: (s.earnSeq = (s.earnSeq ?? 0) + 1), playerId: p.playerId, hexId: id, tier: 'uncommon', from: 'fight' }; }
    }
  } else if (enc.over === 'beaten') {
    p.strikes = Math.max(0, p.strikes - 1);
    bulbLost = 1;
  }
  if (s.config.strikes && p.strikes <= 0) p.defeated = true;
  p.edgeNow = 0;
  p.pushed = false;
  p.slowClock = false;
  p.bonusCharges = false;
  s.roundLog.push({
    roundIndex: s.roundIndex, isBoss: s.round.isBoss, bossId: null, hazardId: 'none', result: enc.over,
    enemy: { id: enc.id, name: enc.name, kind: enc.kind, sprite: enc.sprite, color: enc.color, maxHp: enc.maxHp },
    players: { [p.playerId]: { correct: p.roundStats.correct, cleared: won, strikesLost: (enc.bulbsLost ?? 0) + bulbLost, bonus: won ? Math.round(rw.chips * (enc.reward ?? 1)) : 0, chips: p.chips, strikes: p.strikes, healed, hex, hits: enc.hits } },
  });
  s.phase = 'round-summary';
}

function duelScore(p, won) {
  const e = DUEL.endScore;
  return (won ? p.chips : Math.floor(p.chips / 2)) + p.roundsCleared * e.clearBonus + p.bossesCleared * e.bossBonus + (won ? p.strikes * e.lifeBonus : 0);
}

function startRound(s, ctx) {
  const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
  for (const p of s.players) {
    p.charges = {};
    for (const cardId of p.loadout) {
      if (!cardId || CARDS[cardId].timing === 'run') continue;
      p.charges[cardId] = CARDS[cardId].uses + (p.bonusCharges ? 1 : 0) + (p.comeback ? 1 : 0);
    }
  }
  if (s.enc) {
    for (const p of s.players) {
      p.heat = startHeat(s.enc.kind, p.heatBonus);
      p.heatBonus = 0;
      p.edgeNow = p.edge ?? 0;
      p.edge = 0;
    }
  }
  s.cardsLockedThisRound = Boolean(boss?.cardsLocked) || !s.config.cardsEnabled;
  openQuestion(s, ctx);
}

function openQuestion(s, ctx) {
  if (s.enc && s.qIndex >= s.round.slots.length) addDuelSlot(s, ctx);
  const slot = s.round.slots[s.qIndex];
  const q = ctx.byId.get(slot.questionId);
  const order = q.type === 'tf'
    ? q.choices.map((_, i) => i)
    : withRng(s, (rng) => rng.shuffle(q.choices.map((_, i) => i)));
  // baseId/baseOrder: the question as drawn. Every player stakes on this one and then gets the level their own stake asks for.
  s.q = { questionId: q.id, order, baseId: q.id, baseOrder: order, byPlayer: {}, hexBy: [] };
  for (const p of s.players) {
    s.q.byPlayer[p.playerId] = {
      phase: 'waiting',
      stake: null,
      armed: {},
      used: {},
      usedCards: [],
      hidden: [],
      hexes: [],
      eliminated: [],
      ghostLetter: null,
      startedAt: null,
      timerMs: null,
      attempts: 0,
      retry: false,
      result: null,
    };
  }
  s.turn = 0;
  s.q.byPlayer[s.players[0].playerId].phase = 'stake';
  s.phase = 'stake';
  if (s.enc) {
    const intentId = intentIdFor(s.enc, s.qIndex);
    const it = INTENTS[intentId];
    s.q.intent = intentId;
    s.q.enraged = isEnraged(s.enc);
    s.q.timerMult = timerMultFor(s.enc, intentId, s.qIndex);
    s.q.healedNow = 0;
    if (it.healNow && s.enc.hp < s.enc.maxHp) {
      const before = s.enc.hp;
      s.enc.hp = Math.min(s.enc.maxHp, s.enc.hp + it.healNow);
      s.q.healedNow = s.enc.hp - before;
      s.enc.healed += s.q.healedNow;
    }
    if (it.curse) for (const p of s.players) p.pendingHexes.push({ fx: it.curse, by: 'boss' });
  }
}

function endRound(s, ctx) {
  const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
  const summary = { roundIndex: s.roundIndex, isBoss: s.round.isBoss, bossId: s.round.bossId, hazardId: s.round.hazardId, players: {} };
  for (const p of s.players) {
    const { correct } = p.roundStats;
    const threshold = boss?.passThreshold ?? RULES.passThreshold;
    const cleared = correct >= threshold;
    let strikesLost = 0;
    let bonus = 0;
    if (s.config.strikes && !cleared && !boss?.strikeOnWrong) {
      strikesLost = 1;
      p.strikes = Math.max(0, p.strikes - 1);
    }
    if (correct === RULES.questionsPerRound) {
      bonus += RULES.perfectRoundBonus;
      if (boss?.chainBonus) bonus += boss.chainBonus;
    }
    p.chips += bonus;
    if (cleared) {
      p.roundsCleared += 1;
      if (s.round.isBoss) p.bossesCleared += 1;
    }
    if (s.config.strikes && p.strikes <= 0) p.defeated = true;
    // One-round effects expire.
    p.pushed = false;
    p.slowClock = false;
    p.bonusCharges = false;
    summary.players[p.playerId] = { correct, cleared, strikesLost, bonus, chips: p.chips, strikes: p.strikes };
  }
  s.roundLog.push(summary);
  s.phase = 'round-summary';
}

function finish(s, ctx, { abandoned = false } = {}) {
  s.endedAt = ctx.now();
  s.phase = 'finished';
  if (abandoned) {
    s.status = 'abandoned';
    for (const p of s.players) p.result = 'abandoned';
    return;
  }
  s.status = 'completed';
  if (s.mode === 'versus') {
    const ranked = [...s.players].sort((a, b) => b.chips - a.chips || b.correctTotal - a.correctTotal);
    let place = 0;
    ranked.forEach((p, i) => {
      if (i === 0 || p.chips !== ranked[i - 1].chips || p.correctTotal !== ranked[i - 1].correctTotal) place = i + 1;
      p.placement = place;
      p.finalScore = p.chips;
      p.result = place === 1 ? 'won' : 'lost';
    });
  } else {
    for (const p of s.players) {
      if (s.config.duel) {
        const won = Boolean(s.victory) && !p.defeated;
        p.result = won ? 'won' : 'lost';
        p.finalScore = duelScore(p, won);
        continue;
      }
      const won = !p.defeated && s.roundIndex + 1 >= roundInfo(0, s.config).totalRounds;
      p.result = won ? 'won' : 'lost';
      p.finalScore = runScore({ vault: p.vault, chips: p.chips, won, roundsCleared: p.roundsCleared, bossesCleared: p.bossesCleared });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function puzzleSeed(s, playerId, n, level) {
  return `${s.sessionId}:${playerId}:${n}:L${level}`;
}

export function dispatch(prev, action, ctx) {
  if (prev.phase === 'finished' && action.type !== 'NOOP') return fail(prev, 'game is finished');
  const s = clone(prev);
  const handler = HANDLERS[action.type];
  if (!handler) return fail(prev, `unknown action ${action.type}`);
  const res = handler(s, action, ctx);
  if (res && res.ok === false) return fail(prev, res.reason);
  return succeed(s);
}

const HANDLERS = {
  SET_LOADOUT(s, a) {
    if (s.phase !== 'loadout') return { ok: false, reason: 'not in loadout phase' };
    if (!s.config.cardsEnabled) return { ok: false, reason: 'cards are disabled in this mode' };
    const p = playerOf(s, a.playerId);
    if (!p) return { ok: false, reason: 'unknown player' };
    const cards = (a.cards ?? []).slice(0, 2).concat([null, null]).slice(0, 2);
    const picked = cards.filter(Boolean);
    if (new Set(picked).size !== picked.length) return { ok: false, reason: 'duplicate card' };
    const allowed = equippableCards(p.owned, s.mode);
    if (picked.some((c) => !allowed.includes(c))) return { ok: false, reason: 'card not available' };
    p.loadout = cards;
  },

  START_ROUND(s, a, ctx) {
    if (s.phase !== 'loadout') return { ok: false, reason: 'not in loadout phase' };
    startRound(s, ctx);
  },

  USE_CARD(s, a, ctx) {
    const p = playerOf(s, a.playerId);
    if (!p || turnPlayer(s).playerId !== a.playerId) return { ok: false, reason: 'not your turn' };
    if (s.phase !== 'stake' && s.phase !== 'question') return { ok: false, reason: 'cannot use cards now' };
    const card = CARDS[a.cardId];
    if (!card) return { ok: false, reason: 'unknown card' };
    if (s.cardsLockedThisRound) return { ok: false, reason: 'cards are locked this round' };
    if (!p.loadout.includes(card.id)) return { ok: false, reason: 'card is not equipped' };
    const hazard = HAZARDS[s.round.hazardId];
    const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
    if (hazard.cluesLocked && card.clue) return { ok: false, reason: 'clue cards are locked by the hazard' };

    const qp = s.q.byPlayer[p.playerId];
    const q = ctx.byId.get(s.q.questionId);
    if (qp.usedCards.includes(card.id)) return { ok: false, reason: 'already used on this question' };

    const wantsPhase = card.timing === 'pre-stake' ? 'stake' : 'question';
    if (s.phase !== wantsPhase) return { ok: false, reason: `${card.name} can only be used ${card.timing === 'pre-stake' ? 'before staking' : 'during the question'}` };

    const isRun = card.timing === 'run';
    const left = isRun ? p.runCharges[card.id] ?? 0 : p.charges[card.id] ?? 0;
    if (left <= 0) return { ok: false, reason: 'no charges left' };

    const four = q.choices.length >= 4;
    const visible = () => s.q.order.map((_, d) => d).filter((d) => !qp.hidden.includes(d));

    switch (card.id) {
      case 'peek':
        qp.armed.peek = true;
        break;
      case 'safety_net':
        qp.armed.safetyNet = true;
        break;
      case 'streak_shield':
        qp.armed.streakShield = true;
        break;
      case 'double_or_nothing':
        qp.armed.doubleOrNothing = true;
        break;
      case 'rewind':
        if (q.type === 'tf' || !four) return { ok: false, reason: 'Rewind needs a multiple choice question' };
        qp.armed.rewind = true;
        break;
      case 'scalpel': {
        if (q.type === 'tf' || !four) return { ok: false, reason: 'Scalpel needs a multiple choice question' };
        const correctDisplay = s.q.order.indexOf(q.answer);
        const wrong = visible().filter((d) => d !== correctDisplay);
        if (wrong.length < 3) return { ok: false, reason: 'nothing left to remove' };
        const remove = withRng(s, (rng) => rng.shuffle(wrong).slice(0, 2));
        qp.hidden.push(...remove);
        qp.used.scalpel = true;
        break;
      }
      case 'stopwatch':
        qp.timerMs += CARD_NUMBERS.stopwatchBonusMs;
        qp.used.stopwatch = true;
        break;
      case 'ghost_note': {
        if (q.type === 'tf') return { ok: false, reason: 'Ghost Note needs a multiple choice question' };
        qp.ghostLetter = String(q.choices[q.answer]).trim().charAt(0).toUpperCase();
        qp.used.ghostNote = true;
        break;
      }
      case 'skeleton_key': {
        if (boss || (s.enc && s.enc.kind !== 'minion')) return { ok: false, reason: 'the Skeleton Key does nothing against bosses' };
        qp.used.skeleton = true;
        qp.usedCards.push(card.id);
        p.runCharges[card.id] -= 1;
        resolveAnswer(s, ctx, p, { correct: true, timeout: false, elapsedMs: qp.timerMs });
        return;
      }
      case 'jammer':
      case 'siphon': {
        if (s.mode !== 'versus') return { ok: false, reason: 'attack cards only work in Versus' };
        const target = playerOf(s, a.targetId);
        if (!target || target.playerId === p.playerId) return { ok: false, reason: 'choose a rival' };
        if (card.id === 'jammer') target.jammed = true;
        else target.siphonedBy = p.playerId;
        break;
      }
      default:
        return { ok: false, reason: 'card has no effect' };
    }
    if (isRun) p.runCharges[card.id] -= 1;
    else p.charges[card.id] -= 1;
    qp.usedCards.push(card.id);
  },

  SET_HEXDECK(s, a) {
    if (s.phase !== 'loadout') return { ok: false, reason: 'not in loadout phase' };
    const p = playerOf(s, a.playerId);
    if (!p) return { ok: false, reason: 'unknown player' };
    const deck = [...new Set(Array.isArray(a.deck) ? a.deck : [])];
    if (deck.length > HEX_NUMBERS.deckSize) return { ok: false, reason: `a hex deck holds ${HEX_NUMBERS.deckSize}` };
    if (deck.some((id) => !p.hexOwned.includes(id) || !usableHexes([id], s.mode).length)) return { ok: false, reason: 'hex not available' };
    p.hexDeck = deck.length ? deck : usableHexes(STARTER_HEXES, s.mode).slice(0, HEX_NUMBERS.deckSize);
  },

  /** Play a hex from your hand. The turn player plays before staking; everyone else can prank the turn player live. */
  USE_HEX(s, a) {
    if (!s.config.cardsEnabled) return { ok: false, reason: 'no hexes in this mode' };
    if (s.phase !== 'stake' && s.phase !== 'question') return { ok: false, reason: 'cannot play a hex now' };
    const p = playerOf(s, a.playerId);
    const hex = HEXES[a.hexId];
    if (!p || !hex) return { ok: false, reason: 'unknown hex' };
    const at = p.hexHand.indexOf(hex.id);
    if (at < 0) return { ok: false, reason: 'that hex is not in your hand' };
    const turn = turnPlayer(s);
    const myTurn = turn.playerId === p.playerId;
    if (s.q.hexBy.includes(p.playerId)) return { ok: false, reason: 'one hex per question' };
    const qpTurn = s.q.byPlayer[turn.playerId];

    if (hex.kind === 'defense') {
      if (p.shield) return { ok: false, reason: 'you already have a shield up' };
      p.shield = hex.shield;
      if (hex.shield === 'cloth') {
        p.pendingHexes = [];
        const qp = s.q.byPlayer[p.playerId];
        if (qp) qp.hexes = [];
      }
      p.hexHand.splice(at, 1);
      s.q.hexBy.push(p.playerId);
      s.hexSeq = (s.hexSeq ?? 0) + 1;
      s.lastHex = { seq: s.hexSeq, hexId: hex.id, by: p.playerId, target: p.playerId, self: true, effects: [], stolen: 0, blocked: null, live: false, at: p.playerId };
      p.stats.hexesPlayed += 1;
      return;
    }

    const targetId = a.targetId ?? p.playerId;
    const target = playerOf(s, targetId);
    if (!target) return { ok: false, reason: 'choose a target' };
    const self = target.playerId === p.playerId;
    if (self && hex.targets === 'rival') return { ok: false, reason: `${hex.name} needs a rival` };
    if (!self && s.mode !== 'versus') return { ok: false, reason: 'rivals only exist in Versus' };
    if (!myTurn) {
      // A prank from the sidelines: it hits the player who is answering right now.
      if (self || target.playerId !== turn.playerId) return { ok: false, reason: 'while you wait you can only hex the player who is answering' };
    } else if (s.phase !== 'stake') {
      return { ok: false, reason: 'play hexes before you stake' };
    }
    const live = !myTurn && target.playerId === turn.playerId;

    let victim = target;
    let attacker = p;
    let blocked = null;
    if (!self && target.shield) {
      blocked = target.shield;
      target.shield = null;
      target.stats.blocked += 1;
      if (blocked === 'mirror') { victim = p; attacker = target; }
    }
    let stolen = 0;
    let effects = hex.fx ?? [];
    if (blocked === 'sponge' || blocked === 'cloth') effects = [];
    if (hex.steal && blocked !== 'sponge' && blocked !== 'cloth') {
      const want = hex.steal === 'pickpocket' ? CARD_NUMBERS.pickpocketChips
        : hex.steal === 'kraken' ? CARD_NUMBERS.krakenChips
          : Math.max(CARD_NUMBERS.heistMin, Math.min(CARD_NUMBERS.heistMax, Math.round(victim.chips * CARD_NUMBERS.heistShare)));
      stolen = Math.min(want, victim.chips);
      victim.chips -= stolen;
      attacker.chips += stolen;
      if (hex.steal === 'heist') attacker.chips = Math.max(0, attacker.chips - CARD_NUMBERS.heistCost);
      attacker.stats.chipsStolen += stolen;
    }
    if (effects.length) {
      const vqp = s.q.byPlayer[victim.playerId];
      const applyNow = victim.playerId === turn.playerId && (s.phase === 'question' || (self && s.phase === 'stake') || (live && s.phase === 'stake'));
      if (applyNow && vqp) for (const e of effects) vqp.hexes.push({ fx: e, by: attacker.playerId });
      else {
        for (const e of effects) victim.pendingHexes.push({ fx: e, by: attacker.playerId });
        victim.pendingHexes = victim.pendingHexes.slice(-CARD_NUMBERS.maxPendingHexes);
      }
    }
    p.hexHand.splice(at, 1);
    s.q.hexBy.push(p.playerId);
    p.stats.hexesPlayed += 1;
    s.hexSeq = (s.hexSeq ?? 0) + 1;
    s.lastHex = { seq: s.hexSeq, hexId: hex.id, by: p.playerId, target: victim.playerId, self, effects, stolen, blocked, live, at: target.playerId };
    void qpTurn;
  },

  /** Waiting-room puzzle: the seed is derived from state, so the host can regenerate and judge it. */
  PUZZLE(s, a) {
    if (s.phase !== 'stake' && s.phase !== 'question') return { ok: false, reason: 'no puzzles right now' };
    const p = playerOf(s, a.playerId);
    if (!p) return { ok: false, reason: 'unknown player' };
    if (turnPlayer(s).playerId === p.playerId) return { ok: false, reason: 'it is your turn' };
    const pz = (p.puzzle ??= { n: 0, round: -1, roundBonus: 0, gameBonus: 0 });
    if (pz.round !== s.roundIndex) { pz.round = s.roundIndex; pz.roundBonus = 0; }
    const level = Number(a.level);
    if (![1, 2, 3].includes(level)) return { ok: false, reason: 'bad level' };
    const seed = puzzleSeed(s, p.playerId, pz.n, level);
    if (a.seed !== seed) return { ok: false, reason: 'stale puzzle' };
    pz.n += 1; // one attempt per puzzle
    const ok = checkPuzzle(seed, a.choice);
    if (typeof a.choice !== 'string' || a.choice.length > PUZZLE_RULES.maxLength) return { ok: false, reason: 'bad answer' };
    const room = Math.max(0, Math.min(PUZZLE_RULES.roundCap - pz.roundBonus, PUZZLE_RULES.gameCap - pz.gameBonus));
    const gain = ok ? Math.min(PUZZLE_RULES.reward[level], room) : 0;
    p.chips += gain; pz.roundBonus += gain; pz.gameBonus += gain;
    pz.last = { n: pz.n, ok, gain }; // per player, so two players answering at once never read each other's result
    s.puzzleSeq = (s.puzzleSeq ?? 0) + 1;
    if (ok) {
      p.stats.puzzlesSolved += 1;
      pz.meter = (pz.meter ?? 0) + (level === 3 ? 2 : 1);
      while (pz.meter >= HEX_NUMBERS.puzzlesPerPrank && p.hexHand.length < HEX_NUMBERS.handMax) {
        pz.meter -= HEX_NUMBERS.puzzlesPerPrank;
        const id = drawHex(Rng.fromSeed(`${s.sessionId}:${p.playerId}:hex:${(s.earnSeq ?? 0) + 1}`), p.hexDeck, 'common', s.mode);
        if (id) { p.hexHand.push(id); s.lastEarn = { seq: (s.earnSeq = (s.earnSeq ?? 0) + 1), playerId: p.playerId, hexId: id, tier: 'common', from: 'puzzles' }; }
      }
      if (p.hexHand.length >= HEX_NUMBERS.handMax) pz.meter = Math.min(pz.meter, HEX_NUMBERS.puzzlesPerPrank - 1);
    }
  },

  CONFIRM_STAKE(s, a, ctx) {
    if (s.phase !== 'stake') return { ok: false, reason: 'not staking now' };
    const p = turnPlayer(s);
    if (p.playerId !== a.playerId) return { ok: false, reason: 'not your turn' };
    const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
    const hazard = HAZARDS[s.round.hazardId];
    const q = ctx.byId.get(s.q.questionId);
    const qp = s.q.byPlayer[p.playerId];
    let stake = boss?.lockStake ?? a.stake;
    if (p.chips <= 0) stake = 1;
    if (!RULES.stakes.includes(stake)) return { ok: false, reason: 'invalid stake' };
    if (s.config.heat) {
      const cost = heatCostOf(stake);
      if ((p.heat ?? 0) < cost) return { ok: false, reason: `not enough heat for a ${stake}× stake` };
      p.heat -= cost;
      qp.heatSpent = cost;
    }
    qp.stake = stake;
    const asked = variantFor(s, ctx, q, stake);
    if (asked.id !== q.id) {
      s.q.questionId = asked.id;
      s.q.order = asked.type === 'tf' ? asked.choices.map((_, i) => i) : withRng(s, (rng) => rng.shuffle(asked.choices.map((_, i) => i)));
    }
    qp.timerMs = timerFor({ type: asked.type, hazard, boss, slowClock: p.slowClock, jammed: p.jammed });
    if (s.q.timerMult && s.q.timerMult !== 1) qp.timerMs = Math.max(RULES.minTimerMs, Math.round(qp.timerMs * s.q.timerMult));
    p.jammed = false;
    if (p.pendingHexes?.length) { qp.hexes.push(...p.pendingHexes); p.pendingHexes = []; }
    qp.startedAt = ctx.now();
    qp.phase = 'question';
    s.phase = 'question';
  },

  ANSWER(s, a, ctx) {
    if (s.phase !== 'question') return { ok: false, reason: 'no question is open' };
    const p = turnPlayer(s);
    if (p.playerId !== a.playerId) return { ok: false, reason: 'not your turn' };
    const qp = s.q.byPlayer[p.playerId];
    if (qp.phase !== 'question') return { ok: false, reason: 'already answered' };
    const q = ctx.byId.get(s.q.questionId);

    const elapsed = Math.max(0, a.elapsedMs ?? ctx.now() - qp.startedAt);
    const late = elapsed > qp.timerMs + RULES.answerGraceMs;
    const timeout = a.choice === null || a.choice === undefined || late;
    if (!timeout) {
      if (!Number.isInteger(a.choice) || a.choice < 0 || a.choice >= s.q.order.length) return { ok: false, reason: 'invalid choice' };
      if (qp.hidden.includes(a.choice) || qp.eliminated.includes(a.choice)) return { ok: false, reason: 'that option was removed' };
    }
    const correct = !timeout && s.q.order[a.choice] === q.answer;

    if (!correct && !timeout && qp.armed.rewind && qp.attempts === 0) {
      // Rewind: one retry with the wrong option removed.
      qp.attempts = 1;
      qp.retry = true;
      qp.eliminated.push(a.choice);
      qp.hidden.push(a.choice);
      qp.startedAt = ctx.now();
      qp.timerMs = CARD_NUMBERS.rewindRetryMs;
      return;
    }
    resolveAnswer(s, ctx, p, { correct, timeout, elapsedMs: Math.min(elapsed, qp.timerMs), choice: timeout ? null : a.choice });
  },

  NEXT(s, a, ctx) {
    if (s.phase !== 'reveal') return { ok: false, reason: 'nothing to advance' };
    if (s.enc) {
      if (s.enc.over) return endEncounter(s);
      s.qIndex += 1;
      openQuestion(s, ctx);
      return;
    }
    const defeated = s.config.strikes && s.players.every((p) => p.defeated);
    s.qIndex += 1;
    if (defeated || s.qIndex >= RULES.questionsPerRound) {
      endRound(s, ctx);
    } else {
      openQuestion(s, ctx);
    }
  },

  CONTINUE(s, a, ctx) {
    if (s.phase !== 'round-summary') return { ok: false, reason: 'not in round summary' };
    if (s.config.duel) {
      const me = s.players[0];
      if (me.defeated) { s.victory = false; return finish(s, ctx); }
      if (s.config.variant === 'rush' || s.round.kind === 'final') { s.victory = s.enc.over === 'won'; return finish(s, ctx); }
      s.phase = 'map';
      return;
    }
    const total = roundInfo(0, s.config).totalRounds;
    const lost = s.config.strikes && s.players.every((p) => p.defeated);
    if (lost || s.roundIndex + 1 >= total) return finish(s, ctx);
    if (s.config.crossroads) {
      s.phase = 'crossroads';
    } else {
      prepareRound(s, ctx);
    }
  },

  CROSSROADS(s, a, ctx) {
    if (s.phase !== 'crossroads' || s.crossroadsDone) return { ok: false, reason: 'not at the crossroads' };
    const p = playerOf(s, a.playerId);
    if (!p) return { ok: false, reason: 'unknown player' };
    if (!['bank', 'hold', 'push'].includes(a.choice)) return { ok: false, reason: 'invalid choice' };
    if (a.choice === 'bank') {
      const amount = Math.floor(p.chips * RULES.bankFraction);
      p.chips -= amount;
      p.vault += amount;
    } else if (a.choice === 'push') {
      p.pushed = true;
    }
    s.crossroadsDone = true;
    if (s.config.shop) s.phase = 'shop';
    else prepareRound(s, ctx);
  },

  BUY(s, a) {
    if (s.phase !== 'shop') return { ok: false, reason: 'the shop is closed' };
    const p = playerOf(s, a.playerId);
    const item = SHOP_ITEMS[a.item] ?? (s.config.duel ? DUEL_SHOP_ITEMS[a.item] : null);
    if (!p || !item) return { ok: false, reason: 'unknown item' };
    if (p.chips < item.cost) return { ok: false, reason: 'not enough chips' };
    const act = s.config.duel ? `n${s.map?.at ?? 0}` : s.round.act;
    if (a.item === 'spare_bulb') {
      if (p.strikes >= RULES.maxStrikes) return { ok: false, reason: 'already at maximum strikes' };
      if (p.shopBought[`bulb${act}`]) return { ok: false, reason: 'already bought this act' };
      p.strikes += 1;
      p.shopBought[`bulb${act}`] = true;
    } else if (a.item === 'spare_battery') {
      if (p.bonusCharges) return { ok: false, reason: 'already bought' };
      p.bonusCharges = true;
    } else if (a.item === 'slow_clock') {
      if (p.slowClock) return { ok: false, reason: 'already bought' };
      p.slowClock = true;
    } else if (a.item === 'ice_pack') {
      if (p.shopBought[`ice${act}`]) return { ok: false, reason: 'already bought here' };
      p.shopBought[`ice${act}`] = true;
      p.heatBonus = (p.heatBonus ?? 0) + 2;
    } else if (a.item === 'whetstone') {
      if ((p.edge ?? 0) >= 2) return { ok: false, reason: 'your edge is already sharp' };
      p.edge = (p.edge ?? 0) + 1;
    }
    p.chips -= item.cost;
  },

  LEAVE_SHOP(s, a, ctx) {
    if (s.phase !== 'shop') return { ok: false, reason: 'the shop is closed' };
    if (s.config.duel) { s.phase = 'map'; return; }
    prepareRound(s, ctx);
  },

  /** Walk to a room on the map. */
  MAP_PICK(s, a, ctx) {
    if (s.phase !== 'map' || !s.map) return { ok: false, reason: 'not on the map' };
    const node = availableNodes(s.map).find((n) => n.layer === a.layer && n.index === a.index);
    if (!node) return { ok: false, reason: 'that room is not reachable' };
    s.map.at = node.layer;
    s.map.pick = node.index;
    s.map.trail.push(node.index);
    enterNode(s, ctx, node.kind, node.layer);
  },

  /** The Rest room: heal a bulb, or train for the next fight. */
  REST(s, a) {
    if (s.phase !== 'rest') return { ok: false, reason: 'there is no fire here' };
    const p = s.players[0];
    if (a.choice === 'heal') {
      if (p.strikes >= DUEL.maxLives) return { ok: false, reason: 'your bulbs are already full' };
      p.strikes += 1;
    } else if (a.choice === 'train') {
      p.chips += DUEL.restChips;
      p.heatBonus = (p.heatBonus ?? 0) + 1;
    } else return { ok: false, reason: 'choose to heal or train' };
    s.restSeq = (s.restSeq ?? 0) + 1;
    s.phase = 'map';
  },

  /** A Deal room: take one of two offers, or walk away. */
  EVENT(s, a) {
    if (s.phase !== 'event' || !s.event) return { ok: false, reason: 'nobody is offering anything' };
    const p = s.players[0];
    if (a.choice !== 'walk') {
      if (!s.event.deals.includes(a.choice)) return { ok: false, reason: 'that deal is not on the table' };
      const deal = DEALS[a.choice];
      if (!deal.ok(p)) return { ok: false, reason: 'you cannot afford that deal' };
      let won = null;
      switch (deal.id) {
        case 'sell_bulb': p.strikes -= 1; p.chips += 90; break;
        case 'buy_bulb': p.chips -= 60; p.strikes = Math.min(DUEL.maxLives, p.strikes + 1); break;
        case 'hot_hand': p.chips -= 20; p.heatBonus = (p.heatBonus ?? 0) + 3; break;
        case 'sharpen': p.chips -= 40; p.edge = Math.min(2, (p.edge ?? 0) + 1); break;
        case 'free_hex': {
          if (p.hexHand.length >= HEX_NUMBERS.handMax) return { ok: false, reason: 'your hex hand is full' };
          const id = drawHex(Rng.fromSeed(`${s.sessionId}:${p.playerId}:hex:${(s.earnSeq ?? 0) + 1}`), p.hexDeck, 'common', s.mode);
          if (!id) return { ok: false, reason: 'your hex deck is empty' };
          p.chips -= 25;
          p.hexHand.push(id);
          s.lastEarn = { seq: (s.earnSeq = (s.earnSeq ?? 0) + 1), playerId: p.playerId, hexId: id, tier: 'common', from: 'deal' };
          break;
        }
        case 'gamble': {
          won = withRng(s, (rng) => rng.chance(0.5));
          p.chips = won ? p.chips + 70 : Math.max(0, p.chips - 35);
          break;
        }
        default: return { ok: false, reason: 'unknown deal' };
      }
      s.lastDeal = { seq: (s.lastDeal?.seq ?? 0) + 1, id: deal.id, won };
    }
    s.event = null;
    s.phase = 'map';
  },

  ABANDON(s, a, ctx) {
    if (s.status !== 'active') return { ok: false, reason: 'game already ended' };
    finish(s, ctx, { abandoned: true });
  },
};

/** Apply one answer to the enemy: damage, healing, bulbs, heat, and whether the fight is over. Returns what happened for the UI. */
function applyDuel(s, p, qp, q, { correct, elapsedMs, out }) {
  const enc = s.enc;
  const intentId = s.q.intent ?? 'strike';
  const it = INTENTS[intentId] ?? INTENTS.strike;
  const stake = qp.stake ?? 1;
  const res = {
    intent: intentId, enraged: Boolean(s.q.enraged), hpBefore: enc.hp, hpAfter: enc.hp, maxHp: enc.maxHp, dmg: 0, crit: false, guarded: false,
    phaseFrom: enc.phase ?? 0, phaseTo: enc.phase ?? 0, curseThrough: false, heal: 0, healNow: s.q.healedNow ?? 0, bulbsLost: 0, misses: enc.misses, heatSpent: qp.heatSpent ?? 0, heatGain: 0, leech: 0, over: null, stake, twin: Boolean(it.twin),
  };
  enc.qCount += 1;
  if (correct) {
    const inWindow = elapsedMs <= DUEL.guardWindow * qp.timerMs;
    const curseThrough = (qp.hexes ?? []).some((x) => x.by === 'boss');
    const dmg = duelDamage({ difficulty: q.difficulty, stake, fast: out.fast, inGuardWindow: inWindow, streak: p.streak, intentId, curseThrough, dmgBonus: p.edgeNow ?? 0 });
    enc.hp = Math.max(0, enc.hp - dmg);
    enc.hits += 1;
    Object.assign(res, { dmg, crit: out.fast, guarded: Boolean(it.guard && !inWindow), curseThrough });
    if (s.config.heat) {
      let gain = 0;
      if (out.fast) gain += DUEL.heatOnFast;
      if (p.streak === DUEL.heatOnStreak) gain += 1;
      p.heat = Math.min(DUEL.heatCap, (p.heat ?? 0) + gain);
      res.heatGain = gain;
    }
  } else {
    if (enc.kind === 'minion') enc.misses += 1;
    const lost = bulbsLostOnMiss(enc, intentId);
    if (lost) {
      p.strikes = Math.max(0, p.strikes - lost);
      enc.bulbsLost = (enc.bulbsLost ?? 0) + lost;
      res.bulbsLost = lost;
    }
    if (it.mend && enc.hp < enc.maxHp) {
      const heal = Math.min(it.mend, enc.maxHp - enc.hp);
      enc.hp += heal;
      enc.healed += heal;
      res.heal = heal;
    }
    if (it.leech) {
      res.leech = Math.min(it.leech, p.chips);
      p.chips -= res.leech;
    }
  }
  if (s.config.strikes && p.strikes <= 0) p.defeated = true;
  { const ph = advancePhase(enc); res.phaseFrom = ph.from; res.phaseTo = ph.to; }
  if (enc.hp <= 0) enc.over = 'won';
  else if (p.defeated) enc.over = 'lost';
  else if (enc.kind === 'minion' && enc.misses >= DUEL.minionMisses) enc.over = 'beaten';
  else if (enc.qCount >= DUEL.questionCap) enc.over = enc.kind === 'minion' ? 'beaten' : 'lost';
  if (enc.over === 'lost' && enc.kind !== 'minion') p.defeated = true;
  res.hpAfter = enc.hp;
  res.misses = enc.misses;
  res.over = enc.over;
  return res;
}

function resolveAnswer(s, ctx, p, { correct, timeout, elapsedMs, choice = null }) {
  const q = ctx.byId.get(s.q.questionId);
  const qp = s.q.byPlayer[p.playerId];
  const hazard = HAZARDS[s.round.hazardId];
  const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
  const chipsBefore = p.chips;
  const streakBefore = p.streak;

  const out = computeOutcome({
    correct,
    stake: qp.stake ?? 1,
    chips: p.chips,
    difficulty: q.difficulty,
    elapsedMs,
    timerMs: qp.timerMs,
    streakBefore,
    hazard,
    boss,
    markedSlot: s.round.markedSlot === s.qIndex,
    pushed: p.pushed,
    cards: {
      safetyNet: qp.armed.safetyNet,
      peek: qp.armed.peek,
      ghostNote: qp.used.ghostNote,
      scalpel: qp.used.scalpel,
      stopwatch: qp.used.stopwatch,
      doubleOrNothing: qp.armed.doubleOrNothing,
      rewindRetry: qp.retry && correct,
      skeletonKey: qp.used.skeleton,
    },
  });

  let delta = out.delta;
  if (correct && qp.hexes?.length) {
    // Hexes on your own question are a dare (+20%); hexes from a rival cost you 15% of the win. One bonus, one penalty at most.
    const mine = qp.hexes.some((x) => x.by === p.playerId);
    const theirs = qp.hexes.some((x) => x.by !== p.playerId && x.by !== 'boss');
    let factor = 1;
    if (mine) factor *= CARD_NUMBERS.hexSelfBonus;
    if (theirs) factor *= CARD_NUMBERS.hexVictimFactor;
    delta += Math.round(out.gain * factor) - out.gain;
  }
  let siphoned = 0;
  const siphoner = p.siphonedBy ? playerOf(s, p.siphonedBy) : null;
  if (correct && siphoner) {
    siphoned = Math.floor(out.gain * CARD_NUMBERS.siphonShare);
    delta -= siphoned;
    siphoner.chips += siphoned;
  }
  p.siphonedBy = null;

  p.chips = Math.max(0, p.chips + delta);
  const shielded = Boolean(qp.armed.streakShield);
  p.streak = nextStreak(p.streak, correct, shielded);
  p.longestStreak = Math.max(p.longestStreak, p.streak);
  if (correct && qp.hexes?.some((x) => x.by === p.playerId)) p.stats.dareWins += 1;
  if (correct && s.config.cardsEnabled) {
    const tier = tierForStreak(p.streak);
    if (tier && p.hexHand.length < HEX_NUMBERS.handMax) {
      const id = drawHex(Rng.fromSeed(`${s.sessionId}:${p.playerId}:hex:${(s.earnSeq ?? 0) + 1}`), p.hexDeck, tier, s.mode);
      if (id) { p.hexHand.push(id); s.lastEarn = { seq: (s.earnSeq = (s.earnSeq ?? 0) + 1), playerId: p.playerId, hexId: id, tier, from: 'streak' }; }
    }
  }

  let strikeLost = false;
  if (!correct && boss?.strikeOnWrong) {
    p.strikes = Math.max(0, p.strikes - 1);
    strikeLost = true;
    if (p.strikes <= 0) p.defeated = true;
  }

  let duel = null;
  if (s.enc && !s.enc.over) {
    duel = applyDuel(s, p, qp, q, { correct, elapsedMs, out });
    if (duel.bulbsLost) strikeLost = true;
  }

  p.roundStats.answered += 1;
  p.roundStats[correct ? 'correct' : 'wrong'] += 1;
  p.answeredTotal += 1;
  if (correct) p.correctTotal += 1;

  const usedCards = [...qp.usedCards];
  const result = {
    resultId: `${s.sessionId}:${s.roundIndex}:${s.qIndex}:${p.playerId}`,
    sessionId: s.sessionId,
    playerId: p.playerId,
    questionId: q.family ?? q.id,
    variantId: q.id,
    level: q.level ?? null,
    category: statCategory(q),
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    questionType: q.type,
    correct,
    outcome: correct ? 'correct' : timeout ? 'timeout' : 'wrong',
    choice,
    askedId: q.id,
    askedOrder: [...s.q.order],
    pickedText: choice == null ? null : (q.choices[s.q.order[choice]] ?? null),
    rightText: q.choices[q.answer],
    responseMs: Math.round(elapsedMs),
    timerMs: qp.timerMs,
    timeLeftMs: Math.max(0, qp.timerMs - Math.round(elapsedMs)),
    attempts: qp.retry ? 2 : 1,
    usedCards,
    usedHint: usedCards.some((c) => CARDS[c]?.clue),
    hazardId: s.round.hazardId,
    bossId: s.round.bossId,
    modifierActive: s.round.hazardId !== 'none' || Boolean(s.round.bossId),
    isBoss: s.round.isBoss,
    stake: out.stake,
    stakeChips: out.stakeChips,
    wagerWon: correct,
    delta,
    siphoned,
    chipsBefore,
    chipsAfter: p.chips,
    streakBefore,
    streakAfter: p.streak,
    strikeLost,
    duel,
    enemyId: s.enc?.id ?? null,
    mode: s.mode,
    roundIndex: s.roundIndex,
    slot: s.qIndex,
    timestamp: ctx.now(),
  };
  qp.result = result;
  qp.phase = 'done';
  s.log.push(result);

  // Pass the turn, or reveal once everyone has answered.
  s.turn += 1;
  if (s.turn < s.players.length) {
    // The next player stakes on the question as drawn, then gets the level their own stake asks for (as in solo).
    if (s.q.baseId) { s.q.questionId = s.q.baseId; s.q.order = s.q.baseOrder; }
    s.q.byPlayer[s.players[s.turn].playerId].phase = 'stake';
    s.phase = 'stake';
  } else {
    s.turn = s.players.length - 1;
    s.phase = 'reveal';
  }
}

/* ------------------------------------------------------------------ */
/* Read-only views for the UI                                          */
/* ------------------------------------------------------------------ */

/** Everything the question screen needs for one player. */
export function getQuestionView(s, ctx, playerId) {
  if (!s.q) return null;
  const q = ctx.byId.get(s.q.questionId);
  const qp = s.q.byPlayer[playerId];
  const slot = s.round.slots[s.qIndex];
  const showText = s.phase !== 'stake' || Boolean(qp?.armed.peek) || s.phase === 'reveal';
  return {
    id: q.id,
    type: q.type,
    category: slot.category,
    categoryLabel: slot.category,
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    text: showText ? q.question : null,
    choices: s.q.order.map((orig, display) => ({
      display,
      orig,
      text: q.choices[orig],
      hidden: Boolean(qp?.hidden.includes(display)),
      correct: orig === q.answer,
    })),
    ghostLetter: qp?.ghostLetter ?? null,
    hexes: [...new Set((qp?.hexes ?? []).map((x) => x.fx))],
    timerMs: qp?.timerMs ?? null,
    startedAt: qp?.startedAt ?? null,
    retry: Boolean(qp?.retry),
    explanation: s.phase === 'reveal' ? q.explanation : null,
    audio: s.phase === 'reveal' ? q.audio : null,
    qIndex: s.qIndex,
    markedSlot: s.round.markedSlot === s.qIndex,
    result: qp?.result ?? null,
    intent: s.q.intent ?? null,
  };
}

/** The three stake options with exact win/lose numbers for the player whose turn it is. */
export function getStakeOptions(s, ctx, playerId) {
  const p = playerOf(s, playerId);
  const qp = s.q.byPlayer[playerId];
  const q = ctx.byId.get(s.q.questionId);
  const hazard = HAZARDS[s.round.hazardId];
  const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
  const timerMs = timerFor({ type: q.type, hazard, boss, slowClock: p.slowClock, jammed: p.jammed });
  const mult = s.q.timerMult ?? 1;
  const intentId = s.q.intent ?? 'strike';
  const curse = Boolean(INTENTS[intentId]?.curse);
  const options = (boss?.lockStake ? [boss.lockStake] : p.chips <= 0 ? [1] : RULES.stakes).map((stake) => {
    const v = variantFor(s, ctx, q, stake);
    return {
    ask: v.ask ?? null,
    ...previewStake({
      stake,
      chips: p.chips,
      difficulty: v.difficulty,
      streakBefore: p.streak,
      hazard,
      boss,
      markedSlot: s.round.markedSlot === s.qIndex,
      pushed: p.pushed,
      timerMs: Math.round(timerMs * mult),
      cards: {
        safetyNet: qp.armed.safetyNet,
        peek: qp.armed.peek,
        doubleOrNothing: qp.armed.doubleOrNothing,
      },
    }),
    heatCost: s.config.heat ? heatCostOf(stake) : 0,
    locked: Boolean(s.config.heat && heatCostOf(stake) > (p.heat ?? 0)),
    ...(s.enc ? {
      dmg: duelDamage({ difficulty: v.difficulty, stake, fast: false, streak: p.streak + 1, intentId, curseThrough: curse, dmgBonus: p.edgeNow ?? 0 }),
      dmgFast: duelDamage({ difficulty: v.difficulty, stake, fast: true, streak: p.streak + 1, intentId, curseThrough: curse, dmgBonus: p.edgeNow ?? 0 }),
    } : {}),
    };
  });
  return options;
}

/** Card reward choices offered to a player after a game ends. */
export function cardReward(s, playerId) {
  const p = playerOf(s, playerId);
  if (!p || s.status !== 'completed') return { options: [], pick: 0 };
  let count;
  let guaranteeRare = false;
  if (s.mode === 'versus') {
    count = p.placement === 1 ? 2 : 1;
  } else {
    count = p.result === 'won' ? 3 : Math.min(3, Math.max(1, p.bossesCleared + 1));
    guaranteeRare = p.result === 'won';
  }
  const rng = Rng.fromSeed(`${s.sessionId}:${playerId}:reward`);
  const options = draftCards(rng, p.owned, count, { guaranteeRare });
  return { options, pick: options.length ? 1 : 0 };
}

export function isSessionOver(s) {
  return s.phase === 'finished';
}
