// Player statistics, derived entirely from the raw answer log.
//
// How every metric is defined (also shown to players on the stats screen):
//
//  answered      Questions the player was shown and resolved. A timeout counts as
//                answered and incorrect. Questions never reached (an abandoned or
//                interrupted game) have no record, so they are never counted.
//  correct       Answered correctly. incorrect = answered - correct.
//  accuracy      correct / answered, or null when nothing was answered.
//  weighted      Accuracy where harder questions count more (weights 1, 1.5, 2, 3
//                for Easy, Medium, Hard, Expert), so a player who faces harder
//                questions is not penalised for it.
//  avg time      Mean response time over answers that were not timeouts.
//  streak        Consecutive correct answers in time order across all games. (The
//                in-game streak can survive a miss with a Streak Shield; this
//                one cannot.)
//  wager         Any answer where chips were staked. Won when correct.
//  completed     A game that ran to its natural end. Abandoned games are counted
//                separately and never contribute a score or a win/loss.
//
// Because only answers are stored, every number here is recomputed from them,
// so no counter can drift out of agreement with another.
import { STAT_CATEGORIES, CATEGORIES } from '../engine/bank.js';

export const DIFFICULTY_WEIGHT = { 1: 1, 2: 1.5, 3: 2, 4: 3 };
export const DEFAULT_OPTS = {
  minSample: 10, // answers needed before a category/bucket is ranked or compared
  confidentSample: 25, // below this a qualifying observation is labelled provisional
  recentWindow: 20, // "recent form" window, in answers
  trendWindow: 10, // per-category trend window, in answers
  pressureMs: 5000, // "under time pressure" = less than this left on the clock
};

