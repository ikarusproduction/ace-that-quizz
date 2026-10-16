// "While you wait" mini-game: short, deterministic puzzles. A puzzle is a pure function of its seed, so the host
// can regenerate it to verify an answer and nobody has to trust a phone's claim. Text can be shown in English or
// French; the *answer key* never depends on the language.
//
// Reward: small chip bonuses, capped per round and per game (see PUZZLE_RULES), applied by the game engine.
import { Rng } from './rng.js';

export const PUZZLE_RULES = {
  reward: { 1: 2, 2: 3, 3: 5 }, // chips by level
  roundCap: 10,                  // max bonus chips per player per round
  gameCap: 40,                   // max bonus chips per player per game
  seedMemory: 200,               // used seeds remembered per player (replay protection)
};

const WEEKDAYS = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
};
const NAMES = ['Mia', 'Leo', 'Zed', 'Ana', 'Kai', 'Noor', 'Ivo', 'Sana', 'Tom', 'Lena', 'Raf', 'Yuki'];
const WORDS = ['Bloops', 'Razzies', 'Lazzies', 'Zorbs', 'Quibs', 'Fenns', 'Glims', 'Tarns'];

const T = {
  en: {
    next: 'What number comes next?',
    solve: (eq) => `Hack the lock: ${eq}`,
    order: (a, b, c, w) => `${a} is ${w[0]} than ${b}. ${b} is ${w[0]} than ${c}. Who is ${w[1]}?`,
    faster: ['faster', 'slowest'], taller: ['taller', 'shortest'], older: ['older', 'youngest'],
    cant: "Can't tell",
    day: (d, n) => `Today is ${d}. What day will it be in ${n} days?`,
    syl1: (x, y, z) => `All ${x} are ${y}. All ${y} are ${z}. Is every one of the ${x} a ${z.replace(/s$/, '')}?`,
    syl2: (x, y, z) => `All ${x} are ${y}. Some ${y} are ${z}. Must some ${x} be ${z}?`,
    yes: 'Yes, always', never: 'Never', maybe: 'Not necessarily',
    odd: 'Which one does not belong?', oddProp: { even: 'even', square: 'square', three: 'a multiple of 3', prime: 'prime' },
    fact: 'True or fib?', true: 'True', fib: 'Fib',
    chain: (a, rest, q) => `A = ${a}. ${rest} What is ${q}?`,
    bin: (b) => `Binary 0b${b} in decimal is…`, hex: (h) => `Hex 0x${h} in decimal is…`, xor: (a, b) => `${a} XOR ${b} = …`,
  },
  fr: {
    next: 'Quel nombre vient ensuite ?',
    solve: (eq) => `Pirate le verrou : ${eq}`,
    order: (a, b, c, w) => `${a} est ${w[0]} que ${b}. ${b} est ${w[0]} que ${c}. Qui est ${w[1]} ?`,
    faster: ['plus rapide', 'le plus lent'], taller: ['plus grand', 'le plus petit'], older: ['plus âgé', 'le plus jeune'],
    cant: 'Impossible à dire',
    day: (d, n) => `Aujourd'hui, c'est ${d}. Quel jour serons-nous dans ${n} jours ?`,
    syl1: (x, y, z) => `Tous les ${x} sont des ${y}. Tous les ${y} sont des ${z}. Chaque ${x} est-il un ${z.replace(/s$/, '')} ?`,
    syl2: (x, y, z) => `Tous les ${x} sont des ${y}. Certains ${y} sont des ${z}. Certains ${x} sont-ils forcément des ${z} ?`,
    yes: 'Oui, toujours', never: 'Jamais', maybe: 'Pas forcément',
    odd: "Lequel n'a pas sa place ?", oddProp: { even: 'pair', square: 'un carré', three: 'un multiple de 3', prime: 'premier' },
    fact: 'Vrai ou bidon ?', true: 'Vrai', fib: 'Bidon',
    chain: (a, rest, q) => `A = ${a}. ${rest} Combien vaut ${q} ?`,
    bin: (b) => `Le binaire 0b${b} en décimal, c'est…`, hex: (h) => `L'hexadécimal 0x${h} en décimal, c'est…`, xor: (a, b) => `${a} XOR ${b} = …`,
  },
};

