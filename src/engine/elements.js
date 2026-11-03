// The 118 elements: number, symbol, English and French name, and where each one sits in the standard 18-column table.
// Everything here is stable textbook fact. Where the textbooks disagree (which element heads group 3, where astatine or
// polonium belong, what the heaviest elements are like) the element is flagged in `AMBIGUOUS` and is never asked about
// on that point, so a question never has two defensible answers.
//
// Position follows the IUPAC layout with lutetium and lawrencium in group 3, the lanthanides lanthanum to ytterbium
// (57-70) and the actinides actinium to nobelium (89-102) as the two f-block series (no group number).

// Z, symbol, English, French
const RAW = `1 H Hydrogen Hydrogène|2 He Helium Hélium|3 Li Lithium Lithium|4 Be Beryllium Béryllium|5 B Boron Bore|6 C Carbon Carbone|7 N Nitrogen Azote|8 O Oxygen Oxygène|9 F Fluorine Fluor|10 Ne Neon Néon|
11 Na Sodium Sodium|12 Mg Magnesium Magnésium|13 Al Aluminium Aluminium|14 Si Silicon Silicium|15 P Phosphorus Phosphore|16 S Sulfur Soufre|17 Cl Chlorine Chlore|18 Ar Argon Argon|19 K Potassium Potassium|20 Ca Calcium Calcium|
21 Sc Scandium Scandium|22 Ti Titanium Titane|23 V Vanadium Vanadium|24 Cr Chromium Chrome|25 Mn Manganese Manganèse|26 Fe Iron Fer|27 Co Cobalt Cobalt|28 Ni Nickel Nickel|29 Cu Copper Cuivre|30 Zn Zinc Zinc|
31 Ga Gallium Gallium|32 Ge Germanium Germanium|33 As Arsenic Arsenic|34 Se Selenium Sélénium|35 Br Bromine Brome|36 Kr Krypton Krypton|37 Rb Rubidium Rubidium|38 Sr Strontium Strontium|39 Y Yttrium Yttrium|40 Zr Zirconium Zirconium|
41 Nb Niobium Niobium|42 Mo Molybdenum Molybdène|43 Tc Technetium Technétium|44 Ru Ruthenium Ruthénium|45 Rh Rhodium Rhodium|46 Pd Palladium Palladium|47 Ag Silver Argent|48 Cd Cadmium Cadmium|49 In Indium Indium|50 Sn Tin Étain|
51 Sb Antimony Antimoine|52 Te Tellurium Tellure|53 I Iodine Iode|54 Xe Xenon Xénon|55 Cs Caesium Césium|56 Ba Barium Baryum|57 La Lanthanum Lanthane|58 Ce Cerium Cérium|59 Pr Praseodymium Praséodyme|60 Nd Neodymium Néodyme|
61 Pm Promethium Prométhium|62 Sm Samarium Samarium|63 Eu Europium Europium|64 Gd Gadolinium Gadolinium|65 Tb Terbium Terbium|66 Dy Dysprosium Dysprosium|67 Ho Holmium Holmium|68 Er Erbium Erbium|69 Tm Thulium Thulium|70 Yb Ytterbium Ytterbium|
71 Lu Lutetium Lutécium|72 Hf Hafnium Hafnium|73 Ta Tantalum Tantale|74 W Tungsten Tungstène|75 Re Rhenium Rhénium|76 Os Osmium Osmium|77 Ir Iridium Iridium|78 Pt Platinum Platine|79 Au Gold Or|80 Hg Mercury Mercure|
81 Tl Thallium Thallium|82 Pb Lead Plomb|83 Bi Bismuth Bismuth|84 Po Polonium Polonium|85 At Astatine Astate|86 Rn Radon Radon|87 Fr Francium Francium|88 Ra Radium Radium|89 Ac Actinium Actinium|90 Th Thorium Thorium|
91 Pa Protactinium Protactinium|92 U Uranium Uranium|93 Np Neptunium Neptunium|94 Pu Plutonium Plutonium|95 Am Americium Américium|96 Cm Curium Curium|97 Bk Berkelium Berkélium|98 Cf Californium Californium|99 Es Einsteinium Einsteinium|100 Fm Fermium Fermium|
101 Md Mendelevium Mendélévium|102 No Nobelium Nobélium|103 Lr Lawrencium Lawrencium|104 Rf Rutherfordium Rutherfordium|105 Db Dubnium Dubnium|106 Sg Seaborgium Seaborgium|107 Bh Bohrium Bohrium|108 Hs Hassium Hassium|109 Mt Meitnerium Meitnérium|110 Ds Darmstadtium Darmstadtium|
111 Rg Roentgenium Roentgenium|112 Cn Copernicium Copernicium|113 Nh Nihonium Nihonium|114 Fl Flerovium Flérovium|115 Mc Moscovium Moscovium|116 Lv Livermorium Livermorium|117 Ts Tennessine Tennesse|118 Og Oganesson Oganesson`;

