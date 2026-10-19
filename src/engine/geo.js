// Countries for the "while you wait" geography game: the flag to name, the capital to type.
// One row per country: iso2 | English name | French name | English capital | French capital | tier | extra accepted names.
// Tier 1 = everyone knows it, 2 = a fair guess for a traveller, 3 = a real test. Flags are SVG files in assets/flags/<iso>.svg
// (flag-icons, MIT licence, see assets/flags/LICENSE). Capitals are the seats of government that most atlases list.
const RAW = `
fr|France|France|Paris|Paris|1|
de|Germany|Allemagne|Berlin|Berlin|1|Deutschland
it|Italy|Italie|Rome|Rome|1|
es|Spain|Espagne|Madrid|Madrid|1|
gb|United Kingdom|Royaume-Uni|London|Londres|1|UK;Great Britain;England;Angleterre;Grande-Bretagne;Royaume Uni
us|United States|États-Unis|Washington|Washington|1|USA;US;United States of America;America;Etats-Unis d'Amerique;Washington DC;Washington D.C.
ca|Canada|Canada|Ottawa|Ottawa|1|
mx|Mexico|Mexique|Mexico City|Mexico|1|Mexico;Ciudad de Mexico
br|Brazil|Brésil|Brasília|Brasilia|1|Brasil;Brasilia
ar|Argentina|Argentine|Buenos Aires|Buenos Aires|1|
jp|Japan|Japon|Tokyo|Tokyo|1|
cn|China|Chine|Beijing|Pékin|1|Peking;Pekin;PRC
in|India|Inde|New Delhi|New Delhi|1|Delhi
ru|Russia|Russie|Moscow|Moscou|1|Russian Federation;Federation de Russie
au|Australia|Australie|Canberra|Canberra|1|
eg|Egypt|Égypte|Cairo|Le Caire|1|Le Caire;Caire
za|South Africa|Afrique du Sud|Pretoria|Pretoria|1|Cape Town;Le Cap;Bloemfontein
ch|Switzerland|Suisse|Bern|Berne|1|Berne
be|Belgium|Belgique|Brussels|Bruxelles|1|
nl|Netherlands|Pays-Bas|Amsterdam|Amsterdam|1|Holland;The Netherlands;Hollande;Les Pays-Bas
pt|Portugal|Portugal|Lisbon|Lisbonne|1|Lisboa
gr|Greece|Grèce|Athens|Athènes|1|Athenes;Athina
tr|Turkey|Turquie|Ankara|Ankara|1|Turkiye
se|Sweden|Suède|Stockholm|Stockholm|1|
no|Norway|Norvège|Oslo|Oslo|1|
dk|Denmark|Danemark|Copenhagen|Copenhague|1|Kobenhavn
fi|Finland|Finlande|Helsinki|Helsinki|1|
ie|Ireland|Irlande|Dublin|Dublin|1|Republic of Ireland;Eire
pl|Poland|Pologne|Warsaw|Varsovie|1|Warszawa
at|Austria|Autriche|Vienna|Vienne|1|Wien
cu|Cuba|Cuba|Havana|La Havane|1|La Habana;Havane
kr|South Korea|Corée du Sud|Seoul|Séoul|1|Korea;South-Korea;Coree;Seoul
ma|Morocco|Maroc|Rabat|Rabat|1|
dz|Algeria|Algérie|Algiers|Alger|1|Alger
tn|Tunisia|Tunisie|Tunis|Tunis|1|
sn|Senegal|Sénégal|Dakar|Dakar|1|
ng|Nigeria|Nigéria|Abuja|Abuja|1|Nigeria
ke|Kenya|Kenya|Nairobi|Nairobi|1|
sa|Saudi Arabia|Arabie saoudite|Riyadh|Riyad|1|Arabie Saoudite;Riyad
il|Israel|Israël|Jerusalem|Jérusalem|1|Israel;Jerusalem;Tel Aviv
ua|Ukraine|Ukraine|Kyiv|Kiev|1|Kiev
cz|Czechia|Tchéquie|Prague|Prague|2|Czech Republic;Czech;Republique tcheque;Tchequie;Republique Tcheque
hu|Hungary|Hongrie|Budapest|Budapest|2|
ro|Romania|Roumanie|Bucharest|Bucarest|2|Bucuresti
bg|Bulgaria|Bulgarie|Sofia|Sofia|2|
rs|Serbia|Serbie|Belgrade|Belgrade|2|
hr|Croatia|Croatie|Zagreb|Zagreb|2|
si|Slovenia|Slovénie|Ljubljana|Ljubljana|2|Slovenie
sk|Slovakia|Slovaquie|Bratislava|Bratislava|2|Slovak Republic
lt|Lithuania|Lituanie|Vilnius|Vilnius|2|
lv|Latvia|Lettonie|Riga|Riga|2|
ee|Estonia|Estonie|Tallinn|Tallinn|2|
is|Iceland|Islande|Reykjavik|Reykjavik|2|Reykjavík
lu|Luxembourg|Luxembourg|Luxembourg|Luxembourg|2|Luxembourg City;Luxembourg-Ville
mt|Malta|Malte|Valletta|La Valette|2|La Valette
cy|Cyprus|Chypre|Nicosia|Nicosie|2|Nicosie
al|Albania|Albanie|Tirana|Tirana|2|
mk|North Macedonia|Macédoine du Nord|Skopje|Skopje|3|Macedonia;Macedoine
ba|Bosnia and Herzegovina|Bosnie-Herzégovine|Sarajevo|Sarajevo|3|Bosnia;Bosnie;Bosnia-Herzegovina;Bosnie Herzegovine
me|Montenegro|Monténégro|Podgorica|Podgorica|3|Montenegro
md|Moldova|Moldavie|Chisinau|Chisinau|3|Moldavia;Chișinău;Kichinev
by|Belarus|Biélorussie|Minsk|Minsk|2|Belorussia;Bielorussie;Belarus
ge|Georgia|Géorgie|Tbilisi|Tbilissi|3|Georgie;Tbilissi
am|Armenia|Arménie|Yerevan|Erevan|3|Armenie;Erevan
az|Azerbaijan|Azerbaïdjan|Baku|Bakou|3|Azerbaidjan;Bakou
kz|Kazakhstan|Kazakhstan|Astana|Astana|3|Nur-Sultan;Noursoultan
uz|Uzbekistan|Ouzbékistan|Tashkent|Tachkent|3|Ouzbekistan;Tachkent
cl|Chile|Chili|Santiago|Santiago|2|Chili
pe|Peru|Pérou|Lima|Lima|2|Perou
co|Colombia|Colombie|Bogotá|Bogota|2|Bogota
ve|Venezuela|Venezuela|Caracas|Caracas|2|
ec|Ecuador|Équateur|Quito|Quito|2|Equateur
bo|Bolivia|Bolivie|Sucre|Sucre|3|La Paz;Bolivie
uy|Uruguay|Uruguay|Montevideo|Montevideo|2|
py|Paraguay|Paraguay|Asunción|Asunción|3|Asuncion
cr|Costa Rica|Costa Rica|San José|San José|2|San Jose
pa|Panama|Panama|Panama City|Panama|2|Panama;Ville de Panama
jm|Jamaica|Jamaïque|Kingston|Kingston|2|Jamaique
ht|Haiti|Haïti|Port-au-Prince|Port-au-Prince|2|Haiti;Port au Prince
do|Dominican Republic|République dominicaine|Santo Domingo|Saint-Domingue|3|Republique dominicaine;Saint Domingue
gt|Guatemala|Guatemala|Guatemala City|Guatemala|3|Ciudad de Guatemala
hn|Honduras|Honduras|Tegucigalpa|Tegucigalpa|3|
ni|Nicaragua|Nicaragua|Managua|Managua|3|
sv|El Salvador|Salvador|San Salvador|San Salvador|3|Salvador
bs|Bahamas|Bahamas|Nassau|Nassau|3|The Bahamas
tt|Trinidad and Tobago|Trinité-et-Tobago|Port of Spain|Port-d'Espagne|3|Trinidad;Trinite-et-Tobago
th|Thailand|Thaïlande|Bangkok|Bangkok|1|Thailande
vn|Vietnam|Viêt Nam|Hanoi|Hanoï|2|Viet Nam;Vietnam;Hanoi
id|Indonesia|Indonésie|Jakarta|Jakarta|2|Indonesie
my|Malaysia|Malaisie|Kuala Lumpur|Kuala Lumpur|2|Malaisie
sg|Singapore|Singapour|Singapore|Singapour|2|Singapour
ph|Philippines|Philippines|Manila|Manille|2|The Philippines;Manille
pk|Pakistan|Pakistan|Islamabad|Islamabad|2|
bd|Bangladesh|Bangladesh|Dhaka|Dacca|2|Dacca
lk|Sri Lanka|Sri Lanka|Colombo|Colombo|3|Sri Jayawardenepura Kotte;Kotte
np|Nepal|Népal|Kathmandu|Katmandou|2|Nepal;Katmandou
af|Afghanistan|Afghanistan|Kabul|Kaboul|2|Kaboul
ir|Iran|Iran|Tehran|Téhéran|2|Teheran
iq|Iraq|Irak|Baghdad|Bagdad|2|Irak;Bagdad
sy|Syria|Syrie|Damascus|Damas|2|Syrie;Damas
lb|Lebanon|Liban|Beirut|Beyrouth|2|Liban;Beyrouth
jo|Jordan|Jordanie|Amman|Amman|2|Jordanie
ae|United Arab Emirates|Émirats arabes unis|Abu Dhabi|Abou Dabi|2|UAE;Emirates;Emirats arabes unis;EAU;Abou Dabi
qa|Qatar|Qatar|Doha|Doha|2|
kw|Kuwait|Koweït|Kuwait City|Koweït|3|Koweit;Kuwait;Koweit City
om|Oman|Oman|Muscat|Mascate|3|Mascate
ye|Yemen|Yémen|Sana'a|Sanaa|3|Sanaa;Sana;Yemen
mn|Mongolia|Mongolie|Ulaanbaatar|Oulan-Bator|3|Ulan Bator;Oulan Bator;Mongolie
kp|North Korea|Corée du Nord|Pyongyang|Pyongyang|2|Coree du Nord;DPRK
tw|Taiwan|Taïwan|Taipei|Taipei|3|Taiwan
kh|Cambodia|Cambodge|Phnom Penh|Phnom Penh|3|Cambodge
la|Laos|Laos|Vientiane|Vientiane|3|Lao
mm|Myanmar|Birmanie|Naypyidaw|Naypyidaw|3|Burma;Birmanie;Nay Pyi Taw;Naypyitaw
bt|Bhutan|Bhoutan|Thimphu|Thimphou|3|Bhoutan;Thimphou
mv|Maldives|Maldives|Malé|Malé|3|Male;The Maldives
nz|New Zealand|Nouvelle-Zélande|Wellington|Wellington|1|Nouvelle Zelande
fj|Fiji|Fidji|Suva|Suva|3|Fidji;Fiji Islands
pg|Papua New Guinea|Papouasie-Nouvelle-Guinée|Port Moresby|Port Moresby|3|Papouasie
ws|Samoa|Samoa|Apia|Apia|3|
to|Tonga|Tonga|Nuku'alofa|Nuku'alofa|3|Nukualofa
et|Ethiopia|Éthiopie|Addis Ababa|Addis-Abeba|2|Ethiopie;Addis Abeba
gh|Ghana|Ghana|Accra|Accra|2|
ci|Ivory Coast|Côte d'Ivoire|Yamoussoukro|Yamoussoukro|2|Cote d'Ivoire;Cote dIvoire;Côte d Ivoire;Abidjan
cm|Cameroon|Cameroun|Yaoundé|Yaoundé|2|Cameroun;Yaounde
cd|DR Congo|RD Congo|Kinshasa|Kinshasa|3|Congo-Kinshasa;Democratic Republic of the Congo;DRC;Congo;Republique democratique du Congo;RDC
cg|Republic of the Congo|Congo-Brazzaville|Brazzaville|Brazzaville|3|Congo-Brazzaville;Congo Brazzaville;Republic of Congo;Congo
ao|Angola|Angola|Luanda|Luanda|3|
mz|Mozambique|Mozambique|Maputo|Maputo|3|
tz|Tanzania|Tanzanie|Dodoma|Dodoma|2|Tanzanie;Dar es Salaam
ug|Uganda|Ouganda|Kampala|Kampala|2|Ouganda
zw|Zimbabwe|Zimbabwe|Harare|Harare|3|
zm|Zambia|Zambie|Lusaka|Lusaka|3|Zambie
na|Namibia|Namibie|Windhoek|Windhoek|3|Namibie
bw|Botswana|Botswana|Gaborone|Gaborone|3|
mg|Madagascar|Madagascar|Antananarivo|Antananarivo|2|Tananarive
mu|Mauritius|Maurice|Port Louis|Port-Louis|3|Maurice
ml|Mali|Mali|Bamako|Bamako|2|
ne|Niger|Niger|Niamey|Niamey|3|
td|Chad|Tchad|N'Djamena|N'Djamena|3|Tchad;Ndjamena;N Djamena
sd|Sudan|Soudan|Khartoum|Khartoum|3|Soudan
ss|South Sudan|Soudan du Sud|Juba|Djouba|3|Soudan du Sud;Djouba
ly|Libya|Libye|Tripoli|Tripoli|2|Libye
mr|Mauritania|Mauritanie|Nouakchott|Nouakchott|3|Mauritanie
bf|Burkina Faso|Burkina Faso|Ouagadougou|Ouagadougou|3|Burkina
bj|Benin|Bénin|Porto-Novo|Porto-Novo|3|Benin;Porto Novo;Cotonou
tg|Togo|Togo|Lomé|Lomé|3|Lome
gn|Guinea|Guinée|Conakry|Conakry|3|Guinee
sl|Sierra Leone|Sierra Leone|Freetown|Freetown|3|
lr|Liberia|Liberia|Monrovia|Monrovia|3|Libéria
ga|Gabon|Gabon|Libreville|Libreville|3|
rw|Rwanda|Rwanda|Kigali|Kigali|3|
bi|Burundi|Burundi|Gitega|Gitega|3|Bujumbura
so|Somalia|Somalie|Mogadishu|Mogadiscio|3|Somalie;Mogadiscio;Mogadishu
er|Eritrea|Érythrée|Asmara|Asmara|3|Erythree
dj|Djibouti|Djibouti|Djibouti|Djibouti|3|Djibouti City
ls|Lesotho|Lesotho|Maseru|Maseru|3|
sz|Eswatini|Eswatini|Mbabane|Mbabane|3|Swaziland
cv|Cape Verde|Cap-Vert|Praia|Praia|3|Cabo Verde;Cap Vert
ad|Andorra|Andorre|Andorra la Vella|Andorre-la-Vieille|3|Andorre;Andorre la Vieille
mc|Monaco|Monaco|Monaco|Monaco|2|Monaco-Ville
li|Liechtenstein|Liechtenstein|Vaduz|Vaduz|3|
sm|San Marino|Saint-Marin|San Marino|Saint-Marin|3|Saint Marin
va|Vatican City|Vatican|Vatican City|Vatican|2|Vatican;Holy See;Saint-Siège;Saint Siege;Cite du Vatican
bz|Belize|Belize|Belmopan|Belmopan|3|
gy|Guyana|Guyana|Georgetown|Georgetown|3|
sr|Suriname|Suriname|Paramaribo|Paramaribo|3|Surinam
bb|Barbados|Barbade|Bridgetown|Bridgetown|3|Barbade
lc|Saint Lucia|Sainte-Lucie|Castries|Castries|3|St Lucia;Sainte Lucie
kg|Kyrgyzstan|Kirghizistan|Bishkek|Bichkek|3|Kyrgyzstan;Kirghizstan;Bichkek
tj|Tajikistan|Tadjikistan|Dushanbe|Douchanbé|3|Tadjikistan;Douchanbe
tm|Turkmenistan|Turkménistan|Ashgabat|Achgabat|3|Turkmenistan;Achgabat;Ashkhabad
bh|Bahrain|Bahreïn|Manama|Manama|3|Bahrein
`;