/** [true statement, false twin] in English and French. */
export const FACTS = [
  ['Octopuses have three hearts.', 'Octopuses have five hearts.', 'Les pieuvres ont trois cœurs.', 'Les pieuvres ont cinq cœurs.'],
  ['Honey found in ancient Egyptian tombs was still edible.', 'Honey always spoils within two years, even sealed.', 'Du miel trouvé dans des tombes égyptiennes était encore comestible.', 'Le miel se périme toujours en deux ans, même scellé.'],
  ['A day on Venus lasts longer than its year.', 'A day on Venus is shorter than a day on Earth.', 'Un jour sur Vénus dure plus longtemps que son année.', 'Un jour sur Vénus est plus court qu\'un jour sur Terre.'],
  ['Botanically, a banana is a berry and a strawberry is not.', 'Botanically, a strawberry is a berry and a banana is not.', 'Botaniquement, la banane est une baie, pas la fraise.', 'Botaniquement, la fraise est une baie, pas la banane.'],
  ['The Eiffel Tower grows a few centimetres taller in summer.', 'The Eiffel Tower shrinks by a metre in summer.', 'La tour Eiffel gagne quelques centimètres en été.', 'La tour Eiffel rétrécit d\'un mètre en été.'],
  ['Sharks are older than trees.', 'Trees are older than sharks.', 'Les requins sont plus anciens que les arbres.', 'Les arbres sont plus anciens que les requins.'],
  ['A shrimp\'s heart is in its head.', 'A shrimp\'s heart is in its tail.', 'Le cœur d\'une crevette est dans sa tête.', 'Le cœur d\'une crevette est dans sa queue.'],
  ['Wombat droppings are cube-shaped.', 'Wombat droppings are perfectly round.', 'Les crottes de wombat sont cubiques.', 'Les crottes de wombat sont parfaitement rondes.'],
  ['Sunlight takes about 8 minutes to reach Earth.', 'Sunlight takes about 8 seconds to reach Earth.', 'La lumière du Soleil met environ 8 minutes à atteindre la Terre.', 'La lumière du Soleil met environ 8 secondes à atteindre la Terre.'],
  ['You cannot see the Great Wall of China with the naked eye from the Moon.', 'Astronauts on the Moon can easily spot the Great Wall of China.', 'On ne peut pas voir la Grande Muraille de Chine à l\'œil nu depuis la Lune.', 'Les astronautes sur la Lune repèrent facilement la Grande Muraille.'],
  ['Scotland\'s national animal is the unicorn.', 'Scotland\'s national animal is the dolphin.', 'L\'animal national de l\'Écosse est la licorne.', 'L\'animal national de l\'Écosse est le dauphin.'],
  ['Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.', 'Cleopatra lived closer in time to the building of the Great Pyramid than to the Moon landing.', 'Cléopâtre vivait plus près de l\'alunissage que de la construction de la Grande Pyramide.', 'Cléopâtre vivait plus près de la construction de la Grande Pyramide que de l\'alunissage.'],
  ['Oxford University is older than the Aztec Empire.', 'The Aztec Empire is older than Oxford University.', 'L\'université d\'Oxford est plus ancienne que l\'Empire aztèque.', 'L\'Empire aztèque est plus ancien que l\'université d\'Oxford.'],
  ['Lightning is hotter than the surface of the Sun.', 'Lightning is cooler than the surface of the Sun.', 'La foudre est plus chaude que la surface du Soleil.', 'La foudre est plus froide que la surface du Soleil.'],
  ['Sound travels faster in water than in air.', 'Sound travels slower in water than in air.', 'Le son voyage plus vite dans l\'eau que dans l\'air.', 'Le son voyage plus lentement dans l\'eau que dans l\'air.'],
  ['The farthest point of the Earth\'s surface from its centre is on Chimborazo, not Everest.', 'Everest is the farthest point of the Earth\'s surface from its centre.', 'Le point de la surface terrestre le plus éloigné du centre est le Chimborazo, pas l\'Everest.', 'L\'Everest est le point de la surface terrestre le plus éloigné du centre.'],
  ['A solar day on Mercury lasts about 176 Earth days.', 'A solar day on Mercury lasts about 8 Earth days.', 'Un jour solaire sur Mercure dure environ 176 jours terrestres.', 'Un jour solaire sur Mercure dure environ 8 jours terrestres.'],
  ['Wild penguins live almost only in the Southern Hemisphere.', 'Wild penguins live in the Arctic.', 'Les manchots sauvages vivent presque tous dans l\'hémisphère Sud.', 'Les manchots sauvages vivent en Arctique.'],
  ['The Dead Sea is far saltier than the ocean.', 'The Dead Sea is less salty than the ocean.', 'La mer Morte est bien plus salée que l\'océan.', 'La mer Morte est moins salée que l\'océan.'],
  ['The decimal digits of pi never settle into a repeating pattern.', 'The decimal digits of pi repeat in a regular cycle.', 'Les décimales de pi ne forment jamais de motif répétitif.', 'Les décimales de pi se répètent en cycle régulier.'],
  ['An adult human has 206 bones.', 'An adult human has 306 bones.', 'Un adulte a 206 os.', 'Un adulte a 306 os.'],
  ['Spiders are not insects.', 'Spiders are insects.', 'Les araignées ne sont pas des insectes.', 'Les araignées sont des insectes.'],
  ['The shortest war in history lasted about 38 minutes.', 'The shortest war in history lasted about 38 days.', 'La guerre la plus courte de l\'histoire a duré environ 38 minutes.', 'La guerre la plus courte de l\'histoire a duré environ 38 jours.'],
  ['Russia spans eleven time zones.', 'Russia spans only three time zones.', 'La Russie s\'étend sur onze fuseaux horaires.', 'La Russie ne s\'étend que sur trois fuseaux horaires.'],
  ['Australia is wider than the Moon.', 'The Moon is wider than Australia.', 'L\'Australie est plus large que la Lune.', 'La Lune est plus large que l\'Australie.'],
  ['Canada has more lakes than any other country.', 'Russia has more lakes than Canada.', 'Le Canada a plus de lacs que n\'importe quel pays.', 'La Russie a plus de lacs que le Canada.'],
  ['Koalas have fingerprints very similar to human ones.', 'Koalas have no fingerprints at all.', 'Les koalas ont des empreintes digitales très proches des nôtres.', 'Les koalas n\'ont aucune empreinte digitale.'],
  ['Sloths can hold their breath longer than dolphins.', 'Dolphins can hold their breath longer than sloths.', 'Les paresseux retiennent leur souffle plus longtemps que les dauphins.', 'Les dauphins retiennent leur souffle plus longtemps que les paresseux.'],
  ['China officially uses a single time zone.', 'China officially uses five time zones.', 'La Chine utilise officiellement un seul fuseau horaire.', 'La Chine utilise officiellement cinq fuseaux horaires.'],
  ['Cheetahs cannot roar.', 'Cheetahs roar like lions.', 'Les guépards ne peuvent pas rugir.', 'Les guépards rugissent comme les lions.'],
];

