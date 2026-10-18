// "While you wait" panel: a puzzle for players who are not on turn (online). The element is reused across
// renders so a half-read puzzle is never wiped by an incoming game update.
import { h } from './dom.js';
import { makePuzzle, randomFact, PUZZLE_RULES, applySlide, SLIDE_SOLVED, solveSlide } from '../engine/minigame.js';
import { figure, scatter } from './shapes.js';
import { puzzleSeed } from '../engine/game.js';
import { Rng } from '../engine/rng.js';
import { sfx } from './audio.js';
import { haptic } from './fx.js';

const LEVELS = [[1, 'Easy'], [2, 'Medium'], [3, 'Hard']];
const FR_LEVELS = { Easy: 'Facile', Medium: 'Moyen', Hard: 'Difficile' };
const UI = {
  en: { reset: 'Reset', skip: 'Skip', watch: 'Watch the lights', replay: 'Watch again', moves: (n) => `${n} moves`, tap: 'Now repeat it…', title: 'While you wait', sub: (r, g) => `Solve puzzles for bonus chips (up to ${r} per round, ${g} per game).`, got: (n) => `+${n} chips`, none: 'Chip cap reached for now', right: 'Correct!', wrong: 'Not quite.', next: 'Next puzzle', fact: 'Did you know?', earned: (a, b) => `Earned this round: ${a} / ${b}`, late: 'Too late: the turn moved on before your answer counted. Here is a fresh one.', checking: 'Checking your answer with the host…', meter: (n, of, full) => (full ? 'Hex hand full: play a prank!' : `Prank meter ${n}/${of}: every ${of} right answers earn a hex to play on the answerer`) },
  fr: { reset: 'Recommencer', skip: 'Passer', watch: 'Regarder les lumières', replay: 'Revoir', moves: (n) => `${n} coups`, tap: 'À toi de répéter…', title: 'En attendant', sub: (r, g) => `Résous des énigmes pour gagner des jetons (max ${r} par manche, ${g} par partie).`, got: (n) => `+${n} jetons`, none: 'Plafond de jetons atteint pour le moment', right: 'Bonne réponse !', wrong: 'Raté.', next: 'Énigme suivante', fact: 'Le saviez-vous ?', earned: (a, b) => `Gagnés cette manche : ${a} / ${b}`, late: "Trop tard : le tour a changé avant que ta réponse compte. En voici une nouvelle.", checking: "Vérification de ta réponse par l'hôte…", meter: (n, of, full) => (full ? 'Main de hexes pleine : lance une farce !' : `Jauge de farce ${n}/${of} : ${of} bonnes réponses = un hex à lancer sur celui qui répond`) },
};

export class WaitGame {
  /** @param {{getState:()=>object, myId:string, lang:string, act:(a:object)=>void}} o */
  constructor(o) {
    this.o = o;
    this.level = 1;
    this.sent = null;     // puzzle index we answered, waiting for the host
    this.feedback = null; // { ok, gain, fact }
    this.el = h('div.panel.waitgame', {});
    this.el.__wg = this; // handy for tests
    this.refresh();
  }

  get t() { return UI[this.o.lang === 'fr' ? 'fr' : 'en']; }

  stopFlash() { clearTimeout(this.flashTimer); this.flashTimer = null; }

  /** Sliding tiles. Tap a tile next to the gap; the moves are sent as a string of gap moves (U/D/L/R) once the board is solved. */
  slideView(v, locked, send) {
    const L = this.local;
    L.board ??= [...v.board];
    L.moves ??= '';
    const grid = h('div.slide-grid', {}, L.board.map((n, i) => (n === 0
      ? h('div.slide-gap')
      : h('button.slide-tile', { type: 'button', disabled: locked, 'aria-label': `Tile ${n}`, onclick: () => {
        const gap = L.board.indexOf(0);
        const d = i - gap;
        const m = d === -3 ? 'U' : d === 3 ? 'D' : d === -1 && gap % 3 !== 0 ? 'L' : d === 1 && gap % 3 !== 2 ? 'R' : null;
        if (!m) { sfx.wrong?.(); return; }
        L.board = applySlide(L.board, m);
        L.moves += m;
        sfx.tap?.(); haptic?.('tap');
        if (L.board.every((x, k) => x === SLIDE_SOLVED[k])) { const moves = L.moves; L.board = null; L.moves = ''; send(moves); } else this.refresh();
      } }, String(n))
    )));
    return h('div.slide', {}, grid, h('div.row.between', {}, h('span.tiny.dim', {}, this.t.moves(L.moves.length)),
      h('div.row.gap-s', {}, h('button.btn.small.ghost', { type: 'button', disabled: locked, onclick: () => { L.board = [...v.board]; L.moves = ''; this.refresh(); } }, this.t.reset), h('button.btn.small.ghost', { type: 'button', disabled: locked, onclick: () => { L.board = null; L.moves = ''; send('skip'); } }, this.t.skip))));
  }

