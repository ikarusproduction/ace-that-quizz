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
    slide: 'Slide the tiles into order: 1 to 8, blank in the corner. Tap a tile next to the gap.',
    oddgrid: 'One of these is not like the others. Tap it.',
    scatter: (name) => `How many ${name} are in the picture?`, shapeNames: { circle: 'circles', square: 'squares', triangle: 'triangles', diamond: 'diamonds', cross: 'crosses', star: 'stars' },
    pattern: 'Which figure completes the pattern?',
    memory: 'Watch the lights, then repeat the order.',
    riddle: 'Riddle:',
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
    slide: 'Fais glisser les tuiles dans l\'ordre : de 1 à 8, case vide dans le coin. Touche une tuile à côté du vide.',
    oddgrid: 'L\'une d\'elles est différente. Touche-la.',
    scatter: (name) => `Combien de ${name} vois-tu dans l'image ?`, shapeNames: { circle: 'cercles', square: 'carrés', triangle: 'triangles', diamond: 'losanges', cross: 'croix', star: 'étoiles' },
    pattern: 'Quelle figure complète la suite ?',
    memory: 'Regarde les lumières, puis répète l\'ordre.',
    riddle: 'Énigme :',
  },
};

/** Riddles: [question en, question fr, [answers en], [answers fr], index of the right answer]. */
export const RIDDLES = [
  ['What has keys but cannot open a lock?', 'Qu\'est-ce qui a des touches mais n\'ouvre aucune serrure ?', ['A piano', 'A map', 'A clock', 'A door'], ['Un piano', 'Une carte', 'Une horloge', 'Une porte'], 0],
  ['The more of me you take, the more you leave behind. What am I?', 'Plus tu m\'en prends, plus tu en laisses derrière toi. Que suis-je ?', ['Footsteps', 'Time', 'Money', 'Sand'], ['Des pas', 'Du temps', 'De l\'argent', 'Du sable'], 0],
  ['What can you catch but never throw?', 'Que peut-on attraper mais jamais lancer ?', ['A cold', 'A ball', 'A shadow', 'A wave'], ['Un rhume', 'Une balle', 'Une ombre', 'Une vague'], 0],
  ['I have cities but no houses, mountains but no trees, water but no fish. What am I?', 'J\'ai des villes sans maisons, des montagnes sans arbres, de l\'eau sans poissons. Que suis-je ?', ['A map', 'A dream', 'A painting', 'A globe of glass'], ['Une carte', 'Un rêve', 'Un tableau', 'Une boule de verre'], 0],
  ['What gets wetter the more it dries?', 'Qu\'est-ce qui devient plus mouillé à mesure qu\'il sèche ?', ['A towel', 'A sponge', 'The sea', 'Rain'], ['Une serviette', 'Une éponge', 'La mer', 'La pluie'], 0],
  ['What has a head and a tail but no body?', 'Qu\'est-ce qui a une tête et une queue mais pas de corps ?', ['A coin', 'A comet', 'A snake', 'A match'], ['Une pièce', 'Une comète', 'Un serpent', 'Une allumette'], 0],
  ['What goes up when the rain comes down?', 'Qu\'est-ce qui monte quand la pluie tombe ?', ['An umbrella', 'A rainbow', 'A bird', 'Smoke'], ['Un parapluie', 'Un arc-en-ciel', 'Un oiseau', 'La fumée'], 0],
  ['I speak without a mouth and hear without ears. What am I?', 'Je parle sans bouche et j\'entends sans oreilles. Que suis-je ?', ['An echo', 'A radio dial', 'A ghost', 'A letter'], ['Un écho', 'Un cadran de radio', 'Un fantôme', 'Une lettre'], 0],
  ['What has hands but cannot clap?', 'Qu\'est-ce qui a des mains mais ne peut pas applaudir ?', ['A clock', 'A statue', 'A glove', 'A tree'], ['Une horloge', 'Une statue', 'Un gant', 'Un arbre'], 0],
  ['What can fill a room but takes up no space?', 'Qu\'est-ce qui remplit une pièce sans prendre de place ?', ['Light', 'Furniture', 'A balloon', 'Dust'], ['La lumière', 'Des meubles', 'Un ballon', 'La poussière'], 0],
  ['What has one eye but cannot see?', 'Qu\'est-ce qui a un œil mais ne voit rien ?', ['A needle', 'A potato bag', 'A storm', 'A mask'], ['Une aiguille', 'Un sac de patates', 'Une tempête', 'Un masque'], 0],
  ['What belongs to you but is used more by others?', 'Qu\'est-ce qui t\'appartient mais que les autres utilisent plus que toi ?', ['Your name', 'Your phone', 'Your bed', 'Your shoes'], ['Ton prénom', 'Ton téléphone', 'Ton lit', 'Tes chaussures'], 0],
  ['What runs but never walks, has a mouth but never talks?', 'Qu\'est-ce qui court mais ne marche jamais, a une bouche mais ne parle jamais ?', ['A river', 'A rumour', 'A clock', 'A horse'], ['Une rivière', 'Une rumeur', 'Une horloge', 'Un cheval'], 0],
  ['What is full of holes but still holds water?', 'Qu\'est-ce qui est plein de trous mais retient l\'eau ?', ['A sponge', 'A net', 'A bucket', 'A cloud'], ['Une éponge', 'Un filet', 'Un seau', 'Un nuage'], 0],
  ['What can you break without ever touching it?', 'Que peut-on briser sans jamais le toucher ?', ['A promise', 'A glass', 'A branch', 'An egg'], ['Une promesse', 'Un verre', 'Une branche', 'Un œuf'], 0],
];

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


