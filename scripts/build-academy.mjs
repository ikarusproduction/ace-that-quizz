// Generates the Associations and Dates questions of Champion's Academy from two small tables of facts.
//   data/academy/relations.json  ->  data/questions/assoc.json  + variants/assoc.json
//   data/academy/events.json     ->  data/questions/chrono.json + variants/chrono.json
// and their French text into data/i18n/fr.json. Deterministic: the same tables always give the same bank.
// Drafting is kept apart from publishing: every generated question is review "unreviewed" and carries no source or
// verification date, because the tables are unreviewed drafts. Usage: node scripts/build-academy.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Rng } from '../src/engine/rng.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const rd = async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8'));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const pair = (en, fr) => ({ en, fr: fr ?? en });
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Question texts already in the hand-written bank: a generated question never repeats one of them. */
async function existingTexts() {
  const idx = await rd('data/questions/index.json'); const seen = new Set();
  for (const f of [...idx.files, ...idx.variantFiles]) {
    if (/assoc|chrono/.test(f)) continue;
    const j = await rd(`data/questions/${f}`).catch(() => null);
    for (const q of j?.questions ?? []) seen.add(norm(q.question ?? ''));
    for (const fam of j?.families ?? []) for (const v of fam.variants) seen.add(norm(v.question ?? ''));
  }
  return seen;
}

/** Compact JSON with ", " and ": " separators, the way data/i18n/fr.json is stored. */
const ser = (v) => (Array.isArray(v) ? `[${v.map(ser).join(', ')}]` : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${ser(x)}`).join(', ')}}` : JSON.stringify(v));

/** Shuffle choices once, keep English and French aligned, return { choices, fr, answer }. */
function shuffled(id, correct, wrongs) {
  const all = [correct, ...wrongs];
  if (all.length !== 4) throw new Error(`${id} needs four choices, has ${all.length}`);
  if (new Set(all.map((c) => c.en)).size !== all.length) throw new Error(`duplicate choice in ${id}`);
  const out = Rng.fromSeed(`acad:${id}`).shuffle(all);
  return { choices: out.map((c) => c.en), fr: out.map((c) => c.fr), answer: out.findIndex((c) => c === correct) };
}

/* ------------------------------------------------------------------ associations */
const LOOSE = new Set(['concept-discipline', 'figure-period']); // distractors always come from other groups: the link is looser

function buildAssoc(rel, taken) {
  const questions = []; const families = []; const fr = {};
  const byType = new Map();
  for (const f of rel.facts) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  const side = (f, which) => pair(cap(which === 'a' ? f.a : f.b), cap((which === 'a' ? f.a_fr : f.b_fr) ?? (which === 'a' ? f.a : f.b)));
  for (const f of rel.facts) {
    const t = rel.types[f.type]; const pool = byType.get(f.type).filter((x) => x.id !== f.id);
    const rng = Rng.fromSeed(`assoc:${f.id}`);
    const pickN = (cands, n) => rng.shuffle(cands).slice(0, n);
    // `forward` asks for the b side from a; `reverse` asks for the a side from b.
    const make = (level) => {
      const reverse = level === 3;
      const close = level >= 2 && !LOOSE.has(f.type);
      const key = reverse ? 'a' : 'b'; const other = reverse ? 'b' : 'a';
      const ok = (x) => x[key] !== f[key] && x[key].toLowerCase() !== f[key].toLowerCase() && x[other] !== f[other];
      const seenKey = new Set([f[key]]);
      const uniq = (list) => list.filter((x) => (seenKey.has(x[key]) ? false : (seenKey.add(x[key]), true)));
      const sameGrp = pool.filter((x) => x.grp === f.grp && ok(x)); const otherGrp = pool.filter((x) => x.grp !== f.grp && ok(x));
      const order = close ? [...pickN(sameGrp, 3), ...pickN(otherGrp, 3)] : [...pickN(otherGrp, 3), ...pickN(sameGrp, 3)];
      const wrongs = uniq(order).slice(0, 3);
      if (wrongs.length < 3) throw new Error(`not enough distractors for ${f.id} level ${level}`);
      const tpl = reverse ? t.rev : t.fwd; const given = reverse ? 'b' : 'a';
      const g = side(f, given);
      const sub = (s, v) => s.replace(`{${given}}`, v);
      const { choices, fr: frChoices, answer } = shuffled(`${f.id}:${level}`, side(f, key), wrongs.map((x) => side(x, key)));
      let question = sub(tpl.en, g.en); let questionFr = sub(tpl.fr, g.fr);
      if (taken.has(norm(question))) { // the hand-written bank already asks this: ask it as a link instead
        question = reverse ? `Which of these names is linked to ${g.en}?` : `Which of these is linked to ${g.en}?`;
        questionFr = reverse ? `Parmi ces noms, lequel est lié à : ${g.fr} ?` : `Parmi ceux-ci, lequel est lié à : ${g.fr} ?`;
      }
      return { level, question, questionFr, choices, frChoices, answer, explanation: f.expl.en, explanationFr: f.expl.fr, direction: reverse ? 'reverse' : 'forward' };
    };
    const id = `as-${f.id}`; const d = Math.max(1, Math.min(3, f.d ?? 2));
    const built = [1, 2, 3].map(make);
    const base = built.find((b) => b.level === d);
    const mkQ = (b) => ({ question: b.question, choices: b.choices, answer: b.answer, explanation: b.explanation });
    questions.push({ id, category: t.category, subcategory: t.subcategory, difficulty: base.level, ...mkQ(base), tags: ['assoc', f.type], format: 'assoc', relation: `${f.type}:${base.direction}`, ...(f.mnemonic ? { mnemonic: f.mnemonic } : {}), review: 'unreviewed' });
    families.push({ id, ask: { 1: 'Name the link', 2: 'Close options', 3: 'The other way round' }, variants: built.filter((b) => b.level !== base.level).map((b) => ({ level: b.level, ...mkQ(b), relation: `${f.type}:${b.direction}` })) });
    for (const b of built) fr[b.level === base.level ? id : `${id}~${b.level}`] = { q: b.questionFr, c: b.frChoices, e: b.explanationFr };
  }
  return { questions, families, fr };
}