  /** Light memory: the pads flash in order, then you tap them back. */
  memoryView(v, locked, send) {
    const L = this.local;
    L.phase ??= 'ready'; L.input ??= ''; L.replays ??= 0; L.lit ??= -1;
    const colors = ['#e8a33d', '#6fa86b', '#6fd1ff', '#e07b9b', '#b3261e', '#e6d6a8'];
    const pads = h('div.memory-pads', { style: { gridTemplateColumns: `repeat(${v.pads === 6 ? 3 : 2}, 1fr)` } }, Array.from({ length: v.pads }, (_, i) => {
      const b = h('button.memory-pad', { type: 'button', 'data-pad': i, class: L.lit === i ? 'lit' : '', disabled: locked || L.phase !== 'input', 'aria-label': `Pad ${i + 1}`, onclick: () => {
        L.input += String(i);
        sfx.select?.();
        this.flashPad(i, 160);
        const want = v.seq.join('');
        if (!want.startsWith(L.input)) { L.phase = 'ready'; const wrong = L.input; L.input = ''; send(`x${wrong}`); }
        else if (L.input.length === v.length) { const done = L.input; L.phase = 'ready'; L.input = ''; send(done); }
        else this.refresh();
      } });
      b.style.setProperty('--pad', colors[i]);
      return b;
    }));
    const start = () => {
      L.phase = 'watch'; L.input = ''; L.replays += 1; this.refresh();
      let k = 0;
      const step = () => {
        if (!this.el.isConnected && !this.el.parentNode) { /* keep going: the panel may be re-attached */ }
        if (k >= v.seq.length) { L.lit = -1; L.phase = 'input'; this.refresh(); return; }
        L.lit = v.seq[k]; sfx.select?.(); this.paintPads();
        this.flashTimer = setTimeout(() => { L.lit = -1; this.paintPads(); k += 1; this.flashTimer = setTimeout(step, 220); }, 520);
      };
      this.flashTimer = setTimeout(step, 400);
    };
    return h('div.memory', {}, pads,
      h('div.row.between', {}, h('span.tiny.dim', {}, L.phase === 'input' ? `${this.t.tap} ${L.input.length}/${v.length}` : ''),
        L.phase === 'watch' ? null : h('button.btn.small', { type: 'button', disabled: locked || L.phase === 'input' && L.replays >= 2, onclick: start }, L.replays ? this.t.replay : this.t.watch)));
  }

  paintPads() {
    this.el.querySelectorAll('.memory-pad').forEach((b) => b.classList.toggle('lit', Number(b.dataset.pad) === this.local?.lit));
  }
  flashPad(i, ms) {
    if (this.local) this.local.lit = i;
    this.paintPads();
    setTimeout(() => { if (this.local) this.local.lit = -1; this.paintPads(); }, ms);
  }