/* ------------------------------------------------------------------ */
/* Visual puzzles. `visual` is plain data the UI draws; the host re-derives and checks the answer from the seed.      */
/* ------------------------------------------------------------------ */

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star'];
const HUES = ['#e8a33d', '#6fa86b', '#6fd1ff', '#e07b9b', '#b3261e', '#e6d6a8'];
const NEAR_HUES = [['#e8a33d', '#c9702a'], ['#6fa86b', '#3f8a6a'], ['#6fd1ff', '#3f9ae0'], ['#e07b9b', '#b8506e']];

/** Sliding tiles: 3x3, tiles 1-8, 0 is the gap. The scramble is a random walk of the gap from the solved board, so it is always solvable. */
export const SLIDE_SOLVED = [1, 2, 3, 4, 5, 6, 7, 8, 0];
const slideNeighbours = (i) => {
  const out = [];
  const r = Math.floor(i / 3); const c = i % 3;
  if (r > 0) out.push(i - 3);
  if (r < 2) out.push(i + 3);
  if (c > 0) out.push(i - 1);
  if (c < 2) out.push(i + 1);
  return out;
};
const MOVE_DELTA = { U: -3, D: 3, L: -1, R: 1 };
/** Apply a string of gap moves (U/D/L/R) to a board; null if a move is impossible. */
export function applySlide(board, moves) {
  const b = [...board];
  let gap = b.indexOf(0);
  for (const m of String(moves)) {
    const d = MOVE_DELTA[m];
    if (d == null) return null;
    const to = gap + d;
    if (to < 0 || to > 8) return null;
    if ((m === 'L' && gap % 3 === 0) || (m === 'R' && gap % 3 === 2)) return null;
    [b[gap], b[to]] = [b[to], b[gap]];
    gap = to;
  }
  return b;
}
const isSolved = (b) => b.every((v, i) => v === SLIDE_SOLVED[i]);
export function checkSlide(board, moves) {
  const m = String(moves);
  if (!/^[UDLR]{1,400}$/.test(m)) return false;
  const end = applySlide(board, m);
  return Boolean(end) && isSolved(end);
}
/** Shortest solution (breadth first). Used by tests and the UI's "show me" in debug builds. */
export function solveSlide(board) {
  const key = (b) => b.join('');
  const seen = new Map([[key(board), '']]);
  let frontier = [board];
  for (let depth = 0; depth < 32 && frontier.length; depth++) {
    const next = [];
    for (const b of frontier) {
      const path = seen.get(key(b));
      if (isSolved(b)) return path;
      const gap = b.indexOf(0);
      for (const n of slideNeighbours(gap)) {
        const d = n - gap;
        const m = d === -3 ? 'U' : d === 3 ? 'D' : d === -1 ? 'L' : 'R';
        const nb = [...b]; [nb[gap], nb[n]] = [nb[n], nb[gap]];
        const k = key(nb);
        if (!seen.has(k)) { seen.set(k, path + m); next.push(nb); }
      }
    }
    frontier = next;
  }
  return null;
}

