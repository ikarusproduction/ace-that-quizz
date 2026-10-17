import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createRepo } from '../src/storage/repo.js';
import { STARTER_HEXES, HEXES, FORGE_COST } from '../src/engine/hexes.js';

async function setup() {
  let t = 1000; let u = 0;
  const repo = await createRepo(createMemoryStorage(), { now: () => (t += 10), uuid: () => `u${++u}` });
  const p = await repo.createProfile({ name: 'Ana' });
  return { repo, p };
}

test('profiles start with the basic hex set and no packs', async () => {
  const { repo, p } = await setup();
  const m = await repo.getMeta(p.id);
  assert.deepEqual([...m.hexes.owned].sort(), [...STARTER_HEXES].sort());
  assert.deepEqual(m.packs, []); assert.equal(m.hexes.dust, 0);
});

test('packs: awarding twice never pays twice; opening is deterministic and consumes the pack; duplicates give dust', async () => {
  const { repo, p } = await setup();
  assert.equal(await repo.addPacks(p.id, [{ id: 'g1:p:0', type: 'bronze' }, { id: 'g1:p:1', type: 'silver' }]), 2);
  assert.equal(await repo.addPacks(p.id, [{ id: 'g1:p:0', type: 'bronze' }]), 0);
  const r = await repo.openPack(p.id, 'g1:p:1');
  assert.equal(r.cards.length, 3);
  const m = await repo.getMeta(p.id);
  assert.equal(m.packs.length, 1);
  for (const c of r.cards) assert.ok(m.hexes.owned.includes(c.id));
  await assert.rejects(() => repo.openPack(p.id, 'g1:p:1'), /already been opened/);
  // same pack id on a fresh profile yields the same cards
  const { repo: repo2, p: p2 } = await setup();
  await repo2.addPacks(p2.id, [{ id: 'g1:p:1', type: 'silver' }]);
  assert.deepEqual((await repo2.openPack(p2.id, 'g1:p:1')).cards, r.cards);
});

test('forge: needs dust, only for hexes you lack', async () => {
  const { repo, p } = await setup();
  await assert.rejects(() => repo.forgeHex(p.id, 'quake'), /dust/);
  await assert.rejects(() => repo.forgeHex(p.id, 'ink_blast'), /already own/);
  // give dust by opening bronze packs of duplicates is random; set directly through the storage
  const prof = await repo.getProfile(p.id);
  prof.hexes = { owned: STARTER_HEXES, deck: [], dust: 100 };
  await repo.storage.transact([{ op: 'put', store: 'profiles', value: prof }]);
  const res = await repo.forgeHex(p.id, 'quake');
  assert.ok(res.owned.includes('quake')); assert.equal(res.dust, 100 - FORGE_COST.uncommon);
});

test('hex deck is saved, limited to four owned hexes', async () => {
  const { repo, p } = await setup();
  const deck = await repo.setHexDeck(p.id, ['ink_blast', 'goo_splat', 'kraken', 'sponge', 'pickpocket', 'ink_blast']);
  assert.deepEqual(deck, ['ink_blast', 'goo_splat', 'sponge', 'pickpocket']);
});

test('daily pack: once a day, streak grows on consecutive days and resets after a gap', async () => {
  const { repo, p } = await setup();
  assert.deepEqual(await repo.claimDaily(p.id, '2026-10-17'), { type: 'bronze', streak: 1 });
  assert.equal(await repo.claimDaily(p.id, '2026-10-17'), null);
  assert.deepEqual(await repo.claimDaily(p.id, '2026-10-18'), { type: 'bronze', streak: 2 });
  assert.deepEqual(await repo.claimDaily(p.id, '2026-10-19'), { type: 'silver', streak: 3 });
  assert.deepEqual(await repo.claimDaily(p.id, '2026-10-22'), { type: 'bronze', streak: 1 });
});

test('export and import keep hexes, packs and dust; merging never loses any', async () => {
  const { repo, p } = await setup();
  await repo.addPacks(p.id, [{ id: 'x:1', type: 'gold' }]);
  await repo.claimDaily(p.id, '2026-10-17');
  const data = await repo.exportData();
  const { repo: other } = await setup();
  await other.importData(data, { mode: 'merge' });
  const imported = (await other.listProfiles()).find((x) => x.id === p.id);
  const m = await other.getMeta(imported.id);
  assert.equal(m.packs.length, 2); assert.equal(m.daily.streak, 1);
});
