// Shared test helpers: loading the real question bank and a bot that plays games.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadBank } from '../src/engine/bank.js';
import { makeContext, dispatch } from '../src/engine/game.js';
import { Rng } from '../src/engine/rng.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));

let cached;
export async function realBank() {
  cached ??= await loadBank(readJson);
  return cached;
}

/** A context with a clock that advances by `stepMs` each time it is read. */
export function fakeContext(questions, { start = 1_700_000_000_000, stepMs = 1000 } = {}) {
  let t = start;
  const ctx = makeContext(questions, () => (t += stepMs));
  ctx.setTime = (v) => (t = v);
  return ctx;
}

export function must(res) {
  if (!res.ok) throw new Error(`action rejected: ${res.reason}`);
  return res.state;
}

export function correctDisplay(state, ctx) {
  const q = ctx.byId.get(state.q.questionId);
  return state.q.order.indexOf(q.answer);
}

export function wrongDisplay(state, ctx) {
  const c = correctDisplay(state, ctx);
  const hidden = state.q.byPlayer[state.players[state.turn].playerId].hidden;
  return state.q.order.map((_, i) => i).find((i) => i !== c && !hidden.includes(i));
}

/**
 * Advance a game by one "step" using a simple bot. `decide(state, ctx)` returns
 * { answerCorrectly: boolean, stake: 1|2|3 } for the player whose turn it is.
 */
export function stepBot(state, ctx, decide) {
  const p = state.players[state.turn];
  switch (state.phase) {
    case 'loadout':
      return must(dispatch(state, { type: 'START_ROUND' }, ctx));
    case 'stake': {
      const d = decide(state, ctx);
      return must(dispatch(state, { type: 'CONFIRM_STAKE', playerId: p.playerId, stake: d.stake ?? 1 }, ctx));
    }
    case 'question': {
      const d = decide(state, ctx);
      const choice = d.answerCorrectly ? correctDisplay(state, ctx) : wrongDisplay(state, ctx);
      return must(dispatch(state, { type: 'ANSWER', playerId: p.playerId, choice, elapsedMs: d.elapsedMs ?? 3000 }, ctx));
    }
    case 'reveal':
      return must(dispatch(state, { type: 'NEXT' }, ctx));
    case 'round-summary':
      return must(dispatch(state, { type: 'CONTINUE' }, ctx));
    case 'crossroads':
      return must(dispatch(state, { type: 'CROSSROADS', playerId: state.players[0].playerId, choice: 'hold' }, ctx));
    case 'shop':
      return must(dispatch(state, { type: 'LEAVE_SHOP' }, ctx));
    default:
      throw new Error(`unexpected phase ${state.phase}`);
  }
}

export function playToEnd(state, ctx, decide, maxSteps = 5000) {
  let s = state;
  let steps = 0;
  while (s.phase !== 'finished') {
    s = stepBot(s, ctx, decide);
    if (++steps > maxSteps) throw new Error('game did not finish');
  }
  return s;
}

/** Bot that is right with probability `accuracy`, drawn from a seeded RNG. */
export function accuracyBot(accuracy, seed = 'bot', stake = 1) {
  const rng = new Rng(Rng.fromSeed(seed).state);
  return () => ({ answerCorrectly: rng.next() < accuracy, stake });
}

/** Advance until the phase equals `phase` (and optionally the given turn). */
export function advanceTo(state, ctx, phase, decide, maxSteps = 500) {
  let s = state;
  let steps = 0;
  while (s.phase !== phase) {
    s = stepBot(s, ctx, decide);
    if (++steps > maxSteps) throw new Error(`never reached ${phase}`);
  }
  return s;
}
