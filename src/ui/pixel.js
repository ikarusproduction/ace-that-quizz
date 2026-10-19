// Code-drawn pixel art. Every sprite is a small grid of palette letters, turned
// into a crisp SVG on demand. Symmetrical sprites store only their left half.
//
// Nothing here is traced from or copied from another game: all designs are original.

const PALETTE = {
  k: '#0b0c0d', // outline
  d: '#2a2d30', // steel
  g: '#4a4f54', // grey
  l: '#8a9096', // light grey
  b: '#e8e2d0', // bone
  w: '#fbf8ee', // highlight
  a: '#e8a33d', // amber
  A: '#a8711f', // dark amber
  y: '#f6d77f', // lamp yellow
  o: '#d9772b', // orange
  O: '#8f4a17', // dark orange
  r: '#b3261e', // blood
  R: '#6d1713', // dark blood
  v: '#6fa86b', // verdict green
  V: '#3f6b44', // dark green
  n: '#6b4630', // brown
  N: '#3e281a', // dark brown
  s: '#d3a784', // skin
  S: '#9a7156', // dark skin
  u: '#4a7bb0', // blue
  U: '#274a73', // dark blue
  p: '#8a5fb0', // purple
  P: '#4d2f66', // dark purple
};

/** Each entry: { m: true, rows: [half rows] } mirrors rows; otherwise full rows. */
const SPRITES = {
  /* ---------------------------- avatars 16x16 ---------------------------- */
  gasmask: { m: true, rows: [
    '........', '....kkkk', '...kggdd', '..kgggdd', '..kgggdd', '..kyyykg', '..kykkkg', '..kyyykg',
    '..kgggdd', '...kggdd', '...kkddl', '....kldl', '....kddd', '...kkggg', '...kgrgg', '....kkkk' ] },
  welder: { m: true, rows: [
    '........', '...kkkkk', '..kgggll', '.kggllll', '.kgggggg', '.kdddddd', '.kdaaaaa', '.kdddddd',
    '.kdddddd', '.kgggggg', '..kkgggg', '...kbbbb', '..kbbbbb', '.kbbbbbb', '.kbbbbbb', '.kkkkkkk' ] },
  radio: { rows: [
    '.............k..', '............k...', '...........k....', '..........k.....',
    '..kkkkkkkkkkkkk.', '.kaaaaaaaaaaaak.', '.kakkkkkkkkkaak.', '.kakddddddkkaak.',
    '.kakdgdgdgdkaak.', '.kakddddddkkaak.', '.kakdgdgdgdkaak.', '.kakkkkkkkkkaak.',
    '.kaAAAAAAAAAAak.', '.kaAyAAAvAArAak.', '.kaaaaaaaaaaaak.', '..kkkkkkkkkkkk..' ] },
  owl: { m: true, rows: [
    '........', '..k...kk', '..knkknn', '..knnnnn', '.knbbnnn', '.knbkbnn', '.knbbbnb', '.knnnaan',
    '.knnnaan', '.knbnnnn', '.knbbnnb', '.knnbbnb', '..knnnnn', '..kkaakk', '...kaaak', '....kkkk' ] },
  fox: { m: true, rows: [
    '........', '.ko....o', '.koo..oo', '.kooooo.', '.koooooo', '.kooooww', '.kobkoww', '..kooooo',
    '..kowwww', '..kowwww', '...kowww', '...kowkk', '....kowk', '.....kkk', '........', '........' ] },
  crow: { m: true, rows: [
    '........', '....kkkk', '...kddgg', '..kddggg', '..kdgggl', '..kdgwkl', '..kdggkk', '..kdgggA',
    '..kddggA', '...kddaa', '...kdkAa', '..kddgkA', '.kddggg.', '.kdgggg.', '..kdgg..', '...kk...' ] },
  miner: { m: true, rows: [
    '........', '.....yyy', '...kkyyy', '..kaaaaa', '.kaaaaaa', '.kkkkkkk', '..ksssss', '..kskksk',
    '..kssssS', '..ksssss', '..knnnnn', '..knnnnn', '...kssss', '....kkkk', '..kkaaaa', '.kaaaaaa' ] },
  jester: { rows: [
    '.pp..........rr.', '.ppp........rrr.', '.pPpp......rrRr.', '..pPpp....rrRr..',
    '..kpPpppkrrrRk..', '..kpppprrrrrk...', '..kpppprrrrrk...', '..kkkkkkkkkkk...',
    '..ksssssssssk...', '..kskksskkssk...', '..ksssssssssk...', '..kssrrrrrssk...',
    '...ksssssssk....', '..kpprrpprrpk...', '.kpprrpprrpprk..', '.kkkkkkkkkkkkk..' ] },

  /* ----------------------------- icons 12x12 ----------------------------- */
  news: { rows: [
    '............', '.kkkkkkkkkk.', '.kbbbbbbbbk.', '.kbaabkkkbk.', '.kbaabbbbbk.', '.kbbbbbbbbk.',
    '.kbkkkbkkkk.', '.kbbbbbbbbk.', '.kbkkkbkkkk.', '.kbbbbbbbbk.', '.kkkkkkkkkk.', '............' ] },
  history: { m: true, rows: [
    '......', '.kkkkk', '.kbbbb', '..kbbb', '..kbbb', '..kbbb', '..kbbb', '..kbbb', '..kbbb', '.kbbbb', '.kkkkk', '......' ] },
  geography: { m: true, rows: [
    '......', '..kkkk', '.kuuvv', 'kuuvvv', 'kuvvvu', 'kuvvuu', 'kuuvuu', 'kuuuvu', 'kuuuvv', '.kuuuv', '..kkkk', '......' ] },
  science: { m: true, rows: [
    '......', '..kkkk', '...kbb', '...kbb', '...kbb', '..kbbb', '.kbvvv', '.kbvvv', 'kbvvvv', 'kbvvvv', 'kkkkkk', '......' ] },
  medicine: { m: true, rows: [
    '......', '..kkkk', '.kwwww', '.kwwrr', '.kwwrr', 'kkwwrr', 'kwwwrr', 'kwwwrr', '.kwwrr', '.kwwww', '..kkkk', '......' ] },
  phobia: { m: true, rows: [
    '......', '.kkkk.', 'kbbbbb', 'kbkkbb', 'kbkkbb', 'kbbbbb', 'kbbbbb', 'kbbkbk', 'kbkbkb', 'kbbbbb', 'kkkkkk', '......' ] },
  nature: { rows: [
    '............', '........kk..', '......kkvvk.', '....kkvvvvk.', '..kkvvvVvvk.', '.kvvvvVvvvk.',
    '.kvvvVvvvk..', '..kvVvvvk...', '...kVvkk....', '..kn.kk.....', '.kn.........', '............' ] },
  arts: { m: true, rows: [
    '......', '.kkkkk', 'kbbbbb', 'kbkkbb', 'kbkkbb', 'kbbbbb', 'kbbkkk', 'kbbkbb', '.kbbbb', '..kbbb', '...kkk', '......' ] },
  symbols: { rows: [
    '............', '.kkkkkkkkkk.', '.kaaaaaaaak.', '..kaaak.kkk.', '...kaaak....', '....kaak....',
    '...kaaak....', '..kaaak.....', '.kaaaaaaaak.', '.kaaaaaaaak.', '.kkkkkkkkkk.', '............' ] },
  tunes: { rows: [
    '............', '.....kkkkkk.', '.....kbbbbk.', '.....kbkkkk.', '.....kb.k...', '.....kb.k...',
    '.....kb.k...', '..kkkkb.k...', '.kbbbkb.k...', '.kbbbkb.....', '.kbbbk......', '..kkk.......' ] },

  /* ------------------------------ theme icons ----------------------------- */
  cinema: { rows: [
    '............', '.kkkkkkkkkk.', '.kaakaakaak.', '.kkkkkkkkkk.', '.kbbbbbbbbk.', '.kbkbbbbkbk.',
    '.kbbbbbbbbk.', '.kbbkkkkbbk.', '.kbbbbbbbbk.', '.kbbbbbbbbk.', '.kkkkkkkkkk.', '............' ] },
  popculture: { m: true, rows: [
    '......', '.....k', '....ka', '...kaa', 'kkkkaa', 'kaaaaa', '.kaaaa', '..kaaa', '.kaaak', 'kaakkk', 'kkk...', '......' ] },
  manga: { m: true, rows: [
    '......', '..kkkk', '.kbbbb', 'kbbbbb', 'kbkkbb', 'kbkwbb', 'kbbbbb', 'kbbkkk', '.kbbbb', '..kkrr', '...kkk', '......' ] },
  cooking: { rows: [
    '............', '...kkkkkk...', '..kwwwwwwk..', '.kwwwwwwwwk.', '.kwwwwwwwwk.', '..kkkkkkkk..',
    '..kbbbbbbk..', '..kbbbbbbk..', '..kbbbbbbk..', '..kbbbbbbk..', '..kkkkkkkk..', '............' ] },
  finance: { rows: [
    '............', '...kkkkkk...', '..kaaaaaak..', '.kaaakkaaak.', '.kaakaaaaak.', '.kaaakkaaak.',
    '.kaaaaakaak.', '.kaakkkaaak.', '..kaaaaaak..', '...kkkkkk...', '............', '............' ] },
  business: { rows: [
    '............', '....kkkk....', '....k..k....', '.kkkkkkkkkk.', '.kbbbbbbbbk.', '.kbbbaabbbk.',
    '.kbbbaabbbk.', '.kbbbbbbbbk.', '.kbbbbbbbbk.', '.kkkkkkkkkk.', '............', '............' ] },
  sports: { m: true, rows: [
    '......', '..kkkk', '.koooo', 'koookO', 'kokooo', 'kooOko', 'kooook', 'kookoo', 'kOoooo', '.kooOo', '..kkkk', '......' ] },
  f1: { rows: [
    '............', '............', '....kkkk....', '...krrrrk...', '.kkkrrrrkkk.', 'krrrrrrrrrrk',
    'kkrkkkkkkrkk', '.kkgkkkkgkk.', '.kkkk..kkkk.', '............', '............', '............' ] },
  hockey: { rows: [
    '............', '.kk.........', '.kbk........', '..kbk.......', '...kbk......', '....kbk.....',
    '.....kbk....', '......kbkkk.', '.......kkddk', '........kddk', '.........kkk', '............' ] },
  music: { rows: [
    '............', '....kkkkkk..', '....kbbbbk..', '....kbkkkk..', '....kb..k...', '....kb..k...',
    '..kkkb.kkk..', '.kbbbk.kbbk.', '.kbbbk.kbbk.', '..kkk...kk..', '............', '............' ] },

  /* ------------------------------ card icons ----------------------------- */
  scalpel: { rows: [
    '............', '..........kk', '.........klk', '........klk.', '.......klk..', '......klk...',
    '.....kak....', '....kak.....', '...kak......', '..kak.......', '.kkk........', '............' ] },
  hourglass: { m: true, rows: [
    '......', '.kkkkk', '.kbbbb', '.kaaaa', '..kaaa', '...kab', '...kab', '..kbab', '.kbbaa', '.kbaaa', '.kkkkk', '......' ] },
  net: { rows: [
    '............', '.kkkkkkkkkk.', '.k.k.k.k.kk.', '.kkkkkkkkkk.', '.k.k.k.k.kk.', '.kkkkkkkkkk.',
    '..k.k.k.kk..', '..kkkkkkkk..', '...k.k.kk...', '...kkkkkk...', '....kkkk....', '............' ] },
  eye: { m: true, rows: [
    '......', '......', '..kkkk', '.kbbbb', 'kbbuuu', 'kbuukk', 'kbuukk', 'kbbuuu', '.kbbbb', '..kkkk', '......', '......' ] },
  ghost: { m: true, rows: [
    '......', '..kkkk', '.kwwww', 'kwwwww', 'kwkkww', 'kwkkww', 'kwwwww', 'kwwwww', 'kwwwww', 'kwkwkw', 'kk.k.k', '......' ] },
  shield: { m: true, rows: [
    '......', 'kkkkkk', 'kuuuuu', 'kuuwuu', 'kuuwuu', 'kuuwww', 'kuuuuu', '.kuuuu', '.kuuuu', '..kuuu', '...kkk', '......' ] },
  dice: { rows: [
    '............', '.kkkkkkkkkk.', '.kbbbbbbbbk.', '.kbkkbbbkbk.', '.kbkkbbbkbk.', '.kbbbbbbbbk.',
    '.kbbbkkbbbk.', '.kbbbkkbbbk.', '.kbbbbbbbbk.', '.kbkkbbbkkk.', '.kkkkkkkkkk.', '............' ] },
  rewind: { rows: [
    '............', '............', '....k....k..', '...kv...kv..', '..kvv..kvv..', '.kvvv.kvvv..',
    '..kvv..kvv..', '...kv...kv..', '....k....k..', '............', '............', '............' ] },
  key: { rows: [
    '............', '..kkkk......', '.kaaaak.....', '.ka..ak.....', '.ka..ak.....', '.kaaaak.....',
    '..kaak......', '...kak......', '...kaakk....', '...kak......', '...kaakk....', '....kk......' ] },
  jammer: { rows: [
    '............', '....kkkk....', '...k....k...', '..k.kkkk.k..', '..k.k..k.k..', '....k..k....',
    '.....kk.....', '....kaak....', '....kaak....', '....kaak....', '...kkkkkk...', '............' ] },
  siphon: { rows: [
    '............', '.....kkkk...', '....kbbbbk..', '....kb..kk..', '....kb......', '....kb......',
    '...kkbk.....', '...krrrk....', '..krrrrrk...', '..krrrrrk...', '...krrrk....', '....kkk.....' ] },
  ink: { rows: [
    '............', '.....kk.....', '....kddk.k..', '..kkkddkkdk.', '.kddddddddk.', '.kddddddddk.',
    '..kddddddk..', '.kdddkkddk..', '..kkk..kdk..', '.......kk...', '............', '............' ] },
  goo: { rows: [
    '............', '..kkkkkkkk..', '.kvvvvvvvvk.', '.kvwvvvvvvk.', '.kvvvvvVvvk.', '..kvvvvvvk..',
    '..kvk.kvvk..', '..kvk..kk...', '..kVk.......', '...k........', '............', '............' ] },
  quake: { rows: [
    '............', '.......k....', '......ka....', '.....ka.....', '....kaak....', '.....kak....',
    '......kak...', '.....kak....', '....ka......', '...kk.......', '............', '............' ] },
  blur: { rows: [
    '............', '..kk..kk....', '.kuuk.kuuk..', '.kuuuukuuuk.', '..kuuuuuuk..', '...kuuuuk...',
    '....kuuk....', '.....kk.....', '............', '.k.k.k.k.k..', '............', '............' ] },
  flip: { rows: [
    '............', '..kkkkkkkk..', '..kbbbbbbk..', '..kbkkkkbk..', '..kbbbbbbk..', '..kkkkkkkk..',
    '....k..k....', '....k..k....', '.kk......kk.', '.kvk....kvk.', '..kvkkkkvk..', '...kkkkkk...' ] },
  hand: { rows: [
    '............', '..k.k.k.....', '.ksksksk....', '.kssssssk...', '.kssssssskk.', '.kssssssssk.',
    '..kssssssk..', '..kssssssk..', '...kssssk...', '...kkkkkk...', '............', '............' ] },
  bag: { rows: [
    '............', '....kkkk....', '.....kk.....', '....kaak....', '...kaaaak...', '..kaaAAaak..',
    '..kaaAaaak..', '..kaaAAaak..', '..kaaaaaak..', '...kaaaak...', '....kkkk....', '............' ] },
  squid: { rows: [
    '............', '....kkkk....', '...kppppk...', '..kppppppk..', '..kpwkpwkpk.', '..kppppppk..',
    '..kppppppk..', '..kpkpkpkk..', '.kpk.kk.kpk.', '.kk..kk..kk.', '............', '............' ] },
  sponge: { rows: [
    '............', '..kkkkkkkk..', '.kyyyayyyyk.', '.kyayyyyayk.', '.kyyyyayyyk.', '.kayyyyyayk.',
    '.kyyyayyyyk.', '.kyyyyyayyk.', '..kkkkkkkk..', '............', '............', '............' ] },
  mirror: { rows: [
    '............', '...kkkkkk...', '..kbwwwwbk..', '.kbwuuuubbk.', '.kbwuuubbbk.', '.kbwuubbbbk.',
    '.kbbbbbbbbk.', '..kbbbbbbk..', '...kkkkkk...', '....kddk....', '....kddk....', '...kkkkkk...' ] },

  /* ------------------------------- interface ----------------------------- */
  bulb_on: { m: true, rows: [
    '......', '..kkkk', '.kyyyy', 'kyywww', 'kyywyy', 'kyyyyy', 'kyyyyy', '.kyyyy', '..kaaa', '..kdgg', '..kdgg', '...kkk' ] },
  bulb_off: { m: true, rows: [
    '......', '..kkkk', '.kggdd', 'kgggdd', 'kgglgd', 'kggggd', 'kggggd', '.kggdd', '..kddd', '..kdgg', '..kdgg', '...kkk' ] },
  hat_cap: { m: true, rows: [
    '........', '...kkkkk', '..knnnnn', '.knnnnnn', '.kkkkkkk', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_top: { m: true, rows: [
    '....kkkk', '....kddd', '....kddd', '....krrr', '.kkkkkkk', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_shades: { m: true, rows: [
    '........', '........', '........', '........', '........', '.kkkkkkk', '.kdlddkk', '..kddk..', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_crown: { m: true, rows: [
    '.y..y..y', '.yyyyyyy', '.yaayaay', '.kkkkkkk', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_halo: { m: true, rows: [
    '...yyyyy', '..yaaaaa', '..yaa...', '...yyyyy', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_wizard: { m: true, rows: [
    '.......k', '......kp', '.....kpp', '....kppy', '...kppPp', '..kppppP', '.kkkkkkk', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_horns: { m: true, rows: [
    'rk......', 'rrk.....', '.rrk....', '..rrk...', '..kkk...', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  hat_antenna: { m: true, rows: [
    '.......y', '.......k', '.......d', '.......d', '......kd', '.....kkk', '........', '........', '........', '........', '........', '........', '........', '........', '........', '........' ] },
  bulb_broken: { rows: [
    '....k.k.k...', '..kkgkkgkk..', '.kgglk.ddgk.', '.kglk.dadk..', '.kgkddadgk..', '.kgkdaaddgk.', '.kgdkdddkgk.', '.kggkgkkgk..', '..kggkgggk..', '...kkaAAkk..', '....kdgdk...', '....kkkkk...' ] },
  chip: { m: true, rows: [
    '......', '..kkkk', '.kaaaa', 'kaAAAA', 'kaAaaa', 'kaAaAA', 'kaAaAA', 'kaAaaa', 'kaAAAA', '.kaaaa', '..kkkk', '......' ] },
  vault: { m: true, rows: [
    '......', 'kkkkkk', 'kggggg', 'kgddgg', 'kgdlgg', 'kgddgg', 'kggggg', 'kggggg', 'kggggg', 'kkkkkk', '.k..k.', '......' ] },
  flame: { m: true, rows: [
    '......', '....k.', '...ko.', '..koo.', '..kooa', '.kooaa', '.kooya', 'kooyyy', 'kooyyy', 'kooayy', '.kooaa', '..kkkk' ] },
  lock: { m: true, rows: [
    '......', '...kkk', '..kgg.', '..kg..', '..kg..', '.kkkkk', '.kaaaa', '.kaAkA', '.kaAkA', '.kaaaa', '.kkkkk', '......' ] },
  speaker: { rows: [
    '............', '.....k......', '....kb...k..', '.kkkkb....k.', '.kbbbb..k.k.', '.kbbbb..k.k.',
    '.kbbbb..k.k.', '.kkkkb....k.', '....kb...k..', '.....k......', '............', '............' ] },
  check: { rows: [
    '............', '............', '..........vk', '.........vvk', '........vvk.', '.kv....vvk..',
    '.kvv..vvk...', '..kvvvvk....', '...kvvk.....', '....kk......', '............', '............' ] },
  cross: { rows: [
    '............', '.kr......rk.', '.krr....rrk.', '..krr..rrk..', '...krrrrk...', '....krrk....',
    '...krrrrk...', '..krr..rrk..', '.krr....rrk.', '.kr......rk.', '............', '............' ] },
  star: { m: true, rows: [
    '......', '...ka.', '...ka.', '..kaaa', 'kkkaaa', '.kayaa', '..kyyy', '..kayy', '.kaakk', '.kak..', '......', '......' ] },
};

/** Extra art registered by other modules (the boss roster). Extra palette letters are allowed. */
export function registerSprites(defs, palette = {}) {
  Object.assign(PALETTE, palette);
  Object.assign(SPRITES, defs);
  cache.clear();
}

const cache = new Map();

function expand(def) {
  const rows = def.m ? def.rows.map((r) => r + [...r].reverse().join('')) : def.rows;
  const w = Math.max(...rows.map((r) => r.length));
  return { rows: rows.map((r) => r.padEnd(w, '.')), w, h: rows.length };
}

/** SVG markup for a sprite (crisp edges, one path per colour). */
export function spriteSvg(name) {
  const def = SPRITES[name];
  if (!def) throw new Error(`Unknown sprite "${name}"`);
  const { rows, w, h } = expand(def);
  const paths = new Map();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === c) run++;
      if (c !== '.' && PALETTE[c]) {
        const d = paths.get(c) ?? '';
        paths.set(c, `${d}M${x} ${y}h${run}v1h-${run}z`);
      }
      x += run;
    }
  });
  const body = [...paths].map(([c, d]) => `<path fill="${PALETTE[c]}" d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
}

export function spriteUrl(name) {
  if (!cache.has(name)) cache.set(name, `data:image/svg+xml;utf8,${encodeURIComponent(spriteSvg(name))}`);
  return cache.get(name);
}

export const hasSprite = (name) => name in SPRITES;
export const spriteNames = () => Object.keys(SPRITES);

/** An <img> showing a sprite at an integer pixel size. */
export function sprite(name, px = 32, alt = '') {
  const img = document.createElement('img');
  img.src = spriteUrl(hasSprite(name) ? name : 'star');
  img.width = px;
  img.height = px;
  img.alt = alt;
  img.className = 'sprite';
  img.draggable = false;
  if (!alt) img.setAttribute('aria-hidden', 'true');
  return img;
}

export const AVATAR_SPRITES = ['gasmask', 'welder', 'radio', 'owl', 'fox', 'crow', 'miner', 'jester'];
export const CATEGORY_SPRITES = { news: 'news', history: 'history', geography: 'geography', science: 'science', medicine: 'medicine', phobia: 'phobia', nature: 'nature', arts: 'arts', symbols: 'symbols', tunes: 'tunes', cinema: 'cinema', popculture: 'popculture', manga: 'manga', cooking: 'cooking', finance: 'finance', business: 'business', sports: 'sports', f1: 'f1', hockey: 'hockey', music: 'music' };
