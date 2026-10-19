// Adventure: a 100-step path through one theme (Science, for now). Questions only: the learning engine decides what you
// are asked (reviews that are due, then new concepts), each chapter has its own animated backdrop, lab accidents throw a
// few hex cards at you and every tenth step is a boss that throws more and more.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack, setMood } from '../app.js';
import { screenHeader, avatar } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { confetti, haptic, stamp } from '../fx.js';
import { createScene } from '../scenes.js';
import { playRun, makeLocalizer, LEVEL_NAME } from '../practice.js';
import { createRig } from '../bossrig.js';
import { metaOf } from '../../storage/meta.js';
import { PACKS } from '../../engine/hexes.js';
import { nextDue, summarize, DAY } from '../../engine/learning.js';
import {
  ADVENTURES, OPEN_ADVENTURE_IDS, STEPS, BOSS_EVERY, stepKind, roadsAt, chapterOf, chapterInfo, phaseOf, buildLevel, startRun,
  frontier, isUnlocked, totals, stakeBonusOf,
} from '../../engine/adventure.js';

/** "in 10 minutes", "tomorrow", "in 3 days". */
export function whenText(ms, now = Date.now()) {
  const d = ms - now;
  if (d <= 60_000) return 'now';
  if (d < 3_600_000) return `in ${Math.round(d / 60_000)} minutes`;
  if (d < DAY) return `in ${Math.round(d / 3_600_000)} hours`;
  const days = Math.round(d / DAY);
  return days <= 1 ? 'tomorrow' : `in ${days} days`;
}
export const offsetMin = () => -new Date().getTimezoneOffset();

/** The "what you trained" panel shown after a run (shared with the training modes). */
export function learningSummary(run, learn, now) {
  const indep = run.answers.filter((x) => x.correct && !x.hints).length;
  const helped = run.answers.filter((x) => x.correct && x.hints).length;
  const fresh = run.queue.filter((x) => x.reason === 'new').length;
  const reviews = run.queue.filter((x) => ['due', 'relearn', 'weak', 'maintain'].includes(x.reason)).length;
  const mine = run.answers.map((x) => learn.items[x.id]?.due).filter(Boolean);
  const soonest = mine.length ? Math.min(...mine) : nextDue(learn.items, now);
  return h('div.panel.tight.learn-sum', {},
    h('b', {}, 'What you trained'),
    h('p.small', {}, `${indep} recalled on your own${helped ? `, ${helped} with a hint` : ''}${fresh ? ` · ${fresh} new` : ''}${reviews ? ` · ${reviews} review${reviews > 1 ? 's' : ''}` : ''}.`),
    soonest ? h('p.small', {}, `The first of these comes back ${whenText(soonest, now)}.`) : null,
    learn.streak.count > 1 ? h('p.tiny.amber', {}, `${learn.streak.count} days in a row.`) : null);
}

/** What was missed, with the answer and the explanation. */
export function rememberPanel(app, run) {
  const missed = run.answers.filter((x) => !x.correct);
  if (!missed.length) return null;
  return h('div.panel.tight', {}, h('b', {}, 'Worth remembering'),
    [...new Map(missed.map((x) => [x.id, x])).values()].map((x) => {
      const q = app.ctx.byId.get(x.qid);
      return h('div.remember', {}, h('div.small', {}, q.question), h('div.small', {}, h('b', {}, q.choices[q.answer])), q.explanation ? h('div.tiny.dim', {}, q.explanation) : null);
    }));
}

