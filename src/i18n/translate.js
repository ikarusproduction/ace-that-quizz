// Per-player question translation. The engine and the stored results always use
// the English original (ids and choice order never change), so translating is
// purely presentational and can never affect scoring or statistics.
//
// Sources, in order:
//   1. a bundled dictionary  data/i18n/<lang>.json   {id: {q, c:[...], e}}   (reviewed offline, instant)
//   2. the browser's built-in Translator API (Chrome), on-device
//   3. a public translation web service, with results cached on the device
//   4. otherwise the English original, and the UI says so
// Tune lyrics are never translated: they are the song's own text.
import { DEFAULT_LANGUAGE, isLanguage } from './languages.js';

const CACHE_PREFIX = 'thk-tr1:';
const MEM = new Map(); // `${lang}:${id}` -> result
const bundles = new Map(); // lang -> Promise<dict|null>

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or blocked */ } };

async function loadBundle(lang, fetchJson) {
  if (!bundles.has(lang)) bundles.set(lang, Promise.resolve(fetchJson(`data/i18n/${lang}.json`)).catch(() => null));
  return bundles.get(lang);
}

let apiTranslators = new Map();
async function browserTranslator(lang) {
  const T = globalThis.Translator;
  if (!T?.create) return null;
  if (apiTranslators.has(lang)) return apiTranslators.get(lang);
  const p = (async () => {
    try {
      const avail = await T.availability({ sourceLanguage: 'en', targetLanguage: lang });
      if (avail === 'unavailable') return null;
      return await T.create({ sourceLanguage: 'en', targetLanguage: lang });
    } catch { return null; }
  })();
  apiTranslators.set(lang, p);
  return p;
}

async function webTranslate(text, lang, timeoutMs) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    const out = j?.responseData?.translatedText;
    if (typeof out !== 'string' || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)) return null;
    return out;
  } catch { return null; } finally { clearTimeout(t); }
}

/** Translate one string using the runtime sources (2 then 3), with a persistent cache. */
async function machine(text, lang, { timeoutMs }) {
  const key = `${CACHE_PREFIX}${lang}:${hash(text)}`;
  const cached = lsGet(key);
  if (cached) return cached;
  let out = null;
  const bt = await browserTranslator(lang);
  if (bt) { try { out = await bt.translate(text); } catch { out = null; } }
  if (!out) out = await webTranslate(text, lang, timeoutMs);
  if (out) lsSet(key, out);
  return out;
}

/**
 * Create a translator. `fetchJson(path)` loads bundled dictionaries.
 * `translateQuestion(q, lang)` resolves to { q, c, e, via } or null when no translation exists.
 */
export function createTranslator({ fetchJson, timeoutMs = 3500 } = {}) {
  return {
    async translateQuestion(question, lang) {
      if (!isLanguage(lang) || lang === DEFAULT_LANGUAGE) return null;
      if (question.type === 'tune') return null; // lyrics stay as written
      const memKey = `${lang}:${question.id}`;
      if (MEM.has(memKey)) return MEM.get(memKey);

      const dict = await loadBundle(lang, fetchJson);
      const hit = dict?.[question.id];
      if (hit?.q && Array.isArray(hit.c) && hit.c.length === question.choices.length) {
        const r = { q: hit.q, c: hit.c, e: hit.e ?? null, m: hit.m ?? null, via: 'bundled' };
        MEM.set(memKey, r);
        return r;
      }
      if (question.type === 'tf') {
        // True/False choices are fixed labels, so only the statement is translated.
        const q = await machine(question.question, lang, { timeoutMs });
        const r = q ? { q, c: null, e: null, via: 'machine' } : null;
        if (r) MEM.set(memKey, r);
        return r;
      }
      const parts = [question.question, ...question.choices, question.explanation].filter(Boolean);
      const out = await Promise.all(parts.map((t) => machine(String(t), lang, { timeoutMs })));
      if (!out[0] || out.slice(1, 1 + question.choices.length).some((x) => !x)) return null; // all-or-nothing for the playable part
      const r = { q: out[0], c: out.slice(1, 1 + question.choices.length), e: out[1 + question.choices.length] ?? null, via: 'machine' };
      MEM.set(memKey, r);
      return r;
    },
  };
}

/** Apply a translation to a question view from getQuestionView (choices carry `orig`). */
export function applyTranslation(view, tr) {
  if (!view || !tr) return view;
  return {
    ...view,
    text: view.text == null ? null : tr.q,
    choices: view.choices.map((c) => ({ ...c, text: tr.c && tr.c[c.orig] != null ? tr.c[c.orig] : c.text })),
    explanation: view.explanation == null ? null : tr.e ?? view.explanation,
    misconception: view.misconception == null ? null : tr.m ?? view.misconception,
    translated: tr.via,
  };
}
