// The Periodic Table trainer: memory cards and quizzes to learn all 118 elements by heart.
// Pure functions. Every card is one (element, facet) pair, tracked by the same spaced-repetition engine as Train and the
// Adventure (learning.js), under ids like "pt-26-sym". Nothing here touches the DOM or storage.
//
// Facets (what is asked):
//   sym   the name is shown, recall the symbol          name  the symbol is shown, recall the name
//   num   the name is shown, recall the atomic number   elz   the number is shown, recall the element
//   grp   which group          per   which period       cat   which family          state  gas, liquid or solid
// "Known by heart" means the four recall facets (sym, name, num, elz) are all in review or mastered.
import { Rng } from './rng.js';
import { newItem, grade, DAY } from './learning.js';
import { ELEMENTS, BY_Z, AMBIGUOUS, CATEGORIES, CATEGORY_IDS, NAME_ALIASES, nameOf } from './elements.js';

export const FACETS = ['sym', 'name', 'num', 'elz', 'grp', 'per', 'cat', 'state'];
export const CORE = ['sym', 'name', 'num', 'elz'];
export const FACET_SETS = {
  names: { label: 'Symbols and names', facets: ['sym', 'name'] },
  numbers: { label: 'Atomic numbers', facets: ['num', 'elz'] },
  places: { label: 'Groups, periods and families', facets: ['grp', 'per', 'cat', 'state'] },
  core: { label: 'Symbols, names and numbers', facets: CORE },
  all: { label: 'Everything', facets: FACETS },
};
/** Groups of elements to study, in table order. */
export const RANGES = [
  { id: 'all', label: 'All 118', from: 1, to: 118 },
  { id: 'p1', label: '1 to 20', from: 1, to: 20 },
  { id: 'p2', label: '21 to 54', from: 21, to: 54 },
  { id: 'p3', label: '55 to 86', from: 55, to: 86 },
  { id: 'p4', label: '87 to 118', from: 87, to: 118 },
];
export const cardId = (z, facet) => `pt-${z}-${facet}`;
export const parseCardId = (id) => { const m = /^pt-(\d+)-(\w+)$/.exec(id); return m ? { z: Number(m[1]), facet: m[2] } : null; };

/** Does this (element, facet) have exactly one defensible answer? */
export function applies(e, facet) {
  if (facet === 'grp') return e.group != null && !AMBIGUOUS.group.has(e.z);
  if (facet === 'cat') return !AMBIGUOUS.category.has(e.z);
  if (facet === 'state') return e.state != null;
  return true;
}

/* ------------------------------------------------------------------ text */

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const T = {
  en: {
    sym: (e, L) => `What is the symbol of ${L.name}?`, name: (e) => `Which element has the symbol ${e.symbol}?`, num: (e, L) => `What is the atomic number of ${L.name}?`,
    elz: (e) => `Which element has atomic number ${e.z}?`, grp: (e, L) => `Which group is ${L.name} in?`, per: (e, L) => `Which period is ${L.name} in?`,
    cat: (e, L) => `What kind of element is ${L.name}?`, state: (e, L) => `Is ${L.name} a gas, a liquid or a solid at room temperature?`,
    group: (g) => `Group ${g}`, period: (p) => `Period ${p}`, states: { gas: 'A gas', liquid: 'A liquid', solid: 'A solid' },
  },
  fr: {
    sym: (e, L) => `Quel est le symbole de ${L.s} ?`, name: (e) => `Quel élément a pour symbole ${e.symbol} ?`, num: (e, L) => `Quel est le numéro atomique de ${L.s} ?`,
    elz: (e) => `Quel élément a pour numéro atomique ${e.z} ?`, grp: (e, L) => `Dans quelle colonne (groupe) se trouve ${L.s} ?`, per: (e, L) => `Sur quelle période (ligne) se trouve ${L.s} ?`,
    cat: (e, L) => `De quelle famille est ${L.s} ?`, state: (e, L) => `${L.s} est-il un gaz, un liquide ou un solide à température ambiante ?`,
    group: (g) => `Groupe ${g}`, period: (p) => `Période ${p}`, states: { gas: 'Un gaz', liquid: 'Un liquide', solid: 'Un solide' },
  },
};
const langOf = (lang) => (lang === 'fr' ? 'fr' : 'en');

