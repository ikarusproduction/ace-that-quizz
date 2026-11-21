import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, act, tick, rankScores, validTargets, standings, turnOrder } from '../src/shared/game.js';
import { RULES, damageTable } from '../src/shared/rules.js';
import { BOARD, CASE_COUNT, walk } from '../src/shared/board.js';

function lobby(n, seed = 7) {
  const s = createGame({ code: 'ABCD', seed, now: 0 });
  for (let i = 0; i < n; i++) assert.equal(addPlayer(s, { id: `p${i}`, name: `P${i}` }, 0).ok, true);
  return s;
}

/** Run the clock forward in small steps until `until(state)` or the time limit. */
function run(s, from, until, limit = 600_000) {
  let t = from;
  while (t < from + limit) {
    t += 100;
    tick(s, t);
    if (until(s)) return t;
  }
  throw new Error(`stuck in ${s.phase}`);
}

test('board: 32 cases, evenly spaced, start then blue/red', () => {
  assert.equal(BOARD.cases.length, CASE_COUNT);
  assert.equal(BOARD.cases[0].type, 'start');
  for (let i = 0; i < CASE_COUNT; i++) {
    const a = BOARD.cases[i];
    const b = BOARD.cases[(i + 1) % CASE_COUNT];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    assert.ok(d > 90 && d < 110, `gap ${i}: ${d}`);
  }
  assert.deepEqual(walk(30, 4), [31, 0, 1, 2]);
});

test('lobby: host, unique characters, 8 players max, settings by host only', () => {
  const s = lobby(8);
  assert.equal(s.hostId, 'p0');
  assert.equal(new Set(s.players.map((p) => p.character)).size, 8);
  assert.equal(addPlayer(s, { id: 'p9', name: 'x' }, 0).ok, false);
  assert.equal(act(s, 'p1', { type: 'settings', turns: 5 }, 0).ok, false);
  assert.equal(act(s, 'p0', { type: 'settings', turns: 5, intensity: 'soft' }, 0).ok, true);
  assert.equal(s.settings.turns, 5);
  assert.equal(s.settings.intensity, 'soft');
  assert.equal(act(s, 'p1', { type: 'profile', character: s.players[0].character }, 0).ok, false);
});

test('names are cleaned', () => {
  const s = createGame();
  addPlayer(s, { id: 'a', name: '  <b>Très long nom de soirée</b> ' }, 0);
  assert.equal(s.players[0].name, 'bTrès long nom d');
});

test('cannot start alone; host starts', () => {
  const s = lobby(1);
  assert.equal(act(s, 'p0', { type: 'start' }, 0).ok, false);
  addPlayer(s, { id: 'p1' }, 0);
  assert.equal(act(s, 'p1', { type: 'start' }, 0).ok, false);
  assert.equal(act(s, 'p0', { type: 'start' }, 0).ok, true);
  assert.equal(s.phase, 'roll');
  assert.equal(s.turn, 1);
});

test('rolling: all players roll, then movement', () => {
  const s = lobby(3);
  act(s, 'p0', { type: 'start' }, 0);
  for (const p of s.players) assert.equal(act(s, p.id, { type: 'roll' }, 10).ok, true);
  assert.equal(s.phase, 'move');
  assert.equal(act(s, 'p0', { type: 'roll' }, 10).ok, false);
  for (const v of Object.values(s.rolls)) assert.ok(v >= 1 && v <= 6);
  // Effects land only as the animation reaches them.
  const before = s.players.map((p) => p.pos);
  assert.deepEqual(before, [0, 0, 0]);
  const t = run(s, 10, (x) => x.phase === 'intro');
  for (const p of s.players) assert.equal(p.pos, s.rolls[p.id]);
  assert.ok(t > 10);
});

test('the roll deadline rolls for slow players', () => {
  const s = lobby(3);
  act(s, 'p0', { type: 'start' }, 0);
  act(s, 'p0', { type: 'roll' }, 0);
  tick(s, RULES.rollMs + 1);
  assert.equal(s.phase, 'move');
  assert.equal(Object.keys(s.rolls).length, 3);
});

test('disconnected players do not hold up the roll', () => {
  const s = lobby(3);
  act(s, 'p0', { type: 'start' }, 0);
  s.players[2].connected = false;
  act(s, 'p0', { type: 'roll' }, 0);
  act(s, 'p1', { type: 'roll' }, 0);
  tick(s, 3_500);
  assert.equal(s.phase, 'move');
});

test('blue and red cases', () => {
  const s = lobby(2);
  act(s, 'p0', { type: 'start' }, 0);
  s.rolls = {};
  // p0 lands on 2 (blue), p1 on 3 (red)
  s.rng.s = 12345;
  s.players[0].pos = 0;
  s.players[1].pos = 0;
  const realRandInt = null;
  act(s, 'p0', { type: 'roll' }, 0);
  act(s, 'p1', { type: 'roll' }, 0);
  run(s, 0, (x) => x.phase === 'intro');
  for (const p of s.players) {
    const type = BOARD.cases[p.pos].type;
    if (type === 'blue') assert.equal(p.capsules, RULES.startCapsules + RULES.blueGain);
    if (type === 'red') assert.ok(p.capsules === RULES.startCapsules - RULES.redCapsules || p.hp === RULES.maxHp - RULES.redHp);
  }
  assert.equal(realRandInt, null);
});

