// The statistics dashboard. Every number comes from computeStats(); nothing is
// stored separately. Small samples are labelled, never dressed up as findings.
import { h, mount, formatDate, formatDuration } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { avatar, categoryIcon, screenHeader, pct, secs, modal } from '../components.js';
import { lineChart } from '../charts.js';
import { computeStats, missedQuestions } from '../../stats/stats.js';
import { buildInsights, buildRecommendations } from '../../stats/insights.js';
import { CATEGORIES, DIFFICULTIES, STAT_CATEGORIES } from '../../engine/bank.js';
import { CARDS } from '../../engine/cards.js';
import { HAZARDS, BOSSES } from '../../engine/modifiers.js';
import { sfx } from '../audio.js';

const DAY = 86_400_000;
const RANGES = { all: { label: 'All time', since: null }, d30: { label: '30 days', since: 30 * DAY }, d7: { label: '7 days', since: 7 * DAY } };
const MODES = { all: 'All modes', solo: 'Solo', versus: 'Versus', daily: 'Daily' };
const TABS = [['overview', 'Overview'], ['strengths', 'Strengths'], ['trends', 'Trends'], ['games', 'Games'], ['records', 'Records'], ['method', 'How it works']];

const view = { tab: 'overview', range: 'all', mode: 'all', category: '', difficulty: '' };

export async function statsScreen(app, params) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  const root = h('div.screen');

  if (!profiles.length) {
    return h('div.screen', {}, screenHeader('Stats', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Statistics appear here once you have a player and have played a game.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Create a player'));
  }

  const allSessions = await app.repo.listSessions();
  const settings = app.settings;
  const opts = { minSample: settings.minSample, confidentSample: settings.confidentSample };

  const paint = async () => {
    const p = profiles.find((x) => x.id === pid) ?? profiles[0];
    pid = p.id;
    const results = await app.repo.listResults(p.id);
    const filters = {
      sinceTs: RANGES[view.range].since ? Date.now() - RANGES[view.range].since : null,
      mode: view.mode === 'all' ? null : view.mode,
      category: view.category || null,
      difficulty: view.difficulty ? Number(view.difficulty) : null,
    };
    const stats = computeStats({ results, sessions: allSessions, playerId: p.id, opts, filters });
    const insights = buildInsights(stats);
    const missed = missedQuestions(results, p.id);
    const recs = buildRecommendations(stats, { missed });

    const filtered = Boolean(filters.sinceTs || filters.mode || filters.category || filters.difficulty);
    const body = {
      overview: () => tabOverview(stats, insights, recs, filtered, p),
      strengths: () => tabStrengths(app, stats, missed),
      trends: () => tabTrends(stats),
      games: () => tabGames(app, stats, p),
      records: () => tabRecords(app, stats),
      method: () => tabMethod(stats),
    }[view.tab]();

    mount(root, 
      screenHeader('Stats', () => goBack('menu')),
      profiles.length > 1 ? h('div.tabs', { role: 'tablist', 'aria-label': 'Player' }, profiles.map((x) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(x.id === p.id), onclick: () => { pid = x.id; sfx.select(); paint(); } }, x.name))) : h('div.row', {}, avatar(p, 16), h('h3', {}, p.name)),
      filterBar(paint),
      h('div.tabs', { role: 'tablist' }, TABS.map(([id, label]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(view.tab === id), onclick: () => { view.tab = id; sfx.select(); paint(); window.scrollTo(0, 0); } }, label))),
      filtered ? h('p.tiny.amber', {}, 'Filters are on. Totals below only count matching answers.') : null,
      body,
    );
  };
  await paint();
  return root;
}

/* ------------------------------------------------------------- filters */

