// Question bank: loading, normalising and validating content that lives in /data.
// Content is kept apart from game code. Nothing here marks a question as
// "verified": every question starts as `unreviewed` until a human upgrades it.

export const CATEGORIES = {
  news: { label: 'News & Current Affairs', short: 'News' },
  history: { label: 'History', short: 'History' },
  geography: { label: 'Geography', short: 'Geography' },
  science: { label: 'Science', short: 'Science' },
  phobia: { label: 'Phobias', short: 'Phobias' },
  nature: { label: 'Nature & Biology', short: 'Nature' },
  arts: { label: 'Arts & Entertainment', short: 'Arts' },
  symbols: { label: 'Symbols, Elements & Abbreviations', short: 'Symbols' },
  tunes: { label: 'Name That Tune', short: 'Tunes' },
  cinema: { label: 'Cinema', short: 'Cinema' },
  popculture: { label: 'Pop Culture', short: 'Pop' },
  manga: { label: 'Manga & Anime', short: 'Manga' },
  cooking: { label: 'Cooking & Food', short: 'Cooking' },
  finance: { label: 'Finance', short: 'Finance' },
  business: { label: 'Business', short: 'Business' },
  sports: { label: 'Sports', short: 'Sports' },
  f1: { label: 'Formula 1', short: 'F1' },
  hockey: { label: 'Hockey', short: 'Hockey' },
  music: { label: 'Music', short: 'Music' },
};

/** Categories shown in statistics, in display order. */
export const STAT_CATEGORIES = Object.keys(CATEGORIES);

export const DIFFICULTIES = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };
export const REVIEW_STATES = ['unreviewed', 'needs_review', 'verified'];
export const QUESTION_TYPES = ['mcq', 'tf', 'tune'];

/**
 * Statistics treat phobias as their own row even though they are filed under
 * the Science category in the data.
 */
export function statCategory(q) {
  return q.subcategory === 'phobia' ? 'phobia' : q.category;
}

/** Turn one raw file entry into the normalised shape the engine uses. */
export function normalizeQuestion(raw, file) {
  const category = raw.category ?? file.category;
  const isTune = category === 'tunes';
  const type = raw.type ?? (isTune ? 'tune' : 'mcq');
  let choices = raw.choices;
  let answer = raw.answer;
  if (type === 'tf') {
    choices = ['True', 'False'];
    answer = raw.answer === true ? 0 : raw.answer === false ? 1 : raw.answer;
  }
  return {
    id: raw.id,
    category,
    subcategory: raw.subcategory ?? 'general',
    difficulty: raw.difficulty,
    type,
    question: isTune ? raw.snippet : raw.question,
    choices,
    answer,
    explanation: raw.explanation,
    tags: raw.tags ?? [],
    asOf: raw.asOf ?? null,
    date: raw.date ?? null, // YYYY-MM-DD of the event, used to expire live news
    freshness: raw.freshness ?? file.freshness ?? 'evergreen',
    review: raw.review ?? file.review ?? 'unreviewed',
    audio: raw.audio ?? null,
    audioCredit: raw.audioCredit ?? null,
    refs: raw.refs ?? [],
  };
}

export function normalizeFile(file) {
  return (file.questions ?? []).map((raw) => normalizeQuestion(raw, file));
}

/**
 * Load the full bank. `readJson(relativePath)` is injected so the same code
 * runs in the browser (fetch) and in Node tests (fs).
 */
export async function loadBank(readJson, base = 'data/questions/') {
  const index = await readJson(base + 'index.json');
  const files = await Promise.all(index.files.map((name) => readJson(base + name)));
  const questions = files.flatMap(normalizeFile);
  const vfiles = await Promise.all((index.variantFiles ?? []).map((name) => Promise.resolve(readJson(base + name)).catch(() => null)));
  const variants = applyVariants(questions, vfiles.filter(Boolean));
  return { version: index.version, questions, variants };
}

/** The level a question naturally sits at: easy (1), medium (2) or hard (3, which includes expert). */
export const levelOfDifficulty = (d) => (d <= 1 ? 1 : d === 2 ? 2 : 3);

/**
 * Difficulty ladders. A variants file lists families: { id, ask: {1,2,3}, variants: [{ level, question, choices, answer, explanation }] }.
 * The original question stays as it is and is marked with its own level; the other levels become extra questions
 * (id "<id>~<level>") that are never drawn by themselves, only asked when the stake picks that level.
 * Returns the generated variants. Primary questions get `family`, `level` and `ask` filled in.
 */