test('passing the golden bar buys a crown and moves the bar', () => {
  const s = lobby(2);
  act(s, 'p0', { type: 'start' }, 0);
  s.players[0].pos = s.bar - 1;
  s.players[0].capsules = 25;
  s.players[1].capsules = 0;
  const bar = s.bar;
  act(s, 'p0', { type: 'roll' }, 0);
  act(s, 'p1', { type: 'roll' }, 0);
  run(s, 0, (x) => x.phase === 'intro');
  assert.equal(s.players[0].crowns, 1);
  assert.notEqual(s.bar, bar);
  assert.ok(s.events.some((e) => e.type === 'crown' && e.pid === 'p0'));
});

test('no crown without 20 capsules', () => {
  const s = lobby(2);
  act(s, 'p0', { type: 'start' }, 0);
  s.players[0].pos = s.bar - 1;
  s.players[0].capsules = 19;
  act(s, 'p0', { type: 'roll' }, 0);
  act(s, 'p1', { type: 'roll' }, 0);
  run(s, 0, (x) => x.phase === 'intro');
  assert.equal(s.players[0].crowns, 0);
});

test('ranking: ties share a place, absent players come last', () => {
  const players = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }, { id: 'd', order: 3 }];
  const r = rankScores(players, { a: { score: 5 }, b: { score: 9 }, c: { score: 9 } });
  assert.deepEqual(r.map((x) => [x.pid, x.rank]), [['b', 1], ['c', 1], ['a', 3], ['d', null]]);
});

test('damage table by player count', () => {
  assert.deepEqual(damageTable(2), [3]);
  assert.deepEqual(damageTable(3), [3, 1]);
  assert.deepEqual(damageTable(4), [3, 1]);
  assert.deepEqual(damageTable(6), [3, 2, 1]);
});

function toPlay(s, t = 0) {
  if (s.phase === 'lobby') act(s, s.hostId, { type: 'start' }, t);
  for (const p of s.players) act(s, p.id, { type: 'roll' }, t);
  return run(s, t, (x) => x.phase === 'play');
}

test('podium: third picks first, winner last; 3 / 2 / 1 damage; capsules 6 / 4 / 2 / 1', () => {
  const s = lobby(5);
  let t = toPlay(s);
  const caps = s.players.map((p) => p.capsules);
  const scores = [50, 40, 30, 20, 10];
  s.players.forEach((p, i) => act(s, p.id, { type: 'score', round: s.round.n, score: scores[i], display: `${scores[i]}` }, t));
  assert.equal(s.phase, 'results');
  assert.deepEqual(s.players.map((p, i) => p.capsules - caps[i]), [6, 4, 2, 1, 1]);
  assert.deepEqual(s.round.pickers, ['p2', 'p1', 'p0']);
  t = run(s, t, (x) => x.phase === 'pick');
  assert.equal(act(s, 'p0', { type: 'pick', target: 'p4' }, t).ok, false, 'not your turn');
  assert.equal(act(s, 'p2', { type: 'pick', target: 'p2' }, t).ok, false, 'not yourself');
  assert.equal(act(s, 'p2', { type: 'pick', target: 'p4' }, t).ok, true);
  assert.equal(s.players[4].hp, 9);
  t = run(s, t, (x) => x.phase === 'pick');
  act(s, 'p1', { type: 'pick', target: 'p4' }, t);
  assert.equal(s.players[4].hp, 7);
  t = run(s, t, (x) => x.phase === 'pick');
  // p4 has taken 3; the winner can only add 2 more (cap of 5 per mini-game)
  act(s, 'p0', { type: 'pick', target: 'p4' }, t);
  assert.equal(s.players[4].hp, 5);
  assert.equal(s.players[4].stats.drinks, 5);
  assert.equal(s.players[0].stats.dealt, 2);
  t = run(s, t, (x) => x.phase === 'roll');
  assert.equal(s.turn, 2);
});

test('a target at the cap cannot be picked again', () => {
  const s = lobby(5);
  const t = toPlay(s);
  s.round.taken = { p4: 5 };
  assert.ok(!validTargets(s, 'p0').some((p) => p.id === 'p4'));
  assert.equal(validTargets(s, 'p0').length, 3);
  assert.ok(t);
});

test('K.O.: back to full life, half the capsules lost, bounty to the attacker', () => {
  const s = lobby(2);
  let t = toPlay(s);
  s.players[1].hp = 2;
  s.players[1].capsules = 15;
  const attackerCaps = s.players[0].capsules;
  act(s, 'p0', { type: 'score', round: s.round.n, score: 10 }, t);
  act(s, 'p1', { type: 'score', round: s.round.n, score: 1 }, t);
  t = run(s, t, (x) => x.phase === 'pick');
  act(s, 'p0', { type: 'pick', target: 'p1' }, t);
  const p1 = s.players[1];
  assert.equal(p1.hp, RULES.maxHp);
  assert.equal(p1.stats.drinks, 2, 'only the life left is drunk; the K.O. forfeit replaces the rest');
  assert.equal(p1.stats.knockedOut, 1);
  assert.equal(s.players[0].capsules, attackerCaps + 6 + RULES.koBounty);
  assert.equal(s.players[0].stats.kos, 1);
  assert.ok(s.events.some((e) => e.type === 'ko' && e.pid === 'p1'));
  assert.equal(p1.capsules, 19 - Math.floor(19 / 2), "15 + 4 for second place, then half lost");
});

