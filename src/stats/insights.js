// Plain-language insights and recommendations, generated only from the numbers
// in computeStats(). Nothing here is hard-coded: if the data do not support a
// statement, it is not made. Every statement carries the sample size behind it,
// and observations built on small samples are labelled provisional.
import { DIFFICULTIES } from '../engine/bank.js';

const pct = (x) => Math.round(x * 100);
const secs = (ms) => `${Math.round(ms / 100) / 10}s`;

/**
 * @returns {{id:string, kind:string, text:string, n:number, provisional:boolean}[]}
 */
export function buildInsights(stats) {
  const o = stats.opts;
  const out = [];
  const add = (id, kind, text, n, extra = {}) => out.push({ id, kind, text, n, provisional: n < o.confidentSample, ...extra });

  if (stats.totals.answered === 0) {
    out.push({ id: 'empty', kind: 'note', text: 'Not enough data yet. Play a game to start building your profile.', n: 0, provisional: true });
    return out;
  }

  /* strongest and weakest */
  const r = stats.ranking;
  if (!r.enoughToRank) {
    out.push({
      id: 'not-enough',
      kind: 'note',
      text: `Not enough data yet to rank your categories. Answer at least ${o.minSample} questions in two different categories.`,
      n: stats.totals.answered,
      provisional: true,
    });
  } else if (r.evenlyMatched) {
    const hi = r.ranked[0];
    const lo = r.ranked[r.ranked.length - 1];
    add('even', 'note', `Your categories are evenly matched so far: between ${pct(lo.accuracy)}% and ${pct(hi.accuracy)}% accuracy.`, Math.min(hi.answered, lo.answered), { categories: [lo.key, hi.key] });
  } else {
    const best = r.strongest[0];
    const worst = r.weakest[0];
    add('strongest', 'strength', `Your strongest category is ${best.label}: ${pct(best.accuracy)}% accuracy across ${best.answered} questions.`, best.answered, { category: best.key });
    add('weakest', 'weakness', `${worst.label} is your weakest category: ${pct(worst.accuracy)}% accuracy across ${worst.answered} questions.`, worst.answered, { category: worst.key });
  }

  /* difficulty */
  const levels = [1, 2, 3, 4].filter((d) => stats.byDifficulty[d].answered >= o.minSample);
  if (levels.length >= 2) {
    const easy = levels[0];
    const hard = levels[levels.length - 1];
    const a = stats.byDifficulty[easy];
    const b = stats.byDifficulty[hard];
    if (a.accuracy - b.accuracy >= 0.15) {
      add('difficulty', 'difficulty', `You do well on ${DIFFICULTIES[easy]} questions (${pct(a.accuracy)}% across ${a.answered}) but lose accuracy on ${DIFFICULTIES[hard]} ones (${pct(b.accuracy)}% across ${b.answered}).`, Math.min(a.answered, b.answered));
    }
  }

  /* time pressure: an association, never a claimed cause */
  const p = stats.pressure;
  if (p.pressured.answered >= o.minSample && p.comfortable.answered >= o.minSample) {
    const diff = p.comfortable.accuracy - p.pressured.accuracy;
    if (Math.abs(diff) >= 0.1) {
      add(
        'pressure',
        'pressure',
        `You were right ${pct(p.comfortable.accuracy)}% of the time with more than ${p.thresholdMs / 1000} seconds left (${p.comfortable.answered} questions) and ${pct(p.pressured.accuracy)}% with less (${p.pressured.answered} questions). That is a pattern in your answers, not proof that the clock is the cause.`,
        Math.min(p.pressured.answered, p.comfortable.answered),
      );
    }
  }

  /* speed vs accuracy within a category, also only an association */
  for (const c of stats.byCategory) {
    if (!c.speed) continue;
    const gap = c.speed.slow.accuracy - c.speed.fast.accuracy;
    const n = c.speed.slow.answered + c.speed.fast.answered;
    if (gap >= 0.15) {
      add(`speed:${c.key}`, 'speed', `You answer ${c.short} questions more accurately when you take your time: ${pct(c.speed.slow.accuracy)}% on slower answers versus ${pct(c.speed.fast.accuracy)}% on quicker ones (${n} questions). A pattern, not proof of cause.`, n, { category: c.key });
    } else if (gap <= -0.15) {
      add(`speed:${c.key}`, 'speed', `In ${c.short}, your quicker answers are more accurate: ${pct(c.speed.fast.accuracy)}% versus ${pct(c.speed.slow.accuracy)}% when you take longer (${n} questions). Your first instinct is often right.`, n, { category: c.key });
    }
  }

  /* trends */
  for (const c of stats.byCategory) {
    if (!c.trend || Math.abs(c.trend.delta) < 8) continue;
    const up = c.trend.delta > 0;
    add(`trend:${c.key}`, up ? 'improvement' : 'decline', `Your ${c.short} accuracy has ${up ? 'improved' : 'dropped'} by ${Math.round(Math.abs(c.trend.delta))} percentage points over your last ${c.trend.recent} questions, compared with ${c.trend.baseline} earlier ones.`, c.trend.baseline, { category: c.key, delta: c.trend.delta });
  }
  const t = stats.recent.trend;
  if (t && Math.abs(t.delta) >= 5) {
    add('overall-trend', t.delta > 0 ? 'improvement' : 'decline', `Over your last ${t.recent} questions you were right ${pct(t.recentAccuracy)}% of the time, versus ${pct(t.baselineAccuracy)}% across the ${t.baseline} before that.`, t.baseline, { delta: t.delta });
  }

  return out;
}

