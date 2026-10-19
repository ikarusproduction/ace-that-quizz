// Theme catalogue: what the player can put in the five slots before a game.
// A theme is a pool of questions. Some themes merge several bank categories
// (Science includes phobias; Music includes tune clips and the Arts music questions).
import { statCategory } from './bank.js';

export const NEWS_WINDOW_DAYS = 14;
/** Live news only counts while it is at most two weeks old (and never from the future). */
export function isFreshNews(q, now = Date.now()) {
  if (!q.date) return false;
  const t = Date.parse(`${q.date}T12:00:00Z`);
  if (Number.isNaN(t)) return false;
  const age = (now - t) / 86400000;
  return age <= NEWS_WINDOW_DAYS && age >= -1;
}

/** @type {Record<string,{label:string, short:string, sprite:string, group:string, match:(q:any)=>boolean}>} */
export const THEMES = {
  science: { label: 'Science', short: 'Science', sprite: 'science', group: 'Brain', match: (q) => q.category === 'science' },
  medicine: { label: 'Medicine & Health', short: 'Medicine', sprite: 'medicine', group: 'Brain', match: (q) => q.category === 'medicine' },
  literature: { label: 'Literature & Language', short: 'Literature', sprite: 'arts', group: 'Brain', match: (q) => q.category === 'literature' },
  mythology: { label: 'Mythology & Religions', short: 'Myth', sprite: 'history', group: 'Brain', match: (q) => q.category === 'mythology' },
  philosophy: { label: 'Philosophy & Ideas', short: 'Philosophy', sprite: 'science', group: 'Brain', match: (q) => q.category === 'philosophy' },
  politics: { label: 'Politics, Institutions & Economics', short: 'Politics', sprite: 'finance', group: 'Brain', match: (q) => q.category === 'politics' },
  history: { label: 'History', short: 'History', sprite: 'history', group: 'Brain', match: (q) => q.category === 'history' },
  geography: { label: 'Geography', short: 'Geo', sprite: 'geography', group: 'Brain', match: (q) => q.category === 'geography' },
  nature: { label: 'Nature & Animals', short: 'Nature', sprite: 'nature', group: 'Brain', match: (q) => q.category === 'nature' },
  symbols: { label: 'Symbols & Elements', short: 'Symbols', sprite: 'symbols', group: 'Brain', match: (q) => q.category === 'symbols' },
  news: { label: 'Current Affairs (last 2 weeks)', short: 'News', sprite: 'news', group: 'Brain', match: (q, now) => q.category === 'news' && isFreshNews(q, now) },
  arts: { label: 'Arts & Literature', short: 'Arts', sprite: 'arts', group: 'Culture', match: (q) => q.category === 'arts' && q.subcategory !== 'music' },
  cinema: { label: 'Cinema', short: 'Cinema', sprite: 'cinema', group: 'Culture', match: (q) => q.category === 'cinema' },
  popculture: { label: 'Pop Culture', short: 'Pop', sprite: 'popculture', group: 'Culture', match: (q) => q.category === 'popculture' },
  manga: { label: 'Manga & Anime', short: 'Manga', sprite: 'manga', group: 'Culture', match: (q) => q.category === 'manga' },
  music: { label: 'Music', short: 'Music', sprite: 'music', group: 'Culture', match: (q) => q.category === 'music' || q.category === 'tunes' || (q.category === 'arts' && q.subcategory === 'music') },
  cooking: { label: 'Cooking & Food', short: 'Cooking', sprite: 'cooking', group: 'Life', match: (q) => q.category === 'cooking' },
  finance: { label: 'Finance', short: 'Finance', sprite: 'finance', group: 'Life', match: (q) => q.category === 'finance' },
  business: { label: 'Business', short: 'Business', sprite: 'business', group: 'Life', match: (q) => q.category === 'business' },
  sports: { label: 'Sports', short: 'Sports', sprite: 'sports', group: 'Sport', match: (q) => q.category === 'sports' },
  f1: { label: 'Formula 1', short: 'F1', sprite: 'f1', group: 'Sport', match: (q) => q.category === 'f1' },
  hockey: { label: 'Hockey', short: 'Hockey', sprite: 'hockey', group: 'Sport', match: (q) => q.category === 'hockey' },
};

export const THEME_IDS = Object.keys(THEMES);
export const SLOT_COUNT = 5;
export const DEFAULT_THEMES = ['science', 'music', 'cinema', 'sports', 'news'];

/** Questions belonging to a theme. Science also includes phobias. */
export function themePool(themeId, questions, now = Date.now()) {
  const t = THEMES[themeId];
  return t ? questions.filter((q) => t.match(q, now)) : [];
}

/** How many questions each theme has (only themes with enough to play are offered). */
export function themeCounts(questions, now = Date.now()) {
  const out = {};
  for (const id of THEME_IDS) out[id] = themePool(id, questions, now).length;
  return out;
}

export const MIN_THEME_QUESTIONS = 8;
export const MIN_NEWS_QUESTIONS = 4;
export const availableThemes = (questions, now = Date.now()) => {
  const c = themeCounts(questions, now);
  return THEME_IDS.filter((id) => c[id] >= (id === 'news' ? MIN_NEWS_QUESTIONS : MIN_THEME_QUESTIONS));
};

/** Pick five random theme ids (duplicates allowed but avoided while possible). */
export function randomThemes(rng, available, n = SLOT_COUNT) {
  const bag = rng.shuffle([...available]);
  const out = bag.slice(0, n);
  while (out.length < n) out.push(rng.pick(available));
  return out;
}

/** Validate a theme list from outside (UI, relay). */
export function cleanThemes(list, available = THEME_IDS) {
  if (!Array.isArray(list) || list.length !== SLOT_COUNT) return null;
  return list.every((t) => available.includes(t)) ? [...list] : null;
}

export { statCategory };
