import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, group, wilson, missedQuestions, recentlySeenIds } from '../src/stats/stats.js';
import { buildInsights, buildRecommendations } from '../src/stats/insights.js';

let n = 0;
/** Build a synthetic result row. */
function row(over = {}) {
  n++;
  return {
    resultId: `r${n}`,
    sessionId: 's1',
    playerId: 'a',
    questionId: `q${n}`,
    category: 'history',
    subcategory: 'x',
    difficulty: 2,
    correct: true,
    outcome: 'correct',
    responseMs: 5000,
    timeLeftMs: 15000,
    usedCards: [],
    stakeChips: 0,
    delta: 0,
    isBoss: false,
    mode: 'solo',
    timestamp: 1_000 + n,
    ...over,
  };
}
const many = (count, over) => Array.from({ length: count }, (_, i) => row(typeof over === 'function' ? over(i) : over));
const session = (over = {}) => ({
  sessionId: 's1', mode: 'solo', status: 'completed', startedAt: 1000, endedAt: 2000, seed: 'x',
  players: [{ playerId: 'a', result: 'won', score: 500, roundsCleared: 3, bossesCleared: 1 }], ...over,
});

test('no data: everything is null or zero, never NaN', () => {
  const s = computeStats({ results: [], sessions: [], playerId: 'a' });
  assert.equal(s.totals.answered, 0);
  assert.equal(s.totals.accuracy, null);
  assert.equal(s.games.winRate, null);
  assert.equal(s.ranking.enoughToRank, false);
  assert.equal(s.records.longestStreak, 0);
  assert.equal(JSON.stringify(s).includes('NaN'), false);
  const ins = buildInsights(s);
  assert.match(ins[0].text, /Not enough data yet/);
});

test('basic totals, timeouts count as incorrect and are excluded from timing', () => {
  const results = [
    row({ correct: true, responseMs: 2000 }),
    row({ correct: false, outcome: 'wrong', responseMs: 4000 }),
    row({ correct: false, outcome: 'timeout', responseMs: 20000, timeLeftMs: 0 }),
  ];
  const t = computeStats({ results, sessions: [], playerId: 'a' }).totals;
  assert.equal(t.answered, 3);
  assert.equal(t.correct, 1);
  assert.equal(t.timeouts, 1);
  assert.equal(t.incorrect, 2);
  assert.equal(t.avgMs, 3000);
  assert.ok(Math.abs(t.accuracy - 1 / 3) < 1e-9);
});

test('weighted accuracy rewards hard questions', () => {
  const g = group([row({ difficulty: 1, correct: false, outcome: 'wrong' }), row({ difficulty: 4, correct: true })]);
  assert.equal(g.accuracy, 0.5);
  assert.equal(g.weightedAccuracy, 3 / 4);
});

test('wilson interval is wider for small samples and bounded', () => {
  const [lo5, hi5] = wilson(4, 5);
  const [lo100, hi100] = wilson(80, 100);
  assert.ok(hi5 - lo5 > hi100 - lo100);
  assert.ok(lo5 >= 0 && hi5 <= 1);
  assert.equal(wilson(0, 0), null);
});

test('profile isolation: other players rows never leak in, whatever is passed', () => {
  const mine = many(12, { playerId: 'a' });
  const theirs = many(30, { playerId: 'b', correct: false, outcome: 'wrong' });
  const s = computeStats({ results: [...mine, ...theirs], sessions: [], playerId: 'a' });
  assert.equal(s.totals.answered, 12);
  assert.equal(s.totals.accuracy, 1);
  const sb = computeStats({ results: [...mine, ...theirs], sessions: [], playerId: 'b' });
  assert.equal(sb.totals.answered, 30);
  assert.equal(sb.totals.accuracy, 0);
  assert.equal(computeStats({ results: [...mine, ...theirs], sessions: [], playerId: 'nobody' }).totals.answered, 0);
});

test('games: abandoned and in-progress games never count as wins, losses or scores', () => {
  const sessions = [
    session({ sessionId: 's1' }),
    session({ sessionId: 's2', players: [{ playerId: 'a', result: 'lost', score: 100, roundsCleared: 1 }] }),
    session({ sessionId: 's3', status: 'abandoned', players: [{ playerId: 'a', result: 'abandoned', score: 9999, roundsCleared: 5 }] }),
    session({ sessionId: 's4', status: 'active', players: [{ playerId: 'a', result: null, score: 7777 }] }),
    session({ sessionId: 's5', players: [{ playerId: 'b', result: 'won', score: 1 }] }),
  ];
  const g = computeStats({ results: [], sessions, playerId: 'a' }).games;
  assert.equal(g.total, 4);
  assert.equal(g.completed, 2);
  assert.equal(g.abandoned, 1);
  assert.equal(g.inProgress, 1);
  assert.equal(g.won, 1);
  assert.equal(g.lost, 1);
  assert.equal(g.winRate, 0.5);
  assert.equal(g.bestScore, 500);
  assert.equal(g.avgScore, 300);
});

