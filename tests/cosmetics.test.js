import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/engine/rng.js';
import { openPackStyle, openPack } from '../src/engine/hexes.js';
import { gateText, PACK_COSMETICS, levelOf, xpAtLevel, xpToNext, bestTitle, cleanWardrobe, buyCheck, dustForGame, COSMETICS, MAX_LEVEL } from '../src/engine/cosmetics.js';
import { metaOf, mergeMeta } from '../src/storage/meta.js';

test('levels grow with xp and cap', () => {
  assert.equal(levelOf(0).level, 1);
  assert.equal(levelOf(xpToNext(1)).level, 2);
  assert.equal(levelOf(xpAtLevel(10) - 1).level, 9);
  assert.equal(levelOf(1e9).level, MAX_LEVEL);
  assert.ok(levelOf(40).pct > 0 && levelOf(40).pct < 1);
});
test('titles follow level', () => {
  assert.equal(bestTitle(1).name, 'Newcomer');
  assert.equal(bestTitle(16).name, 'Bulb Whisperer');
  assert.equal(bestTitle(99).name, 'Master of the House');
});
test('wardrobe is cleaned and bought with dust only', () => {
  const w = cleanWardrobe({ owned: ['fr_rust', 'nope'], equipped: { frame: 'fr_rust', bg: 'bg_dusk', title: 't30' } }, 5);
  assert.deepEqual(w.owned, ['fr_rust']);
  assert.equal(w.equipped.frame, 'fr_rust');
  assert.equal(w.equipped.bg, undefined);
  assert.equal(w.equipped.title, undefined);
  assert.equal(buyCheck(w, 'fr_gold', 9999), null, 'ordinary pieces have no gate');
  assert.match(buyCheck(w, 'fr_steel', 1), /dust/);
  assert.equal(buyCheck(w, 'fr_steel', 999), null);
  assert.match(buyCheck(w, 'fr_rust', 999), /already/);
  assert.ok(Object.values(COSMETICS).filter((c) => !c.pack).every((c) => c.cost > 0));
  assert.ok(Object.values(COSMETICS).filter((c) => c.slot === 'frame').every((c) => /^#/.test(c.glow)), 'frames carry a light colour');
  assert.ok(['frame', 'bg', 'tint', 'hat', 'fx', 'room'].every((slot) => Object.values(COSMETICS).some((c) => c.slot === slot)));
  assert.equal(cleanWardrobe({ owned: ['fx_embers'], equipped: { fx: 'fx_embers' } }).equipped.fx, 'fx_embers');
});
test('dust for a finished game is small and capped', () => {
  const s = { status: 'completed', players: [{ playerId: 'a', result: 'won', bossesCleared: 20 }, { playerId: 'b', result: 'lost' }] };
  assert.equal(dustForGame(s, 'a'), 30);
  assert.equal(dustForGame(s, 'b'), 4);
  assert.equal(dustForGame({ ...s, status: 'active' }, 'a'), 0);
});
test('meta keeps xp and cosmetics, merge takes the best', () => {
  const a = { xp: 100, xpLog: ['s1'], cos: { owned: ['fr_rust'], equipped: { frame: 'fr_rust' } } };
  const b = { xp: 300, xpLog: ['s2'], cos: { owned: ['bg_dusk'], equipped: { bg: 'bg_dusk' } } };
  assert.equal(metaOf(a).xp, 100);
  const m = mergeMeta(a, b, true);
  assert.equal(m.xp, 300);
  assert.deepEqual(m.cos.owned.sort(), ['bg_dusk', 'fr_rust']);
  assert.equal(m.cos.equipped.bg, 'bg_dusk');
  assert.equal(metaOf({}).xp, 0);
});

test('prices are steep, the best pieces are gated and some are pack-only', () => {
  const buyable = Object.values(COSMETICS).filter((c) => !c.pack);
  assert.ok(buyable.every((c) => c.cost >= 100), 'nothing is cheap');
  assert.ok(Object.values(COSMETICS).every((c) => c.pack ? c.cost === undefined : c.cost > 0));
  const w = { owned: [], equipped: {} };
  assert.match(buyCheck(w, 'fr_house', 99999, { level: 10, steps: 0 }), /Level 35/);
  assert.equal(buyCheck(w, 'fr_house', 99999, { level: 35, steps: 0 }), null);
  assert.match(buyCheck(w, 'bg_void', 99999, { level: 50, steps: 99 }), /Science Adventure/);
  assert.equal(buyCheck(w, 'bg_void', 99999, { level: 1, steps: 100 }), null);
  assert.match(buyCheck(w, 'rm_hexfield', 99999), /hex packs/);
  assert.ok(gateText(COSMETICS.ht_crown) && !gateText(COSMETICS.ht_cap));
  assert.ok(Object.values(COSMETICS).some((c) => c.gate?.level) && Object.values(COSMETICS).some((c) => c.gate?.adventure));
  assert.ok(PACK_COSMETICS.length >= 5 && ['frame', 'bg', 'fx', 'tint', 'room'].every((sl) => PACK_COSMETICS.some((c) => COSMETICS[c.id].slot === sl)));
});
test('hex packs sometimes hold a bonus style piece, from a separate roll', () => {
  let got = 0; const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const st = openPackStyle(Rng.fromSeed(`packstyle:${i}`), 'gold', []);
    if (st) { got++; seen.add(st.id); assert.ok(COSMETICS[st.id].pack); assert.equal(st.dup, false); }
  }
  assert.ok(got > 80 && got < 200, `gold packs hold one about a third of the time (${got})`);
  assert.ok(seen.size >= 4);
  const dup = openPackStyle({ next: () => 0, weighted: () => 'tn_holo' }, 'gold', ['tn_holo']);
  assert.equal(dup.dup, true); assert.ok(dup.dust > 0);
  assert.equal(openPackStyle({ next: () => 0.99 }, 'bronze', []), null);
  const a = openPack(Rng.fromSeed('pack:x'), 'gold', []);
  assert.deepEqual(openPack(Rng.fromSeed('pack:x'), 'gold', []), a, 'hex cards are unaffected by the style roll');
});