function filterBar(repaint) {
  const sel = (key, options) => h('select', { 'aria-label': key, onchange: (e) => { view[key] = e.target.value; repaint(); } }, Object.entries(options).map(([v, l]) => h('option', { value: v, selected: view[key] === v }, l)));
  return h('details.panel.tight', { open: Boolean(view.category || view.difficulty) },
    h('summary', {}, `Filters · ${RANGES[view.range].label} · ${MODES[view.mode]}`),
    h('div.col', {},
      h('label.field', {}, h('span', {}, 'Period'), sel('range', Object.fromEntries(Object.entries(RANGES).map(([k, v]) => [k, v.label])))),
      h('label.field', {}, h('span', {}, 'Mode'), sel('mode', MODES)),
      h('label.field', {}, h('span', {}, 'Category'), sel('category', { '': 'All categories', ...Object.fromEntries(STAT_CATEGORIES.map((k) => [k, CATEGORIES[k].label])) })),
      h('label.field', {}, h('span', {}, 'Difficulty'), sel('difficulty', { '': 'All difficulties', ...DIFFICULTIES })),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { Object.assign(view, { range: 'all', mode: 'all', category: '', difficulty: '' }); repaint(); } }, 'Clear filters'),
    ),
  );
}

/* ------------------------------------------------------------ helpers */

const stat = (value, label, sub) => h('div.stat', {}, h('b', {}, value), h('span', {}, label), sub ? h('span.mute', {}, sub) : null);

function empty(text) {
  return h('div.panel.inset.empty-state', {}, sprite('bulb_off', 32), h('p', {}, text));
}

function provisionalTag(n, confident) {
  return n < confident ? h('span.tag', { title: `Fewer than ${confident} answers: treat as an early signal.` }, 'Provisional') : null;
}

/** A labelled accuracy bar with its 95% interval and sample size. */
function accBar(label, g, { icon, min, confident, tone } = {}) {
  const enough = g.answered >= min;
  const lbl = h('span.lbl', {}, icon ? categoryIcon(icon, 16) : null, label);
  if (!g.answered) return h('div.bar-row', {}, lbl, h('div.bar'), h('span.val.mute', {}, '—'));
  const bar = h('div.bar', { title: `${g.correct} of ${g.answered} correct` },
    h('i', { class: `${tone ?? ''} ${g.answered < confident ? 'prov' : ''}`, style: { width: `${(g.accuracy ?? 0) * 100}%` } }),
    g.ci && g.answered >= 3 ? h('span.ci', { style: { left: `${g.ci[0] * 100}%`, width: `${Math.max(1, (g.ci[1] - g.ci[0]) * 100)}%` } }) : null,
  );
  return h('div.bar-row', {}, lbl, bar, h('span.val', {}, pct(g.accuracy), h('small', {}, enough ? `n=${g.answered}` : `n=${g.answered} · early`)));
}

/* ------------------------------------------------------------ overview */

function tabOverview(stats, insights, recs, filtered, p) {
  const t = stats.totals;
  if (!t.answered && !stats.games.total) return empty(filtered ? 'No answers match these filters.' : `Not enough data yet. Play a game as ${p.name} and the numbers start filling in.`);
  const g = stats.games;
  const o = stats.opts;
  return h('div.col', {},
    h('div.panel', {},
      h('div.grid2', {},
        stat(t.answered, 'Questions answered', t.timeouts ? `${t.timeouts} timed out` : null),
        stat(pct(t.accuracy), 'Accuracy', t.answered < o.minSample ? 'early reading' : null),
        stat(secs(t.avgMs), 'Average answer time'),
        stat(stats.streak.longest, 'Longest streak'),
        stat(g.completed, 'Games completed', g.abandoned ? `${g.abandoned} abandoned` : null),
        stat(g.winRate == null ? '—' : pct(g.winRate), 'Win rate', g.completed ? `of ${g.completed} completed` : 'no completed games yet'),
      ),
      t.ci && t.answered >= 3 ? h('p.tiny.mute', { style: { marginTop: '10px' } }, `Accuracy is likely between ${pct(t.ci[0])} and ${pct(t.ci[1])} (95% interval, ${t.answered} answers).`) : null,
      t.answered >= 1 && t.answered < o.minSample ? h('p.small.amber', {}, `Not enough data yet for firm conclusions: ${t.answered} of ${o.minSample} answers.`) : null,
    ),
    h('div.panel', {}, h('h3', {}, 'What stands out'), ...insightList(insights, o)),
    recs.length ? h('div.panel', {}, h('h3', {}, 'Suggestions'), h('p.tiny.mute', {}, 'Advice only. The game never changes its difficulty behind your back.'), ...recs.map((r) => h('div.insight', {}, sprite(r.type === 'celebrate' ? 'star' : r.type === 'review' ? 'eye' : 'key', 24), h('p', {}, r.text)))) : null,
    stats.recent.trend ? h('div.panel.tight', {}, h('div.tiny.dim', {}, 'Recent form'), h('p', { style: { margin: '4px 0 0' } }, `Last ${stats.recent.window} answers: ${pct(stats.recent.last.accuracy)}, against ${pct(stats.recent.baseline.accuracy)} before that (${stats.recent.baseline.answered}).`)) : null,
  );
}

