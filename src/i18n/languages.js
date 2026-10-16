// Languages a player can pick. Questions are written in English; for any other
// language they are translated for that player only (see translate.js).
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'fr', name: 'French', native: 'Français', bundled: true },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese', native: '中文' },
];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE = 'en';
export const isLanguage = (c) => LANGUAGE_CODES.includes(c);
export const languageOf = (c) => LANGUAGES.find((l) => l.code === c) ?? LANGUAGES[0];

/** Best guess from the browser, used as the default for a new player. */
export function guessLanguage(nav = globalThis.navigator) {
  const first = String(nav?.language ?? 'en').toLowerCase().split('-')[0];
  return isLanguage(first) ? first : DEFAULT_LANGUAGE;
}