export const CATEGORIES = {
  alkali: { en: 'Alkali metal', fr: 'Métal alcalin' },
  alkaline: { en: 'Alkaline earth metal', fr: 'Métal alcalino-terreux' },
  transition: { en: 'Transition metal', fr: 'Métal de transition' },
  post: { en: 'Post-transition metal', fr: 'Métal pauvre' },
  metalloid: { en: 'Metalloid', fr: 'Métalloïde' },
  nonmetal: { en: 'Reactive nonmetal', fr: 'Non-métal réactif' },
  halogen: { en: 'Halogen', fr: 'Halogène' },
  noble: { en: 'Noble gas', fr: 'Gaz noble' },
  lanthanide: { en: 'Lanthanide', fr: 'Lanthanide' },
  actinide: { en: 'Actinide', fr: 'Actinide' },
};
export const CATEGORY_IDS = Object.keys(CATEGORIES);

const IN = (s) => new Set(s.split(' ').map(Number));
const NONMETAL = IN('1 6 7 8 15 16 34');
const HALOGEN = IN('9 17 35 53 85 117');
const NOBLE = IN('2 10 18 36 54 86 118');
const METALLOID = IN('5 14 32 33 51 52');
const POST = IN('13 31 49 50 81 82 83 84 113 114 115 116');
const GAS = IN('1 2 7 8 9 10 17 18 36 54 86');
const LIQUID = IN('35 80');
/** Elements whose group, family or state the textbooks do not agree on: never asked about on that point. */
export const AMBIGUOUS = {
  group: IN('57 71 89 103'),
  category: IN('57 71 84 85 89 103 109 110 111 112 113 114 115 116 117 118'),
  state: new Set(Array.from({ length: 22 }, (_, i) => 97 + i)), // 97 to 118: too little is known to state it
};
/** Symbols that come from a Latin or German name, the classic stumbling block. */
export const SYMBOL_ORIGIN = { Na: 'natrium', K: 'kalium', Fe: 'ferrum', Cu: 'cuprum', Ag: 'argentum', Sn: 'stannum', Sb: 'stibium', Au: 'aurum', Hg: 'hydrargyrum', Pb: 'plumbum', W: 'wolfram' };
/** Other spellings accepted when a name is typed. */
export const NAME_ALIASES = { Aluminium: ['aluminum'], Caesium: ['cesium'], Sulfur: ['sulphur'], Césium: ['cesium', 'caesium'], Tennesse: ['tennessee', 'tennesine'] };

function periodOf(z) { return z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7; }
function groupOf(z) {
  if (z === 1) return 1;
  if (z === 2) return 18;
  if ((z >= 57 && z <= 70) || (z >= 89 && z <= 102)) return null; // the f-block series have no group number
  const start = { 2: 3, 3: 11, 4: 19, 5: 37, 6: 55, 7: 87 }[periodOf(z)];
  let k = z - start;
  if (periodOf(z) === 6 && z >= 71) k = z - 71 + 2; // lutetium continues the row at group 3
  if (periodOf(z) === 7 && z >= 103) k = z - 103 + 2;
  if (periodOf(z) <= 3) return k < 2 ? k + 1 : k + 11; // 3,4 -> 1,2 ; 5.. -> 13..
  return k + 1; // 1,2, then 3..18
}
function blockOf(z, g) {
  if (z === 2) return 's';
  if (g == null) return 'f';
  return g <= 2 ? 's' : g <= 12 ? 'd' : 'p';
}
function categoryOf(z) {
  if (NOBLE.has(z)) return 'noble';
  if (HALOGEN.has(z)) return 'halogen';
  if (NONMETAL.has(z)) return 'nonmetal';
  if (METALLOID.has(z)) return 'metalloid';
  if (POST.has(z)) return 'post';
  if ([3, 11, 19, 37, 55, 87].includes(z)) return 'alkali';
  if ([4, 12, 20, 38, 56, 88].includes(z)) return 'alkaline';
  if (z >= 57 && z <= 70) return 'lanthanide';
  if (z >= 89 && z <= 102) return 'actinide';
  return 'transition';
}

export const ELEMENTS = RAW.split('|').map((s) => s.trim()).map((s) => {
  const [z, symbol, en, fr] = s.split(' ');
  const Z = Number(z);
  const group = groupOf(Z);
  return {
    z: Z, symbol, en, fr, period: periodOf(Z), group, block: blockOf(Z, group), cat: categoryOf(Z),
    state: AMBIGUOUS.state.has(Z) ? null : GAS.has(Z) ? 'gas' : LIQUID.has(Z) ? 'liquid' : 'solid',
    origin: SYMBOL_ORIGIN[symbol] ?? null,
  };
});
export const BY_Z = Object.fromEntries(ELEMENTS.map((e) => [e.z, e]));
export const BY_SYMBOL = Object.fromEntries(ELEMENTS.map((e) => [e.symbol, e]));
export const nameOf = (e, lang = 'en') => (lang === 'fr' ? e.fr : e.en);

/** Row and column of an element in the drawn table (18 columns; the f-block series sit in two rows underneath). */
export function cell(e) {
  if (e.group == null) return { row: e.z >= 89 ? 10 : 9, col: 3 + (e.z >= 89 ? e.z - 89 : e.z - 57) };
  return { row: e.period, col: e.group };
}

export const TABLE_ROWS = 10; // 7 periods, a gap row, then the two f-block series
export const TABLE_COLS = 18;