/**
 * Optional suggestions for what to play or review next. Advisory only: the game
 * never silently changes difficulty or question mix.
 */
export function buildRecommendations(stats, { missed = [] } = {}) {
  const o = stats.opts;
  const out = [];
  if (stats.totals.answered < o.minSample) {
    out.push({ id: 'more-data', type: 'note', text: `Play a few more questions (${stats.totals.answered} of ${o.minSample} so far) to unlock personalised suggestions.`, evidence: { answered: stats.totals.answered } });
    return out;
  }
  const overall = stats.totals.accuracy;
  const r = stats.ranking;

  if (r.enoughToRank && !r.evenlyMatched) {
    for (const c of r.weakest) {
      if (overall - c.accuracy >= 0.1) {
        out.push({ id: `focus:${c.key}`, type: 'focus', category: c.key, text: `Practise ${c.label}: you are at ${pct(c.accuracy)}% across ${c.answered} questions, against ${pct(overall)}% overall.`, evidence: { n: c.answered, accuracy: c.accuracy, overall } });
        break;
      }
    }
    for (const c of r.strongest) {
      if (c.accuracy >= 0.85) {
        out.push({ id: `harder:${c.key}`, type: 'harder', category: c.key, text: `${c.label} is going very well (${pct(c.accuracy)}% across ${c.answered}). Your later acts will push you harder there.`, evidence: { n: c.answered, accuracy: c.accuracy } });
        break;
      }
    }
    out.push({ id: 'balanced', type: 'balanced', text: `For a balanced session, alternate ${r.strongest[0].short} with ${r.weakest[0].short}: your best and weakest categories so far.`, evidence: { strongest: r.strongest[0].key, weakest: r.weakest[0].key } });
  }

  const gains = stats.byCategory.filter((c) => c.trend && c.trend.delta >= 8).sort((a, b) => b.trend.delta - a.trend.delta);
  if (gains.length) {
    const c = gains[0];
    out.push({ id: `progress:${c.key}`, type: 'celebrate', category: c.key, text: `Nice progress in ${c.short}: up ${Math.round(c.trend.delta)} percentage points over your last ${c.trend.recent} questions.`, evidence: { delta: c.trend.delta } });
  }

  if (missed.length >= 3) {
    out.push({ id: 'review', type: 'review', text: `Review the explanations for the ${missed.length} questions you missed most recently.`, evidence: { count: missed.length } });
  }

  if (stats.pressure.timeouts >= 5 && stats.totals.answered > 0 && stats.pressure.timeouts / stats.totals.answered >= 0.1) {
    out.push({ id: 'timeouts', type: 'note', text: `${stats.pressure.timeouts} of your ${stats.totals.answered} questions ran out of time. The Stopwatch card or the Slow Clock from the shop can help.`, evidence: { timeouts: stats.pressure.timeouts } });
  }
  return out;
}

export { secs as formatSeconds, pct as formatPercent };