test('partially played games contribute their answers and no more', () => {
  // an abandoned game with 3 answers: those 3 count, nothing is invented for the rest
  const results = many(3, { sessionId: 's3' });
  const s = computeStats({ results, sessions: [session({ sessionId: 's3', status: 'abandoned', players: [{ playerId: 'a', result: 'abandoned', score: 0 }] })], playerId: 'a' });
  assert.equal(s.totals.answered, 3);
  assert.equal(s.history[0].questions, 3);
});

test('streak is computed in time order, not array order', () => {
  const rs = [
    row({ timestamp: 5, correct: true }), row({ timestamp: 1, correct: true }),
    row({ timestamp: 3, correct: false, outcome: 'wrong' }), row({ timestamp: 2, correct: true }),
    row({ timestamp: 4, correct: true }),
  ];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  assert.equal(s.streak.longest, 2);
  assert.equal(s.streak.current, 2);
});

test('small samples: no ranking, categories listed as early signals only', () => {
  const rs = [...many(4, { category: 'history' }), ...many(3, { category: 'science', correct: false, outcome: 'wrong' })];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  assert.equal(s.ranking.enoughToRank, false);
  assert.deepEqual(s.ranking.strongest, []);
  assert.equal(s.ranking.earlySignals.length, 2);
  const ins = buildInsights(s);
  assert.ok(ins.some((i) => i.id === 'not-enough'));
  assert.ok(!ins.some((i) => i.kind === 'strength' || i.kind === 'weakness'));
});

test('ranking: strongest and weakest with sample sizes, provisional below the confident sample', () => {
  const rs = [
    ...many(12, { category: 'history' }),
    ...many(12, (i) => ({ category: 'science', correct: i < 3, outcome: i < 3 ? 'correct' : 'wrong' })),
    ...many(12, (i) => ({ category: 'geography', correct: i < 8, outcome: i < 8 ? 'correct' : 'wrong' })),
  ];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  assert.equal(s.ranking.enoughToRank, true);
  assert.equal(s.ranking.strongest[0].key, 'history');
  assert.equal(s.ranking.weakest[0].key, 'science');
  assert.equal(s.ranking.ranked[0].provisional, true); // 12 < 25
  const ins = buildInsights(s);
  const weak = ins.find((i) => i.id === 'weakest');
  assert.equal(weak.n, 12);
  assert.equal(weak.provisional, true);
  assert.match(weak.text, /25%/);
  assert.match(weak.text, /12 questions/);
});

test('ranking ties are broken deterministically and identical categories are "evenly matched"', () => {
  const rs = [...many(10, { category: 'history' }), ...many(10, { category: 'science' })];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  assert.equal(s.ranking.evenlyMatched, true);
  const again = computeStats({ results: [...rs].reverse(), sessions: [], playerId: 'a' });
  assert.deepEqual(s.ranking.ranked.map((c) => c.key), again.ranking.ranked.map((c) => c.key));
  const ins = buildInsights(s);
  assert.ok(ins.some((i) => i.id === 'even'));
  assert.ok(!ins.some((i) => i.id === 'weakest'));
});

test('confident sample removes the provisional flag', () => {
  const rs = [...many(30, { category: 'history' }), ...many(30, (i) => ({ category: 'science', correct: i < 10, outcome: i < 10 ? 'correct' : 'wrong' }))];
  const ins = buildInsights(computeStats({ results: rs, sessions: [], playerId: 'a' }));
  assert.equal(ins.find((i) => i.id === 'weakest').provisional, false);
});

test('thresholds are configurable', () => {
  const rs = [...many(4, { category: 'history' }), ...many(4, { category: 'science', correct: false, outcome: 'wrong' })];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a', opts: { minSample: 3 } });
  assert.equal(s.ranking.enoughToRank, true);
});