export function applyVariants(questions, files) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out = [];
  for (const file of files) {
    for (const fam of file.families ?? []) {
      const base = byId.get(fam.id);
      if (!base) continue;
      base.family = base.id;
      base.level = levelOfDifficulty(base.difficulty);
      base.ask = fam.ask?.[base.level] ?? null;
      for (const v of fam.variants ?? []) {
        if (![1, 2, 3].includes(v.level) || v.level === base.level) continue;
        const q = normalizeQuestion({ ...base, ...v, type: v.type ?? 'mcq', id: `${base.id}~${v.level}`, difficulty: v.difficulty ?? v.level, tags: base.tags, refs: [], subcategory: v.subcategory ?? base.subcategory }, { category: base.category, review: base.review, freshness: base.freshness });
        q.family = base.id; q.level = v.level; q.ask = fam.ask?.[v.level] ?? null; q.review = base.review;
        out.push(q);
      }
    }
  }
  return out;
}

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'is', 'was', 'what', 'which', 'who', 'does', 'did', 'for', 'to']);

// Short tokens such as chemical symbols ("Na", "Pb") are meaningful, so keep them.
function tokenSet(s) {
  return new Set(norm(s).split(' ').filter((w) => w && !STOPWORDS.has(w)));
}

function sameAnswerOrChoices(a, b) {
  if (!Array.isArray(a.choices) || !Array.isArray(b.choices)) return false;
  if (norm(a.choices[a.answer]) === norm(b.choices[b.answer])) return true;
  const setB = new Set(b.choices.map(norm));
  return a.choices.filter((c) => setB.has(norm(c))).length >= 3;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Validate a normalised question list. Returns errors (must fix),
 * warnings (worth a look) and simple coverage stats.
 */
export function validateQuestions(questions, { minPerCategory = 8 } = {}) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const tokens = [];

  for (const q of questions) {
    const where = q.id ?? '(missing id)';
    const err = (m) => errors.push(`${where}: ${m}`);

    if (!q.id || typeof q.id !== 'string') err('missing id');
    else if (ids.has(q.id)) err('duplicate id');
    else ids.add(q.id);

    if (!CATEGORIES[q.category]) err(`unknown category "${q.category}"`);
    if (!QUESTION_TYPES.includes(q.type)) err(`unknown type "${q.type}"`);
    if (![1, 2, 3, 4].includes(q.difficulty)) err('difficulty must be 1-4');
    if (typeof q.question !== 'string' || q.question.trim().length < 8) err('question text missing or too short');
    else if (q.question.length > 260) warnings.push(`${where}: question text is long (${q.question.length} chars)`);
    if (typeof q.explanation !== 'string' || q.explanation.trim().length < 8) err('explanation missing');
    if (!REVIEW_STATES.includes(q.review)) err(`unknown review state "${q.review}"`);
    if (q.freshness === 'dated' && !q.asOf) err('dated question needs an asOf date (YYYY-MM)');
    if (q.date && !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) err('date must look like YYYY-MM-DD');
    if (q.asOf && !/^\d{4}-\d{2}$/.test(q.asOf)) err('asOf must look like YYYY-MM');

    if (!Array.isArray(q.choices) || q.choices.length < 2) err('needs at least 2 choices');
    else {
      if (q.type === 'mcq' && q.choices.length !== 4) warnings.push(`${where}: expected 4 choices, found ${q.choices.length}`);
      if (new Set(q.choices.map(norm)).size !== q.choices.length) err('choices are not unique');
      if (q.choices.some((c) => typeof c !== 'string' || !c.trim())) err('empty choice');
      if (q.choices.some((c) => c.length > 120)) warnings.push(`${where}: a choice is very long`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) err('answer index out of range');
    }
    if (q.type === 'tune' && !q.audio) warnings.push(`${where}: tune has no audio, so the reveal will be silent`);

    tokens.push([q, tokenSet(q.question)]);
  }

  // Duplicate and near-duplicate detection.
  const seenText = new Map();
  for (const [q] of tokens) {
    const key = norm(q.question);
    if (seenText.has(key) && !(q.family && q.family === seenText.get(key).family)) errors.push(`${q.id}: same question text as ${seenText.get(key).id}`);
    else seenText.set(key, q);
  }
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const [a, ta] = tokens[i];
      const [b, tb] = tokens[j];
      if (norm(a.question) === norm(b.question)) continue;
      if (a.family && a.family === b.family) continue;
      // Templated questions ("Which element has the symbol X?") share most
      // words by design, so also require the same answer or overlapping choices.
      if (jaccard(ta, tb) >= 0.75 && sameAnswerOrChoices(a, b)) {
        warnings.push(`${a.id} and ${b.id} look like near-duplicates`);
      }
    }
  }

  // Coverage.
  const byCategory = {};
  const byDifficulty = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byReview = {};
  for (const q of questions) {
    const key = statCategory(q);
    byCategory[key] = (byCategory[key] ?? 0) + 1;
    if (byDifficulty[q.difficulty] !== undefined) byDifficulty[q.difficulty]++;
    byReview[q.review] = (byReview[q.review] ?? 0) + 1;
  }
  for (const key of Object.keys(CATEGORIES)) {
    if (key === 'tunes') continue; // intentionally empty until licensed content exists
    if ((byCategory[key] ?? 0) < minPerCategory) warnings.push(`category "${key}" has only ${byCategory[key] ?? 0} questions`);
  }

  return { errors, warnings, stats: { total: questions.length, byCategory, byDifficulty, byReview } };
}