  refresh() {
    const s = this.o.getState();
    const me = s.players.find((p) => p.playerId === this.o.myId);
    if (!me) return;
    const lang = this.o.lang === 'fr' ? 'fr' : 'en';
    const pz = me.puzzle ?? { n: 0, roundBonus: 0 };
    const roundBonus = pz.round === s.roundIndex ? pz.roundBonus : 0;
    const turnKey = `${s.roundIndex}:${s.qIndex}:${s.turn}:${s.phase}`;
    if (this.sent !== null && pz.n === this.sent && this.turnKey && this.turnKey !== turnKey) { // the question moved on before the host saw our answer
      this.sent = null;
      this.late = true;
    }
    this.turnKey = turnKey;
    if (this.sent !== null && pz.n > this.sent) { // the host judged our answer
      const last = pz.last && pz.last.n === this.sent + 1 ? pz.last : { ok: false, gain: 0 };
      const done = makePuzzle(puzzleSeed(s, me.playerId, this.sent, this.sentLevel), lang);
      this.feedback = { ok: last.ok, gain: last.gain, fact: randomFact(Rng.fromSeed(done.seed), lang), explain: done.kind === 'fact' ? done.fact : null };
      this.sent = null;
      if (last.ok) { sfx.coin?.(); haptic?.('ok'); } else sfx.wrong?.();
    }
    if (this.sent !== null) this.checking = true; else this.checking = false;
    const kids = [h('h3', {}, this.t.title), h('p.tiny.dim', {}, this.t.sub(PUZZLE_RULES.roundCap, PUZZLE_RULES.gameCap)), h('p.tiny.mute', {}, this.t.earned(roundBonus, PUZZLE_RULES.roundCap))];
    if (s.mode === 'versus' && s.config.cardsEnabled) kids.push(h('p.tiny.mute', {}, this.t.meter((pz.meter ?? 0), 3, (me.hexHand ?? []).length >= 3)));
    if (this.feedback) {
      const f = this.feedback;
      kids.push(
        h('p.big', { class: f.ok ? 'green' : 'red' }, f.ok ? this.t.right : this.t.wrong, ' ', f.ok ? (f.gain ? this.t.got(f.gain) : this.t.none) : ''),
        h('p.small.dim', {}, `${this.t.fact} ${f.explain ?? f.fact}`),
        h('button.btn.primary.block', { type: 'button', onclick: () => { this.feedback = null; this.refresh(); } }, this.t.next),
      );
    } else {
      kids.push(h('div.row.gap-s', {}, LEVELS.map(([lv, name]) => h('button.btn.small', { type: 'button', 'aria-pressed': String(this.level === lv), class: this.level === lv ? 'primary' : '', onclick: () => { this.level = lv; this.refresh(); } }, lang === 'fr' ? FR_LEVELS[name] : name))));
      const seed = puzzleSeed(s, me.playerId, pz.n, this.level);
      const p = makePuzzle(seed, lang);
      const answerKey = p.input === 'moves' ? solveSlide(p.visual.board) : p.answerKey;
      const send = (choice) => {
        this.sent = pz.n; this.sentLevel = this.level; sfx.select?.();
        const mine = pz.n;
        setTimeout(() => { if (this.sent === mine) { this.sent = null; this.refresh(); } }, 6000);
        this.o.act({ type: 'PUZZLE', playerId: me.playerId, level: this.level, seed, choice });
        this.refresh();
      };
      this.cur = { seed, answerKey, answerIndex: p.choices.findIndex((c) => c.key === p.answerKey), solve: () => send(answerKey) };
      if (this.local?.seed !== seed) { this.stopFlash(); this.local = { seed }; }
      kids.push(h('p.puzzle-prompt', {}, p.prompt));
      const locked = this.sent !== null;
      if (this.late) { kids.push(h('p.tiny.amber', {}, this.t.late)); this.late = false; }
      if (locked) kids.push(h('p.tiny.dim', {}, this.t.checking));
      const v = p.visual;
      const choiceBtn = (c, inner, cls = '') => h('button.btn.block', { type: 'button', class: cls, disabled: locked, 'data-key': c.key, onclick: () => send(c.key) }, inner);
      if (v?.type === 'slide') kids.push(this.slideView(v, locked, send));
      else if (v?.type === 'memory') kids.push(this.memoryView(v, locked, send));
      else if (v?.type === 'oddgrid') kids.push(h('div.odd-grid', { style: { gridTemplateColumns: `repeat(${v.cols}, 1fr)` } }, p.choices.map((c, i) => h('button.fig-btn', { type: 'button', disabled: locked, 'aria-label': `Shape ${i + 1}`, 'data-key': c.key, onclick: () => send(c.key) }, figure(v.cells[i], 44)))));
      else if (v?.type === 'scatter') kids.push(h('div.scatter', {}, scatter(v.items, 280)), h('div.row.gap-s', { style: { flexWrap: 'wrap' } }, p.choices.map((c) => h('button.btn.grow', { type: 'button', disabled: locked, 'data-key': c.key, onclick: () => send(c.key) }, c.label))));
      else if (v?.type === 'pattern') {
        kids.push(h('div.pattern-row', {}, ...v.seq.map((f) => h('div.fig-cell', {}, figure(f, 52))), h('div.fig-cell.q', {}, '?')));
        kids.push(h('div.pattern-choices', {}, p.choices.map((c) => h('button.fig-btn', { type: 'button', disabled: locked, 'data-key': c.key, onclick: () => send(c.key) }, figure(c.figure, 52)))));
      } else kids.push(h('div.col.gap-s', {}, p.choices.map((c) => choiceBtn(c, c.label))));
    }
    this.el.replaceChildren(...kids);
  }
}