function insightList(insights, o) {
  const icon = { strength: 'check', weakness: 'cross', improvement: 'star', decline: 'cross', note: 'bulb_off' };
  return insights.map((i) => h('div.insight', {}, sprite(icon[i.kind] ?? 'eye', 24), h('div', {}, h('p', {}, i.text), i.n ? h('div.row.wrap', { style: { gap: '6px', marginTop: '4px' } }, h('span.tag', {}, `n=${i.n}`), i.provisional ? h('span.tag', { title: `Fewer than ${o.confidentSample} answers behind this.` }, 'Provisional') : null) : null)));
}

/* ----------------------------------------------------------- strengths */

function tabStrengths(app, stats, missed) {
  const o = stats.opts;
  const r = stats.ranking;
  const cats = stats.byCategory.filter((c) => c.answered > 0);
  if (!cats.length) return empty('Not enough data yet. Answer some questions to see your categories.');
  const ranked = r.ranked;
  const bar = (c, tone) => accBar(c.short, c, { icon: c.key, min: o.minSample, confident: o.confidentSample, tone });
  const strongest = new Set(r.strongest.map((c) => c.key));
  const weakest = new Set(r.weakest.map((c) => c.key));

  return h('div.col', {},
    h('div.panel', {},
      h('h3', {}, 'Categories'),
      r.enoughToRank
        ? h('p.small.dim', {}, r.evenlyMatched ? 'Your categories are close together right now.' : `Ranked by accuracy. Needs ${o.minSample}+ answers per category. Hatched bars have fewer than ${o.confidentSample} answers.`)
        : h('p.small.amber', {}, `Not enough data yet to rank categories: at least two need ${o.minSample}+ answers.`),
      ...ranked.map((c) => bar(c, !r.evenlyMatched && strongest.has(c.key) ? 'good' : !r.evenlyMatched && weakest.has(c.key) ? 'bad' : '')),
      r.earlySignals.length ? h('div.hr') : null,
      r.earlySignals.length ? h('div.tiny.dim', {}, 'Early signals · not enough data to rank') : null,
      ...r.earlySignals.map((c) => bar(c)),
      h('p.tiny.mute', {}, 'The whisker on each bar is the 95% interval: wide means we are still guessing.'),
    ),
    !r.evenlyMatched && r.enoughToRank ? h('div.grid2', {},
      h('div.panel.good', {}, h('div.tiny', {}, 'Strongest'), ...r.strongest.map((c) => h('p', { style: { margin: '4px 0' } }, h('b', {}, c.label), ` ${pct(c.accuracy)} · n=${c.answered}`, provisionalTag(c.answered, o.confidentSample)))),
      h('div.panel.warn', {}, h('div.tiny', {}, 'Weakest'), ...r.weakest.map((c) => h('p', { style: { margin: '4px 0' } }, h('b', {}, c.label), ` ${pct(c.accuracy)} · n=${c.answered}`, provisionalTag(c.answered, o.confidentSample)))),
    ) : null,
    h('div.panel', {},
      h('h3', {}, 'By difficulty'),
      ...[1, 2, 3, 4].map((d) => accBar(DIFFICULTIES[d], stats.byDifficulty[d], { min: o.minSample, confident: o.confidentSample })),
      h('p.tiny.mute', {}, `Weighted accuracy counts harder questions more: ${pct(stats.totals.weightedAccuracy)} for you.`),
    ),
    pressurePanel(stats),
    cardsPanel(stats),
    subcategoryPanel(stats),
    missedPanel(app, missed),
  );
}

