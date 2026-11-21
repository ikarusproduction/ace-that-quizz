// Tournée Générale: the rules engine. Pure and deterministic: no clock reads, no I/O.
// The server owns one state per room, calls act() for every player action and tick()
// a few times per second, and sends the whole state to every phone after each change.
//
// Phases: lobby → roll → move → intro → play → results → pick ⇄ hit → recap → roll … → end
import { RULES, damageTable, CAPSULE_REWARDS, CONSOLATION, INTENSITIES } from './rules.js';
import { BOARD, CASE_COUNT, START, BAR_START, walk } from './board.js';
import { CHARACTERS } from './characters.js';
import { MINIGAMES } from './minigames.js';
import { rand, randInt } from './rng.js';

const MAX_EVENTS = 40;

export function createGame({ code = 'TEST', seed = 1, now = 0 } = {}) {
  return {
    code,
    v: 1,
    phase: 'lobby',
    phaseStartedAt: now,
    deadline: null,
    settings: { turns: RULES.defaultTurns, intensity: 'normal' },
    hostId: null,
    players: [],
    turn: 0,
    bar: BAR_START,
    rng: { s: seed | 0 },
    rolls: {},
    move: null,
    round: null,
    lastGames: [],
    events: [],
    eventSeq: 0,
  };
}

const freshStats = () => ({ drinks: 0, dealt: 0, wins: 0, kos: 0, knockedOut: 0, crownsBought: 0 });

function resetPlayer(p) {
  p.hp = RULES.maxHp;
  p.capsules = RULES.startCapsules;
  p.crowns = 0;
  p.pos = START;
  p.stats = freshStats();
}

const cleanName = (name) => String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);

function freeCharacter(state, wanted, exceptId) {
  const taken = new Set(state.players.filter((p) => p.id !== exceptId).map((p) => p.character));
  if (wanted && CHARACTERS.some((c) => c.id === wanted) && !taken.has(wanted)) return wanted;
  return CHARACTERS.find((c) => !taken.has(c.id))?.id ?? null;
}

/** Add a player in the lobby. Returns { ok, error }. */
export function addPlayer(state, { id, name, character }, now) {
  if (state.phase !== 'lobby') return { ok: false, error: 'La partie a déjà commencé' };
  if (state.players.length >= RULES.maxPlayers) return { ok: false, error: `${RULES.maxPlayers} joueurs maximum` };
  if (state.players.some((p) => p.id === id)) return { ok: false, error: 'Déjà dans la partie' };
  const n = cleanName(name) || `Joueur ${state.players.length + 1}`;
  const p = { id, name: n, character: freeCharacter(state, character), connected: true, order: state.players.length };
  resetPlayer(p);
  state.players.push(p);
  if (!state.hostId) state.hostId = id;
  bump(state);
  return { ok: true };
}

export function setConnected(state, id, connected, now) {
  const p = player(state, id);
  if (!p || p.connected === connected) return false;
  p.connected = connected;
  if (!connected && state.hostId === id) {
    const next = state.players.find((q) => q.connected);
    if (next) state.hostId = next.id;
  }
  if (connected && !player(state, state.hostId)?.connected) state.hostId = id;
  bump(state);
  return true;
}

const player = (state, id) => state.players.find((p) => p.id === id);
const bump = (state) => { state.v++; };