/* ------------------------------------------------------------------ dates and chronology */
const ordinalEn = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
const centuryOf = (y) => Math.ceil(Math.abs(y) / 100);
const yearTxt = (y) => pair(y < 0 ? `${-y} BC` : `${y}`, y < 0 ? `${-y} av. J.-C.` : `${y}`);
const centuryTxt = (y) => { const c = centuryOf(y); return y < 0 ? pair(`${ordinalEn(c)} century BC`, `${ROMAN[c]}${c === 1 ? 'er' : 'e'} siècle av. J.-C.`) : pair(`${ordinalEn(c)} century`, `${ROMAN[c]}${c === 1 ? 'er' : 'e'} siècle`); };

function buildChrono(ev) {
  const questions = []; const families = []; const fr = {};
  const all = ev.events;
  const ambiguousCentury = (y) => Math.abs(y) % 100 <= 1 || Math.abs(y) % 100 === 99; // year 800, 1900 and neighbours sit on a boundary
  const name = (e) => pair(e.name.en, e.name.fr);
  all.forEach((e, i) => {
    const rng = Rng.fromSeed(`chrono:${e.id}`); const id = `ch-${e.id}`;
    // level 1: a year is given, name the event (the other events are centuries away)
    const far = all.filter((x) => Math.abs(x.year - e.year) >= 120);
    const l1 = shuffled(`${id}:1`, name(e), rng.shuffle(far).slice(0, 3).map(name));
    // level 2: an event is given, name the year (alternating with the century when that is unambiguous)
    const useCentury = i % 2 === 1 && !ambiguousCentury(e.year);
    let l2;
    if (useCentury) {
      const c = centuryOf(e.year); const sign = e.year < 0 ? -1 : 1;
      const near = [-3, -2, -1, 1, 2, 3].map((d) => c + sign * d).filter((x) => x >= 1 && x <= 21).map((x) => centuryTxt(sign * (x * 100 - 50)));
      const wrongs = rng.shuffle(near).slice(0, 3);
      l2 = { ...shuffled(`${id}:2`, centuryTxt(e.year), wrongs), q: pair(`In which century did this happen: ${e.name.en}?`, `À quel siècle appartient l'événement suivant : ${e.name.fr} ?`) };
    } else {
      const wrongs = []; const used = new Set([e.year]);
      for (const step of rng.shuffle([-90, -60, -35, -20, 20, 35, 60, 90, 140])) {
        const y = e.year + step; const near = [...used].some((u) => Math.abs(u - y) < 10);
        if (!near && !all.some((x) => x.id !== e.id && x.year === y && false)) { wrongs.push(y); used.add(y); }
        if (wrongs.length === 3) break;
      }
      l2 = { ...shuffled(`${id}:2`, yearTxt(e.year), wrongs.map(yearTxt)), q: pair(`In which year did this happen: ${e.name.en}?`, `En quelle année a eu lieu l'événement suivant : ${e.name.fr} ?`) };
    }
    // level 3: put it first among four events at least 25 years apart
    const asc = rng.chance(0.5); const spread = (x) => all.filter((o) => o.id !== e.id && (asc ? o.year > e.year + 25 : o.year < e.year - 25));
    const rivals = rng.shuffle(spread()).filter((o, k, arr) => arr.slice(0, k).every((p) => Math.abs(p.year - o.year) >= 25)).slice(0, 3);
    const flip = rivals.length < 3; // the earliest or the latest events cannot be first or last: ask the other way round
    const dir = flip ? !asc : asc;
    const rv = flip ? rng.shuffle(all.filter((o) => o.id !== e.id && (dir ? o.year > e.year + 25 : o.year < e.year - 25))).filter((o, k, arr) => arr.slice(0, k).every((p) => Math.abs(p.year - o.year) >= 25)).slice(0, 3) : rivals;
    if (rv.length < 3) throw new Error(`cannot build an ordering question for ${e.id}`);
    const ys = [e, ...rv].map((x) => x.year); const span = pair(`${yearTxt(Math.min(...ys)).en} and ${yearTxt(Math.max(...ys)).en}`, `${yearTxt(Math.min(...ys)).fr} et ${yearTxt(Math.max(...ys)).fr}`);
    const l3 = { ...shuffled(`${id}:3`, name(e), rv.map(name)), q: dir ? pair(`Which of these events, all between ${span.en}, happened first?`, `Lequel de ces événements, tous entre ${span.fr}, s'est produit en premier ?`) : pair(`Which of these events, all between ${span.en}, happened last?`, `Lequel de ces événements, tous entre ${span.fr}, s'est produit en dernier ?`) };
    const lv = { 1: { ...l1, q: pair(`Which event took place in ${yearTxt(e.year).en}?`, `Quel événement a eu lieu en ${yearTxt(e.year).fr} ?`) }, 2: l2, 3: l3 };
    const expl = pair(e.expl.en, e.expl.fr);
    const d = 2; const mk = (l) => ({ question: lv[l].q.en, choices: lv[l].choices, answer: lv[l].answer, explanation: expl.en });
    questions.push({ id, category: e.category, subcategory: 'dates', difficulty: d, ...mk(d), tags: ['chrono'], format: 'chrono', relation: useCentury ? 'event:century' : 'event:year', review: 'unreviewed' });
    families.push({ id, ask: { 1: 'Year to event', 2: useCentury ? 'Which century' : 'Date it', 3: 'Put in order' }, variants: [1, 3].map((l) => ({ level: l, ...mk(l), relation: l === 1 ? 'year:event' : 'event:order' })) });
    for (const l of [1, 2, 3]) fr[l === d ? id : `${id}~${l}`] = { q: lv[l].q.fr, c: lv[l].fr, e: expl.fr };
  });
  return { questions, families, fr };
}