function genSlide(rng, level, t) {
  const steps = { 1: 6, 2: 12, 3: 20 }[level];
  let board;
  do {
    board = [...SLIDE_SOLVED];
    let gap = 8; let prev = -1;
    for (let i = 0; i < steps; i++) {
      const opts = slideNeighbours(gap).filter((n) => n !== prev);
      const n = rng.pick(opts);
      [board[gap], board[n]] = [board[n], board[gap]];
      prev = gap; gap = n;
    }
  } while (isSolved(board));
  return { prompt: t.slide, choices: [], input: 'moves', answerKey: 'slide', kind: 'slide', visual: { type: 'slide', board } };
}

function genOddGrid(rng, level, t) {
  const size = level === 1 ? 3 : 4;
  const n = size * size;
  const odd = rng.int(0, n - 1);
  let base; let off;
  if (level === 1) {
    const [a, b] = rng.shuffle(SHAPES.slice()).slice(0, 2);
    const hue = rng.pick(HUES);
    base = { shape: a, rot: 0, color: hue }; off = { shape: b, rot: 0, color: hue };
  } else if (level === 2) {
    const hue = rng.pick(HUES);
    base = { shape: 'arrow', rot: 0, color: hue }; off = { shape: 'arrow', rot: rng.pick([90, 180, 270]), color: hue };
  } else {
    const [c1, c2] = rng.pick(NEAR_HUES);
    const shape = rng.pick(SHAPES);
    base = { shape, rot: 0, color: c1 }; off = { shape, rot: 0, color: c2 };
  }
  const cells = Array.from({ length: n }, (_, i) => (i === odd ? off : base));
  return { prompt: t.oddgrid, choices: cells.map((_, i) => ({ key: String(i), label: '' })), answerKey: String(odd), kind: 'oddgrid', visual: { type: 'oddgrid', cols: size, cells } };
}

function genScatter(rng, level, t) {
  const target = rng.pick(SHAPES.slice(0, level === 1 ? 3 : 5));
  const pool = SHAPES.slice(0, level === 1 ? 3 : level === 2 ? 4 : 5);
  const count = rng.int(2, level === 1 ? 6 : 8);
  const total = { 1: 10, 2: 16, 3: 22 }[level];
  const cols = 6;
  const slots = rng.shuffle(Array.from({ length: cols * cols }, (_, i) => i)).slice(0, total);
  const items = slots.map((slot, i) => {
    const shape = i < count ? target : rng.pick(pool.filter((p) => p !== target));
    return { shape, x: ((slot % cols) + 0.2 + rng.next() * 0.6) / cols, y: ((Math.floor(slot / cols)) + 0.2 + rng.next() * 0.6) / cols, color: rng.pick(HUES) };
  });
  return { prompt: t.scatter(t.shapeNames[target]), choices: numericChoices(rng, count, [1, 2, 3]), answerKey: String(count), kind: 'scatter', visual: { type: 'scatter', items: rng.shuffle(items), target } };
}

