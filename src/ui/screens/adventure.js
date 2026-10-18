// Adventure screens: pick a theme, walk a 100-step path with forks and bosses, learn three facts, then practise.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack, setMood } from '../app.js';
import { screenHeader, avatar, bulbs, toast } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { confetti, haptic, stamp } from '../fx.js';
import { metaOf } from '../../storage/meta.js';
import { levelOf } from '../../engine/cosmetics.js';
import { PACKS } from '../../engine/hexes.js';
import { createTranslator, applyTranslation } from '../../i18n/translate.js';
import { languageOf } from '../../i18n/languages.js';
import {
  ADVENTURES, ADVENTURE_IDS, STEPS, BOSS_EVERY, stepKind, roadsAt, chapterOf, buildLevel, startRun, currentItem, answerRun, advanceRun,
  frontier, isUnlocked, totals, levelForStep,
} from '../../engine/adventure.js';

const LETTERS = 'ABCD';
const LEVEL_NAME = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

export async function adventureScreen(app, params = {}) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  let advId = params.adv ?? null;
  let chapter = params.chapter ?? null;
  const translator = createTranslator({ fetchJson: (p) => app.readJson(p) });
  const root = h('div.screen.adventure');

  const profile = async () => app.repo.getProfile(pid);

  /** The question in the player's language when a translation is available. */
  async function localized(qid, lang) {
    const q = app.ctx.byId.get(qid);
    const base = { text: q.question, choices: q.choices.map((t, i) => ({ orig: i, text: t })), explanation: q.explanation, translated: null };
    if (lang === 'en') return base;
    const tr = await Promise.race([translator.translateQuestion(q, lang).catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))]);
    return tr ? applyTranslation(base, tr) : base;
  }

  const playerBar = () => profiles.length > 1
    ? h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, profiles.map((p) => h('button.btn.icon.ghost', { type: 'button', 'aria-pressed': String(p.id === pid), class: p.id === pid ? 'on' : '', 'aria-label': p.name, onclick: () => { pid = p.id; hub(); } }, avatar(p, 32))))
    : null;

  /* ------------------------------------------------------------ hub */
  async function hub() {
    advId = null;
    if (!profiles.find((p) => p.id === pid)) {
      mount(root, screenHeader('Adventure', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start an adventure.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players'));
      return;
    }
    const m = metaOf(await profile());
    mount(root,
      screenHeader('Adventure', () => goBack('menu')),
      playerBar(),
      h('p.small.dim', {}, `Five themed paths of ${STEPS} steps. Each step is three facts to learn, then five questions with three hearts. The road forks now and then, and a boss waits every ${BOSS_EVERY} steps.`),
      h('div.col.gap-s', {}, ADVENTURE_IDS.map((id) => {
        const a = ADVENTURES[id]; const t = totals(m.adv[id]);
        return h('button.panel.adv-card', { type: 'button', style: { '--adv': a.color }, onclick: () => { unlockAudio(); sfx.tap(); chapter = null; openAdventure(id); } },
          sprite(a.icon, 40),
          h('div.grow', {}, h('b', {}, a.name), h('div.tiny.dim', {}, a.blurb), h('div.progress', { style: { marginTop: '6px' } }, h('i', { style: { width: `${t.steps}%`, background: a.color } }))),
          h('div.mono.small', {}, `${t.steps}/${STEPS}`, h('div.tiny.amber', {}, `★ ${t.stars}`)));
      })));
  }

  /* ------------------------------------------------------------ map */
  async function openAdventure(id) {
    advId = id;
    const a = ADVENTURES[id];
    const m = metaOf(await profile());
    const prog = m.adv[id];
    const front = frontier(prog);
    if (chapter == null) chapter = Math.min(10, chapterOf(Math.min(front, STEPS)));
    const t = totals(prog);

    const tabs = h('div.tabs', {}, Array.from({ length: 10 }, (_, i) => {
      const c = i + 1; const lo = (c - 1) * BOSS_EVERY + 1;
      const locked = lo > front;
      return h('button.tab', { type: 'button', 'aria-pressed': String(c === chapter), class: locked ? 'locked' : '', onclick: () => { chapter = c; openAdventure(id); } }, c === 10 ? '★ 10' : String(c));
    }));

    const nodeBtn = (step, road, label) => {
      const taken = !prog.road[step] || prog.road[step] === road;
      const done = taken ? prog.done[step] ?? 0 : 0;
      const open = isUnlocked(prog, step);
      const kind = stepKind(step);
      return h('button.adv-node', {
        type: 'button', disabled: !open, class: `${kind} ${done ? 'done' : ''} ${step === front ? 'now' : ''}`, style: { '--adv': a.color },
        'aria-label': `Step ${step}${label ? `, ${label}` : ''}${done ? `, ${done} stars` : ''}`,
        onclick: () => { unlockAudio(); sfx.tap(); lesson(step, road); },
      }, kind === 'boss' ? sprite(step === STEPS ? 'boss_house' : a.bossSprite, 44) : h('span.num', {}, String(step)),
        h('span.stars', {}, done ? '★'.repeat(done) + '☆'.repeat(3 - done) : (open ? (label ?? ' ') : '🔒')));
    };

    const lo = (chapter - 1) * BOSS_EVERY + 1;
    const rows = [];
    for (let step = lo; step < lo + BOSS_EVERY; step++) {
      const roads = roadsAt(step);
      rows.push(h('div.adv-row', { class: roads.length > 1 ? 'fork' : '' },
        roads.length > 1 ? h('div.tiny.dim.center', {}, 'The road forks') : null,
        h('div.adv-nodes', {}, roads.map((r) => h('div.adv-slot', { class: prog.road[step] && prog.road[step] !== r.id ? 'other' : '' }, nodeBtn(step, r.id, roads.length > 1 ? r.label : stepKind(step) === 'boss' ? ADVENTURES[id].bossNames[chapterOf(step) - 1] : null), roads.length > 1 ? h('div.tiny.dim', {}, r.hint) : null)))));
    }

    mount(root,
      screenHeader(a.name, () => hub()),
      h('div.row.between', {}, h('span.small.dim', {}, `${a.title} · ${t.steps}/${STEPS} steps · ★ ${t.stars}`), playerBar()),
      tabs,
      h('div.adv-path', { style: { '--adv': a.color } }, rows));
  }

  /* ------------------------------------------------------------ lesson */
  async function lesson(step, road) {
    const p = await profile();
    const lang = p.language ?? 'en';
    const level = buildLevel(advId, step, road, app.ctx);
    const kind = level.kind;
    const a = ADVENTURES[advId];
    if (kind === 'boss') {
      mount(root, screenHeader(`Step ${step}`, () => openAdventure(advId)),
        h('div.panel.boss-intro', { style: { '--adv': a.color } }, sprite(level.boss.sprite, 96), h('h2', {}, level.boss.name), h('p.small', {}, `Seven ${LEVEL_NAME[level.level].toLowerCase()} questions, three hearts, and no second chances.`)),
        h('button.btn.primary.block', { type: 'button', onclick: () => practise(level, lang, p) }, 'Face the boss'));
      return;
    }
    let i = 0;
    const cards = await Promise.all(level.learn.map((qid) => localized(qid, lang)));
    const answers = level.learn.map((qid, k) => cards[k].choices.find((c) => c.orig === app.ctx.byId.get(qid).answer)?.text);
    const paint = () => {
      const c = cards[i];
      mount(root, screenHeader(`Step ${step} · learn`, () => openAdventure(advId)),
        h('div.row.between', {}, h('span.tiny.dim', {}, `Fact ${i + 1} of ${cards.length}`), h('span.tag', {}, `${LEVEL_NAME[level.level]}${road === 'risk' ? ' · risky road' : ''}`)),
        h('div.panel.paper.learn-card', { dir: c.translated && languageOf(lang).rtl ? 'rtl' : null }, h('div.q', {}, c.text), h('div.learn-a', {}, h('span.tiny.amber', {}, 'Answer'), h('b', {}, answers[i])), c.explanation ? h('p.small', {}, c.explanation) : null),
        h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { sfx.tap(); if (i + 1 < cards.length) { i++; paint(); } else practise(level, lang, p); } }, i + 1 < cards.length ? 'Next fact' : 'Start practising')));
    };
    paint();
  }

  /* ------------------------------------------------------------ practise */
  async function practise(level, lang, p) {
    let run = startRun(level, app.ctx);
    const a = ADVENTURES[advId];
    let view = null;
    const loadView = async () => { const it = currentItem(run); view = it ? await localized(it.qid, lang) : null; };
    await loadView();

    const paint = () => {
      const it = currentItem(run);
      if (!it) return finish(level, run, p);
      const q = app.ctx.byId.get(it.qid);
      const rtl = view.translated && languageOf(lang).rtl ? 'rtl' : null;
      const shown = it.order.map((orig, display) => ({ display, orig, text: view.choices.find((c) => c.orig === orig)?.text ?? q.choices[orig] }));
      const picked = run.picked;
      const total = run.queue.length;
      mount(root,
        h('div.topbar', {}, h('button.btn.icon.ghost.back', { type: 'button', 'aria-label': 'Leave', onclick: () => { sfx.tap(); openAdventure(advId); } }, '✕'),
          h('div.progress.grow', {}, h('i', { style: { width: `${(run.idx / total) * 100}%`, background: a.color } })), bulbs(run.hearts, level.hearts)),
        h('div.row.between', {}, h('span.tiny.dim', {}, level.kind === 'boss' ? `${level.boss.name} · ${run.idx + 1} of ${total}` : `Question ${run.idx + 1} of ${total}${it.retry ? ' · second chance' : ''}`), h('span.tag', {}, LEVEL_NAME[level.level])),
        h('div.panel.paper.qcard', { dir: rtl }, h('div.q', {}, view.text)),
        h('div.choices', { dir: rtl }, shown.map((c) => h('button.choice', {
          type: 'button', disabled: Boolean(picked), 'data-display': c.display,
          class: picked ? (c.display === picked.answerDisplay ? 'right' : c.display === picked.display ? 'wrong' : '') : '',
          onclick: () => choose(c.display),
        }, h('span.key', {}, LETTERS[c.display]), c.text))),
        picked ? h('div.panel.tight', { class: picked.correct ? 'good-note' : 'warn' }, h('b', {}, picked.correct ? 'Right.' : 'Not quite.'), view.explanation ? h('p.small', {}, view.explanation) : null,
          lang !== 'en' && !view.translated ? h('p.tiny.amber', {}, `No ${languageOf(lang).name} translation was available, so this one is in English.`) : null) : null,
        picked ? h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: next }, run.hearts <= 0 ? 'See result' : 'Continue')) : null);
    };
    const choose = (display) => {
      unlockAudio();
      run = answerRun(run, display, app.ctx);
      if (run.picked.correct) { sfx.correct(); haptic('tap'); } else { sfx.wrong(); haptic('warn'); }
      paint();
    };
    const next = async () => { sfx.tap(); run = advanceRun(run); await loadView(); paint(); };
    paint();
  }

  /* ------------------------------------------------------------ result */
  async function finish(level, run, p) {
    const a = ADVENTURES[advId];
    if (run.status === 'lost') {
      sfx.wrong();
      mount(root, screenHeader('Out of hearts', () => openAdventure(advId)),
        h('div.panel.warn', {}, sprite('bulb_off', 48), h('h2', {}, level.kind === 'boss' ? `${level.boss.name} wins this time` : 'No hearts left'), h('p.small', {}, 'The facts are still fresh. Go again.')),
        h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => lesson(level.step, level.road) }, 'Try again'), h('button.btn.block', { type: 'button', onclick: () => openAdventure(advId) }, 'Back to the path')));
      return;
    }
    const res = await app.repo.completeAdventureStep(pid, advId, level.step, level.road, run.stars);
    sfx.win(); haptic('big'); confetti({ count: level.kind === 'boss' ? 90 : 45 });
    if (level.kind === 'boss') { sfx.jackpot?.(); stamp('BOSS DOWN!', { kind: 'jackpot' }); }
    const nextStep = level.step < STEPS ? level.step + 1 : null;
    mount(root, screenHeader(`Step ${level.step} complete`, () => openAdventure(advId)),
      h('div.panel.center', {}, h('div.big-stars', {}, '★'.repeat(run.stars) + '☆'.repeat(3 - run.stars)), h('p.small', {}, `${run.right} right, ${run.wrong} wrong · ${run.hearts} heart${run.hearts === 1 ? '' : 's'} left`),
        res.first ? h('p', {}, h('b.amber', {}, `+${res.xp.gained} XP`), res.xp.after > res.xp.before ? ` · level ${res.xp.after}!` : '') : h('p.small.dim', {}, 'Already cleared: XP is paid once, stars keep your best.'),
        res.pack ? h('p.good', {}, `A ${PACKS[res.pack].name} is waiting in Hexes.`) : null,
        level.step === STEPS ? h('p.amber', {}, `${a.name} is complete.`) : null),
      h('div.stick-bottom', {}, nextStep ? h('button.btn.primary.block', { type: 'button', onclick: () => { chapter = chapterOf(nextStep); const roads = roadsAt(nextStep); if (roads.length > 1) openAdventure(advId); else lesson(nextStep, roads[0].id); } }, 'Next step') : null,
        h('button.btn.block', { type: 'button', onclick: () => { chapter = chapterOf(Math.min(STEPS, level.step)); openAdventure(advId); } }, 'Back to the path')));
  }

  if (advId && ADVENTURES[advId]) await openAdventure(advId); else await hub();
  return root;
}