test('trend: improvement over recent window is reported with both sample sizes', () => {
  const rs = [
    ...many(20, (i) => ({ category: 'history', correct: i < 8, outcome: i < 8 ? 'correct' : 'wrong' })), // 40%
    ...many(10, { category: 'history' }), // 100%
  ];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  const h = s.byCategory.find((c) => c.key === 'history');
  assert.equal(h.trend.recent, 10);
  assert.equal(h.trend.baseline, 20);
  assert.ok(h.trend.delta > 50);
  const ins = buildInsights(s).find((i) => i.id === 'trend:history');
  assert.equal(ins.kind, 'improvement');
  assert.match(ins.text, /last 10 questions/);
});

test('no trend without enough history', () => {
  const s = computeStats({ results: many(12, { category: 'history' }), sessions: [], playerId: 'a' });
  assert.equal(s.byCategory.find((c) => c.key === 'history').trend, null);
});

test('difficulty insight only when both levels have enough data and the gap is real', () => {
  const rs = [
    ...many(12, { difficulty: 1 }),
    ...many(12, (i) => ({ difficulty: 4, correct: i < 3, outcome: i < 3 ? 'correct' : 'wrong' })),
  ];
  const ins = buildInsights(computeStats({ results: rs, sessions: [], playerId: 'a' }));
  assert.ok(ins.some((i) => i.id === 'difficulty'));
  const few = buildInsights(computeStats({ results: [...many(12, { difficulty: 1 }), ...many(4, { difficulty: 4, correct: false, outcome: 'wrong' })], sessions: [], playerId: 'a' }));
  assert.ok(!few.some((i) => i.id === 'difficulty'));
});

test('time pressure is described as a pattern, not a cause', () => {
  const rs = [
    ...many(12, { timeLeftMs: 15000 }),
    ...many(12, (i) => ({ timeLeftMs: 2000, correct: i < 3, outcome: i < 3 ? 'correct' : 'wrong' })),
  ];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  assert.equal(s.pressure.pressured.answered, 12);
  const p = buildInsights(s).find((i) => i.id === 'pressure');
  assert.ok(p);
  assert.match(p.text, /not proof/);
});

test('speed vs accuracy needs enough answers on both sides of the median', () => {
  const rs = many(24, (i) => ({ category: 'history', responseMs: 1000 + i * 100, correct: i >= 12, outcome: i >= 12 ? 'correct' : 'wrong' }));
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  const h = s.byCategory.find((c) => c.key === 'history');
  assert.ok(h.speed);
  assert.ok(h.speed.slow.accuracy > h.speed.fast.accuracy);
  assert.ok(buildInsights(s).some((i) => i.id === 'speed:history'));
  const small = computeStats({ results: many(8, { category: 'history' }), sessions: [], playerId: 'a' });
  assert.equal(small.byCategory.find((c) => c.key === 'history').speed, null);
});

test('filters: category, mode, difficulty and date range', () => {
  const rs = [
    row({ category: 'history', mode: 'solo', difficulty: 1, timestamp: 100 }),
    row({ category: 'science', mode: 'versus', difficulty: 3, timestamp: 200 }),
    row({ category: 'science', mode: 'solo', difficulty: 3, timestamp: 300 }),
  ];
  const a = (filters) => computeStats({ results: rs, sessions: [], playerId: 'a', filters }).totals.answered;
  assert.equal(a({}), 3);
  assert.equal(a({ category: 'science' }), 2);
  assert.equal(a({ mode: 'solo' }), 2);
  assert.equal(a({ difficulty: 3 }), 2);
  assert.equal(a({ sinceTs: 250 }), 1);
  assert.equal(computeStats({ results: rs, sessions: [], playerId: 'a', filters: { category: 'science' } }).gameLevelAvailable, false);
});

test('wagers and net chips', () => {
  const rs = [row({ stakeChips: 10, delta: 15 }), row({ stakeChips: 20, correct: false, outcome: 'wrong', delta: -20 }), row({ stakeChips: 0, delta: 0 })];
  const w = computeStats({ results: rs, sessions: [], playerId: 'a' }).wagers;
  assert.deepEqual([w.total, w.won, w.lost, w.netChips], [2, 1, 1, -5]);
});

test('cards: with/without comparison and per-card groups', () => {
  const rs = [row({ usedCards: ['scalpel'] }), row({ usedCards: ['scalpel', 'stopwatch'], correct: false, outcome: 'wrong' }), row()];
  const it = computeStats({ results: rs, sessions: [], playerId: 'a' }).items;
  assert.equal(it.withItems.answered, 2);
  assert.equal(it.withoutItems.answered, 1);
  assert.equal(it.byCard.scalpel.answered, 2);
  assert.equal(it.byCard.stopwatch.answered, 1);
});