function pressurePanel(stats) {
  const p = stats.pressure;
  const o = stats.opts;
  if (p.pressured.answered + p.comfortable.answered < 1) return null;
  return h('div.panel', {},
    h('h3', {}, 'Under the clock'),
    accBar(`>${p.thresholdMs / 1000}s left`, p.comfortable, { min: o.minSample, confident: o.confidentSample }),
    accBar(`<${p.thresholdMs / 1000}s left`, p.pressured, { min: o.minSample, confident: o.confidentSample }),
    h('div.kv', {}, h('span', {}, 'Ran out of time'), h('b', {}, `${p.timeouts} of ${stats.totals.answered}`)),
    h('p.tiny.mute', {}, 'Compares answers given with plenty of time left against those given in a rush. A pattern, not proof of what caused it.'),
  );
}

function cardsPanel(stats) {
  const it = stats.items;
  if (!it.withItems.answered) return null;
  const o = stats.opts;
  return h('div.panel', {},
    h('h3', {}, 'Bonus cards'),
    accBar('With a card', it.withItems, { min: o.minSample, confident: o.confidentSample }),
    accBar('No card', it.withoutItems, { min: o.minSample, confident: o.confidentSample }),
    ...Object.entries(it.byCard).sort((a, b) => b[1].answered - a[1].answered).map(([id, g]) => accBar(CARDS[id]?.name ?? id, g, { min: o.minSample, confident: o.confidentSample })),
    h('p.tiny.mute', {}, 'Cards tend to be played on harder questions, so a lower accuracy with a card does not mean the card hurts.'),
  );
}

function subcategoryPanel(stats) {
  const o = stats.opts;
  const rows = Object.entries(stats.bySubcategory)
    .map(([k, g]) => ({ k, g }))
    .filter((x) => x.g.answered >= o.minSample)
    .sort((a, b) => b.g.accuracy - a.g.accuracy);
  if (!rows.length) return null;
  const label = (k) => { const [c, s] = k.split('/'); return `${CATEGORIES[c]?.short ?? c} · ${s}`; };
  return h('details.panel', {}, h('summary', {}, 'Topics in detail'), ...rows.map((x) => accBar(label(x.k), x.g, { min: o.minSample, confident: o.confidentSample })), h('p.tiny.mute', {}, `Only topics with ${o.minSample}+ answers are listed.`));
}

function missedPanel(app, missed) {
  if (!missed.length) return null;
  const q = (id) => app.ctx.byId.get(id);
  const list = missed.slice(0, 12).filter((m) => q(m.questionId));
  if (!list.length) return null;
  return h('details.panel', {}, h('summary', {}, `Review your misses (${list.length})`),
    ...list.map((m) => {
      const question = q(m.questionId);
      return h('details', { style: { marginBottom: '8px' } },
        h('summary.small', { style: { cursor: 'pointer' } }, `${CATEGORIES[m.category]?.short ?? m.category} · ${question.question.slice(0, 70)}${question.question.length > 70 ? '…' : ''}`),
        h('div.panel.paper.tight', { style: { marginTop: '6px' } }, h('div.explain', {}, h('span.ans', {}, `Answer: ${question.choices[question.answer]}`), question.explanation)),
      );
    }),
  );
}

/* -------------------------------------------------------------- trends */