/** Pick up to n distinct numeric distractors around the answer. */
function numericChoices(rng, answer, spreads) {
  const set = new Set([answer]);
  const tries = [];
  for (const d of spreads) { tries.push(answer + d, answer - d); }
  rng.shuffle(tries);
  for (const v of tries) { if (set.size >= 4) break; if (Number.isFinite(v)) set.add(v); }
  let k = 1;
  while (set.size < 4) set.add(answer + (k++) * 7);
  return rng.shuffle([...set]).map((v) => ({ key: String(v), label: String(v) }));
}

const SEQ = {
  1: [
    (r) => { const a = r.int(1, 15); const d = r.int(2, 9); return Array.from({ length: 7 }, (_, i) => a + d * i); },
    (r) => { const a = r.int(1, 4); return Array.from({ length: 7 }, (_, i) => (a + i) ** 2); },
    (r) => { const a = r.int(1, 5); return Array.from({ length: 7 }, (_, i) => a * 2 ** i); },
  ],
  2: [
    (r) => { const a = r.int(1, 4); const m = r.int(2, 3); return Array.from({ length: 7 }, (_, i) => a * m ** i); },
    (r) => { const a = r.int(1, 6); const b = r.int(2, 8); const out = [a, b]; while (out.length < 7) out.push(out.at(-1) + out.at(-2)); return out; },
    (r) => { const a = r.int(5, 30); const p = r.int(3, 9); const q = r.int(1, p - 1); const out = [a]; for (let i = 1; i < 7; i++) out.push(out.at(-1) + (i % 2 ? p : -q)); return out; },
    (r) => { const a = r.int(1, 9); const out = [a]; for (let i = 1; i < 7; i++) out.push(out.at(-1) + i + 1); return out; },
  ],
  3: [
    (r) => { const a = r.int(1, 3); return Array.from({ length: 7 }, (_, i) => (a + i) ** 3); },
    (r) => { const a = r.int(1, 4); const out = [a]; for (let i = 1; i < 7; i++) out.push(out.at(-1) * 2 + 1); return out; },
    () => [2, 3, 5, 7, 11, 13, 17],
    (r) => { const a = r.int(2, 5); const b = r.int(10, 20); const dA = r.int(2, 4); const dB = r.int(3, 6); return [a, b, a + dA, b + dB, a + 2 * dA, b + 2 * dB, a + 3 * dA]; }, // two interleaved lines
    (r) => { const a = r.int(2, 5); const out = [a]; for (let i = 1; i < 7; i++) out.push(out.at(-1) * 3 - 2); return out; },
  ],
};