/** The question, the right answer (as text) and the explanation for one card. */
export function cardText(e, facet, lang = 'en') {
  const l = langOf(lang); const t = T[l];
  const nm = nameOf(e, l);
  const L = { name: nm, s: l === 'fr' ? nm[0].toLowerCase() + nm.slice(1) : nm }; // French names are lower case inside a sentence
  const place = `${t.group(e.group ?? '–')}, ${t.period(e.period)}`;
  const detail = e.group == null ? `${e.symbol} · ${L.name} · ${e.z} · ${t.period(e.period)} · ${CATEGORIES[e.cat][l]}` : `${e.symbol} · ${L.name} · ${e.z} · ${place} · ${CATEGORIES[e.cat][l]}`;
  const origin = e.origin ? (l === 'fr' ? ` (${e.symbol} vient de « ${e.origin} »)` : ` (${e.symbol} comes from “${e.origin}”)`) : '';
  const answer = {
    sym: e.symbol, name: L.name, num: String(e.z), elz: L.name, grp: t.group(e.group), per: t.period(e.period),
    cat: CATEGORIES[e.cat]?.[l], state: t.states[e.state],
  }[facet];
  return { question: t[facet](e, L), answer, explain: `${detail}${origin}` };
}

/* ------------------------------------------------------------- distractors */

/** Elements a learner is likely to confuse with e: its table neighbours, its group, its first letter. */
function lookalikes(e) {
  return ELEMENTS.filter((o) => o.z !== e.z && (Math.abs(o.z - e.z) <= 4 || (o.group != null && o.group === e.group) || o.symbol[0] === e.symbol[0] || o.symbol.toLowerCase() === e.symbol.toLowerCase()));
}
function pickDistinct(rng, candidates, answer, n = 3, key = (x) => x) {
  const out = []; const seen = new Set([key(answer)]);
  for (const c of rng.shuffle(candidates.slice())) { const k = key(c); if (!seen.has(k)) { seen.add(k); out.push(c); if (out.length === n) break; } }
  return out;
}

/** Four choices (three for a state) with the right one at a seeded position. Returns { choices, answer }. */
export function choicesFor(e, facet, rng, lang = 'en') {
  const l = langOf(lang); const t = T[l];
  const right = cardText(e, facet, l).answer;
  let wrong;
  if (facet === 'sym') wrong = pickDistinct(rng, lookalikes(e).map((o) => o.symbol), e.symbol);
  else if (facet === 'name' || facet === 'elz') wrong = pickDistinct(rng, lookalikes(e).map((o) => nameOf(o, l)), nameOf(e, l));
  else if (facet === 'num') {
    const near = []; for (let d = -7; d <= 7; d++) { const z = e.z + d; if (d && z >= 1 && z <= 118) near.push(String(z)); }
    wrong = pickDistinct(rng, near, String(e.z));
  } else if (facet === 'grp') {
    const near = [e.group - 1, e.group + 1, e.group - 2, e.group + 2, e.group - 3, e.group + 3].filter((g) => g >= 1 && g <= 18);
    wrong = pickDistinct(rng, near.map((g) => t.group(g)), right);
  } else if (facet === 'per') {
    wrong = pickDistinct(rng, [1, 2, 3, 4, 5, 6, 7].map((p) => t.period(p)), right);
  } else if (facet === 'cat') {
    wrong = pickDistinct(rng, CATEGORY_IDS.map((c) => CATEGORIES[c][l]), right);
  } else wrong = ['gas', 'liquid', 'solid'].map((s) => t.states[s]).filter((x) => x !== right);
  const choices = rng.shuffle([right, ...wrong]);
  return { choices, answer: choices.indexOf(right) };
}

/** Is a typed answer right? Case, accents and spaces do not matter; the other language's name and common spellings are accepted. */
export function checkTyped(e, facet, text) {
  const x = fold(text);
  if (!x) return false;
  if (facet === 'sym') return x === fold(e.symbol);
  if (facet === 'num') return x === String(e.z);
  if (facet === 'name' || facet === 'elz') {
    const ok = [e.en, e.fr, ...(NAME_ALIASES[e.en] ?? []), ...(NAME_ALIASES[e.fr] ?? [])].map(fold);
    return ok.includes(x);
  }
  return false;
}
export const canType = (facet) => ['sym', 'name', 'elz', 'num'].includes(facet);

/* ------------------------------------------------------------- progress */

const RANK = { new: 0, learning: 1, relearning: 1, review: 2, mastered: 3 };
export function statusOf(learn, z, now = 0) {
  const items = CORE.map((f) => learn?.items?.[cardId(z, f)]);
  const ranks = items.map((it) => RANK[it?.state ?? 'new']);
  const touched = ranks.some((r) => r > 0);
  const low = Math.min(...ranks);
  const state = !touched ? 'new' : low >= 3 ? 'mastered' : low >= 2 ? 'review' : 'learning';
  const due = items.some((it) => it && it.state !== 'new' && it.due <= now);
  return { state, due, pct: Math.round((ranks.reduce((a, b) => a + b, 0) / (ranks.length * 3)) * 100) };
}

