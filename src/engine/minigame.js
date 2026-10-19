// "While you wait" mini-game: geography, typed. A puzzle is a pure function of its seed, so the host can regenerate
// it to verify an answer and nobody has to trust a phone's claim. Two kinds:
//   flag     a flag is shown; type the country
//   capital  a country is shown; type its capital
// Answers are free text in English or French (accents, case and small typos forgiven, see geo.js). The answer key
// never depends on the display language.
//
// Reward: chips by level, capped per round and per game (see PUZZLE_RULES), applied by the game engine. Typing is
// harder than tapping a choice, so a right answer pays more than the old multiple-choice puzzles did, but the caps
// are unchanged: a waiting player can earn at most a couple of questions' worth of chips per round.
import { Rng } from './rng.js';
import { COUNTRIES, COUNTRY, isCountry, isCapital } from './geo.js';

export const PUZZLE_RULES = {
  reward: { 1: 3, 2: 4, 3: 6 }, // chips by level
  roundCap: 10,                  // max bonus chips per player per round
  gameCap: 40,                   // max bonus chips per player per game
  seedMemory: 200,               // used seeds remembered per player (replay protection)
  maxLength: 60,                 // longest typed answer the host will read
};

/** Which countries a level draws from: 1 the famous ones, 2 adds the middle tier, 3 the harder two tiers. */
const POOL = { 1: [1, 1, 1, 2], 2: [1, 2, 2, 3], 3: [2, 3, 3, 3] };

export const LEVEL_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

/**
 * Seeds look like `<anything>:L<level>`; the level (1-3) is the last `:L` suffix.
 */
export function parseSeed(seed) {
  const m = /:L([123])$/.exec(String(seed));
  return { level: m ? Number(m[1]) : 1 };
}

/**
 * Build the puzzle for a seed.
 * Returns { seed, level, kind, input: 'text', prompt, visual, iso, answerKey, fact, reward }.
 * `visual` is { type: 'flag', iso, name? }: the flag to draw, and for capital puzzles the country's name in `lang`.
 */
export function makePuzzle(seed, lang = 'en') {
  const L = lang === 'fr' ? 'fr' : 'en';
  const { level } = parseSeed(seed);
  const rng = Rng.fromSeed(`puzzle:${seed}`);
  const kind = rng.chance(0.5) ? 'flag' : 'capital';
  const tier = rng.pick(POOL[level]);
  const pool = COUNTRIES.filter((c) => c.tier === tier);
  const c = rng.pick(pool);
  const name = c[L]; const cap = L === 'fr' ? c.capFr : c.capEn;
  const base = { seed, level, kind, input: 'text', iso: c.iso, reward: PUZZLE_RULES.reward[level] };
  if (kind === 'flag') {
    return { ...base, prompt: L === 'fr' ? 'À quel pays est ce drapeau ?' : 'Which country is this flag?', visual: { type: 'flag', iso: c.iso }, answerKey: c.en,
      fact: L === 'fr' ? `Drapeau : ${name}. Capitale : ${cap}.` : `That is the flag of ${name}. Its capital is ${cap}.` };
  }
  return { ...base, prompt: L === 'fr' ? 'Quelle est la capitale de ce pays ?' : 'What is the capital of this country?', visual: { type: 'flag', iso: c.iso, name }, answerKey: c.capEn,
    fact: L === 'fr' ? `Capitale de ${name} : ${cap}.` : `${cap} is the capital of ${name}.` };
}

/** Is `answer` (typed text) right for this seed? Language-independent. */
export function checkPuzzle(seed, answer) {
  if (typeof answer !== 'string' || answer.length > PUZZLE_RULES.maxLength) return false;
  const p = makePuzzle(seed, 'en');
  return p.kind === 'flag' ? isCountry(p.iso, answer) : isCapital(p.iso, answer);
}

/** A friendly line shown after an answer. */
export function randomFact(rng, lang = 'en') {
  const c = rng.pick(COUNTRIES.filter((x) => x.tier <= 2));
  return lang === 'fr' ? `Capitale de ${c.fr} : ${c.capFr}.` : `${c.capEn} is the capital of ${c.en}.`;
}
export { COUNTRY };