function tabTrends(stats) {
  const o = stats.opts;
  const t = stats.totals;
  if (!t.answered) return empty('Not enough data yet. Trends need a few games.');
  const roll = stats.series.rolling;
  const bySession = stats.series.accuracyBySession;
  const scores = stats.series.scoreBySession;
  const times = stats.series.avgTimeBySession;
  const dateLabels = (arr, key = 'startedAt') => (arr.length > 1 ? [formatDate(arr[0][key], { day: 'numeric', month: 'short' }), formatDate(arr[arr.length - 1][key], { day: 'numeric', month: 'short' })] : null);

  return h('div.col', {},
    h('div.panel', {}, h('h3', {}, `Accuracy · last ${o.recentWindow} answers`),
      roll.length >= 2
        ? [lineChart({ points: roll.map((r) => ({ x: r.index, y: r.accuracy, label: `Answer ${r.index}: ${pct(r.accuracy)}` })), xLabels: [`answer ${roll[0].index}`, `answer ${roll[roll.length - 1].index}`], ariaLabel: 'Rolling accuracy' }), h('p.tiny.mute', {}, 'Each point is your accuracy over the 20 answers up to that moment.')]
        : h('p.small.amber', {}, `Not enough data yet: this chart appears after ${o.recentWindow} answers (you have ${t.answered}).`)),
    h('div.panel', {}, h('h3', {}, 'Accuracy by game'),
      bySession.length >= 2 ? lineChart({ points: bySession.map((s, i) => ({ x: i, y: s.accuracy, label: `${formatDate(s.startedAt)}: ${pct(s.accuracy)} of ${s.answered}${s.status === 'abandoned' ? ' (abandoned)' : ''}` })), xLabels: dateLabels(bySession), ariaLabel: 'Accuracy by game' }) : h('p.small.amber', {}, 'Not enough data yet: play at least two games.')),
    scores.length >= 2 ? h('div.panel', {}, h('h3', {}, 'Score by game'),
      lineChart({ points: scores.map((s, i) => ({ x: i, y: s.score, label: `${formatDate(s.startedAt)}: ${s.score}` })), yDomain: [0, Math.max(100, ...scores.map((s) => s.score)) * 1.1], yFormat: (v) => String(Math.round(v)), xLabels: dateLabels(scores), ariaLabel: 'Score by game' })) : null,
    times.length >= 2 ? h('div.panel', {}, h('h3', {}, 'Answer speed by game'),
      lineChart({ points: times.map((s, i) => ({ x: i, y: s.avgMs / 1000 })), yDomain: [0, Math.max(5, ...times.map((s) => s.avgMs / 1000)) * 1.1], yFormat: (v) => `${v.toFixed(0)}s`, xLabels: dateLabels(times), color: '#4a7bb0', ariaLabel: 'Average answer time by game' }), h('p.tiny.mute', {}, 'Lower is faster.')) : null,
    h('div.panel', {}, h('h3', {}, 'Category movement'),
      ...(stats.byCategory.some((c) => c.trend)
        ? stats.byCategory.filter((c) => c.trend).map((c) => h('div.kv', {}, h('span.row', {}, categoryIcon(c.key, 16), c.short), h('b', { class: c.trend.delta >= 5 ? 'green' : c.trend.delta <= -5 ? 'red' : '' }, `${c.trend.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(c.trend.delta))} pts`)))
        : [h('p.small.amber', {}, `Not enough data yet: a category needs ${o.minSample + o.trendWindow} answers to show movement.`)]),
      h('p.tiny.mute', {}, `Change in accuracy over the last ${o.trendWindow} answers in that category, compared with all the earlier ones.`)),
  );
}

/* --------------------------------------------------------------- games */

function modeLabel(m) {
  return { solo: 'Solo run', versus: 'Versus', daily: 'Daily' }[m] ?? m;
}

