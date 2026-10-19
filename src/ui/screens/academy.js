// Champion's Academy: elite general-knowledge training. Seven modules (Daily Workout, Rapid Fire, Associations, Precision,
// Dates and Chronology, Progressive Clues, Champion Examination), a personal training plan, an insights page computed from the
// stored answers, and a small library (timeline, connections). What is asked comes from engine/academy.js and the learning engine;
// the answers go back into the player's learning record and Academy record on this device.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import '../art_icons.js';
import { go, goBack, setMood } from '../app.js';
import { screenHeader, avatar } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { confetti, haptic } from '../fx.js';
import { createScene } from '../scenes.js';
import { playRun, makeLocalizer } from '../practice.js';
import { learningSummary, rememberPanel, offsetMin, whenText } from './adventure.js';
import { metaOf } from '../../storage/meta.js';
import { PACKS } from '../../engine/hexes.js';
import { dayKey, nextDue, DAY } from '../../engine/learning.js';
import { startPractice } from '../../engine/practice.js';
import {
  MODULES, SUBJECTS, SUBJECT, PLANS, PLAN_IDS, TIMER_SECONDS, ACHIEVEMENTS, CLUE_POINTS, MIN_SAMPLE, weightsFor, subjectOf, buildAcademy, buildClues, clueOutcome, cluePoints,
  entriesFromRun, rapidScore, academyStats, examReport,
} from '../../engine/academy.js';

const ICON = { workout: 'ic_sun', rapid: 'ic_target', assoc: 'ic_compass', trick: 'ic_magnifier', chrono: 'ic_flag', clues: 'ic_book', exam: 'ic_trophy' };
const SCENE = { workout: 'bench', rapid: 'reactor', assoc: 'greenhouse', trick: 'fearlab', chrono: 'observatory', clues: 'clinic', exam: 'paradox' };
const ORDER = ['workout', 'rapid', 'assoc', 'trick', 'chrono', 'clues', 'exam'];
const yearText = (y) => (y < 0 ? `${-y} BC` : `${y}`);
const pctText = (s) => (s && s.n >= MIN_SAMPLE ? `${s.pct}%` : s && s.n ? `${s.pct}% (only ${s.n})` : 'no data yet');

