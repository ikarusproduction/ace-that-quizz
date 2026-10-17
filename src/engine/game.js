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

export const STATE_VERSION = 1;

/** Everything the reducer needs besides state: the bank and a clock. */
export function makeContext(questions, now = () => Date.now()) {
  return { questions, byId: new Map(questions.map((q) => [q.id, q])), now };
}

export function buildConfig(mode, overrides = {}) {
  if (mode === 'versus') {
    return { acts: 1, roundsPerAct: 0, noBoss: true, rounds: overrides.rounds ?? RULES.versusRounds, cardsEnabled: true, shop: false, crossroads: false, strikes: false, ...(overrides.themes ? { themes: overrides.themes } : {}) };
  }
  if (mode === 'daily') {
    return { acts: 1, roundsPerAct: RULES.roundsPerAct, noBoss: false, cardsEnabled: false, shop: false, crossroads: true, strikes: true };
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
  const s = {
    version: STATE_VERSION,
    sessionId: sessionId ?? `s_${ctx.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
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
        strikes: config.strikes ? RULES.startStrikes : 0,
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
        puzzle: { n: 0, round: -1, roundBonus: 0, gameBonus: 0 },
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
  prepareRound(s, ctx);
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

function startRound(s, ctx) {
  const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
  for (const p of s.players) {
    p.charges = {};
    for (const cardId of p.loadout) {
      if (!cardId || CARDS[cardId].timing === 'run') continue;
      p.charges[cardId] = CARDS[cardId].uses + (p.bonusCharges ? 1 : 0) + (p.comeback ? 1 : 0);
    }
  }
  s.cardsLockedThisRound = Boolean(boss?.cardsLocked) || !s.config.cardsEnabled;
  openQuestion(s, ctx);
}

function openQuestion(s, ctx) {
  const slot = s.round.slots[s.qIndex];
  const q = ctx.byId.get(slot.questionId);
  const order = q.type === 'tf'
    ? q.choices.map((_, i) => i)
    : withRng(s, (rng) => rng.shuffle(q.choices.map((_, i) => i)));
  s.q = { questionId: q.id, order, byPlayer: {} };
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
        if (boss) return { ok: false, reason: 'the Skeleton Key does nothing against bosses' };
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
      case 'ink_blast':
      case 'goo_splat':
      case 'quake':
      case 'blur_out':
      case 'flip_table':
      case 'pickpocket':
      case 'heist':
      case 'kraken': {
        const targetId = a.targetId ?? p.playerId;
        const target = playerOf(s, targetId);
        if (!target) return { ok: false, reason: 'choose a target' };
        const self = target.playerId === p.playerId;
        if (self && card.targets === 'rival') return { ok: false, reason: `${card.name} needs a rival` };
        if (!self && s.mode !== 'versus') return { ok: false, reason: 'rivals only exist in Versus' };
        const effects = card.hex ? card.hex.split('+') : [];
        let stolen = 0;
        if (card.steal) {
          const want = card.steal === 'pickpocket' ? CARD_NUMBERS.pickpocketChips
            : card.steal === 'kraken' ? CARD_NUMBERS.krakenChips
              : Math.max(CARD_NUMBERS.heistMin, Math.min(CARD_NUMBERS.heistMax, Math.round(target.chips * CARD_NUMBERS.heistShare)));
          stolen = Math.min(want, target.chips);
          target.chips -= stolen;
          p.chips += stolen;
          if (card.steal === 'heist') p.chips = Math.max(0, p.chips - CARD_NUMBERS.heistCost);
        }
        if (effects.length) {
          if (self) {
            for (const e of effects) qp.hexes.push({ fx: e, by: p.playerId });
          } else {
            for (const e of effects) target.pendingHexes.push({ fx: e, by: p.playerId });
            target.pendingHexes = target.pendingHexes.slice(-CARD_NUMBERS.maxPendingHexes);
          }
        }
        s.hexSeq = (s.hexSeq ?? 0) + 1;
        s.lastHex = { seq: s.hexSeq, cardId: card.id, by: p.playerId, target: target.playerId, self, effects, stolen };
        break;
      }
      default:
        return { ok: false, reason: 'card has no effect' };
    }
    if (isRun) p.runCharges[card.id] -= 1;
    else p.charges[card.id] -= 1;
    qp.usedCards.push(card.id);
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
    const room = Math.max(0, Math.min(PUZZLE_RULES.roundCap - pz.roundBonus, PUZZLE_RULES.gameCap - pz.gameBonus));
    const gain = ok ? Math.min(PUZZLE_RULES.reward[level], room) : 0;
    p.chips += gain; pz.roundBonus += gain; pz.gameBonus += gain;
    pz.last = { n: pz.n, ok, gain }; // per player, so two players answering at once never read each other's result
    s.puzzleSeq = (s.puzzleSeq ?? 0) + 1;
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
    qp.stake = stake;
    qp.timerMs = timerFor({ type: q.type, hazard, boss, slowClock: p.slowClock, jammed: p.jammed });
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
    const item = SHOP_ITEMS[a.item];
    if (!p || !item) return { ok: false, reason: 'unknown item' };
    if (p.chips < item.cost) return { ok: false, reason: 'not enough chips' };
    const act = s.round.act;
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
    }
    p.chips -= item.cost;
  },

  LEAVE_SHOP(s, a, ctx) {
    if (s.phase !== 'shop') return { ok: false, reason: 'the shop is closed' };
    prepareRound(s, ctx);
  },

  ABANDON(s, a, ctx) {
    if (s.status !== 'active') return { ok: false, reason: 'game already ended' };
    finish(s, ctx, { abandoned: true });
  },
};

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
    const theirs = qp.hexes.some((x) => x.by !== p.playerId);
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

  let strikeLost = false;
  if (!correct && boss?.strikeOnWrong) {
    p.strikes = Math.max(0, p.strikes - 1);
    strikeLost = true;
    if (p.strikes <= 0) p.defeated = true;
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
    questionId: q.id,
    category: statCategory(q),
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    questionType: q.type,
    correct,
    outcome: correct ? 'correct' : timeout ? 'timeout' : 'wrong',
    choice,
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
  const options = (boss?.lockStake ? [boss.lockStake] : p.chips <= 0 ? [1] : RULES.stakes).map((stake) =>
    previewStake({
      stake,
      chips: p.chips,
      difficulty: q.difficulty,
      streakBefore: p.streak,
      hazard,
      boss,
      markedSlot: s.round.markedSlot === s.qIndex,
      pushed: p.pushed,
      timerMs,
      cards: {
        safetyNet: qp.armed.safetyNet,
        peek: qp.armed.peek,
        doubleOrNothing: qp.armed.doubleOrNothing,
      },
    }),
  );
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