/** { known, mastered, learning, fresh, due, total } across the whole table, plus a status per element. */
export function progress(learn, now = 0) {
  const per = {}; let known = 0; let mastered = 0; let learning = 0; let fresh = 0; let due = 0;
  for (const e of ELEMENTS) {
    const s = statusOf(learn, e.z, now); per[e.z] = s;
    if (s.state === 'new') fresh++; else if (s.state === 'learning') learning++; else { known++; if (s.state === 'mastered') mastered++; }
  }
  for (const [id, it] of Object.entries(learn?.items ?? {})) if (parseCardId(id) && it.state !== 'new' && it.due <= now) due++;
  return { known, mastered, learning, fresh, due, total: ELEMENTS.length, per };
}

/* ------------------------------------------------------------- sessions */

/** Which cards to study now: what is due first, then new elements in table order (all of an element's cards together). */
export function buildSession({ learn, now = 0, seed = 'pt', size = 20, range = RANGES[0], facets = FACET_SETS.core.facets, newLimit = 5, extra = true }) {
  const items = learn?.items ?? {};
  const inRange = ELEMENTS.filter((e) => e.z >= range.from && e.z <= range.to);
  const cards = [];
  for (const e of inRange) for (const f of facets) if (applies(e, f)) cards.push({ id: cardId(e.z, f), z: e.z, facet: f, it: items[cardId(e.z, f)] });
  const due = cards.filter((c) => c.it && c.it.state !== 'new' && c.it.due <= now).sort((a, b) => a.it.due - b.it.due);
  const fresh = cards.filter((c) => !c.it || c.it.state === 'new');
  const picked = due.slice(0, size);
  // new material: the next few elements in table order, all of an element's cards together
  const startZ = []; for (const c of fresh) if (!startZ.includes(c.z) && startZ.length < newLimit) startZ.push(c.z);
  const newCards = fresh.filter((c) => startZ.includes(c.z)).slice(0, Math.max(0, size - picked.length));
  const queue = [...picked, ...newCards].slice(0, size);
  if (extra && queue.length < Math.min(size, 8)) {
    // nothing due and nothing new: an early review of the shakiest cards, so the session is never empty
    const rest = cards.filter((c) => c.it && c.it.state !== 'new' && !queue.includes(c)).sort((a, b) => (a.it.interval ?? 0) - (b.it.interval ?? 0));
    queue.push(...rest.slice(0, Math.min(size, 8) - queue.length));
  }
  const rng = Rng.fromSeed(`${seed}:order`);
  // due cards are mixed; brand-new elements stay in table order so the first meeting is orderly
  const dueQ = rng.shuffle(queue.filter((c) => c.it && c.it.state !== 'new'));
  const newQ = queue.filter((c) => !c.it || c.it.state === 'new');
  return [...dueQ, ...newQ].map(({ id, z, facet }) => ({ id, z, facet, fresh: !items[id] || items[id].state === 'new' }));
}

/** Turn a session into quiz questions (multiple choice, or typed when `typed` and the facet allows it). */
export function buildQuiz({ learn, now = 0, seed = 'ptq', size = 10, range = RANGES[0], facets = FACET_SETS.core.facets, lang = 'en', typed = false, newLimit = 3 }) {
  const cards = buildSession({ learn, now, seed, size, range, facets, newLimit });
  return cards.map((c, i) => {
    const e = BY_Z[c.z]; const rng = Rng.fromSeed(`${seed}:${c.id}:${i}`);
    const txt = cardText(e, c.facet, lang);
    const type = typed && canType(c.facet);
    return { ...c, type: type ? 'type' : 'choice', question: txt.question, correct: txt.answer, explain: txt.explain, ...(type ? {} : choicesFor(e, c.facet, rng, lang)) };
  });
}

/** The learning outcome for a flashcard grade ('again' | 'hard' | 'good' | 'easy') or a quiz answer. level: 1 choice, 2 self-graded recall, 3 typed. */
export function outcomeOf(card, how, { wrongText = null, level = 2 } = {}) {
  const base = { id: card.id, level };
  if (how === 'again' || how === false) return { ...base, correct: false, hints: 0, confidence: null, ...(wrongText ? { wrongText } : {}) };
  if (how === 'hard') return { ...base, correct: true, hints: 1, confidence: 'maybe' };
  if (how === 'easy') return { ...base, correct: true, hints: 0, confidence: 'sure' };
  return { ...base, correct: true, hints: 0, confidence: null };
}

/** Preview what a grade does to a card (used for the little "see you in 3 days" under each button). */
export function nextInterval(item, how, now) {
  const it = item ?? newItem('x', now);
  const out = grade(it, outcomeOf({ id: 'x' }, how), now);
  return Math.max(0, out.due - now);
}
export function intervalText(ms) {
  if (ms < 60 * 60000) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (ms < DAY) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / DAY)} d`;
}