/* ------------------------------------------------------------------ write */
async function emit(name, cat, built, mine) {
  const qPath = `data/questions/${name}.json`; const vPath = `data/questions/variants/${name}.json`;
  await writeFile(join(root, qPath), JSON.stringify({ category: cat, review: 'unreviewed', note: 'Generated by scripts/build-academy.mjs from data/academy. Unreviewed drafts: no source or verification date yet.', questions: built.questions }, null, 1));
  await writeFile(join(root, vPath), JSON.stringify({ category: cat, review: 'unreviewed', note: 'Generated by scripts/build-academy.mjs.', families: built.families }, null, 1));
  return mine;
}

const rel = await rd('data/academy/relations.json'); const ev = await rd('data/academy/events.json');
const a = buildAssoc(rel, await existingTexts()); const c = buildChrono(ev);
await emit('assoc', 'history', a); await emit('chrono', 'history', c); // each question names its own category
const fr = await rd('data/i18n/fr.json');
for (const k of Object.keys(fr)) if (/^(as|ch)-/.test(k)) delete fr[k];
Object.assign(fr, a.fr, c.fr);
await writeFile(join(root, 'data/i18n/fr.json'), ser(fr));
const idx = await rd('data/questions/index.json');
for (const f of ['assoc.json', 'chrono.json']) if (!idx.files.includes(f)) idx.files.push(f);
for (const f of ['variants/assoc.json', 'variants/chrono.json']) if (!idx.variantFiles.includes(f)) idx.variantFiles.push(f);
await writeFile(join(root, 'data/questions/index.json'), JSON.stringify(idx, null, 2) + '\n');
console.log(`associations: ${a.questions.length} concepts · chronology: ${c.questions.length} concepts · French entries: ${Object.keys(a.fr).length + Object.keys(c.fr).length}`);
// Run node scripts/sort-bank.mjs afterwards to restore difficulty order.