/** @type {{iso:string,en:string,fr:string,capEn:string,capFr:string,tier:number,alias:string[]}[]} */
export const COUNTRIES = RAW.trim().split('\n').map((line) => {
  const [iso, en, fr, capEn, capFr, tier, alias = ''] = line.split('|');
  return { iso, en, fr, capEn, capFr, tier: Number(tier), alias: alias ? alias.split(';') : [] };
});
export const COUNTRY = Object.fromEntries(COUNTRIES.map((c) => [c.iso, c]));

/** Lower case, no accents, no punctuation, no leading article: the form two spellings are compared in. */
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^(the|le|la|les|l|el) /, '').replace(/ +/g, ' ');
}

/** Edit distance, capped (anything above `cap` returns cap + 1). */
export function editDistance(a, b, cap = 2) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const namesOf = (c) => [c.en, c.fr, ...c.alias];
const capsOf = (c) => [c.capEn, c.capFr, ...(c.capAlias ?? [])];

// the capital questions of a few countries accept the seat or the biggest city (the clue text says "capital")
for (const c of COUNTRIES) {
  if (c.iso === 'bo') c.capAlias = ['La Paz', 'Sucre'];
  if (c.iso === 'za') c.capAlias = ['Cape Town', 'Le Cap', 'Bloemfontein'];
  if (c.iso === 'tz') c.capAlias = ['Dar es Salaam'];
  if (c.iso === 'bj') c.capAlias = ['Cotonou'];
  if (c.iso === 'ci') c.capAlias = ['Abidjan'];
  if (c.iso === 'il') c.capAlias = ['Tel Aviv'];
  if (c.iso === 'bi') c.capAlias = ['Bujumbura'];
  if (c.iso === 'lk') c.capAlias = ['Kotte', 'Sri Jayawardenepura Kotte'];
  if (c.iso === 'nl') c.capAlias = ['The Hague', 'La Haye'];
  if (c.iso === 'mc') c.capAlias = ['Monaco-Ville'];
}