function event(state, now, data) {
  state.events.push({ id: ++state.eventSeq, at: now, ...data });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function setPhase(state, phase, now, durationMs) {
  state.phase = phase;
  state.phaseStartedAt = now;
  state.deadline = durationMs == null ? null : now + durationMs;
  bump(state);
}

/** Players in the order they move this turn (rotates every turn). */
export function turnOrder(state) {
  const ps = [...state.players].sort((a, b) => a.order - b.order);
  const k = ps.length ? (state.turn - 1 + ps.length) % ps.length : 0;
  return [...ps.slice(k), ...ps.slice(0, k)];
}

/** Apply one player action. Returns { ok, error }. Mutates state. */
export function act(state, id, action, now) {
  const p = player(state, id);
  if (!p) return { ok: false, error: 'Joueur inconnu' };
  const isHost = state.hostId === id;
  const type = action?.type;
  switch (type) {
    case 'settings': {
      if (state.phase !== 'lobby' || !isHost) return no('Seul l\'hôte règle la partie');
      if (RULES.turnOptions.includes(action.turns)) state.settings.turns = action.turns;
      if (INTENSITIES[action.intensity]) state.settings.intensity = action.intensity;
      bump(state);
      return yes();
    }
    case 'profile': {
      if (state.phase !== 'lobby') return no('Trop tard pour changer');
      if (action.name != null) p.name = cleanName(action.name) || p.name;
      if (action.character) {
        const c = freeCharacter(state, action.character, id);
        if (c !== action.character) return no('Personnage déjà pris');
        p.character = c;
      }
      bump(state);
      return yes();
    }
    case 'leave': {
      if (state.phase !== 'lobby') return no('On ne quitte pas une tournée en cours');
      state.players = state.players.filter((q) => q.id !== id);
      state.players.forEach((q, i) => { q.order = i; });
      if (state.hostId === id) state.hostId = state.players[0]?.id ?? null;
      bump(state);
      return yes();
    }
    case 'start': {
      if (state.phase !== 'lobby' || !isHost) return no('Seul l\'hôte lance la partie');
      if (state.players.length < RULES.minPlayers) return no(`Il faut au moins ${RULES.minPlayers} joueurs`);
      for (const q of state.players) resetPlayer(q);
      state.turn = 1;
      state.bar = BAR_START;
      state.lastGames = [];
      state.events = [];
      event(state, now, { type: 'turn', turn: 1 });
      startRoll(state, now);
      return yes();
    }
    case 'roll': {
      if (state.phase !== 'roll') return no('Pas le moment de lancer');
      if (state.rolls[id] != null) return no('Déjà lancé');
      state.rolls[id] = randInt(state.rng, 1, 6);
      bump(state);
      maybeEndRoll(state, now);
      return yes();
    }
    case 'score': {
      if (state.phase !== 'play') return no('Pas de mini-jeu en cours');
      const r = state.round;
      if (!r || action.round !== r.n) return no('Mauvaise manche');
      if (r.scores[id]) return no('Score déjà envoyé');
      const score = Number(action.score);
      if (!Number.isFinite(score)) return no('Score invalide');
      r.scores[id] = { score, display: String(action.display ?? '').slice(0, 40) };
      bump(state);
      if (state.players.every((q) => r.scores[q.id])) startResults(state, now);
      return yes();
    }
    case 'pick': {
      if (state.phase !== 'pick') return no('Pas le moment');
      const r = state.round;
      if (r.pickers[r.pickIndex] !== id) return no('Ce n\'est pas à toi de choisir');
      if (!validTargets(state, id).some((q) => q.id === action.target)) return no('Cible impossible');
      applyPick(state, id, action.target, now);
      return yes();
    }
    case 'restart': {
      if (state.phase !== 'end' || !isHost) return no('Seul l\'hôte relance');
      for (const q of state.players) resetPlayer(q);
      state.round = null;
      state.move = null;
      state.turn = 0;
      setPhase(state, 'lobby', now, null);
      return yes();
    }
    default:
      return no('Action inconnue');
  }
}

const yes = () => ({ ok: true });
const no = (error) => ({ ok: false, error });

// ---------- Roll ----------
function startRoll(state, now) {
  state.rolls = {};
  state.move = null;
  state.round = null;
  setPhase(state, 'roll', now, RULES.rollMs);
}

function maybeEndRoll(state, now, force = false) {
  const missing = state.players.filter((p) => state.rolls[p.id] == null);
  if (missing.length && !force) return;
  for (const p of missing) state.rolls[p.id] = randInt(state.rng, 1, 6);
  startMove(state, now);
}

// ---------- Move ----------
// The whole movement of the turn is computed up front as a timed script. Its effects are
// applied by tick() at the moment each animation reaches them, so the numbers on the
// phones change in step with the pawns.
function startMove(state, now) {
  const sim = new Map(state.players.map((p) => [p.id, { capsules: p.capsules }]));
  let bar = state.bar;
  let t = 600;
  const script = [];
  const effects = [];
  for (const p of turnOrder(state)) {
    const value = state.rolls[p.id];
    const path = walk(p.pos, value);
    const entry = { pid: p.id, from: p.pos, value, path, startAt: t, crowns: [], bars: [] };
    let clock = t;
    path.forEach((c, i) => {
      clock += RULES.stepMs;
      if (c === bar && sim.get(p.id).capsules >= RULES.crownPrice) {
        sim.get(p.id).capsules -= RULES.crownPrice;
        const nextBar = relocateBar(state, c);
        entry.crowns.push({ step: i, at: clock });
        entry.bars.push({ at: clock + RULES.crownMs, bar: nextBar });
        effects.push({ at: clock, kind: 'crown', pid: p.id, bar: nextBar });
        bar = nextBar;
        clock += RULES.crownMs;
      }
    });
    const end = path[path.length - 1];
    const type = BOARD.cases[end].type;
    let land = { type, dCaps: 0, dHp: 0 };
    if (type === 'blue') land.dCaps = RULES.blueGain;
    if (type === 'red') {
      if (rand(state.rng) < 0.5) land = { type, dCaps: 0, dHp: -RULES.redHp };
      else land = { type, dCaps: -Math.min(RULES.redCapsules, sim.get(p.id).capsules), dHp: 0 };
    }
    sim.get(p.id).capsules += land.dCaps;
    entry.land = land;
    entry.landAt = clock;
    effects.push({ at: clock, kind: 'land', pid: p.id, pos: end, ...land });
    clock += RULES.landMs;
    entry.endAt = clock;
    script.push(entry);
    t = clock + RULES.playerGapMs;
  }
  state.move = { script, effects, applied: 0, barAtStart: state.bar };
  setPhase(state, 'move', now, t + 300);
}

function relocateBar(state, current) {
  const options = BOARD.cases.filter((c) => c.id !== START && c.id !== current && Math.abs(c.id - current) > 4).map((c) => c.id);
  return options[randInt(state.rng, 0, options.length - 1)];
}

function applyMoveEffects(state, now) {
  const m = state.move;
  if (!m) return false;
  const elapsed = now - state.phaseStartedAt;
  let changed = false;
  while (m.applied < m.effects.length && m.effects[m.applied].at <= elapsed) {
    const e = m.effects[m.applied++];
    const p = player(state, e.pid);
    changed = true;
    if (!p) continue;
    if (e.kind === 'crown') {
      p.capsules -= RULES.crownPrice;
      p.crowns += 1;
      p.stats.crownsBought += 1;
      state.bar = e.bar;
      event(state, now, { type: 'crown', pid: p.id });
    } else {
      p.pos = e.pos;
      if (e.dCaps) p.capsules = Math.max(0, p.capsules + e.dCaps);
      event(state, now, { type: 'case', pid: p.id, kind: e.type, dCaps: e.dCaps, dHp: e.dHp });
      if (e.dHp) hurt(state, p, -e.dHp, null, now);
    }
  }
  if (changed) bump(state);
  return changed;
}

// ---------- Damage ----------
function hurt(state, target, amount, from, now) {
  const lost = Math.min(amount, target.hp);
  target.hp -= amount;
  target.stats.drinks += lost;
  if (from) from.stats.dealt += amount;
  event(state, now, { type: 'damage', from: from?.id ?? null, to: target.id, amount, drinks: lost });
  if (target.hp <= 0) {
    target.hp = RULES.maxHp;
    const lostCaps = Math.floor(target.capsules / 2);
    target.capsules -= lostCaps;
    target.stats.knockedOut += 1;
    if (from) {
      from.capsules += RULES.koBounty;
      from.stats.kos += 1;
    }
    event(state, now, { type: 'ko', pid: target.id, by: from?.id ?? null, lostCaps, bounty: from ? RULES.koBounty : 0 });
  }
}

// ---------- Mini-game ----------
function startIntro(state, now) {
  const recent = new Set(state.lastGames.slice(-Math.min(2, MINIGAMES.length - 1)));
  const pool = MINIGAMES.filter((g) => !recent.has(g.id));
  const game = pool[randInt(state.rng, 0, pool.length - 1)];
  state.lastGames.push(game.id);
  if (state.lastGames.length > 6) state.lastGames.shift();
  state.move = null;
  state.round = {
    n: state.turn,
    game: game.id,
    seed: randInt(state.rng, 1, 2 ** 30),
    scores: {},
    ranking: null,
    pickers: [],
    pickIndex: 0,
    taken: {},
    lastHit: null,
  };
  setPhase(state, 'intro', now, RULES.introMs);
}

function startPlay(state, now) {
  const game = MINIGAMES.find((g) => g.id === state.round.game);
  setPhase(state, 'play', now, game.durationMs + RULES.playGraceMs);
}

/** Competition ranking (1, 1, 3, …) of the players who sent a score; the others come last with no place. */
export function rankScores(players, scores) {
  const played = players.filter((p) => scores[p.id]).sort((a, b) => scores[b.id].score - scores[a.id].score || a.order - b.order);
  const ranking = [];
  played.forEach((p, i) => {
    const prev = ranking[i - 1];
    const rank = prev && scores[prev.pid].score === scores[p.id].score ? prev.rank : i + 1;
    ranking.push({ pid: p.id, rank, score: scores[p.id].score, display: scores[p.id].display });
  });
  for (const p of players) if (!scores[p.id]) ranking.push({ pid: p.id, rank: null, score: null, display: 'Absent' });
  return ranking;
}

function startResults(state, now) {
  const r = state.round;
  const table = damageTable(state.players.length);
  r.ranking = rankScores(state.players, r.scores).map((row) => ({
    ...row,
    dmg: row.rank ? table[row.rank - 1] ?? 0 : 0,
    caps: row.rank ? CAPSULE_REWARDS[row.rank - 1] ?? CONSOLATION : 0,
  }));
  for (const row of r.ranking) {
    const p = player(state, row.pid);
    p.capsules += row.caps;
    if (row.rank === 1) p.stats.wins += 1;
  }
  // Lowest rewarded place picks first, so the winner has the last word.
  r.pickers = r.ranking
    .filter((row) => row.dmg > 0)
    .sort((a, b) => b.rank - a.rank || player(state, a.pid).order - player(state, b.pid).order)
    .map((row) => row.pid);
  r.pickIndex = 0;
  setPhase(state, 'results', now, RULES.resultsMs);
}

export function validTargets(state, pickerId) {
  const taken = state.round?.taken ?? {};
  return state.players.filter((p) => p.id !== pickerId && (taken[p.id] ?? 0) < RULES.maxDamagePerRound);
}

function nextPicker(state, now) {
  const r = state.round;
  while (r.pickIndex < r.pickers.length && validTargets(state, r.pickers[r.pickIndex]).length === 0) r.pickIndex++;
  if (r.pickIndex >= r.pickers.length) {
    setPhase(state, 'recap', now, RULES.recapMs);
    return;
  }
  setPhase(state, 'pick', now, RULES.pickMs);
}

function applyPick(state, pickerId, targetId, now) {
  const r = state.round;
  const row = r.ranking.find((x) => x.pid === pickerId);
  const target = player(state, targetId);
  const amount = Math.min(row.dmg, RULES.maxDamagePerRound - (r.taken[targetId] ?? 0));
  r.taken[targetId] = (r.taken[targetId] ?? 0) + amount;
  r.lastHit = { from: pickerId, to: targetId, amount };
  hurt(state, target, amount, player(state, pickerId), now);
  r.pickIndex++;
  setPhase(state, 'hit', now, RULES.afterPickMs);
}

function autoPick(state, now) {
  const r = state.round;
  const pid = r.pickers[r.pickIndex];
  const targets = validTargets(state, pid);
  // Left to the machine, the hit goes to whoever leads (most crowns, then capsules).
  targets.sort((a, b) => b.crowns - a.crowns || b.capsules - a.capsules || a.order - b.order);
  applyPick(state, pid, targets[0].id, now);
}

function endTurn(state, now) {
  if (state.turn >= state.settings.turns) {
    state.round = null;
    event(state, now, { type: 'end' });
    setPhase(state, 'end', now, null);
    return;
  }
  state.turn += 1;
  event(state, now, { type: 'turn', turn: state.turn });
  startRoll(state, now);
}

/** Final standings: crowns, then capsules. */
export function standings(state) {
  return [...state.players].sort((a, b) => b.crowns - a.crowns || b.capsules - a.capsules || a.order - b.order);
}

// ---------- Clock ----------
/** Advance timed phases. Returns true when the state changed. */
export function tick(state, now) {
  const v = state.v;
  const late = state.deadline != null && now >= state.deadline;
  const connected = state.players.filter((p) => p.connected);
  switch (state.phase) {
    case 'roll': {
      // Phones that dropped out are rolled for once everyone else has rolled.
      const waitingOnlyOffline = connected.every((p) => state.rolls[p.id] != null);
      if (late || (waitingOnlyOffline && now - state.phaseStartedAt > 3_000)) maybeEndRoll(state, now, true);
      break;
    }
    case 'move':
      applyMoveEffects(state, now);
      if (late) startIntro(state, now);
      break;
    case 'intro':
      if (late) startPlay(state, now);
      break;
    case 'play': {
      const r = state.round;
      const onlyOffline = connected.every((p) => r.scores[p.id]);
      if (late || (onlyOffline && connected.length && now - state.phaseStartedAt > 2_000)) startResults(state, now);
      break;
    }
    case 'results':
      if (late) nextPicker(state, now);
      break;
    case 'pick': {
      const picker = player(state, state.round.pickers[state.round.pickIndex]);
      if (late || (!picker?.connected && now - state.phaseStartedAt > 3_000)) autoPick(state, now);
      break;
    }
    case 'hit':
      if (late) nextPicker(state, now);
      break;
    case 'recap':
      if (late) endTurn(state, now);
      break;
    default:
      break;
  }
  return state.v !== v;
}

export { CASE_COUNT };