test('the pick deadline hits the leader', () => {
  const s = lobby(3);
  let t = toPlay(s);
  s.players[2].crowns = 2;
  act(s, 'p0', { type: 'score', round: s.round.n, score: 10 }, t);
  act(s, 'p1', { type: 'score', round: s.round.n, score: 5 }, t);
  act(s, 'p2', { type: 'score', round: s.round.n, score: 1 }, t);
  t = run(s, t, (x) => x.phase === 'pick');
  assert.equal(s.round.pickers[0], 'p1');
  t = run(s, t, (x) => x.phase === 'hit');
  assert.equal(s.round.lastHit.to, 'p2');
});

test('absent players get nothing and the mini-game ends on the deadline', () => {
  const s = lobby(3);
  const t = toPlay(s);
  act(s, 'p0', { type: 'score', round: s.round.n, score: 10 }, t);
  run(s, t, (x) => x.phase === 'results');
  assert.equal(s.round.ranking.find((r) => r.pid === 'p2').rank, null);
  assert.equal(act(s, 'p2', { type: 'score', round: s.round.n, score: 99 }, t).ok, false, 'too late');
});

test('wrong round number or bad score is refused', () => {
  const s = lobby(2);
  const t = toPlay(s);
  assert.equal(act(s, 'p0', { type: 'score', round: 999, score: 1 }, t).ok, false);
  assert.equal(act(s, 'p0', { type: 'score', round: s.round.n, score: 'abc' }, t).ok, false);
  assert.equal(act(s, 'p0', { type: 'score', round: s.round.n, score: 3 }, t).ok, true);
  assert.equal(act(s, 'p0', { type: 'score', round: s.round.n, score: 4 }, t).ok, false);
});

test('the same mini-game never comes twice in a row', () => {
  const s = lobby(2, 99);
  act(s, 'p0', { type: 'settings', turns: 20 }, 0);
  let t = 0;
  const seen = [];
  act(s, 'p0', { type: 'start' }, 0);
  while (s.phase !== 'end') {
    t = run(s, t, (x) => x.phase === 'play' || x.phase === 'end');
    if (s.phase === 'end') break;
    seen.push(s.round.game);
    t = run(s, t, (x) => x.phase === 'roll' || x.phase === 'end');
  }
  assert.equal(seen.length, 20);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  assert.ok(new Set(seen).size === 3);
});

test('a full game on autopilot ends after the chosen number of turns', () => {
  const s = lobby(4, 3);
  act(s, 'p0', { type: 'settings', turns: 10 }, 0);
  act(s, 'p0', { type: 'start' }, 0);
  let t = 0;
  let rounds = 0;
  while (s.phase !== 'end') {
    t = run(s, t, (x) => x.phase === 'play' || x.phase === 'end');
    if (s.phase === 'play') {
      rounds++;
      s.players.forEach((p, i) => act(s, p.id, { type: 'score', round: s.round.n, score: (i * 7 + rounds) % 5 }, t));
    }
  }
  assert.equal(rounds, 10);
  assert.equal(s.turn, 10);
  for (const p of s.players) {
    assert.ok(p.hp >= 1 && p.hp <= RULES.maxHp);
    assert.ok(p.capsules >= 0);
  }
  const st = standings(s);
  assert.ok(st[0].crowns >= st[st.length - 1].crowns);
  // restart
  assert.equal(act(s, 'p0', { type: 'restart' }, t).ok, true);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.players.every((p) => p.hp === RULES.maxHp && p.crowns === 0), true);
});

test('turn order rotates', () => {
  const s = lobby(3);
  act(s, 'p0', { type: 'start' }, 0);
  assert.deepEqual(turnOrder(s).map((p) => p.id), ['p0', 'p1', 'p2']);
  s.turn = 2;
  assert.deepEqual(turnOrder(s).map((p) => p.id), ['p1', 'p2', 'p0']);
});

test('host moves to a connected player when the host drops', async () => {
  const { setConnected } = await import('../src/shared/game.js');
  const s = lobby(3);
  setConnected(s, 'p0', false, 0);
  assert.equal(s.hostId, 'p1');
});

test('same seed, same game', () => {
  const play = () => {
    const s = lobby(3, 42);
    act(s, 'p0', { type: 'start' }, 0);
    for (const p of s.players) act(s, p.id, { type: 'roll' }, 0);
    run(s, 0, (x) => x.phase === 'play');
    return JSON.stringify([s.rolls, s.round.game, s.round.seed, s.players.map((p) => [p.pos, p.capsules, p.hp])]);
  };
  assert.equal(play(), play());
});
