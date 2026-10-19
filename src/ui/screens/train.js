// Train: the learning modes. Daily Training, Focused Training, Weakness Hunter, Mastery Challenge and the Review Expedition.
// What is asked comes from the learning engine; the answers go back into the player's learning record on this device.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import '../art_icons.js';
import { go, goBack, setMood } from '../app.js';
import { screenHeader, avatar } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { confetti, haptic } from '../fx.js';
import { createScene } from '../scenes.js';
import { playRun, makeLocalizer } from '../practice.js';
import { createRig } from '../bossrig.js';
import { learningSummary, rememberPanel, offsetMin, whenText } from './adventure.js';
import { metaOf } from '../../storage/meta.js';
import { PACKS } from '../../engine/hexes.js';
import { summarize, dayKey, nextDue } from '../../engine/learning.js';
import { startPractice } from '../../engine/practice.js';
import { THEMES, THEME_IDS } from '../../engine/themes.js';
import { MODES, MIN_FOR, conceptsFor, buildTraining, buildExpedition, EXPEDITION_HEARTS } from '../../engine/train.js';

const MODE_SCENE = { daily: 'bench', focus: 'greenhouse', weak: 'fearlab', mastery: 'observatory', expedition: 'reactor' };
const MODE_ICON = { daily: 'ic_sun', focus: 'ic_target', weak: 'ic_magnifier', mastery: 'ic_trophy', expedition: 'ic_flag' };
const STATE_LABEL = { new: 'New', learning: 'Learning', relearning: 'Relearning', review: 'Review', mastered: 'Provisionally mastered' };