export async function academyScreen(app, params = {}) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  const localize = makeLocalizer(app);
  const scene = createScene();
  const content = h('div.adv-content');
  const root = h('div.screen.adventure.academy', {}, scene.el, content);
  const view = (...nodes) => mount(content, ...nodes);
  const profile = async () => app.repo.getProfile(pid);
  let busy = false; let workoutSize = MODULES.workout.size;
  const langOf = (p) => ((p?.language ?? 'en') === 'fr' ? 'fr' : 'en'); // clue and library text exist in English and French
  const pick = (x, lang) => x?.[lang] ?? x?.en ?? '';

  const playerBar = () => (profiles.length > 1
    ? h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, profiles.map((p) => h('button.btn.icon.ghost', { type: 'button', 'aria-pressed': String(p.id === pid), class: p.id === pid ? 'on' : '', 'aria-label': p.name, onclick: () => { pid = p.id; hub(); } }, avatar(p, 32))))
    : null);

  /* ------------------------------------------------------------ hub */
  async function hub() {
    scene.el.classList.remove('arena'); scene.set('bench', 0.35); setMood('calm');
    if (!profiles.find((p) => p.id === pid)) {
      view(screenHeader("Champion's Academy", () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start training.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players'));
      return;
    }
    const p = await profile(); const m = metaOf(p); const now = Date.now();
    const stats = academyStats(m.acad, m.learn, app.ctx, now);
    const plan = PLANS[m.acad.plan.id];
    const card = (id, extra, onclick) => h('button.panel.mode-card', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); onclick(); } },
      sprite(ICON[id], 36), h('div.grow', {}, h('b', {}, MODULES[id].name), h('div.tiny.dim', {}, MODULES[id].blurb)), extra ? h('span.tag', {}, extra) : null);
    view(
      screenHeader("Champion's Academy", () => goBack('menu')),
      playerBar(),
      h('div.panel.tight', {},
        h('p.small', {}, 'Broad knowledge, precise recall, durable memory. Your answers train the same memory schedule as Train and the Adventure.'),
        h('div.row.between', {}, h('span.small', {}, stats.due ? h('b.amber', {}, `${stats.due} reviews due`) : 'Nothing due right now'), h('span.tiny.dim', {}, stats.total ? `${stats.total} answers recorded` : 'No answers recorded yet')),
        h('div.row.gap-s', { style: { flexWrap: 'wrap', marginTop: '6px' } },
          h('button.chip', { type: 'button', onclick: () => planScreen() }, `Plan: ${plan.name}`),
          h('button.chip', { type: 'button', 'aria-pressed': String(m.acad.timer), class: m.acad.timer ? 'on' : '', title: 'Shows a suggested time in Rapid Fire and the Examination. Never a penalty in learning.', onclick: async () => { await app.repo.setAcademyPrefs(pid, { timer: !m.acad.timer }); hub(); } }, m.acad.timer ? 'Timer: on' : 'Timer: off'))),
      h('div.panel.mode-card', { style: { flexDirection: 'column', alignItems: 'stretch' } },
        h('div.row.gap-s', {}, sprite(ICON.workout, 36), h('div.grow', {}, h('b', {}, MODULES.workout.name), h('div.tiny.dim', {}, MODULES.workout.blurb))),
        h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, MODULES.workout.sizes.map((n) => h('button.chip', { type: 'button', 'aria-pressed': String(workoutSize === n), class: workoutSize === n ? 'on' : '', onclick: () => { workoutSize = n; hub(); } }, `${n} questions`)),
          h('button.btn.primary.small', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); start('workout'); } }, 'Start'))),
      ...ORDER.filter((id) => id !== 'workout').map((id) => card(id, id === 'exam' ? `${MODULES.exam.size} questions` : null, () => (id === 'clues' ? startClues() : start(id)))),
      h('button.panel.mode-card', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); go('game', { mode: 'rush', playerIds: [pid], bossId: 'champion' }); } },
        sprite('boss_champion', 36), h('div.grow', {}, h('b', {}, 'Beat the Champion'), h('div.tiny.dim', {}, 'A boss duel against the reigning quiz-show champion. Rapid fire on everything.')), h('span.tag', {}, 'Boss')),
      h('div.row.gap-s', {}, h('button.btn.block', { type: 'button', onclick: () => insights() }, 'Insights'), h('button.btn.block', { type: 'button', onclick: () => library() }, 'Library')),
      h('p.tiny.dim', {}, 'Everything is saved on this device with this player. Academy scores are separate from mastery: a concept is only provisionally mastered after recalls spread over days.'));
  }

  /* ------------------------------------------------------------ plan */
  async function planScreen() {
    const p = await profile(); const m = metaOf(p);
    let planId = m.acad.plan.id; let custom = { ...m.acad.plan.custom };
    const paint = () => {
      const w = weightsFor({ id: planId, custom });
      view(screenHeader('Training plan', () => hub()),
        h('p.small.dim', {}, 'A plan sets how much each subject counts in your sessions. Every subject still appears; change any weight to make the plan your own.'),
        h('div.col.gap-s', {}, PLAN_IDS.map((id) => h('button.panel.mode-card', { type: 'button', 'aria-pressed': String(planId === id), class: planId === id ? 'on' : '', onclick: () => { planId = id; custom = {}; paint(); } }, h('div.grow', {}, h('b', {}, PLANS[id].name), h('div.tiny.dim', {}, PLANS[id].blurb)), planId === id ? h('span.tag.green', {}, 'Selected') : null))),
        h('div.panel.tight', {}, h('b', {}, 'Subject weights'), h('p.tiny.dim', {}, '0 leaves a subject out, 1 is normal, 3 is three times as often.'),
          SUBJECTS.map((s) => h('label.weight', {}, h('span.small', {}, s.label), h('input', { type: 'range', min: '0', max: '3', step: '0.5', value: String(w[s.id]), 'aria-label': s.label, onchange: (e) => { custom = { ...custom, [s.id]: Number(e.target.value) }; paint(); } }), h('span.tag', {}, String(w[s.id]))))),
        h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: async () => { await app.repo.setAcademyPrefs(pid, { plan: { id: planId, custom } }); sfx.tap(); hub(); } }, 'Save plan')));
    };
    paint();
  }

  /* ------------------------------------------------------------ a multiple-choice session */
  async function start(mode) {
    if (busy) return; busy = true;
    try {
      const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = p.language ?? 'en';
      const seed = `${pid}:${now}`;
      const { questions, notice, timer } = buildAcademy(mode, app.ctx, m.learn, m.acad, { now, seed, size: mode === 'workout' ? workoutSize : null });
      if (!questions.length) { busy = false; view(screenHeader(MODULES[mode].name, () => hub()), h('div.panel.inset', {}, h('p', {}, notice ?? 'Nothing to ask yet.')), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')); return; }
      scene.set(SCENE[mode], 0.5, { step: questions.length });
      const strict = mode === 'rapid' || mode === 'exam'; // no hints, no second chance
      const run = startPractice({ questions, ctx: app.ctx, hearts: null, allowHints: !strict, allowRetry: !strict, seed });
      const timed = Boolean(MODULES[mode].timer && m.acad.timer);
      busy = false;
      await playRun({
        app, view, scene, run, lang, player: p, localize, learnItems: m.learn.items, color: '#f2c14e',
        timer: timed ? (it) => timer[it.level] ?? 15 : null,
        label: (it, r) => `${MODULES[mode].name} · ${Math.min(r.queue.length, r.idx + 1)} of ${r.queue.length}${mode === 'exam' ? '' : ` · ${SUBJECT[subjectOf(app.ctx.byId.get(it.qid))]?.label ?? ''}`}`,
        onExit: () => hub(),
        onEnd: (done) => finish(mode, done, p, m, timed, timer),
      });
    } finally { busy = false; }
  }

  const weekKey = (now) => { const d = Math.floor((now + offsetMin() * 60_000) / DAY); return Math.floor((d + 3) / 7); };

  async function finish(mode, run, p, before, timed, limits, extra = {}) {
    const now = Date.now(); const day = dayKey(now, offsetMin());
    const entries = extra.entries ?? entriesFromRun(run.answers, app.ctx, before.learn.items, { mode, now, timed, limits });
    const right = entries.filter((e) => e.ok).length;
    const score = extra.score ?? (mode === 'rapid' ? rapidScore(entries) : right);
    const ms = entries.reduce((s, e) => s + (e.ms ?? 0), 0) || null;
    const prevExam = before.acad.sessions.filter((s) => s.mode === 'exam').at(-1) ?? null;
    const bestRapid = Math.max(0, ...before.acad.sessions.filter((s) => s.mode === 'rapid').map((s) => s.score));
    const today = before.acad.sessions.filter((s) => dayKey(s.t, offsetMin()) === day).length;
    const res = await app.repo.recordAcademy(pid, { answers: run.answers, entries, session: { mode, n: entries.length, right, score, ms, timed }, now, offsetMin: offsetMin() });
    // XP rewards the first three sessions of a day; after that, practice is free but pays nothing (no grinding).
    const xp = await app.repo.addXp(pid, `acad-${mode}-${now}`, today < 3 ? entries.length * 2 + 4 : 0, 0);
    let pack = null;
    if (mode === 'workout' && entries.length >= 5 && await app.repo.addPacks(pid, [{ id: `acad-${pid}-${day}`, type: 'bronze', from: "Champion's Academy" }])) pack = 'bronze';
    if (mode === 'exam' && entries.length >= 15 && right / entries.length >= 0.5 && await app.repo.addPacks(pid, [{ id: `acad-exam-${pid}-${weekKey(now)}`, type: 'silver', from: 'Champion Examination' }])) pack = 'silver';
    sfx.win(); haptic('big'); confetti({ count: res.unlocked.length ? 70 : 30 });
    const nd = nextDue(res.learn.items, now);
    const report = mode === 'exam' ? examReport(entries, prevExam) : null;
    view(screenHeader(`${MODULES[mode].name} done`, () => hub()),
      h('div.panel.center', {}, h('div.big-score', {}, `${right}/${entries.length}`),
        mode === 'rapid' ? h('p.small', {}, `Rapid Fire score: ${score}${score > bestRapid ? (bestRapid ? ' · a new best!' : '') : ` · best ${bestRapid}`}`) : null,
        h('p.small', {}, `${entries.filter((e) => e.ok && e.hints === 0).length} recalled without help`),
        xp.gained ? h('p', {}, h('b.amber', {}, `+${xp.gained} XP`)) : h('p.tiny.dim', {}, 'No XP after three sessions today: come back tomorrow.'),
        pack ? h('p.good', {}, `A ${PACKS[pack].name} is waiting in your Inventory. Once per ${pack === 'silver' ? 'week' : 'day'}.`) : null,
        h('p.tiny.dim', {}, 'This score is a game result. Mastery is decided by your memory schedule, over days.')),
      res.unlocked.length ? h('div.panel.tight', {}, h('b', {}, 'Achievement'), res.unlocked.map((a) => h('p.small', {}, h('b.amber', {}, a.name), ` ${a.text} `, h('span.tag', {}, `+${a.dust} dust`)))) : null,
      report ? examPanel(report) : null,
      extra.panel ?? null,
      learningSummary(run, res.learn, now), rememberPanel(app, run),
      h('div.panel.tight', {}, h('b', {}, 'Why come back'), h('p.small', {}, nd ? `Your next review is due ${whenText(nd, now)}. Reviewing at the right moment is what makes it stick.` : 'Train again tomorrow to start building your schedule.')),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => (mode === 'clues' ? startClues() : start(mode)) }, 'Again'), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')));
  }

  function examPanel(r) {
    return h('div.panel.tight', {}, h('b', {}, 'Examination report'),
      h('p.small', {}, `Accuracy ${r.pct}% (${r.right} of ${r.n})${r.vsPrevious ? ` · ${r.vsPrevious.delta >= 0 ? '+' : ''}${r.vsPrevious.delta} points against your last examination` : ''}.`),
      h('p.small', {}, r.medianMs != null ? `Median time ${(r.medianMs / 1000).toFixed(1)} s${r.late ? ` · ${r.late} over the suggested time` : ''}.` : 'No timing recorded.'),
      h('p.small', {}, r.delayed.n ? `Delayed retention: ${r.delayed.right} of ${r.delayed.n} right on concepts last asked at least a day ago.` : 'Delayed retention: nothing here was last asked a day or more ago yet.'),
      h('p.small', {}, r.transfer.n ? `Transfer: ${r.transfer.right} of ${r.transfer.n} right in a formulation you had not seen for a known concept.` : 'Transfer: no known concept came in a new formulation this time.'),
      h('p.small', {}, `Confidence: ${r.confidence.sureWrong} wrong of ${r.confidence.sure} you were sure about${r.confidence.guess ? `; ${r.confidence.guessRight} right of ${r.confidence.guess} guesses` : ''}.`),
      h('div.col.gap-s', {}, r.bySubject.map((s) => h('div.acad-row', {}, h('span.tiny', {}, s.label), h('div.acad-bar', {}, h('i', { style: { width: `${s.pct}%` } })), h('span.tiny.dim', {}, `${s.right}/${s.n}`)))),
      r.advice.map((a) => h('p.tiny.amber', {}, a)));
  }

  /* ------------------------------------------------------------ progressive clues */
  async function startClues() {
    if (busy) return; busy = true;
    try {
      const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = langOf(p);
      const file = await Promise.resolve(app.readJson('data/academy/clues.json')).catch(() => null);
      const { items, notice } = buildClues(file, m.learn, m.acad, { now, seed: `${pid}:${now}` });
      if (!items.length) { busy = false; view(screenHeader(MODULES.clues.name, () => hub()), h('div.panel.inset', {}, h('p', {}, notice ?? 'Nothing to ask yet.')), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')); return; }
      scene.set(SCENE.clues, 0.5, { step: items.length });
      busy = false;
      const outcomes = []; let points = 0; let aborted = false;
      for (const [i, item] of items.entries()) {
        const res = await new Promise((resolve) => {
          let reveal = 0; const gone = new Set(); const wrongs = []; let done = null;
          const paint = () => {
            const answerEn = item.answer.en;
            view(
              h('div.topbar', {}, h('button.btn.icon.ghost.back', { type: 'button', 'aria-label': 'Leave', onclick: () => resolve('exit') }, '✕'), h('div.progress.grow', {}, h('i', { style: { width: `${(i / items.length) * 100}%`, background: '#f2c14e' } }))),
              h('div.row.between', {}, h('span.tiny.dim', {}, `Puzzle ${i + 1} of ${items.length} · ${SUBJECT[subjectOf({ category: item.category, subcategory: item.subcategory })]?.label ?? ''}`), h('span.tag', {}, done ? 'Solved' : `Worth ${CLUE_POINTS[reveal]} point${CLUE_POINTS[reveal] > 1 ? 's' : ''}`)),
              h('div.col.gap-s', {}, item.clues.slice(0, reveal + 1).map((c, k) => h('div.panel.tight.clue', { class: k === reveal && !done ? 'new' : '' }, h('span.tag', {}, `Clue ${k + 1}`), h('p', {}, pick(c, lang))))),
              h('div.choices.adv-choices', {}, item.order.map((k) => {
                const c = item.choices[k]; const right = c.en === answerEn;
                return h('button.choice', { type: 'button', disabled: Boolean(done) || gone.has(k), class: [done ? (right ? 'right' : gone.has(k) ? 'wrong' : '') : '', gone.has(k) ? 'elim' : ''].join(' '), onclick: () => {
                  if (right) { done = { solvedAt: reveal }; sfx.correct(); haptic('tap'); } else { gone.add(k); wrongs.push(c.en); sfx.wrong(); haptic('warn'); if (reveal < 3) reveal++; else done = { solvedAt: null }; }
                  paint();
                } }, c[lang] ?? c.en);
              })),
              !done && reveal < 3 ? h('button.btn.ghost.block', { type: 'button', onclick: () => { reveal++; sfx.tap(); paint(); } }, 'Another clue (worth less)') : null,
              done ? h('div.panel.tight.fb', { class: done.solvedAt != null ? 'good-note' : 'warn' },
                h('b', {}, done.solvedAt != null ? `${pick(item.answer, lang)}: ${cluePoints(done.solvedAt)} point${cluePoints(done.solvedAt) > 1 ? 's' : ''}` : `It was ${pick(item.answer, lang)}.`),
                item.expl ? h('p.small', {}, pick(item.expl, lang)) : null) : null,
              done ? h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => resolve({ ...done, wrongs }) }, i + 1 < items.length ? 'Next puzzle' : 'See result')) : null);
          };
          paint();
        });
        if (res === 'exit') { aborted = true; break; }
        outcomes.push({ item, outcome: clueOutcome(item, res) }); points += cluePoints(res.solvedAt);
      }
      setMood('calm');
      if (aborted && !outcomes.length) { hub(); return; }
      const answers = outcomes.map((o) => o.outcome);
      const before = metaOf(await profile());
      const now2 = Date.now();
      const entries = entriesFromRun(answers, app.ctx, before.learn.items, { mode: 'clues', now: now2 });
      const byClue = [1, 2, 3, 4].map((c) => answers.filter((a) => a.clue === c).length);
      const run = { answers, queue: answers.map((a) => ({ family: a.id, reason: 'practice' })), thrown: 0, deflected: 0 };
      await finish('clues', run, await profile(), before, false, null, {
        entries, score: points,
        panel: h('div.panel.tight', {}, h('b', {}, 'Where you got it'), h('p.small', {}, `${points} point${points === 1 ? '' : 's'} of ${answers.length * 4}.`),
          h('p.small', {}, byClue.map((n, k) => `clue ${k + 1}: ${n}`).join(' · ')), h('p.tiny.dim', {}, `Missed: ${answers.filter((a) => !a.correct).length}. Answering on the first clue counts as full recall in your schedule; later clues count like hints.`)),
      });
    } finally { busy = false; }
  }

  /* ------------------------------------------------------------ insights */
  async function insights() {
    const p = await profile(); const m = metaOf(p); const now = Date.now();
    const s = academyStats(m.acad, m.learn, app.ctx, now);
    const fam = (title, st, note) => h('div.stat-card', {}, h('b', {}, title), h('div.big-score', {}, st.n >= MIN_SAMPLE ? `${st.pct}%` : '—'), h('div.tiny.dim', {}, `${st.right} of ${st.n}`), h('div.tiny.dim', {}, st.n >= MIN_SAMPLE ? note : `Not enough data yet (needs ${MIN_SAMPLE}). ${note}`));
    const bar = (label, pct, sub) => h('div.acad-row', {}, h('span.tiny', {}, label), h('div.acad-bar', {}, h('i', { style: { width: `${pct ?? 0}%` } })), h('span.tiny.dim', {}, sub));
    view(screenHeader('Insights', () => hub()),
      s.total === 0 ? h('div.panel.inset.empty-state', {}, 'Nothing recorded yet. Play a module: every figure here is calculated from your stored answers.') : null,
      s.total ? h('div.stat-grid', {}, fam('Game results', s.game, s.game.note), fam('Independent recall', s.independent, s.independent.note), fam('Delayed retention', s.delayed, s.delayed.note), fam('Transfer', s.transfer, s.transfer.note)) : null,
      s.total ? h('p.tiny.dim', {}, 'These four are kept apart on purpose. There is no single mastery percentage: it would hide how little data there is.') : null,
      s.bySubject.length ? h('div.panel.tight', {}, h('b', {}, 'Accuracy by subject'), s.bySubject.map((x) => bar(x.label, x.pct, `${x.right}/${x.n}${x.n < MIN_SAMPLE ? ' · few' : ''}`))) : null,
      s.total ? h('div.panel.tight', {}, h('b', {}, 'Speed and time pressure'),
        h('p.small', {}, s.speed.medianMs != null ? `Median answer time ${(s.speed.medianMs / 1000).toFixed(1)} s.` : 'No timing recorded.'),
        h('p.small', {}, `With the timer: ${pctText(s.speed.timed)} · without: ${pctText(s.speed.untimed)}${s.speed.onTimePct != null ? ` · ${s.speed.onTimePct}% on time` : ''}.`), h('p.tiny.dim', {}, s.speed.note)) : null,
      s.total ? h('div.panel.tight', {}, h('b', {}, 'Confidence calibration'), s.calibration.map((c) => h('p.small', {}, `${{ sure: 'Sure', maybe: 'Not sure', guess: 'Guess' }[c.conf]}: ${c.n ? `${c.pct}% right (${c.n})` : 'no answers'}${c.n && c.n < MIN_SAMPLE ? ' · too few to judge' : ''}`)),
        h('p.tiny.dim', {}, 'Well calibrated means "sure" is right far more often than "guess".')) : null,
      s.total ? h('div.panel.tight', {}, h('b', {}, 'Hint dependence'), h('p.small', {}, `${s.hints.share ?? 0}% of your answers used a hint. Right with hints: ${pctText(s.hints.withHints)} · without: ${pctText(s.hints.without)}.`)) : null,
      s.weakest.length ? h('div.panel.tight', {}, h('b', {}, 'Weakest subcategories'), s.weakest.map((w) => h('p.small', {}, `${w.key.replace('/', ' › ').replace(/-/g, ' ')}: ${w.pct}% of ${w.n}`))) : null,
      s.improved.length ? h('div.panel.tight', {}, h('b', {}, 'Most improved'), s.improved.map((w) => h('p.small', {}, `${w.label}: ${w.from}% → ${w.to}%`))) : null,
      s.confused.length ? h('div.panel.tight', {}, h('b', {}, 'Often confused'), s.confused.map((c) => h('p.small', {}, c.question ? `${c.question} You keep picking: ${c.picked}` : `Concept ${c.id}: you keep picking ${c.picked}`))) : null,
      h('div.panel.tight', {}, h('b', {}, 'Your memory'), h('p.small', {}, `${s.due} due now · ${s.mastered} provisionally mastered · ${s.days} day${s.days === 1 ? '' : 's'} with Academy answers.`),
        s.exams.length ? h('p.small', {}, `Examinations: ${s.exams.map((e) => `${e.pct}%`).join(', ')}`) : null),
      h('div.panel.tight', {}, h('b', {}, 'Achievements'), ACHIEVEMENTS.map((a) => h('p.small', { class: m.acad.achv[a.id] ? '' : 'dim' }, `${m.acad.achv[a.id] ? '✔' : '○'} ${a.name}: ${a.text}`))),
      s.recent.length ? h('div.panel.tight', {}, h('b', {}, 'Recent activity'), s.recent.map((r) => h('p.tiny.dim', {}, `${new Date(r.t).toLocaleDateString()} · ${MODULES[r.mode]?.name ?? r.mode}: ${r.right}/${r.n}`))) : null);
  }

  /* ------------------------------------------------------------ library: timeline and connections */
  async function library(tab = 'timeline') {
    const p = await profile(); const lang = langOf(p);
    const [events, rel] = await Promise.all([Promise.resolve(app.readJson('data/academy/events.json')).catch(() => null), Promise.resolve(app.readJson('data/academy/relations.json')).catch(() => null)]);
    let relType = Object.keys(rel?.types ?? {})[0] ?? null;
    const paint = () => {
      const tabs = h('div.row.gap-s', {}, ['timeline', 'connections'].map((t) => h('button.chip', { type: 'button', 'aria-pressed': String(tab === t), class: tab === t ? 'on' : '', onclick: () => { tab = t; paint(); } }, t === 'timeline' ? 'Timeline' : 'Connections')));
      let body;
      if (tab === 'timeline') {
        const list = [...(events?.events ?? [])].sort((a, b) => a.year - b.year);
        body = list.length ? h('div.timeline', {}, list.map((e) => h('div.tl-row', {}, h('b.tl-year', {}, yearText(e.year)), h('div', {}, h('div.small', {}, pick(e.name, lang)), e.expl ? h('div.tiny.dim', {}, pick(e.expl, lang)) : null)))) : h('p.small.dim', {}, 'The timeline is not available.');
      } else {
        const facts = (rel?.facts ?? []).filter((f) => f.type === relType);
        body = h('div.col.gap-s', {}, h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, Object.keys(rel?.types ?? {}).map((t) => h('button.chip', { type: 'button', 'aria-pressed': String(t === relType), class: t === relType ? 'on' : '', onclick: () => { relType = t; paint(); } }, t.replace(/-/g, ' → ')))),
          facts.length ? h('table.comp', {}, h('tbody', {}, facts.map((f) => h('tr', {}, h('td', {}, lang === 'fr' && f.a_fr ? f.a_fr : f.a), h('td', {}, lang === 'fr' && f.b_fr ? f.b_fr : f.b), h('td.tiny.dim', {}, f.mnemonic ?? ''))))) : h('p.small.dim', {}, 'No connections here.'));
      }
      view(screenHeader('Library', () => hub()), tabs, body, h('p.tiny.dim', {}, 'Unreviewed drafts: dates and links come with no verified source yet.'));
    };
    paint();
  }

  await hub();
  return root;
}