function genSequence(rng, level, t) {
  const make = rng.pick(SEQ[level]);
  const terms = make(rng);
  const shown = terms.slice(0, 6);
  const answer = terms[6];
  const gap = Math.max(1, Math.abs(terms[6] - terms[5]));
  return { prompt: `${shown.join(', ')}, …  ${t.next}`, choices: numericChoices(rng, answer, [1, 2, gap, gap + 1, Math.max(1, gap - 1), 10]), answerKey: String(answer), kind: 'sequence' };
}

function genEquation(rng, level, t) {
  let eq; let answer;
  if (level === 1) {
    const x = rng.int(2, 12); const a = rng.int(2, 5); const b = rng.int(1, 15);
    if (rng.chance?.(0.5) ?? rng.next() < 0.5) { eq = `${a}x + ${b} = ${a * x + b}`; } else { eq = `${a}x − ${b} = ${a * x - b}`; }
    answer = x;
  } else if (level === 2) {
    const x = rng.int(2, 11); const a = rng.int(3, 8); let c = rng.int(1, a - 1); const b = rng.int(1, 12);
    const d = a * x + b - c * x;
    eq = `${a}x + ${b} = ${c}x + ${d}`; answer = x;
    if (rng.next() < 0.4) { const r = rng.int(3, 12); eq = `x² = ${r * r}  (x > 0)`; answer = r; }
  } else {
    const kind = rng.int(0, 3);
    if (kind === 0) { const n = rng.int(5, 31); return fin(rng, t.bin(n.toString(2)), n, [1, 2, 4, 8], 'binary'); }
    if (kind === 1) { const n = rng.int(16, 120); return fin(rng, t.hex(n.toString(16).toUpperCase()), n, [1, 2, 16, 15], 'hex'); }
    if (kind === 2) { const a = rng.int(5, 15); const b = rng.int(3, 15); return fin(rng, t.xor(a, b), a ^ b, [1, 2, 3, 4, 5], 'xor'); }
    const a = rng.int(2, 6); const m = rng.int(2, 4); const k = rng.int(1, 5);
    const B = a * m - k; const C = B + a;
    return fin(rng, t.chain(a, `B = A × ${m} − ${k}. C = B + A.`, 'C'), C, [1, 2, 3, a], 'chain');
  }
  return fin(rng, t.solve(eq), answer, [1, 2, 3, 4], 'equation');
}
function fin(rng, prompt, answer, spreads, kind) {
  return { prompt, choices: numericChoices(rng, answer, spreads), answerKey: String(answer), kind };
}

