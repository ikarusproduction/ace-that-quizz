// The question player shared by the Adventure and the training modes: retrieval first (the question and the choices),
// then optional hints and a confidence tap, then elaborative feedback. For boss fights and lab accidents it also runs the
// arena: hex cards are thrown at the player and can be deflected by tapping them.
import { h } from './dom.js';
import { sprite } from './pixel.js';
import { avatar, bulbs } from './components.js';
import { sfx, unlockAudio } from './audio.js';
import { haptic, burstAt, motionReduced } from './fx.js';
import { splash, clearHexFx, unblurOnFirstTap } from './hexfx.js';
import { createRig } from './bossrig.js';
import { createTranslator, applyTranslation } from '../i18n/translate.js';
import { languageOf } from '../i18n/languages.js';
import { HEXES } from '../engine/hexes.js';
import { hexEffects } from '../engine/adventure.js';
import { currentItem, answerRun, advanceRun, useHint, hintsLeft, setConfidence, noteHex, setStake, stakesAvailable, STAKES } from '../engine/practice.js';
import { misconception } from '../engine/learning.js';

const LETTERS = 'ABCD';
export const LEVEL_NAME = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const REASON = { new: 'New', due: 'Review', relearn: 'Review', weak: 'Weak spot', practice: 'Practice', maintain: 'Refresh', retry: 'Another angle' };
const CONF = [['sure', 'Sure'], ['maybe', 'Not sure'], ['guess', 'Guess']];

/** The question in the player's language when a translation is available (3 s at most), otherwise in English. */
export function makeLocalizer(app) {
  const translator = createTranslator({ fetchJson: (p) => app.readJson(p) });
  return async function localized(qid, lang) {
    const q = app.ctx.byId.get(qid);
    const base = { text: q.question, choices: q.choices.map((t, i) => ({ orig: i, text: t })), explanation: q.explanation, misconception: q.misconception ?? null, mnemonic: q.mnemonic ?? null, translated: null };
    if (!lang || lang === 'en') return base;
    const tr = await Promise.race([translator.translateQuestion(q, lang).catch(() => null), new Promise((r) => setTimeout(() => r(null), 3000))]);
    return tr ? applyTranslation(base, tr) : base;
  };
}

/**
 * Play a run to its end.
 *   app, view(...nodes), scene (optional createScene()), run (from startRun / startPractice), lang, color, player (profile),
 *   localize(qid, lang), learnItems ({ conceptId: item }) for misconception notes, boss ({ name, sprite }) or event (true),
 *   label(it, run) -> small text above the question, onExit(), onEnd(run).
 */