function genPattern(rng, level, t) {
  const hue = rng.pick(HUES);
  let seq; let answer; let options;
  const key = (f) => `${f.shape}:${f.n}:${f.rot}`;
  if (level === 1) { // dots count up by one
    const a = rng.int(1, 4);
    seq = [0, 1, 2, 3].map((i) => ({ shape: 'circle', n: a + i, rot: 0, color: hue }));
    answer = { shape: 'circle', n: a + 4, rot: 0, color: hue };
    options = [answer, ...[-2, -1, 1, 2].map((d) => ({ ...answer, n: answer.n + d })).filter((f) => f.n >= 1 && f.n <= 9)];
  } else if (level === 2) { // an arrow turns by a fixed angle
    const step = rng.pick([90, 45, 135]);
    const r0 = rng.pick([0, 45, 90, 180]);
    seq = [0, 1, 2, 3].map((i) => ({ shape: 'arrow', n: 1, rot: (r0 + step * i) % 360, color: hue }));
    answer = { shape: 'arrow', n: 1, rot: (r0 + step * 4) % 360, color: hue };
    options = [answer, ...[45, 90, 135, 180, 270].map((d) => ({ ...answer, rot: (answer.rot + d) % 360 }))];
  } else { // shapes cycle while the count grows
    const cycle = rng.shuffle(['circle', 'square', 'triangle', 'diamond']).slice(0, 3);
    const a = rng.int(1, 2);
    seq = [0, 1, 2, 3].map((i) => ({ shape: cycle[i % 3], n: a + i, rot: 0, color: hue }));
    answer = { shape: cycle[4 % 3], n: a + 4, rot: 0, color: hue };
    options = [answer, { ...answer, shape: cycle[(4 + 1) % 3] }, { ...answer, n: answer.n - 1 }, { ...answer, n: answer.n + 1 }, { ...answer, shape: cycle[(4 + 2) % 3], n: answer.n - 1 }];
  }
  const uniq = [];
  for (const f of options) if (!uniq.some((u) => key(u) === key(f))) uniq.push(f);
  const picks = [answer, ...rng.shuffle(uniq.filter((f) => key(f) !== key(answer))).slice(0, 3)];
  const choices = rng.shuffle(picks).map((f) => ({ key: key(f), label: '', figure: f }));
  return { prompt: t.pattern, choices, answerKey: key(answer), kind: 'pattern', visual: { type: 'pattern', seq } };
}

function genMemory(rng, level, t) {
  const pads = level === 3 ? 6 : 4;
  const len = { 1: 3, 2: 5, 3: 6 }[level];
  const seq = Array.from({ length: len }, () => rng.int(0, pads - 1));
  return { prompt: t.memory, choices: [], input: 'seq', answerKey: seq.join(''), kind: 'memory', visual: { type: 'memory', pads, length: len, seq } };
}

function genRiddle(rng, level, t, lang) {
  const r = rng.pick(RIDDLES);
  const order = rng.shuffle([0, 1, 2, 3]);
  const answers = lang === 'fr' ? r[3] : r[2];
  const choices = order.map((i) => ({ key: String(i), label: answers[i] }));
  return { prompt: `${t.riddle}  ${lang === 'fr' ? r[1] : r[0]}`, choices, answerKey: String(r[4]), kind: 'riddle', fact: null };
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
/** What a puzzle of each level can be. Repeats weight the mix: lots of visual and hands-on puzzles, a few word and number ones. */
const KINDS = {
  1: ['sequence', 'equation', 'logic', 'fact', 'slide', 'slide', 'oddgrid', 'scatter', 'riddle', 'pattern', 'memory'],
  2: ['sequence', 'equation', 'logic', 'fact', 'slide', 'slide', 'oddgrid', 'scatter', 'riddle', 'pattern', 'memory', 'pattern'],
  3: ['sequence', 'equation', 'logic', 'slide', 'slide', 'oddgrid', 'scatter', 'riddle', 'pattern', 'memory', 'memory', 'equation'],
};
export function makePuzzle(seed, lang = 'en') {
  const L = lang === 'fr' ? 'fr' : 'en';
  const t = { ...T[L], lang: L };
  const { level } = parseSeed(seed);
  const rng = wrap(Rng.fromSeed(`puzzle:${seed}`));
  const kind = rng.pick(KINDS[level]);
  const make = {
    sequence: () => genSequence(rng, level, t), equation: () => genEquation(rng, level, t), logic: () => genLogic(rng, level, t), fact: () => genFact(rng, t, L),
    slide: () => genSlide(rng, level, t), oddgrid: () => genOddGrid(rng, level, t), scatter: () => genScatter(rng, level, t), pattern: () => genPattern(rng, level, t),
    memory: () => genMemory(rng, level, t), riddle: () => genRiddle(rng, level, t, L),
  }[kind];
  const p = make();
  return { seed, level, ...p, reward: PUZZLE_RULES.reward[level] };
}

/** Is `answerKey` right for this seed? Language-independent. */
export function checkPuzzle(seed, answerKey) {
  const p = makePuzzle(seed, 'en');
  if (p.input === 'moves') return checkSlide(p.visual.board, answerKey);
  return p.answerKey === String(answerKey);
}

/** A friendly tip shown under the puzzles. */
export function randomFact(rng, lang = 'en') {
  const f = FACTS[rng.int(FACTS.length)];
  return lang === 'fr' ? f[2] : f[0];
}