function tabGames(app, stats, p) {
  const hs = stats.history;
  if (!hs.length) return empty('No games yet.');
  const g = stats.games;
  return h('div.col', {},
    h('div.panel', {},
      h('div.grid2', {}, stat(g.total, 'Games', `${g.completed} done · ${g.abandoned} abandoned`), stat(g.bestScore ?? '—', 'Best score'), stat(g.avgScore == null ? '—' : Math.round(g.avgScore), 'Average score', 'completed games only'), stat(g.highestRun ?? '—', 'Most rounds cleared')),
      ...Object.entries(g.byMode).map(([m, v]) => h('div.kv', {}, h('span', {}, modeLabel(m)), h('b', {}, `${v.completed} done · ${v.won} won${v.abandoned ? ` · ${v.abandoned} left` : ''}`))),
    ),
    h('div.col.gap-s', {}, hs.map((x) => h('button.history-item', { type: 'button', onclick: () => gameDetail(x) },
      h('div.grow', {},
        h('div.row', {}, h('b', {}, modeLabel(x.mode)), x.status === 'abandoned' ? h('span.tag', {}, 'Abandoned') : x.status === 'active' ? h('span.tag.amber', {}, 'In progress') : x.result === 'won' ? h('span.tag.green', {}, x.mode === 'versus' ? `Place ${x.placement}` : 'Won') : h('span.tag.red', {}, x.mode === 'versus' ? `Place ${x.placement}` : 'Lost')),
        h('div.small.dim', {}, `${formatDate(x.startedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${x.questions} questions · ${pct(x.accuracy)}`),
      ),
      x.status === 'completed' ? h('b.mono.amber', {}, x.score ?? '') : null,
    ))),
  );
}

function gameDetail(x) {
  modal((close) => [
    h('h2', {}, `${modeLabel(x.mode)} · ${formatDate(x.startedAt)}`),
    h('div.panel.inset.tight', {},
      h('div.kv', {}, h('span', {}, 'Status'), h('b', {}, x.status)),
      x.status === 'completed' ? h('div.kv', {}, h('span', {}, 'Score'), h('b', {}, x.score ?? '—')) : null,
      x.mode === 'versus' ? h('div.kv', {}, h('span', {}, 'Placement'), h('b', {}, `${x.placement ?? '—'} of ${x.players}`)) : null,
      h('div.kv', {}, h('span', {}, 'Correct'), h('b', {}, `${x.correct} of ${x.questions}`)),
      h('div.kv', {}, h('span', {}, 'Average time'), h('b', {}, secs(x.avgMs))),
      h('div.kv', {}, h('span', {}, 'Rounds cleared'), h('b', {}, x.roundsCleared ?? '—')),
      x.endedAt ? h('div.kv', {}, h('span', {}, 'Duration'), h('b', {}, formatDuration(x.endedAt - x.startedAt))) : null,
      h('div.kv', {}, h('span', {}, 'Seed'), h('b', { style: { fontSize: '12px' } }, String(x.seed))),
    ),
    h('h3', {}, 'By category'),
    ...x.categories.map((c) => h('div.bar-row', {}, h('span.lbl', {}, categoryIcon(c.key, 16), CATEGORIES[c.key].short), h('div.bar', {}, h('i', { style: { width: `${(c.accuracy ?? 0) * 100}%` } })), h('span.val', {}, `${c.correct}/${c.answered}`))),
    h('button.btn.primary.block', { type: 'button', onclick: () => close() }, 'Close'),
  ]);
}

/* ------------------------------------------------------------- records */