export async function adventureScreen(app, params = {}) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  let advId = OPEN_ADVENTURE_IDS.includes(params.adv) ? params.adv : (OPEN_ADVENTURE_IDS.length > 1 ? null : OPEN_ADVENTURE_IDS[0]);
  let chapter = params.chapter ?? null;
  let lastFamilies = [];
  const attempts = {};
  const localize = makeLocalizer(app);
  const scene = createScene();
  const content = h('div.adv-content');
  const root = h('div.screen.adventure', {}, scene.el, content);
  const view = (...nodes) => mount(content, ...nodes);
  const profile = async () => app.repo.getProfile(pid);

  const playerBar = () => profiles.length > 1
    ? h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, profiles.map((p) => h('button.btn.icon.ghost', { type: 'button', 'aria-pressed': String(p.id === pid), class: p.id === pid ? 'on' : '', 'aria-label': p.name, onclick: () => { pid = p.id; map(); } }, avatar(p, 32))))
    : null;

  /* ------------------------------------------------------------ choose an adventure */
  async function choose() {
    scene.el.classList.remove('arena'); scene.set('bench', 0.3);
    const p = profiles.find((x) => x.id === pid) ? await profile() : null;
    const m = p ? metaOf(p) : null;
    view(screenHeader('Adventure', () => goBack('menu')),
      !p ? h('div.panel.inset.empty-state', {}, 'Create a player to start an adventure.') : null,
      p ? playerBar() : null,
      ...OPEN_ADVENTURE_IDS.map((id) => {
        const a = ADVENTURES[id]; const t = totals(m?.adv[id] ?? { done: {}, road: {} });
        return h('button.panel.mode-card', { type: 'button', style: { '--adv': a.color }, onclick: () => { unlockAudio(); sfx.tap(); advId = id; chapter = null; map(); } },
          sprite(a.bossSprite, 40), h('div.grow', {}, h('b', {}, `${a.name} · ${a.title}`), h('div.tiny.dim', {}, a.blurb)), h('span.tag', {}, p ? `${t.steps}/${STEPS}` : '100 steps'));
      }),
      !p ? h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players') : null);
  }

  /* ------------------------------------------------------------ map */
  async function map() {
    if (!advId) return choose();
    scene.el.classList.remove('arena');
    if (!profiles.find((p) => p.id === pid)) {
      scene.set('bench', 0.3);
      view(screenHeader('Adventure', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start an adventure.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players'));
      return;
    }
    const a = ADVENTURES[advId];
    const p = await profile();
    const m = metaOf(p);
    const prog = m.adv[advId];
    const front = frontier(prog);
    if (chapter == null) chapter = Math.min(10, chapterOf(Math.min(front, STEPS)));
    const t = totals(prog);
    const lo = (chapter - 1) * BOSS_EVERY + 1;
    const info = chapterInfo(advId, lo);
    scene.set(info.scene, 0.35 + (front >= lo ? 0.3 * phaseOf(Math.min(front, chapter * BOSS_EVERY)) : 0), { step: chapter * BOSS_EVERY });
    const sum = summarize(m.learn.items, Date.now());

    const tabs = h('div.tabs', {}, Array.from({ length: 10 }, (_, i) => {
      const c = i + 1;
      return h('button.tab', { type: 'button', 'aria-pressed': String(c === chapter), class: (c - 1) * BOSS_EVERY + 1 > front ? 'locked' : '', onclick: () => { chapter = c; map(); } }, c === 10 ? '★ 10' : String(c));
    }));

    const nodeBtn = (step, road, label) => {
      const taken = !prog.road[step] || prog.road[step] === road;
      const done = taken ? prog.done[step] ?? 0 : 0;
      const open = isUnlocked(prog, step);
      const kind = stepKind(step);
      return h('button.adv-node', {
        type: 'button', disabled: !open, class: `${kind} ${done ? 'done' : ''} ${step === front ? 'now' : ''}`, style: { '--adv': a.color },
        'aria-label': `Step ${step}${label ? `, ${label}` : ''}${kind === 'event' ? `, ${(a.eventName ?? 'Lab accident').toLowerCase()}` : ''}${done ? `, ${done} stars` : ''}`,
        onclick: () => { unlockAudio(); sfx.tap(); begin(step, road); },
      }, kind === 'boss' ? sprite(step === STEPS ? 'boss_house' : a.bossSprite, 44) : h('span.num', {}, String(step)),
        kind === 'event' ? h('span.badge', {}, sprite('goo', 16)) : null,
        step === front && open ? h('span.token', {}, avatar(p, 30)) : null,
        h('span.stars', {}, done ? '★'.repeat(done) + '☆'.repeat(3 - done) : (open ? (label ?? ' ') : '🔒')));
    };

    const rows = [];
    for (let step = lo; step < lo + BOSS_EVERY; step++) {
      const roads = roadsAt(step);
      rows.push(h('div.adv-row', { class: `${roads.length > 1 ? 'fork' : ''} z${step % 2}` },
        roads.length > 1 ? h('div.tiny.dim.center', {}, 'The road forks') : null,
        h('div.adv-nodes', {}, roads.map((r) => h('div.adv-slot', { class: prog.road[step] && prog.road[step] !== r.id ? 'other' : '' },
          nodeBtn(step, r.id, roads.length > 1 ? r.label : stepKind(step) === 'boss' ? a.bossNames[chapterOf(step) - 1] : null),
          roads.length > 1 ? h('div.tiny.dim', {}, r.hint) : stepKind(step) === 'event' ? h('div.tiny.dim', {}, a.eventName ?? 'Lab accident') : null)))));
    }

    view(
      screenHeader(a.name, () => (OPEN_ADVENTURE_IDS.length > 1 ? (advId = null, chapter = null, choose()) : goBack('menu'))),
      h('div.row.between', {}, h('span.small.dim', {}, `${a.title} · ${t.steps}/${STEPS} steps · ★ ${t.stars}`), playerBar()),
      h('div.chapter-banner', {}, h('span.tiny.dim', {}, `Chapter ${chapter}${info.subject ? ` · ${info.subject}` : ''}`), h('b', {}, info.name),
        info.aspects ? h('span.tiny.dim', {}, info.aspects.map((x) => x.name).join(' · ')) : null),
      tabs,
      sum.due > 0 ? h('button.panel.tight.due-chip', { type: 'button', onclick: () => go('train', { playerId: pid, mode: 'daily' }) }, h('b', {}, `${sum.due} review${sum.due > 1 ? 's' : ''} due`), h('span.tiny.dim', {}, 'They come back inside your steps. Or train them now.')) : null,
      h('div.adv-path', { style: { '--adv': a.color } }, rows),
      h('p.tiny.dim.center', {}, OPEN_ADVENTURE_IDS.length > 1 ? 'More adventures are on the way.' : 'More adventures are on the way. Science is the first.'));
  }

  /* ------------------------------------------------------------ a step */
  async function begin(step, road) {
    const p = await profile();
    const m = metaOf(p);
    const lang = p.language ?? 'en';
    const attempt = attempts[`${step}:${road}`] ?? 0;
    const level = buildLevel(advId, step, road, app.ctx, { learn: m.learn, now: Date.now(), attempt, exclude: lastFamilies });
    const a = ADVENTURES[advId];
    scene.set(chapterInfo(advId, step).scene, level.phase, { arena: level.kind === 'boss', step });
    if (level.kind === 'boss') {
      setMood('tense');
      const rig = createRig(level.boss.sprite, 128, level.boss.name);
      view(screenHeader(`Step ${step}`, () => { setMood('calm'); map(); }),
        h('div.panel.boss-intro', { style: { '--adv': a.color } }, rig.el, h('h2', {}, level.boss.name),
          h('p.small', {}, `Seven ${LEVEL_NAME[level.target].toLowerCase()} questions on ${chapterInfo(advId, level.step).subject?.toLowerCase() ?? 'everything so far'}, three hearts, no hints and no second chances. ${level.boss.name} throws hex cards at you as the fight goes on. Tap a card in the air to deflect it, or wipe the mess away when it lands.`)),
        h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { sfx.boss?.(); play(level, p, m, lang); } }, 'Face the boss')));
      return;
    }
    setMood('calm');
    play(level, p, m, lang);
  }

  async function play(level, p, m, lang) {
    const run = startRun(level, app.ctx);
    await playRun({
      app, view, scene, run, lang, color: ADVENTURES[advId].color, player: p, localize, learnItems: m.learn.items,
      boss: level.boss, event: level.kind === 'event', eventName: ADVENTURES[advId].eventName,
      label: (it, r) => (level.kind === 'boss' ? `${level.boss.name} · ${it.retry ? 'another angle' : `${Math.min(level.questions.length, r.idx + 1)} of ${level.questions.length}`}` : `Step ${level.step} · ${level.aspect ?? chapterInfo(advId, level.step).name}${it.retry ? ' · another angle' : ''}`),
      onExit: () => { setMood('calm'); map(); },
      onEnd: (done) => finish(level, done),
    });
  }

  /* ------------------------------------------------------------ result */
  async function finish(level, run) {
    setMood('calm');
    const now = Date.now();
    lastFamilies = run.queue.map((x) => x.family);
    const learn = await app.repo.recordLearning(pid, run.answers, { now, kind: 'adventure', offsetMin: offsetMin() });
    const summary = learningSummary(run, learn, now);
    const remember = rememberPanel(app, run);
    const deflectLine = run.thrown > 0 ? h('p.tiny.dim', {}, `Hex cards: ${run.deflected} deflected, ${run.thrown - run.deflected} landed.`) : null;

    if (run.status === 'lost') {
      sfx.wrong();
      attempts[`${level.step}:${level.road}`] = (attempts[`${level.step}:${level.road}`] ?? 0) + 1;
      view(screenHeader('Out of hearts', () => map()),
        h('div.panel.warn', {}, sprite('bulb_off', 48), h('h2', {}, level.kind === 'boss' ? `${level.boss.name} wins this time` : 'No hearts left'),
          h('p.small', {}, 'What you missed is already scheduled to come back. The next try starts with it, asked another way.')),
        remember, summary, deflectLine,
        h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => begin(level.step, level.road) }, 'Try again'), h('button.btn.block', { type: 'button', onclick: () => map() }, 'Back to the path')));
      return;
    }
    const res = await app.repo.completeAdventureStep(pid, advId, level.step, level.road, run.stars, stakeBonusOf(run));
    sfx.win(); haptic('big'); confetti({ count: level.kind === 'boss' ? 90 : 45 });
    if (level.kind === 'boss') { sfx.jackpot?.(); stamp('BOSS DOWN!', { kind: 'jackpot' }); }
    const nextStep = level.step < STEPS ? level.step + 1 : null;
    view(screenHeader(`Step ${level.step} complete`, () => map()),
      h('div.panel.center', {}, h('div.big-stars', {}, '★'.repeat(run.stars) + '☆'.repeat(3 - run.stars)),
        h('p.small', {}, `${run.right} right, ${run.wrong} wrong · ${run.hearts} heart${run.hearts === 1 ? '' : 's'} left`),
        res.first ? h('p', {}, h('b.amber', {}, `+${res.xp.gained} XP`), stakeBonusOf(run) > 0 ? ` (incl. +${stakeBonusOf(run)} for bold stakes)` : '', res.xp.after > res.xp.before ? ` · level ${res.xp.after}!` : '') : h('p.small.dim', {}, 'Already cleared: XP is paid once, stars keep your best.'),
        res.pack ? h('p.good', {}, `A ${PACKS[res.pack].name} is waiting in your Inventory.`) : null,
        level.step === STEPS ? h('p.amber', {}, `${ADVENTURES[advId].name} is complete.`) : null, deflectLine),
      summary, remember,
      h('div.stick-bottom', {}, nextStep ? h('button.btn.primary.block', { type: 'button', onclick: () => { chapter = chapterOf(nextStep); const roads = roadsAt(nextStep); if (roads.length > 1) map(); else begin(nextStep, roads[0].id); } }, 'Next step') : null,
        h('button.btn.block', { type: 'button', onclick: () => { chapter = chapterOf(Math.min(STEPS, level.step)); map(); } }, 'Back to the path')));
  }

  await map();
  return root;
}
