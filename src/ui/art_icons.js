// Menu and mode icons: one unique 12x12 sprite per menu entry and per training mode.
import { registerSprites } from './pixel.js';

registerSprites({
  ic_compass: { rows: [
    '...kkkkkk...', '..kaaaaaak..', '.kabbbbbrak.', 'kabbbbbrrbak', 'kabbbbrrbbak', 'kabbbyrbbbak',
    'kabbddbbbbak', 'kabddbbbbbak', '.kabbbbbbak.', '..kaaaaaak..', '...kkkkkk...', '............',
  ] },
  ic_book: { rows: [
    '............', '.kkkk..kkkk.', 'kbbbbkkbbbbk', 'kbkkbkkbkkbk', 'kbbbbkkbbbbk', 'kbkkbkkbkkbk',
    'kbbbbkkbbbbk', 'kbkkbkkbkbbk', 'kbbbbkkbbbbk', 'kaaaaaaaaaak', '.kkkkkkkkkk.', '............',
  ] },
  ic_people: { rows: [
    '............', '.kkk....kkk.', 'ksssk..ksssk', 'ksssk..ksssk', '.kkk....kkk.', 'kuuuk..kvvvk',
    'kuuuukkvvvvk', 'kuuuuuuvvvvk', 'kuuuuuuvvvvk', 'kkkkkkkkkkkk', '............', '............',
  ] },
  ic_cards: { rows: [
    '............', '.kkkkkkk....', '.kaaaaak....', '.kaaaaakkkkk', '.kaaaakbbbbk', '.kaaaakbrrbk',
    '.kaaaakbrrbk', '.kkkkkkbbbbk', '......kbrrbk', '......kbbbbk', '......kkkkkk', '............',
  ] },
  ic_chest: { rows: [
    '............', '..kkkkkkkk..', '.knnnnnnnnk.', 'knnnnnnnnnnk', 'kkkkkkkkkkkk', 'kaaaayyaaaak',
    'kNNNNyyNNNNk', 'knnnnkknnnnk', 'knnnnnnnnnnk', 'knnnnnnnnnnk', 'kkkkkkkkkkkk', '............',
  ] },
  ic_chart: { rows: [
    '............', '.........kkk', '.........krk', '.........krk', '.....kkk.krk', '.....kak.krk',
    '.....kak.krk', '.kkk.kak.krk', '.kvk.kak.krk', '.kvk.kak.krk', '.kkk.kkk.kkk', 'kkkkkkkkkkkk',
  ] },
  ic_gear: { rows: [
    '.....kk.....', '.kk..gg..kk.', '.k.kkggkk.k.', '..kggggggk..', '..kggkkggk..', 'kgggk..kgggk',
    'kgggk..kgggk', '..kggkkggk..', '..kggggggk..', '.k.kkggkk.k.', '.kk..gg..kk.', '.....kk.....',
  ] },
  ic_target: { rows: [
    '.....kk.....', '...kkbbkk...', '..kbbkkbbk..', '.kbkkrrkkbk.', '.kbkrkkrkbk.', 'kbkrkrrkrkbk',
    'kbkrkrrkrkbk', '.kbkrkkrkbk.', '.kbkkrrkkbk.', '..kbbkkbbk..', '...kkbbkk...', '.....kk.....',
  ] },
  ic_sun: { rows: [
    '.....aa.....', '......a.....', '..a......a..', '....kkkk....', '...kyyyyk...', 'a..kyyyyk..a',
    'aa.kyyyyk.aa', '...kyyyyk...', '....kkkk....', '..a......a..', '......a.....', '.....aa.....',
  ] },
  ic_magnifier: { rows: [
    '............', '..kkkkk.....', '.kkuuukk....', '.kuwwuuk....', '.kuwuuuk....', '.kuuuuuk....',
    '.kkuuukk....', '..kkkkkkk...', '.......knk..', '........knk.', '.........knk', '..........k.',
  ] },
  ic_trophy: { rows: [
    '............', 'kkkkkkkkkkkk', 'kaayyyyyaakk', 'kaayyyyyyaak', '.kaayyyyaak.', '..kaayyaak..',
    '...kkaakk...', '....kaak....', '....kaak....', '...kAAAAk...', '..kkkkkkkk..', '............',
  ] },
  ic_flag: { rows: [
    '..k.........', '..kkkkkkk...', '..krrrrrrk..', '..krrrrrk...', '..krrrrk....', '..krrrk.....',
    '..kkkk......', '..k.........', '..k.........', '..k.........', '.kkk........', '.kkkkk......',
  ] },
  ic_gift: { rows: [
    '............', '...kk..kk...', '..krrkkrrk..', '...kkrrkk...', 'kkkkkkkkkkkk', 'kaaaarraaaak',
    'kaaaarraaaak', 'kkkkkkkkkkkk', 'kaaaarraaaak', 'kaaaarraaaak', 'kaaaarraaaak', 'kkkkkkkkkkkk',
  ] },
});