export async function trainScreen(app, params = {}) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  const localize = makeLocalizer(app);
  const scene = createScene();
  const content = h('div.adv-content');
  const root = h('div.screen.adventure', {}, scene.el, content);
  const view = (...nodes) => mount(content, ...nodes);
  const profile = async () => app.repo.getProfile(pid);
  let busy = false;

  const playerBar = () => profiles.length > 1
    ? h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, profiles.map((p) => h('button.btn.icon.ghost', { type: 'button', 'aria-pressed': String(p.id === pid), class: p.id === pid ? 'on' : '', 'aria-label': p.name, onclick: () => { pid = p.id; hub(); } }, avatar(p, 32))))
    : null;

  /* ------------------------------------------------------------ hub */
  async function hub() {
    scene.el.classList.remove('arena'); scene.set('bench', 0.3); setMood('calm');
    if (!profiles.find((p) => p.id === pid)) {
      view(screenHeader('Train', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start training.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players'));
      return;
    }
    const p = await profile(); const m = metaOf(p);
    const now = Date.now();
    const all = conceptsFor(app.ctx, { now });
    const sum = summarize(m.learn.items, now, all);
    const today = m.learn.daily[dayKey(now, offsetMin())] ?? { answered: 0, right: 0, hinted: 0 };
    const mastery = m.learn.log.filter((l) => l.kind === 'mastery').slice(-3).reverse();
    const bar = h('div.state-bar', { role: 'img', 'aria-label': Object.entries(sum.byState).map(([k, v]) => `${STATE_LABEL[k]} ${v}`).join(', ') },
      ['mastered', 'review', 'relearning', 'learning', 'new'].map((k) => h('i', { class: `st-${k}`, style: { flex: String(sum.byState[k]) }, title: `${STATE_LABEL[k]}: ${sum.byState[k]}` })));
    const card = (id, extra, onclick, disabled = false) => h('button.panel.mode-card', { type: 'button', disabled, onclick: () => { unlockAudio(); sfx.tap(); onclick(); } },
      sprite(MODE_ICON[id], 36), h('div.grow', {}, h('b', {}, MODES[id].name), h('div.tiny.dim', {}, MODES[id].blurb)), extra ? h('span.tag', {}, extra) : null);
    view(
      screenHeader('Train', () => goBack('menu')),
      playerBar(),
      h('div.panel.tight', {},
        h('div.row.between', {}, h('b', {}, 'Your memory'), h('span.tiny.dim', {}, `${sum.seen} of ${sum.total} concepts started`)),
        bar,
        h('div.tiny.dim', {}, `${sum.byState.mastered} provisionally mastered · ${sum.byState.review} in review · ${sum.byState.learning + sum.byState.relearning} being learned · ${sum.byState.new} new`),
        h('div.row.between', { style: { marginTop: '6px' } }, h('span.small', {}, sum.due ? h('b.amber', {}, `${sum.due} due now`) : 'Nothing due right now'), h('span.tiny.dim', {}, today.answered ? `Today: ${today.right}/${today.answered} right${today.hinted ? ` · ${today.hinted} with hints` : ''}` : 'Nothing trained today'))),
      m.learn.streak.count ? h('p.tiny.amber', {}, `${m.learn.streak.count} day${m.learn.streak.count > 1 ? 's' : ''} in a row${m.learn.streak.last === dayKey(now, offsetMin()) ? '' : '. Train today to keep it.'}`) : null,
      card('daily', sum.due ? `${sum.due} due` : null, () => start('daily')),
      card('focus', null, () => focusPicker()),
      card('weak', sum.fragile ? `${sum.fragile}` : null, () => start('weak')),
      card('mastery', null, () => start('mastery')),
      card('expedition', null, () => expedition()),
      mastery.length ? h('div.panel.tight', {}, h('b', {}, 'Mastery Challenge history'), mastery.map((l) => h('div.tiny.dim', {}, `${new Date(l.t).toLocaleDateString()}: ${l.right} of ${l.n} right`)), h('p.tiny.dim', {}, 'Provisional: a concept only counts as mastered after several recalls spread over days, in more than one formulation. One good session never certifies it.')) : null,
      h('p.tiny.dim', {}, 'Your learning record is saved on this device with this player. It is not synced anywhere.'));
  }

  function focusPicker() {
    const now = Date.now();
    const themes = THEME_IDS.map((id) => ({ id, n: conceptsFor(app.ctx, { category: id, now }).length })).filter((t) => t.n >= 5);
    view(screenHeader('Focused Training', () => hub()),
      h('p.small.dim', {}, 'Pick a subject. Questions that are due or shaky come first, then new ones.'),
      h('div.col.gap-s', {}, themes.map((t) => h('button.panel.mode-card', { type: 'button', onclick: () => { sfx.tap(); subPicker(t.id); } }, sprite(THEMES[t.id].sprite, 32), h('div.grow', {}, h('b', {}, THEMES[t.id].label)), h('span.tag', {}, `${t.n} concepts`)))));
  }
  function subPicker(theme) {
    const now = Date.now();
    const subs = new Map();
    for (const c of conceptsFor(app.ctx, { category: theme, now })) subs.set(c.subcategory, (subs.get(c.subcategory) ?? 0) + 1);
    const list = [...subs].filter(([k, n]) => k && n >= 3).sort((a, b) => b[1] - a[1]);
    view(screenHeader(THEMES[theme].label, () => focusPicker()),
      h('button.btn.primary.block', { type: 'button', onclick: () => start('focus', { category: theme }) }, 'Everything in this subject'),
      list.length ? h('p.small.dim', {}, 'Or one part of it:') : null,
      h('div.col.gap-s', {}, list.map(([k, n]) => h('button.panel.mode-card', { type: 'button', onclick: () => start('focus', { category: theme, subcategory: k }) }, h('div.grow', {}, h('b', {}, k.replace(/-/g, ' '))), h('span.tag', {}, `${n}`)))));
  }

  /* ------------------------------------------------------------ one session */
  async function start(mode, opts = {}) {
    if (busy) return; busy = true;
    try {
      const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = p.language ?? 'en';
      const seed = `${pid}:${now}`;
      const { questions, notice } = buildTraining(mode, app.ctx, m.learn, { now, seed, ...opts });
      if (!questions.length) { busy = false; view(screenHeader(MODES[mode].name, () => hub()), h('div.panel.inset', {}, h('p', {}, notice ?? 'Nothing to ask yet.')), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')); return; }
      scene.set(MODE_SCENE[mode], 0.5, { step: questions.length });
      const run = startPractice({ questions, ctx: app.ctx, hearts: null, allowHints: mode !== 'mastery', allowRetry: mode !== 'mastery', seed });
      busy = false;
      await playRun({
        app, view, scene, run, lang, player: p, localize, learnItems: m.learn.items, color: '#6fd1ff',
        label: (it, r) => `${MODES[mode].name} · ${Math.min(r.queue.length, r.idx + 1)} of ${r.queue.length}`,
        onExit: () => hub(),
        onEnd: (done) => finishSession(mode, done, p),
      });
    } finally { busy = false; }
  }

  async function finishSession(mode, run, p) {
    const now = Date.now(); const day = dayKey(now, offsetMin());
    const learn = await app.repo.recordLearning(pid, run.answers, { now, kind: mode, offsetMin: offsetMin() });
    const xp = await app.repo.addXp(pid, `train-${mode}-${now}`, run.answers.length * 2 + 4, 0);
    let pack = null;
    if (mode === 'daily' && run.answers.length >= 5 && await app.repo.addPacks(pid, [{ id: `train-${pid}-${day}`, type: 'bronze', from: 'Daily Training' }])) pack = 'bronze';
    sfx.win(); haptic('big'); confetti({ count: 30 });
    const nd = nextDue(learn.items, now);
    const total = run.answers.length; const right = run.answers.filter((x) => x.correct).length; const indep = run.answers.filter((x) => x.correct && !x.hints).length;
    view(screenHeader(`${MODES[mode].name} done`, () => hub()),
      h('div.panel.center', {}, h('div.big-score', {}, `${right}/${total}`), h('p.small', {}, `${indep} recalled without help`),
        h('p', {}, h('b.amber', {}, `+${xp.gained} XP`)),
        pack ? h('p.good', {}, `A ${PACKS[pack].name} is waiting in your Inventory. One per day.`) : null,
        mode === 'mastery' ? h('p.tiny.dim', {}, 'This is how you did today. It does not certify mastery: that needs recalls spread over days.') : null),
      learningSummary(run, learn, now), rememberPanel(app, run),
      h('div.panel.tight', {}, h('b', {}, 'Why come back'), h('p.small', {}, nd ? `Your next review is due ${whenText(nd, now)}. Reviewing at the right moment is what makes it stick.` : 'Train again tomorrow to start building your schedule.'),
        learn.streak.count ? h('p.tiny.amber', {}, `Streak: ${learn.streak.count} day${learn.streak.count > 1 ? 's' : ''}. Train tomorrow to make it ${learn.streak.count + 1}.`) : null),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => start(mode) }, 'Train again'), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')));
  }

  /* ------------------------------------------------------------ the expedition */
  async function expedition() {
    if (busy) return; busy = true;
    try {
      const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = p.language ?? 'en';
      const seed = `${pid}:${now}`;
      const { encounters, notice } = buildExpedition(app.ctx, m.learn, { now, seed });
      if (!encounters.length) { busy = false; view(screenHeader('Review Expedition', () => hub()), h('div.panel.inset', {}, h('p', {}, notice)), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')); return; }
      let hearts = EXPEDITION_HEARTS; const answers = []; let lost = false; let aborted = false; let thrown = 0; let deflected = 0;
      for (const [i, enc] of encounters.entries()) {
        const isBoss = enc.kind === 'boss';
        scene.set(enc.scene, 0.3 + 0.2 * i, { arena: isBoss, step: i + 1 });
        setMood(isBoss ? 'tense' : 'calm');
        await new Promise((resolve) => {
          const rig = isBoss ? createRig(enc.boss.sprite, 128, enc.boss.name) : null;
          view(screenHeader(`Encounter ${i + 1} of ${encounters.length}`, () => resolve('exit')),
            h('div.panel.boss-intro', {}, rig ? rig.el : sprite(MODE_ICON.expedition, 64), h('h2', {}, enc.title), h('p.small', {}, enc.blurb),
              h('p.tiny.dim', {}, `${enc.questions.length} questions · ${hearts} heart${hearts === 1 ? '' : 's'} left${isBoss ? ' · no hints · hex cards will be thrown' : ''}`)),
            h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); resolve('go'); } }, isBoss ? 'Face the boss' : 'Go')));
        }).then((r) => { if (r === 'exit') aborted = true; });
        if (aborted) break;
        const run = startPractice({ questions: enc.questions, ctx: app.ctx, hearts, allowHints: !isBoss, allowRetry: false, hexes: enc.hexes ?? [], seed: `${seed}:${i}` });
        const done = await new Promise((resolve) => {
          playRun({
            app, view, scene, run, lang, player: p, localize, learnItems: m.learn.items, color: '#6fd1ff', boss: enc.boss ?? null, event: false,
            label: (it, r) => `${enc.title} · ${Math.min(r.queue.length, r.idx + 1)} of ${r.queue.length}`,
            onExit: () => resolve(null), onEnd: resolve,
          });
        });
        if (!done) { aborted = true; break; }
        answers.push(...done.answers); hearts = done.hearts; thrown += done.thrown; deflected += done.deflected;
        if (done.status === 'lost') { lost = true; break; }
      }
      setMood('calm');
      if (!answers.length) { hub(); return; }
      busy = false;
      const now2 = Date.now(); const day = dayKey(now2, offsetMin());
      const learn = await app.repo.recordLearning(pid, answers, { now: now2, kind: 'expedition', offsetMin: offsetMin() });
      const won = !lost && !aborted;
      const xp = await app.repo.addXp(pid, `exp-${now2}`, answers.length * 2 + (won ? 30 : 6), 0);
      let pack = null;
      if (won && await app.repo.addPacks(pid, [{ id: `exp-${pid}-${day}`, type: 'silver', from: 'Review Expedition' }])) pack = 'silver';
      if (won) { sfx.win(); haptic('big'); confetti({ count: 70 }); } else sfx.wrong();
      const fake = { answers, queue: encounters.flatMap((e) => e.questions).slice(0, answers.length).map((q) => ({ ...q })), thrown, deflected };
      view(screenHeader(won ? 'Expedition complete' : lost ? 'Expedition over' : 'Expedition left early', () => hub()),
        h('div.panel.center', { class: won ? '' : 'warn' }, h('div.big-stars', {}, won ? '★'.repeat(Math.max(1, hearts)) + '☆'.repeat(3 - Math.max(1, hearts)) : ''), h('p.small', {}, `${answers.filter((a) => a.correct).length} of ${answers.length} right · ${hearts} heart${hearts === 1 ? '' : 's'} left`),
          h('p', {}, h('b.amber', {}, `+${xp.gained} XP`)), pack ? h('p.good', {}, `A ${PACKS[pack].name} is waiting in your Inventory. One per day.`) : null,
          thrown ? h('p.tiny.dim', {}, `Hex cards: ${deflected} deflected, ${thrown - deflected} landed.`) : null),
        learningSummary(fake, learn, now2), rememberPanel(app, fake),
        h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => expedition() }, 'Another expedition'), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back')));
    } finally { busy = false; }
  }

  void MIN_FOR;
  await hub();
  return root;
}
