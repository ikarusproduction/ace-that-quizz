// The Periodic Table trainer: a mastery-coloured table of all 118 elements, memory cards (flashcards) and quizzes.
// What is asked and when comes from engine/periodic.js and the learning engine; answers go back into the player's learning
// record on this device, so the table fills in as you learn and your reviews come due on a spaced schedule.
import { h, mount } from '../dom.js';
import { go, goBack, setMood } from '../app.js';
import { screenHeader, avatar, modal, toast } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { confetti, haptic } from '../fx.js';
import { offsetMin } from './adventure.js';
import { metaOf } from '../../storage/meta.js';
import { ELEMENTS, BY_Z, cell, nameOf } from '../../engine/elements.js';
import { RANGES, FACET_SETS, buildSession, buildQuiz, cardText, checkTyped, outcomeOf, progress, nextInterval, intervalText, statusOf } from '../../engine/periodic.js';

const STATE_LABEL = { new: 'Not started', learning: 'Learning', review: 'Known', mastered: 'Mastered' };

export async function periodicScreen(app, params = {}) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  const content = h('div.pt-content');
  const root = h('div.screen.periodic', {}, content);
  const view = (...nodes) => mount(content, ...nodes);
  const profile = async () => app.repo.getProfile(pid);
  const langOf = (p) => ((p?.language ?? 'en') === 'fr' ? 'fr' : 'en');
  // the choices made on the hub stay while you move around
  const cfg = { range: 'all', focus: 'core', typed: false, size: 20 };

  const playerBar = () => (profiles.length > 1
    ? h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, profiles.map((p) => h('button.btn.icon.ghost', { type: 'button', 'aria-pressed': String(p.id === pid), class: p.id === pid ? 'on' : '', 'aria-label': p.name, onclick: () => { pid = p.id; hub(); } }, avatar(p, 32))))
    : null);

  /* ------------------------------------------------------------ the table */
  function tableGrid(prog, lang, onCell) {
    const grid = h('div.pt-grid', { role: 'group', 'aria-label': 'Periodic table' });
    for (const e of ELEMENTS) {
      const { row, col } = cell(e); const st = prog.per[e.z];
      grid.append(h('button.pt-cell', {
        type: 'button', class: `s-${st.state}${st.due ? ' due' : ''}${e.block ? ` b-${e.block}` : ''}`, style: { gridRow: String(row), gridColumn: String(col) },
        'aria-label': `${e.z} ${nameOf(e, lang)}, ${STATE_LABEL[st.state]}${st.due ? ', review due' : ''}`, onclick: () => onCell(e),
      }, h('span.z', {}, String(e.z)), h('span.sy', {}, e.symbol)));
    }
    return grid;
  }

  async function elementSheet(e, lang, learn, now) {
    const st = statusOf(learn, e.z, now);
    const txt = cardText(e, 'sym', lang).explain;
    await modal((close) => [
      h('div.row.between', {}, h('h2', {}, `${e.symbol} · ${nameOf(e, lang)}`), h('span.tag', {}, `#${e.z}`)),
      h('p.small', {}, txt),
      h('p.small.dim', {}, `${lang === 'fr' ? e.en : e.fr} · ${e.state ? { gas: 'gas', liquid: 'liquid', solid: 'solid' }[e.state] : 'state unknown'} at room temperature · ${e.block}-block`),
      h('p.small', {}, st.state === 'new' ? 'You have not started this one.' : `${STATE_LABEL[st.state]} (${st.pct}%)${st.due ? ' · a review is due' : ''}`),
      h('button.btn.primary.block', { type: 'button', onclick: () => close(true) }, 'Close'),
    ]);
  }

  /* ------------------------------------------------------------ hub */
  async function hub() {
    setMood('calm');
    if (!profiles.find((p) => p.id === pid)) {
      view(screenHeader('Periodic Table', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start learning the table.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Create a player'));
      return;
    }
    const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = langOf(p);
    const prog = progress(m.learn, now);
    const chips = (items, current, onpick) => h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, items.map((x) => h('button.chip', { type: 'button', 'aria-pressed': String(current === x.id), class: current === x.id ? 'on' : '', onclick: () => { sfx.tap(); onpick(x.id); hub(); } }, x.label)));
    view(
      screenHeader('Periodic Table', () => goBack('menu')),
      playerBar(),
      h('div.panel.tight', {},
        h('div.row.between', {}, h('b', {}, `${prog.known} of ${prog.total} known by heart`), h('span.tiny.dim', {}, prog.due ? `${prog.due} reviews due` : 'nothing due')),
        h('div.progress', { 'aria-label': 'Known by heart' }, h('i', { style: { width: `${(prog.known / prog.total) * 100}%` } })),
        h('p.tiny.dim', {}, 'Known means symbol, name and atomic number all recalled on a spaced schedule. Tap an element to see it.')),
      tableGrid(prog, lang, (e) => { sfx.tap(); elementSheet(e, lang, m.learn, now); }),
      h('div.pt-legend', {}, Object.entries(STATE_LABEL).map(([k, l]) => h('span.tiny', {}, h('i', { class: `sw s-${k}` }), l)), h('span.tiny', {}, h('i', { class: 'sw due' }), 'Due')),
      h('div.panel.tight', {},
        h('div.tiny.dim', {}, 'Which elements'), chips(RANGES, cfg.range, (v) => { cfg.range = v; }),
        h('div.tiny.dim', { style: { marginTop: '8px' } }, 'What to learn'), chips(Object.entries(FACET_SETS).map(([id, f]) => ({ id, label: f.label })), cfg.focus, (v) => { cfg.focus = v; })),
      h('button.btn.primary.block', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); startCards(); } }, 'Memory cards'),
      h('div.row.gap-s', {},
        h('button.btn.block', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); cfg.typed = false; startQuiz(); } }, 'Quiz'),
        h('button.btn.block', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); cfg.typed = true; startQuiz(); } }, 'Type the answer')),
      h('p.tiny.dim', {}, 'Memory cards show new elements in table order, a few at a time, and bring each one back just before you would forget it. Quizzes and typing count toward the same schedule. All saved on this device.'),
    );
  }

  const settings = () => ({ range: RANGES.find((r) => r.id === cfg.range) ?? RANGES[0], facets: (FACET_SETS[cfg.focus] ?? FACET_SETS.core).facets });
  const emptyNotice = (title) => view(screenHeader(title, () => hub()), h('div.panel.inset', {}, h('p', {}, 'Nothing to study with these choices. Pick another range or topic.')), h('button.btn.block', { type: 'button', onclick: () => hub() }, 'Back'));

  /* ------------------------------------------------------------ memory cards */
  async function startCards() {
    const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = langOf(p);
    const s = settings();
    const deck = buildSession({ learn: m.learn, now, seed: `${pid}:${now}`, size: cfg.size, range: s.range, facets: s.facets });
    if (!deck.length) return emptyNotice('Memory cards');
    const queue = deck.map((c) => ({ ...c, retried: false }));
    const answers = []; const missed = new Map(); let shown = false; let done = 0; const total = deck.length;

    const paint = () => {
      if (!queue.length) return finish();
      const c = queue[0]; const e = BY_Z[c.z]; const t = cardText(e, c.facet, lang);
      const main = c.facet === 'name' ? e.symbol : c.facet === 'elz' ? String(e.z) : nameOf(e, lang);
      const item = m.learn.items[c.id];
      const grades = [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']];
      view(
        screenHeader('Memory cards', () => hub(), h('span.tag', {}, `${done} of ${total}`)),
        h('div.progress', {}, h('i', { style: { width: `${(done / total) * 100}%` } })),
        h('div.pt-card', { class: `${shown ? 'back' : 'front'}${c.fresh && !c.retried ? ' fresh' : ''}`, onclick: () => { if (!shown) { shown = true; sfx.tap(); paint(); } } },
          h('div.tiny.dim', {}, c.retried ? 'Once more' : c.fresh ? 'New' : 'Review'),
          h('div.pt-prompt', {}, t.question),
          h('div.pt-main', {}, main),
          shown ? [h('div.pt-answer', {}, t.answer), h('p.small.dim', {}, t.explain)] : h('p.small.dim', {}, 'Think of the answer, then tap the card.')),
        shown
          ? h('div.pt-grades', {}, grades.map(([how, label]) => h('button.btn', { type: 'button', class: how === 'good' ? 'primary' : '', onclick: () => grade(c, how) }, label, h('span.tiny', {}, how === 'again' ? 'soon' : intervalText(nextInterval(item, how, now))))))
          : h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { shown = true; sfx.tap(); paint(); } }, 'Show the answer')),
      );
    };
    const grade = (c, how) => {
      queue.shift();
      if (!c.retried) { answers.push(outcomeOf(c, how, { level: 2 })); done++; }
      if (how === 'again') { missed.set(c.z, true); if (!c.retried) queue.splice(Math.min(3, queue.length), 0, { ...c, retried: true }); }
      shown = false; sfx[how === 'again' ? 'wrong' : 'correct']?.(); paint();
    };
    const finish = async () => { await record(answers, 'pt-cards'); summary({ title: 'Cards done', answers, missed: [...missed.keys()], again: startCards }); };
    paint();
  }

  /* ------------------------------------------------------------ quiz */
  async function startQuiz() {
    const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = langOf(p);
    const s = settings();
    const typed = cfg.typed;
    const qs = buildQuiz({ learn: m.learn, now, seed: `${pid}:${now}`, size: 12, range: s.range, facets: s.facets, lang, typed, newLimit: 3 });
    if (!qs.length) return emptyNotice('Quiz');
    const answers = []; const missed = new Set(); let i = 0; let state = null; // state: { picked, ok, text }
    const paint = () => {
      if (i >= qs.length) return finish();
      const q = qs[i]; const e = BY_Z[q.z];
      const feedback = state && h('div.panel.tight', { class: state.ok ? 'good' : 'bad' }, h('b', {}, state.ok ? 'Right' : `Not quite. It is ${q.correct}`), h('p.small', {}, q.explain));
      const body = q.type === 'type'
        ? [h('input.pt-input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Your answer', disabled: Boolean(state), onkeydown: (ev) => { if (ev.key === 'Enter') check(q, e, ev.target.value); } }),
          state ? null : h('button.btn.primary.block', { type: 'button', onclick: () => check(q, e, content.querySelector('.pt-input').value) }, 'Check')]
        : h('div.col.gap-s', {}, q.choices.map((c, k) => h('button.btn.block', { type: 'button', disabled: Boolean(state), class: state ? (k === q.answer ? 'good' : k === state.picked ? 'bad' : '') : '', onclick: () => pick(q, k) }, c)));
      view(
        screenHeader(typed ? 'Type the answer' : 'Quiz', () => hub(), h('span.tag', {}, `${i + 1} of ${qs.length}`)),
        h('div.progress', {}, h('i', { style: { width: `${(i / qs.length) * 100}%` } })),
        h('div.pt-card', {}, h('div.tiny.dim', {}, q.fresh ? 'New element' : 'Review'), h('div.pt-prompt', {}, q.question)),
        body, feedback,
        state ? h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { i++; state = null; paint(); } }, i + 1 >= qs.length ? 'See results' : 'Next')) : null,
      );
      if (q.type === 'type' && !state) content.querySelector('.pt-input')?.focus();
    };
    const settle = (q, ok, wrongText, level) => {
      answers.push(outcomeOf(q, ok ? 'good' : 'again', { level, wrongText })); if (!ok) missed.add(q.z);
      state = { ...state, ok }; sfx[ok ? 'correct' : 'wrong']?.(); haptic(ok ? 'correct' : 'wrong'); paint();
    };
    const pick = (q, k) => { state = { picked: k }; settle(q, k === q.answer, k === q.answer ? null : q.choices[k], 1); };
    const check = (q, e, text) => { if (!String(text).trim()) return toast('Type an answer first.'); state = { text }; settle(q, checkTyped(e, q.facet, text), String(text).slice(0, 40), 3); };
    const finish = async () => { await record(answers, 'pt-quiz'); summary({ title: typed ? 'Typing done' : 'Quiz done', answers, missed: [...missed], again: startQuiz }); };
    paint();
  }

  /* ------------------------------------------------------------ end of a session */
  async function record(answers, kind) {
    if (!answers.length) return;
    try { await app.repo.recordLearning(pid, answers, { kind, offsetMin: offsetMin() }); } catch (err) { toast('Could not save this session.'); }
  }
  async function summary({ title, answers, missed, again }) {
    const p = await profile(); const m = metaOf(p); const now = Date.now(); const lang = langOf(p);
    const prog = progress(m.learn, now);
    const right = answers.filter((a) => a.correct).length;
    sfx.win(); if (answers.length && right === answers.length) { haptic('big'); confetti({ count: 40 }); }
    view(
      screenHeader(title, () => hub()),
      h('div.panel.banner', {}, h('div.big-num.amber', {}, `${right}/${answers.length}`), h('p.small', {}, missed.length ? `${missed.length} to watch` : 'No misses')),
      missed.length ? h('div.panel.tight', {}, h('b', {}, 'Watch these'), h('div.pt-missed', {}, missed.slice(0, 12).map((z) => { const e = BY_Z[z]; return h('div.row.between', {}, h('span', {}, `${e.symbol} · ${nameOf(e, lang)}`), h('span.tag', {}, `#${e.z}`)); }))) : null,
      h('div.panel.tight', {}, h('b', {}, `${prog.known} of ${prog.total} known by heart`), h('div.progress', {}, h('i', { style: { width: `${(prog.known / prog.total) * 100}%` } })), h('p.tiny.dim', {}, prog.due ? `${prog.due} reviews due` : 'Nothing due right now. Come back tomorrow for the next reviews.')),
      h('div.stick-bottom', {}, h('div.row.gap-s', {}, h('button.btn.block', { type: 'button', onclick: () => hub() }, 'The table'), h('button.btn.primary.block', { type: 'button', onclick: () => again() }, 'Keep going'))),
    );
  }

  await hub();
  return root;
}