/** Wilson 95% interval for a proportion. Shown so small samples look as uncertain as they are. */
export function wilson(correct, n, z = 1.96) {
  if (!n) return null;
  const p = correct / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

/** Summary of any list of results. Pure and reusable for every breakdown. */
export function group(results) {
  const answered = results.length;
  const correct = results.filter((r) => r.correct).length;
  const timeouts = results.filter((r) => r.outcome === 'timeout').length;
  const timed = results.filter((r) => r.outcome !== 'timeout');
  const correctTimed = timed.filter((r) => r.correct);
  const wDen = results.reduce((s, r) => s + (DIFFICULTY_WEIGHT[r.difficulty] ?? 1), 0);
  const wNum = results.reduce((s, r) => s + (r.correct ? DIFFICULTY_WEIGHT[r.difficulty] ?? 1 : 0), 0);
  const mean = (list) => (list.length ? list.reduce((s, r) => s + r.responseMs, 0) / list.length : null);
  return {
    answered,
    correct,
    incorrect: answered - correct,
    timeouts,
    accuracy: answered ? correct / answered : null,
    weightedAccuracy: wDen ? wNum / wDen : null,
    avgMs: mean(timed),
    avgCorrectMs: mean(correctTimed),
    ci: wilson(correct, answered),
  };
}

const byTime = (a, b) => a.timestamp - b.timestamp || (a.resultId < b.resultId ? -1 : 1);

export function applyFilters(results, filters = {}) {
  return results.filter(
    (r) =>
      (filters.sinceTs == null || r.timestamp >= filters.sinceTs) &&
      (!filters.category || r.category === filters.category) &&
      (!filters.mode || r.mode === filters.mode) &&
      (!filters.difficulty || r.difficulty === filters.difficulty),
  );
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function streaks(sorted) {
  let current = 0;
  let longest = 0;
  for (const r of sorted) {
    current = r.correct ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return { current, longest };
}

/** Accuracy change in percentage points between the last `window` answers and everything before. */
function trendOf(sorted, window, minBaseline) {
  if (sorted.length < window + minBaseline) return null;
  const recent = group(sorted.slice(-window));
  const baseline = group(sorted.slice(0, -window));
  return {
    delta: (recent.accuracy - baseline.accuracy) * 100,
    recent: recent.answered,
    baseline: baseline.answered,
    recentAccuracy: recent.accuracy,
    baselineAccuracy: baseline.accuracy,
  };
}

function sample(arr, max) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/**
 * Compute every statistic for one player.
 * @param {Object} o
 * @param {Array} o.results   result rows (rows for other players are ignored)
 * @param {Array} o.sessions  session rows
 * @param {string} o.playerId
 * @param {Object} [o.opts]   sample-size thresholds, see DEFAULT_OPTS
 * @param {Object} [o.filters] { sinceTs, category, mode, difficulty }
 */
export function computeStats({ results, sessions, playerId, opts = {}, filters = {} }) {
  const o = { ...DEFAULT_OPTS, ...opts };

  // Profile isolation: only this player's rows, whatever the caller passed in.
  const all = results.filter((r) => r.playerId === playerId).sort(byTime);
  const rs = applyFilters(all, filters);
  const mySessions = sessions.filter((s) => s.players.some((p) => p.playerId === playerId));
  const gameLevelAvailable = !filters.category && !filters.difficulty;
  const sessionInScope = (s) => (filters.sinceTs == null || s.startedAt >= filters.sinceTs) && (!filters.mode || s.mode === filters.mode);
  const scoped = mySessions.filter(sessionInScope);

  const totals = group(rs);

  /* ---- games ---- */
  const summaryOf = (s) => s.players.find((p) => p.playerId === playerId);
  const completed = scoped.filter((s) => s.status === 'completed');
  const abandoned = scoped.filter((s) => s.status === 'abandoned');
  const active = scoped.filter((s) => s.status === 'active');
  const won = completed.filter((s) => summaryOf(s).result === 'won');
  const scores = completed.map((s) => summaryOf(s).score).filter((x) => Number.isFinite(x));
  const runSessions = [...completed, ...abandoned].filter((s) => s.mode !== 'versus');
  const sessionAcc = (s) => {
    const g = group(all.filter((r) => r.sessionId === s.sessionId));
    return { answered: g.answered, accuracy: g.accuracy };
  };
  const bestRun = completed
    .map((s) => ({ s, ...sessionAcc(s) }))
    .filter((x) => x.answered >= o.minSample)
    .sort((a, b) => b.accuracy - a.accuracy || b.answered - a.answered)[0];
  const modes = {};
  for (const s of scoped) {
    const m = (modes[s.mode] ??= { total: 0, completed: 0, abandoned: 0, won: 0, lost: 0 });
    m.total++;
    if (s.status === 'completed') {
      m.completed++;
      if (summaryOf(s).result === 'won') m.won++;
      else m.lost++;
    } else if (s.status === 'abandoned') m.abandoned++;
  }
  const games = {
    total: scoped.length,
    completed: completed.length,
    abandoned: abandoned.length,
    inProgress: active.length,
    won: won.length,
    lost: completed.length - won.length,
    winRate: completed.length ? won.length / completed.length : null,
    avgScore: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null,
    bestScore: scores.length ? Math.max(...scores) : null,
    highestRun: runSessions.length ? Math.max(...runSessions.map((s) => summaryOf(s).roundsCleared ?? 0)) : null,
    byMode: modes,
  };

  /* ---- streaks, wagers, items, bosses, pressure ---- */
  const streak = streaks(rs);
  const wagerRows = rs.filter((r) => r.stakeChips > 0);
  const wagers = {
    total: wagerRows.length,
    won: wagerRows.filter((r) => r.correct).length,
    lost: wagerRows.filter((r) => !r.correct).length,
    netChips: rs.reduce((s, r) => s + (r.delta ?? 0), 0),
  };
  const items = {
    withItems: group(rs.filter((r) => r.usedCards?.length)),
    withoutItems: group(rs.filter((r) => !r.usedCards?.length)),
    byCard: {},
  };
  for (const r of rs) for (const c of r.usedCards ?? []) (items.byCard[c] ??= []).push(r);
  items.byCard = Object.fromEntries(Object.entries(items.byCard).map(([c, list]) => [c, group(list)]));
  const boss = { boss: group(rs.filter((r) => r.isBoss)), normal: group(rs.filter((r) => !r.isBoss)) };

  const timed = rs.filter((r) => r.outcome !== 'timeout');
  const pressure = {
    thresholdMs: o.pressureMs,
    pressured: group(timed.filter((r) => r.timeLeftMs < o.pressureMs)),
    comfortable: group(timed.filter((r) => r.timeLeftMs >= o.pressureMs)),
    timeouts: totals.timeouts,
  };

  /* ---- recent form ---- */
  const recent = {
    window: o.recentWindow,
    last: group(rs.slice(-o.recentWindow)),
    baseline: group(rs.slice(0, -o.recentWindow)),
    trend: trendOf(rs, o.recentWindow, o.recentWindow),
  };

  /* ---- breakdowns ---- */
  const byDifficulty = {};
  for (const d of [1, 2, 3, 4]) byDifficulty[d] = group(rs.filter((r) => r.difficulty === d));

  const bySubcategory = {};
  for (const r of rs) (bySubcategory[`${r.category}/${r.subcategory}`] ??= []).push(r);
  for (const k of Object.keys(bySubcategory)) bySubcategory[k] = group(bySubcategory[k]);

  const byCategory = STAT_CATEGORIES.map((key) => {
    const list = rs.filter((r) => r.category === key);
    const g = group(list);
    const timedList = list.filter((r) => r.outcome !== 'timeout');
    let speed = null;
    if (timedList.length >= 2 * o.minSample) {
      const med = median(timedList.map((r) => r.responseMs));
      const fast = group(timedList.filter((r) => r.responseMs <= med));
      const slow = group(timedList.filter((r) => r.responseMs > med));
      if (fast.answered >= o.minSample && slow.answered >= o.minSample) speed = { medianMs: med, fast, slow };
    }
    return {
      key,
      label: CATEGORIES[key].label,
      short: CATEGORIES[key].short,
      ...g,
      qualified: g.answered >= o.minSample,
      provisional: g.answered > 0 && g.answered < o.confidentSample,
      trend: trendOf(list, o.trendWindow, o.minSample),
      speed,
    };
  });

  /* ---- strongest / weakest ---- */
  const ranked = byCategory
    .filter((c) => c.qualified)
    .sort((a, b) => b.accuracy - a.accuracy || b.answered - a.answered || a.label.localeCompare(b.label));
  const take = Math.min(3, Math.floor(ranked.length / 2));
  const spread = ranked.length >= 2 ? (ranked[0].accuracy - ranked[ranked.length - 1].accuracy) * 100 : null;
  const ranking = {
    ranked,
    strongest: ranked.slice(0, take),
    weakest: take ? ranked.slice(-take).reverse() : [],
    earlySignals: byCategory.filter((c) => c.answered > 0 && !c.qualified),
    spreadPoints: spread,
    evenlyMatched: spread !== null && spread < 5,
    enoughToRank: ranked.length >= 2,
  };

  /* ---- history ---- */
  const history = scoped
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => {
      const mine = all.filter((r) => r.sessionId === s.sessionId);
      const me = summaryOf(s);
      const g = group(mine);
      return {
        sessionId: s.sessionId,
        mode: s.mode,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        seed: s.seed,
        result: me.result,
        score: me.score,
        placement: me.placement,
        players: s.players.length,
        roundsCleared: me.roundsCleared,
        bossesCleared: me.bossesCleared,
        questions: g.answered,
        correct: g.correct,
        accuracy: g.accuracy,
        avgMs: g.avgMs,
        categories: STAT_CATEGORIES.map((key) => ({ key, label: CATEGORIES[key].label, ...group(mine.filter((r) => r.category === key)) })).filter((c) => c.answered > 0),
      };
    });

  /* ---- chart series ---- */
  const chronoSessions = history.slice().reverse().filter((h) => h.questions > 0);
  const win = o.recentWindow;
  const rolling = [];
  for (let i = win - 1; i < rs.length; i++) rolling.push({ index: i + 1, accuracy: group(rs.slice(i - win + 1, i + 1)).accuracy });
  const series = {
    accuracyBySession: chronoSessions.map((h) => ({ sessionId: h.sessionId, startedAt: h.startedAt, accuracy: h.accuracy, answered: h.questions, status: h.status })),
    rolling: sample(rolling, 120),
    scoreBySession: chronoSessions.filter((h) => h.status === 'completed' && Number.isFinite(h.score)).map((h) => ({ sessionId: h.sessionId, startedAt: h.startedAt, score: h.score, mode: h.mode })),
    avgTimeBySession: chronoSessions.filter((h) => h.avgMs != null).map((h) => ({ sessionId: h.sessionId, startedAt: h.startedAt, avgMs: h.avgMs })),
  };

  /* ---- records ---- */
  const correctRows = rs.filter((r) => r.correct);
  const hardest = correctRows.slice().sort((a, b) => b.difficulty - a.difficulty || b.timestamp - a.timestamp)[0] ?? null;
  const improved = byCategory.filter((c) => c.trend && c.trend.delta >= 5).sort((a, b) => b.trend.delta - a.trend.delta)[0] ?? null;
  const records = {
    highestScore: games.bestScore,
    longestStreak: streak.longest,
    bestRunAccuracy: bestRun ? { sessionId: bestRun.s.sessionId, accuracy: bestRun.accuracy, answered: bestRun.answered } : null,
    hardestCorrect: hardest ? { questionId: hardest.questionId, difficulty: hardest.difficulty, category: hardest.category, timestamp: hardest.timestamp } : null,
    mostImproved: improved ? { category: improved.key, label: improved.label, delta: improved.trend.delta } : null,
    highestRun: games.highestRun,
  };

  // Favourite category: most played, ties broken by accuracy.
  const favourite = byCategory
    .filter((c) => c.answered > 0)
    .sort((a, b) => b.answered - a.answered || (b.accuracy ?? 0) - (a.accuracy ?? 0))[0] ?? null;

  return {
    playerId,
    opts: o,
    filters,
    gameLevelAvailable,
    totals,
    games,
    streak,
    wagers,
    items,
    boss,
    pressure,
    recent,
    byDifficulty,
    byCategory,
    bySubcategory,
    ranking,
    favourite: favourite ? { key: favourite.key, label: favourite.label, answered: favourite.answered } : null,
    history,
    series,
    records,
  };
}

/** Missed questions for the "review your mistakes" screen, newest first, one per question. */
export function missedQuestions(results, playerId, { limit = 30 } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of results.filter((x) => x.playerId === playerId && !x.correct).sort(byTime).reverse()) {
    if (seen.has(r.questionId)) continue;
    seen.add(r.questionId);
    out.push({ questionId: r.questionId, category: r.category, difficulty: r.difficulty, timestamp: r.timestamp, outcome: r.outcome });
    if (out.length >= limit) break;
  }
  return out;
}

/** Question ids a set of players has seen recently, newest first, used to avoid repeats. */
export function recentlySeenIds(results, playerIds, { limit = 150 } = {}) {
  const ids = new Set(playerIds);
  const seen = [];
  const set = new Set();
  for (const r of results.filter((x) => ids.has(x.playerId)).sort(byTime).reverse()) {
    if (seen.length >= limit) break;
    if (set.has(r.questionId)) continue;
    set.add(r.questionId);
    seen.push(r.questionId);
  }
  return seen;
}