function tabRecords(app, stats) {
  const r = stats.records;
  const t = stats.totals;
  if (!t.answered) return empty('Not enough data yet. Records appear as you play.');
  const q = r.hardestCorrect ? app.ctx.byId.get(r.hardestCorrect.questionId) : null;
  const w = stats.wagers;
  const b = stats.boss;
  return h('div.col', {},
    h('div.panel', {},
      h('h3', {}, 'Personal bests'),
      h('div.kv', {}, h('span', {}, 'Highest score'), h('b', {}, r.highestScore ?? '—')),
      h('div.kv', {}, h('span', {}, 'Longest streak'), h('b', {}, r.longestStreak)),
      h('div.kv', {}, h('span', {}, 'Most rounds cleared in a run'), h('b', {}, r.highestRun ?? '—')),
      h('div.kv', {}, h('span', {}, 'Best game accuracy'), h('b', {}, r.bestRunAccuracy ? `${pct(r.bestRunAccuracy.accuracy)} of ${r.bestRunAccuracy.answered}` : `needs ${stats.opts.minSample}+ answers`)),
      h('div.kv', {}, h('span', {}, 'Most improved category'), h('b', {}, r.mostImproved ? `${r.mostImproved.label} +${Math.round(r.mostImproved.delta)}` : 'not enough data yet')),
      h('div.kv', {}, h('span', {}, 'Most played category'), h('b', {}, stats.favourite ? `${stats.favourite.label} (${stats.favourite.answered})` : '—')),
    ),
    q ? h('div.panel.paper', {}, h('div.tiny', {}, `Hardest question you got right · ${DIFFICULTIES[r.hardestCorrect.difficulty]}`), h('p.serif', { style: { margin: '6px 0 0', fontSize: '17px' } }, q.question)) : null,
    h('div.panel', {},
      h('h3', {}, 'Risk & reward'),
      h('div.kv', {}, h('span', {}, 'Stakes won'), h('b', {}, `${w.won} of ${w.total}`)),
      h('div.kv', {}, h('span', {}, 'Net chips from all answers'), h('b', { class: w.netChips >= 0 ? 'green' : 'red' }, `${w.netChips >= 0 ? '+' : '−'}${Math.abs(w.netChips)}`)),
      b.boss.answered ? h('div.kv', {}, h('span', {}, 'Boss rounds accuracy'), h('b', {}, `${pct(b.boss.accuracy)} (n=${b.boss.answered})`)) : null,
      b.boss.answered ? h('div.kv', {}, h('span', {}, 'Normal rounds accuracy'), h('b', {}, `${pct(b.normal.accuracy)} (n=${b.normal.answered})`)) : null,
    ),
  );
}

/* -------------------------------------------------------------- method */

function tabMethod(stats) {
  const o = stats.opts;
  return h('div.panel.method', {},
    h('h3', {}, 'How these numbers work'),
    h('ul', { style: { paddingLeft: '18px' } },
      h('li', {}, h('b', {}, 'Answered'), ': a question you were shown and resolved. A timeout counts as answered and wrong. Questions you never reached (a game you abandoned) are not counted at all.'),
      h('li', {}, h('b', {}, 'Accuracy'), ': correct ÷ answered.'),
      h('li', {}, h('b', {}, 'Weighted accuracy'), ': harder questions count more (Easy 1, Medium 1.5, Hard 2, Expert 3).'),
      h('li', {}, h('b', {}, 'Average time'), ': mean response time on answers that did not time out.'),
      h('li', {}, h('b', {}, 'Streak'), ': consecutive correct answers in time order across all games.'),
      h('li', {}, h('b', {}, 'Win rate'), ': wins ÷ completed games. Abandoned games count as neither.'),
      h('li', {}, h('b', {}, `Strongest and weakest`), `: only categories with at least ${o.minSample} answers are ranked, and at least two are needed.`),
      h('li', {}, h('b', {}, 'Provisional'), `: any observation resting on fewer than ${o.confidentSample} answers is labelled, because small samples swing a lot.`),
      h('li', {}, h('b', {}, '95% interval'), ': the whisker on a bar is the range your true accuracy plausibly falls in (Wilson interval). Wide whiskers mean few answers.'),
      h('li', {}, h('b', {}, 'Trends'), `: your last ${o.trendWindow} answers in a category versus everything before them.`),
      h('li', {}, h('b', {}, 'Filters'), ': period, mode, category and difficulty. Game-level figures (wins, scores) follow the period and mode filters.'),
    ),
    h('p.small', {}, 'Everything is calculated from your saved answers each time you open this page. There are no hidden counters, and nothing here changes how hard the game is.'),
    h('p.small.dim', {}, 'The thresholds can be changed in Settings. Data stays on this device unless you export it.'),
    h('button.btn.small', { type: 'button', onclick: () => go('settings') }, 'Open settings'),
  );
}