function genLogic(rng, level, t) {
  const pick = rng.int(0, level === 1 ? 2 : 4);
  if (pick === 0) { // ordering
    const [a, b, c] = rng.shuffle(NAMES.slice()).slice(0, 3);
    const w = rng.pick([t.faster, t.taller, t.older]);
    const last = rng.next() < 0.5;
    const choices = rng.shuffle([a, b, c]).map((n) => ({ key: n, label: n }));
    choices.push({ key: 'cant', label: t.cant });
    return { prompt: t.order(a, b, c, last ? w : w), choices, answerKey: c, kind: 'logic' };
  }
  if (pick === 1) { // weekday arithmetic
    const d0 = rng.int(0, 6); const n = rng.int(10, level === 1 ? 20 : 45);
    const idx = (d0 + n) % 7;
    const keys = [idx, (idx + 1) % 7, (idx + 6) % 7, (idx + 2) % 7];
    return { prompt: t.day(WEEKDAYS[t.lang][d0], n), choices: rng.shuffle(keys).map((k) => ({ key: String(k), label: WEEKDAYS[t.lang][k] })), answerKey: String(idx), kind: 'logic' };
  }
  if (pick === 2) { // odd one out
    const prop = rng.pick(['even', 'square', 'three']);
    const members = new Set();
    const isMember = { even: (n) => n % 2 === 0, square: (n) => Number.isInteger(Math.sqrt(n)), three: (n) => n % 3 === 0 }[prop];
    while (members.size < 3) members.add(rng.int(2, 60));
    let odd; do { odd = rng.int(2, 60); } while (members.has(odd) || isMember(odd));
    const arr = [...members].filter(isMember);
    // enforce membership by construction
    const build = { even: () => rng.int(1, 30) * 2, square: () => rng.int(2, 9) ** 2, three: () => rng.int(1, 20) * 3 }[prop];
    const mem = new Set(); while (mem.size < 3) mem.add(build());
    let non; do { non = rng.int(2, 80); } while (mem.has(non) || isMember(non));
    void arr;
    const all = rng.shuffle([...mem, non]);
    return { prompt: `${t.odd}  (${all.join(', ')})`, choices: all.map((n) => ({ key: String(n), label: String(n) })), answerKey: String(non), kind: 'logic' };
  }
  // syllogisms (level 2+)
  const [x, y, z] = rng.shuffle(WORDS.slice()).slice(0, 3);
  if (pick === 3) {
    return { prompt: t.syl1(x, y, z), choices: [{ key: 'yes', label: t.yes }, { key: 'never', label: t.never }, { key: 'maybe', label: t.maybe }], answerKey: 'yes', kind: 'logic' };
  }
  return { prompt: t.syl2(x, y, z), choices: [{ key: 'yes', label: t.yes }, { key: 'never', label: t.never }, { key: 'maybe', label: t.maybe }], answerKey: 'maybe', kind: 'logic' };
}

function genFact(rng, t, lang) {
  const f = rng.pick(FACTS);
  const isTrue = rng.next() < 0.5;
  const text = lang === 'fr' ? (isTrue ? f[2] : f[3]) : (isTrue ? f[0] : f[1]);
  return { prompt: `${t.fact}  “${text}”`, choices: [{ key: 'true', label: t.true }, { key: 'fib', label: t.fib }], answerKey: isTrue ? 'true' : 'fib', kind: 'fact', fact: lang === 'fr' ? f[2] : f[0] };
}

/**
 * Build the puzzle for a seed. Seeds look like `<anything>:L<level>`; the level (1-3) is the last `:L` suffix.
 * Returns { seed, level, kind, prompt, choices:[{key,label}], answerKey, reward }.
 */
export function parseSeed(seed) {
  const m = /:L([123])$/.exec(String(seed));
  return { level: m ? Number(m[1]) : 1 };
}
/** Adapter: inclusive int(lo, hi) on top of the engine Rng. */
function wrap(base) {
  return {
    next: () => base.next(),
    int: (lo, hi) => lo + base.int(hi - lo + 1),
    pick: (a) => base.pick(a),
    shuffle: (a) => base.shuffle(a),
    chance: (p) => base.chance(p),
  };
}
export function makePuzzle(seed, lang = 'en') {
  const L = lang === 'fr' ? 'fr' : 'en';
  const t = { ...T[L], lang: L };
  const { level } = parseSeed(seed);
  const rng = wrap(Rng.fromSeed(`puzzle:${seed}`));
  const kinds = level === 1 ? ['sequence', 'equation', 'logic', 'fact'] : ['sequence', 'equation', 'logic', 'equation', 'sequence', 'fact'];
  const kind = rng.pick(kinds);
  const p = kind === 'sequence' ? genSequence(rng, level, t) : kind === 'equation' ? genEquation(rng, level, t) : kind === 'logic' ? genLogic(rng, level, t) : genFact(rng, t, L);
  return { seed, level, ...p, reward: PUZZLE_RULES.reward[level] };
}

/** Is `answerKey` right for this seed? Language-independent. */
export function checkPuzzle(seed, answerKey) {
  return makePuzzle(seed, 'en').answerKey === String(answerKey);
}

/** A friendly tip shown under the puzzles. */
export function randomFact(rng, lang = 'en') {
  const f = FACTS[rng.int(FACTS.length)];
  return lang === 'fr' ? f[2] : f[0];
}