export async function playRun({ app, view, scene = null, run, lang = 'en', color = '#6fd1ff', player = null, localize, learnItems = {}, boss = null, event = false, eventName = 'Lab accident', label = null, timer = null, onExit, onEnd }) {
  let r = run;
  let q = null; // the localized current question
  let fx = { blur: false, flip: false };
  let flights = []; // thrown cards in the air
  let token = 0;
  const total0 = run.queue.length;
  let askedAt = 0; let askedKey = ''; let timerTok = 0; // when the current question was shown (for the Academy's speed stats) and the optional countdown
  const arena = Boolean(boss || event);
  const rig = boss ? createRig(boss.sprite, 96, boss.name) : null;
  const hpFill = h('i', { style: { width: '100%' } });
  const bossEl = boss ? h('div.arena-boss', {}, rig.el, h('div.progress.boss-hp', { 'aria-label': 'Boss health' }, hpFill)) : null;
  const meEl = h('div.arena-me', {}, player ? avatar(player, 48) : sprite('gasmask', 48));
  const air = h('div.arena-air');
  const strip = arena ? h('div.arena-strip', { class: boss ? 'boss' : 'event' }, bossEl ?? h('div.arena-hazard', {}, sprite('goo', 28), h('span.tiny', {}, eventName)), meEl, air) : null;
  const rtlOf = () => (q?.translated && languageOf(lang).rtl ? 'rtl' : null);

  const cancelFlights = () => { token++; for (const f of flights) { try { f.anim?.cancel(); } catch { /* already finished */ } f.el.remove(); } flights = []; };
  const leave = () => { cancelFlights(); clearHexFx(); onExit?.(); };

  async function load() {
    const it = currentItem(r);
    q = it ? await localize(it.qid, lang) : null;
  }

  /* ------------------------------------------------------------ hex cards */
  function centre(el, within) {
    const a = el.getBoundingClientRect(); const b = within.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
  }
  function impact(f) {
    const hex = HEXES[f.id];
    f.el.remove(); flights = flights.filter((x) => x !== f);
    r = noteHex(r, false);
    const effects = hexEffects(f.id);
    meEl.classList.remove('hit'); void meEl.offsetWidth; meEl.classList.add('hit');
    const c = meEl.getBoundingClientRect();
    burstAt(c.left + c.width / 2, c.top + c.height / 2, { colors: ['#b3261e', '#e8a33d', '#e8e2d0'], count: 14, spread: 90 });
    sfx.wrong?.(); haptic('warn');
    splash(effects);
    if (effects.includes('flip')) fx = { ...fx, flip: true };
    if (effects.includes('blur')) fx = { ...fx, blur: true };
    scene?.react('bad');
    applyLasting();
    void hex;
  }
  function deflect(f) {
    if (!flights.includes(f)) return;
    flights = flights.filter((x) => x !== f);
    r = noteHex(r, true);
    const rect = f.el.getBoundingClientRect();
    f.anim?.cancel();
    sfx.card?.(); haptic('select');
    burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2, { colors: ['#6fd1ff', '#fff', '#e8a33d'], count: 12, spread: 80 });
    const from = f.from;
    f.el.style.pointerEvents = 'none';
    f.el.animate([{ transform: f.el.style.transform || 'none', opacity: 1 }, { transform: `translate(${from.x - 40}px, ${from.y - 30}px) scale(.3) rotate(540deg)`, opacity: 0 }], { duration: motionReduced() ? 1 : 420, easing: 'ease-in' }).finished.then(() => f.el.remove()).catch(() => f.el.remove());
    stamp2('Deflected!');
  }
  function stamp2(text) {
    const t = h('div.deflect-note', {}, text); air.append(t); setTimeout(() => t.remove(), 900);
  }
  function throwHex(id, dur) {
    const hex = HEXES[id]; if (!hex || !strip) return;
    const from = bossEl ? centre(bossEl, air) : { x: air.clientWidth / 2, y: -20 };
    const to = centre(meEl, air);
    const kind = hex.fx?.[0] ?? 'ink';
    const el = h('button.hexcard', { type: 'button', class: `${hex.rarity} fxk-${kind}`, 'aria-label': `Deflect ${hex.name}` }, h('span.hx-trail', { 'aria-hidden': 'true' }), h('span.hx-orb', {}, sprite(hex.icon, 52)), h('span.hx-name', {}, hex.name));
    const f = { id, el, from, anim: null };
    air.append(el);
    flights.push(f);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); deflect(f); });
    if (motionReduced()) { setTimeout(() => { if (flights.includes(f)) impact(f); }, 700); el.style.transform = `translate(${to.x - 36}px, ${to.y - 36}px)`; return; }
    const sx = from.x - 36; const sy = from.y - 36;
    f.anim = el.animate([
      { transform: `translate(${sx}px, ${sy}px) scale(.3) rotate(-30deg)`, opacity: 0 },
      { transform: `translate(${sx + (to.x - from.x) * 0.25}px, ${sy + (to.y - from.y) * 0.25 - 16}px) scale(.8) rotate(-8deg)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${to.x - 36}px, ${to.y - 36}px) scale(1) rotate(10deg)`, opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.35,.05,.7,.95)', fill: 'forwards' });
    f.anim.finished.then(() => { if (flights.includes(f)) impact(f); }).catch(() => {});
    sfx.card?.();
  }
  function scheduleThrows() {
    const it = currentItem(r);
    if (!it || !strip || !it.hexes?.length || it.retry) return;
    const my = ++token;
    const t = Math.min(1, r.idx / Math.max(1, total0 - 1));
    const dur = Math.round(2300 - 1100 * t);
    it.hexes.forEach((id, k) => setTimeout(() => { if (my === token && !r.picked) throwHex(id, dur); }, 400 + k * 1100));
  }
  function applyLasting() {
    const ch = document.querySelector('.choices.adv-choices'); const qc = document.querySelector('.qwrap');
    if (qc) qc.classList.toggle('hex-flip', fx.flip);
    if (ch && fx.blur && !ch.classList.contains('hex-blur')) { ch.classList.add('hex-blur'); unblurOnFirstTap(ch); }
  }

  /* ------------------------------------------------------------ painting */
  function feedback(it, shown) {
    const p = r.picked; const qq = app.ctx.byId.get(it.qid);
    const correctText = shown.find((c) => c.display === p.answerDisplay)?.text;
    const wrongText = !p.correct ? shown.find((c) => c.display === p.display)?.text : null;
    const item = learnItems[it.family];
    const habit = !p.correct && item && misconception(item) === String(qq.choices[it.order[p.display]] ?? '').slice(0, 60);
    const other = [1, 2, 3].filter((l) => l !== it.level).map((l) => app.ctx.families.get(it.family)?.[l]).find(Boolean);
    const otherAns = other ? other.choices[other.answer] : null;
    return h('div.panel.tight.fb', { class: p.correct ? 'good-note' : 'warn' },
      h('b', {}, p.correct ? (p.hints ? 'Right, with help.' : 'Right.') : 'Not quite.'),
      !p.correct ? h('p.small', {}, 'The answer: ', h('b', {}, correctText)) : null,
      wrongText ? h('p.tiny.dim', {}, `You picked: ${wrongText}`) : null,
      q.explanation ? h('p.small', {}, q.explanation) : null,
      !p.correct && q.misconception ? h('p.tiny.amber', {}, `Common mix-up: ${q.misconception}`) : null,
      q.mnemonic ? h('p.tiny.dim', {}, `Memory aid: ${q.mnemonic}`) : null,
      habit ? h('p.tiny.amber', {}, 'You have picked this one before. It is a recurring mix-up, so it will come back.') : null,
      !p.correct && p.confidence === 'sure' ? h('p.tiny.amber', {}, 'You were sure about this one. Mistakes made with confidence are the most useful to fix, so it comes back soon.') : null,
      p.correct && p.hints ? h('p.tiny.dim', {}, `Answered with ${p.hints} hint${p.hints > 1 ? 's' : ''}: it counts for less in your review schedule than a recall without help.`) : null,
      !p.correct && run.allowRetry && !it.retry ? h('p.tiny.dim', {}, 'It returns at the end, asked another way.') : null,
      other && otherAns ? h('details.angle', {}, h('summary.tiny', {}, 'Same idea, another angle'), h('p.small', {}, other.question), h('p.small', {}, h('b', {}, otherAns))) : null,
      lang !== 'en' && !q.translated ? h('p.tiny.amber', {}, `No ${languageOf(lang).name} translation was available, so this one is in English.`) : null);
  }

  function paint() {
    const it = currentItem(r);
    if (!it) { cancelFlights(); clearHexFx(); return onEnd(r); }
    const qq = app.ctx.byId.get(it.qid);
    const shown = it.order.map((orig, display) => ({ display, orig, text: q.choices.find((c) => c.orig === orig)?.text ?? qq.choices[orig] }));
    const picked = r.picked; const left = hintsLeft(r, app.ctx);
    const key = `${r.idx}:${it.qid}`;
    if (key !== askedKey) { askedKey = key; askedAt = performance.now(); }
    const secs = timer && !picked ? timer(it) : null;
    const bar = secs ? h('div.q-timer', { role: 'timer', 'aria-label': `${secs} seconds suggested` }, h('i', { style: { animationDuration: `${secs}s`, animationDelay: `-${Math.min(secs, (performance.now() - askedAt) / 1000).toFixed(2)}s` } })) : null;
    const myTok = ++timerTok;
    if (secs) setTimeout(() => { if (myTok === timerTok && !r.picked) document.querySelector('.q-timer')?.classList.add('over'); }, Math.max(0, secs * 1000 - (performance.now() - askedAt)));
    const hearts = r.hearts !== null ? bulbs(r.hearts, r.maxHearts) : null;
    view(
      h('div.topbar', {}, h('button.btn.icon.ghost.back', { type: 'button', 'aria-label': 'Leave', onclick: () => { sfx.tap(); leave(); } }, '✕'),
        h('div.progress.grow', {}, h('i', { style: { width: `${(r.idx / r.queue.length) * 100}%`, background: color } })), hearts),
      strip,
      h('div.row.between', {}, h('span.tiny.dim', {}, label ? label(it, r) : `Question ${r.idx + 1} of ${r.queue.length}`), h('span.row.gap-s', {}, REASON[it.reason] ? h('span.tag.green', {}, REASON[it.reason]) : null, h('span.tag', {}, LEVEL_NAME[it.level] ?? ''))),
      bar,
      h('div.qwrap', { class: fx.flip ? 'hex-flip' : '', dir: rtlOf() }, h('div.panel.paper.qcard', {}, h('div.q', {}, q.text))),
      !picked && stakesAvailable(r, app.ctx).length > 1 ? h('div.stakes', { role: 'group', 'aria-label': 'Stake on this question' }, h('span.tiny.dim', {}, 'Stake'),
        STAKES.map((st) => { const ok = stakesAvailable(r, app.ctx).includes(st.shift); return h('button.chip', { type: 'button', title: st.hint, disabled: !ok, 'aria-pressed': String(it.shift === st.shift), class: it.shift === st.shift ? 'on' : '', onclick: async () => { sfx.tap(); r = setStake(r, st.shift, app.ctx); await load(); paint(); } }, st.name); }),
        h('span.tiny.dim.stake-hint', {}, STAKES.find((st) => st.shift === it.shift)?.hint)) : null,
      !picked ? h('div.metacog', {},
        h('div.conf', { role: 'group', 'aria-label': 'How sure are you?' }, h('span.tiny.dim', {}, 'How sure?'), CONF.map(([k, name]) => h('button.chip', { type: 'button', 'aria-pressed': String(it.conf === k), class: it.conf === k ? 'on' : '', onclick: () => { sfx.tap(); r = setConfidence(r, k); paint(); } }, name))),
        run.allowHints ? h('button.btn.ghost.hint', { type: 'button', disabled: left <= 0, onclick: () => { sfx.select?.(); r = useHint(r, app.ctx); paint(); } }, left > 0 ? `Hint · ${left} left` : 'No hints left') : null) : null,
      h('div.choices.adv-choices', { dir: rtlOf(), class: fx.blur ? 'hex-blur' : '' }, shown.map((c) => {
        const gone = it.elim.includes(c.orig);
        return h('button.choice', {
          type: 'button', disabled: Boolean(picked) || gone, 'data-display': c.display,
          class: [picked ? (c.display === picked.answerDisplay ? 'right' : c.display === picked.display ? 'wrong' : '') : '', gone ? 'elim' : ''].join(' '),
          onclick: () => choose(c.display),
        }, h('span.key', {}, LETTERS[c.display]), c.text);
      })),
      picked ? feedback(it, shown) : null,
      picked ? h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: next }, r.hearts !== null && r.hearts <= 0 ? 'See result' : 'Continue')) : null);
    if (fx.blur || fx.flip) applyLasting();
  }

  function choose(display) {
    unlockAudio();
    cancelFlights();
    timerTok++; r = answerRun(r, display, app.ctx, { ms: performance.now() - askedAt });
    if (r.picked.correct) {
      sfx.correct(); haptic('tap'); scene?.react('good');
      if (boss) {
        const left = Math.max(0, 1 - r.right / total0); hpFill.style.width = `${left * 100}%`; bossEl.classList.remove('hit'); void bossEl.offsetWidth; bossEl.classList.add('hit');
        const b = bossEl.getBoundingClientRect(); burstAt(b.left + b.width / 2, b.top + b.height / 2, { colors: ['#6fd1ff', '#fff', '#e8a33d'], count: 16 });
        if (left < 0.4) rig.setEnraged(true);
      }
    } else { sfx.wrong(); haptic('warn'); scene?.react('bad'); meEl.classList.remove('hit'); void meEl.offsetWidth; meEl.classList.add('hit'); }
    paint();
  }
  async function next() {
    sfx.tap(); cancelFlights(); clearHexFx(); fx = { blur: false, flip: false };
    r = advanceRun(r); await load(); paint(); scheduleThrows();
  }

  await load(); paint(); scheduleThrows();
}
