// "While you wait" panel: a puzzle for players who are not on turn (online). The element is reused across
// renders so a half-read puzzle is never wiped by an incoming game update.
import { h } from './dom.js';
import { makePuzzle, randomFact, PUZZLE_RULES } from '../engine/minigame.js';
import { puzzleSeed } from '../engine/game.js';
import { Rng } from '../engine/rng.js';
import { sfx } from './audio.js';
import { haptic } from './fx.js';

const LEVELS = [[1, 'Easy'], [2, 'Medium'], [3, 'Hard']];
const FR_LEVELS = { Easy: 'Facile', Medium: 'Moyen', Hard: 'Difficile' };
const UI = {
  en: { title: 'While you wait', sub: (r, g) => `Solve puzzles for bonus chips (up to ${r} per round, ${g} per game).`, got: (n) => `+${n} chips`, none: 'Chip cap reached for now', right: 'Correct!', wrong: 'Not quite.', next: 'Next puzzle', fact: 'Did you know?', earned: (a, b) => `Earned this round: ${a} / ${b}`, late: 'Too late: the turn moved on before your answer counted. Here is a fresh one.', checking: 'Checking your answer with the host…', meter: (n, of, full) => (full ? 'Hex hand full: play a prank!' : `Prank meter ${n}/${of}: every ${of} right answers earn a hex to play on the answerer`) },
  fr: { title: 'En attendant', sub: (r, g) => `Résous des énigmes pour gagner des jetons (max ${r} par manche, ${g} par partie).`, got: (n) => `+${n} jetons`, none: 'Plafond de jetons atteint pour le moment', right: 'Bonne réponse !', wrong: 'Raté.', next: 'Énigme suivante', fact: 'Le saviez-vous ?', earned: (a, b) => `Gagnés cette manche : ${a} / ${b}`, late: "Trop tard : le tour a changé avant que ta réponse compte. En voici une nouvelle.", checking: "Vérification de ta réponse par l'hôte…", meter: (n, of, full) => (full ? 'Main de hexes pleine : lance une farce !' : `Jauge de farce ${n}/${of} : ${of} bonnes réponses = un hex à lancer sur celui qui répond`) },
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
      this.cur = { seed, answerIndex: p.choices.findIndex((c) => c.key === p.answerKey) };
      kids.push(h('p.puzzle-prompt', {}, p.prompt));
      const locked = this.sent !== null;
      if (this.late) { kids.push(h('p.tiny.amber', {}, this.t.late)); this.late = false; }
      if (locked) kids.push(h('p.tiny.dim', {}, this.t.checking));
      kids.push(h('div.col.gap-s', {}, p.choices.map((c) => h('button.btn.block', {
        type: 'button', disabled: locked,
        onclick: () => { this.sent = pz.n; this.sentLevel = this.level; sfx.select?.(); const mine = pz.n; setTimeout(() => { if (this.sent === mine) { this.sent = null; this.refresh(); } }, 6000); this.o.act({ type: 'PUZZLE', playerId: me.playerId, level: this.level, seed, choice: c.key }); this.refresh(); },
      }, c.label))));
    }
    this.el.replaceChildren(...kids);
  }
}