const NAME_INDEX = new Map(); // normalised name -> iso
for (const c of COUNTRIES) for (const n of namesOf(c)) NAME_INDEX.set(norm(n), c.iso);
const CAP_INDEX = new Map();  // normalised capital -> [iso]
for (const c of COUNTRIES) for (const n of capsOf(c)) { const k = norm(n); CAP_INDEX.set(k, [...(CAP_INDEX.get(k) ?? []), c.iso]); }

function fuzzy(guess, targets, exactElsewhere) {
  const g = norm(guess);
  if (!g) return false;
  const hit = targets.map(norm);
  if (hit.includes(g)) return true;
  if (exactElsewhere(g)) return false; // it is exactly some other country's name: never "close enough"
  return hit.some((t) => (t.length >= 10 ? editDistance(g, t, 2) <= 2 : t.length >= 6 ? editDistance(g, t, 1) <= 1 : false));
}

/** Is `guess` (typed, any language, a typo or two forgiven on longer names) the country with this iso code? */
export function isCountry(iso, guess) {
  const c = COUNTRY[iso];
  if (!c) return false;
  return fuzzy(guess, namesOf(c), (g) => NAME_INDEX.has(g) && NAME_INDEX.get(g) !== iso);
}
/** Is `guess` the capital of that country? Another country's capital never counts, even when it is also yours (Luxembourg). */
export function isCapital(iso, guess) {
  const c = COUNTRY[iso];
  if (!c) return false;
  return fuzzy(guess, capsOf(c), (g) => (CAP_INDEX.get(g) ?? []).length > 0 && !(CAP_INDEX.get(g) ?? []).includes(iso));
}
