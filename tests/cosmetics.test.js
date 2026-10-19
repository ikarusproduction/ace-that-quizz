import test from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, xpAtLevel, xpToNext, bestTitle, cleanWardrobe, buyCheck, dustForGame, COSMETICS, MAX_LEVEL } from '../src/engine/cosmetics.js';
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
  assert.equal(buyCheck(w, 'fr_gold', 999), null, 'no level gate');
  assert.match(buyCheck(w, 'fr_steel', 1), /dust/);
  assert.equal(buyCheck(w, 'fr_steel', 100), null);
  assert.match(buyCheck(w, 'fr_rust', 100), /already/);
  assert.ok(Object.values(COSMETICS).every((c) => c.cost > 0));
  assert.ok(Object.values(COSMETICS).filter((c) => c.slot === 'frame').every((c) => /^#/.test(c.glow)), 'frames carry a light colour');
  assert.ok(['frame', 'bg', 'tint', 'hat', 'fx'].every((slot) => Object.values(COSMETICS).some((c) => c.slot === slot)));
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