test('records and history ordering', () => {
  const rs = [
    ...many(12, { sessionId: 's1', timestamp: 1100 }),
    ...many(12, (i) => ({ sessionId: 's2', timestamp: 2100 + i, correct: i < 6, outcome: i < 6 ? 'correct' : 'wrong' })),
  ];
  const sessions = [session({ sessionId: 's1', startedAt: 1000 }), session({ sessionId: 's2', startedAt: 2000, players: [{ playerId: 'a', result: 'lost', score: 900, roundsCleared: 2 }] })];
  const s = computeStats({ results: rs, sessions, playerId: 'a' });
  assert.deepEqual(s.history.map((h) => h.sessionId), ['s2', 's1']); // newest first
  assert.equal(s.records.highestScore, 900);
  assert.equal(s.records.bestRunAccuracy.sessionId, 's1');
  assert.equal(s.series.accuracyBySession[0].sessionId, 's1'); // charts oldest first
});

test('rolling accuracy series is capped', () => {
  const s = computeStats({ results: many(1000, { category: 'history' }), sessions: [], playerId: 'a' });
  assert.ok(s.series.rolling.length <= 125);
  assert.equal(s.series.rolling.at(-1).index, 1000);
});

test('recommendations only reference real numbers and wait for data', () => {
  const none = buildRecommendations(computeStats({ results: many(3), sessions: [], playerId: 'a' }));
  assert.equal(none[0].id, 'more-data');
  const rs = [
    ...many(30, { category: 'history' }),
    ...many(30, (i) => ({ category: 'science', correct: i < 9, outcome: i < 9 ? 'correct' : 'wrong' })),
  ];
  const s = computeStats({ results: rs, sessions: [], playerId: 'a' });
  const rec = buildRecommendations(s, { missed: missedQuestions(rs, 'a') });
  assert.ok(rec.some((r) => r.id === 'focus:science'));
  assert.ok(rec.some((r) => r.id === 'review'));
  const focus = rec.find((r) => r.id === 'focus:science');
  assert.equal(focus.evidence.n, 30);
});

test('missedQuestions is newest first, de-duplicated and per player', () => {
  const rs = [
    row({ questionId: 'x', correct: false, outcome: 'wrong', timestamp: 1 }),
    row({ questionId: 'y', correct: false, outcome: 'timeout', timestamp: 2 }),
    row({ questionId: 'x', correct: false, outcome: 'wrong', timestamp: 3 }),
    row({ questionId: 'z', correct: true, timestamp: 4 }),
    row({ questionId: 'w', playerId: 'b', correct: false, outcome: 'wrong', timestamp: 5 }),
  ];
  assert.deepEqual(missedQuestions(rs, 'a').map((m) => m.questionId), ['x', 'y']);
});

test('recentlySeenIds: right answers rest for 48 hours, wrong ones may come back, other players and old answers do not count', () => {
  const H = 3_600_000; const now = 100 * 24 * H;
  const rs = [
    row({ questionId: 'a1', timestamp: now - 3 * H, correct: true }),                      // right 3 hours ago: rests
    row({ questionId: 'a2', timestamp: now - 3 * H, correct: false }),                     // wrong: free for reinforcement
    row({ questionId: 'a3', timestamp: now - 49 * H, correct: true }),                     // right 49 hours ago: free again
    row({ questionId: 'a4', timestamp: now - 80 * H, correct: true }), row({ questionId: 'a4', timestamp: now - 2 * H, correct: false }), // wrong most recently
    row({ questionId: 'a5~2', timestamp: now - H, correct: true }),                        // a variant is the same question
    row({ questionId: 'b1', playerId: 'b', timestamp: now - H, correct: true }),
    row({ questionId: 'c1', playerId: 'c', timestamp: now - H, correct: true }),
  ];
  assert.deepEqual(recentlySeenIds(rs, ['a'], { now }).sort(), ['a1', 'a5']);
  assert.deepEqual(recentlySeenIds(rs, ['a', 'b'], { now }).sort(), ['a1', 'a5', 'b1'], 'a group avoids what any member just got right');
  assert.deepEqual(recentlySeenIds(rs, ['a'], { now: now + 60 * H }), [], 'everything is free again after 48 hours');
  const learn = { items: { 'sci-1': { state: 'review', last: now - H, recent: [0, 1] }, 'sci-2': { state: 'relearning', last: now - H, recent: [1] }, 'sci-3': { state: 'review', last: now - H, recent: [1, 0] } } };
  assert.deepEqual(recentlySeenIds([], ['a'], { now, learns: [learn] }), ['sci-1'], 'the learning record counts too, but not a missed or relearning concept');
});
