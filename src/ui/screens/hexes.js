import { h, mount, localDateKey, sleep } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { cardTile, screenHeader, rarityLabel, avatar, toast } from '../components.js';
import { HEXES, HEX_IDS, HEX_RARITY_ORDER, HEX_NUMBERS, PACKS, FORGE_COST, STREAK_TIERS } from '../../engine/hexes.js';
import { CARD_IDS } from '../../engine/cards.js';
import { levelOf, TITLES, titleById, bestTitle, unlockedTitles, SLOTS, cosmeticsIn, COSMETICS, MAX_LEVEL } from '../../engine/cosmetics.js';
import { metaOf } from '../../storage/meta.js';
import { sfx, unlockAudio } from '../audio.js';
import { cardReveal, rarityFx } from '../rarityfx.js';
import { createBulbRite, showCardsPage, PACK_LIGHT } from '../bulbrite.js';

const TABS = [['deck', 'Deck'], ['book', 'Collection'], ['packs', 'Packs'], ['forge', 'Forge'], ['style', 'Style']];
const byRarity = (a, b) => HEX_RARITY_ORDER.indexOf(HEXES[a].rarity) - HEX_RARITY_ORDER.indexOf(HEXES[b].rarity);

/** Pack opening: press and hold the bulb until it blows (or open instantly), then the cards are dealt side by side. */
export async function openPackRitual(app, playerId, pack) {
  unlockAudio();
  const rite = createBulbRite({ name: PACKS[pack.type].name, from: pack.from, light: PACK_LIGHT[pack.type] ?? '#ffd24a', count: PACKS[pack.type].count });
  document.body.append(rite.el);
  const how = await rite.hold();
  let result;
  try { result = await app.repo.openPack(playerId, pack.id); } catch (e) { rite.close(); toast(e.message, 'err'); return null; }
  if (how === 'held') {
    const best = result.cards.map((c) => HEXES[c.id]?.rarity ?? 'common').sort((a, b) => HEX_RARITY_ORDER.indexOf(b) - HEX_RARITY_ORDER.indexOf(a))[0] ?? 'common';
    await rite.overload(best);
  }
  rite.close();
  await showCardsPage({ title: PACKS[result.type].name, results: [result], instant: how === 'quick' });
  return result;
}

/** Open every waiting pack with no animation and show all the rewards on one page. */
export async function openAllPacks(app, playerId, packs) {
  unlockAudio();
  const results = [];
  for (const k of packs) {
    try { results.push(await app.repo.openPack(playerId, k.id)); } catch (e) { toast(e.message, 'err'); break; }
  }
  if (results.length) await showCardsPage({ title: `${results.length} pack${results.length > 1 ? 's' : ''} opened`, results, instant: true });
  return results;
}

export async function hexesScreen(app, params) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  let tab = params.tab ?? 'deck';
  const root = h('div.screen');

  const paint = async () => {
    const p = profiles.find((x) => x.id === pid);
    if (!p) {
      mount(root, screenHeader('Hexes', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start a hex deck.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players'));
      return;
    }
    const fresh = await app.repo.getProfile(p.id);
    const m = metaOf(fresh);
    const lvl = levelOf(m.xp);
    const today = localDateKey();
    const dailyReady = m.daily.lastDay !== today;
    const owned = new Set(m.hexes.owned);

    const dailyBtn = h('button.btn.good.block', { type: 'button', onclick: async () => {
      const r = await app.repo.claimDaily(p.id, today);
      if (r) { sfx.cash(); toast(`Day ${r.streak}: a ${PACKS[r.type].name} is waiting`); tab = 'packs'; }
      paint();
    } }, sprite('flame', 24), `Claim today's free pack${m.daily.streak ? ` · day streak ${m.daily.streak}` : ''}`);

    const saveDeck = async (deck) => { await app.repo.setHexDeck(p.id, deck); sfx.select(); paint(); };
    const body = {
      deck: () => {
        const deck = m.hexes.deck.length ? m.hexes.deck : HEX_IDS.filter((id) => owned.has(id) && HEXES[id].starter).slice(0, HEX_NUMBERS.deckSize);
        const rest = [...owned].filter((id) => !deck.includes(id)).sort(byRarity);
        return [
          h('p.small.dim', {}, `Pick up to ${HEX_NUMBERS.deckSize} hexes for your deck. In a game, every streak earns a hex drawn from this deck: a streak of 2 a common one, 4 an uncommon, 6 a rare, 8 a legendary. Mix rarities to have something to draw.`),
          h('div.streak-ladder', {}, Object.entries(STREAK_TIERS).map(([n, r]) => h('span.tag', { class: r === 'uncommon' ? 'green' : r === 'rare' ? 'blue' : r === 'legendary' ? 'amber' : '' }, `${n} → ${rarityLabel(r)}`))),
          h('h3', {}, `Deck · ${deck.length}/${HEX_NUMBERS.deckSize}`),
          h('div.reward-grid', {}, deck.map((id) => cardTile(id, { onclick: () => saveDeck(deck.filter((x) => x !== id)) }))),
          h('h3', {}, 'Your hexes · tap to add'),
          h('div.reward-grid', {}, rest.length ? rest.map((id) => cardTile(id, { onclick: () => (deck.length >= HEX_NUMBERS.deckSize ? toast('The deck is full. Tap a deck hex to remove it.') : saveDeck([...deck, id])) })) : [h('p.small.dim', {}, 'Everything you own is already in the deck.')]),
        ];
      },
      book: () => {
        const ordered = [...HEX_IDS].sort(byRarity);
        const per = HEX_RARITY_ORDER.map((r) => `${rarityLabel(r)} ${ordered.filter((id) => HEXES[id].rarity === r && owned.has(id)).length}/${ordered.filter((id) => HEXES[id].rarity === r).length}`);
        return [
          h('div.row.between', {}, h('h3', {}, 'Hex book'), h('span.mono', {}, `${owned.size} / ${HEX_IDS.length}`)),
          h('div.progress', {}, h('i', { style: { width: `${(owned.size / HEX_IDS.length) * 100}%` } })),
          h('p.tiny.dim', {}, per.join(' · ')),
          h('div.reward-grid', {}, ordered.map((id) => owned.has(id) ? cardTile(id, { interactive: false }) : h('div.card-tile.locked.panel', { style: { minHeight: '84px', display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center' } }, sprite('lock', 32), h('div', {}, h('div.nm', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', textTransform: 'uppercase' } }, 'Not found yet'), h('div.tiny', {}, `${rarityLabel(HEXES[id].rarity)} hex`))))),
          h('button.btn.block', { type: 'button', onclick: () => go('cards', { playerId: pid }) }, `Bonus cards: ${fresh.ownedCards.length} / ${CARD_IDS.length}`),
        ];
      },
      packs: () => [
        h('p.small.dim', {}, 'Every finished game earns packs: a Bronze for playing, a Silver for a win or a streak of 5, a Gold for a streak of 8. Finished missions add a Bronze each. Duplicates turn into dust.'),
        m.packs.length > 1 ? h('button.btn.block', { type: 'button', onclick: async () => { const r = await openAllPacks(app, pid, m.packs); if (r.length) { await sleep(150); paint(); } } }, `Open all ${m.packs.length} instantly`) : null,
        m.packs.length ? h('div.col.gap-s', {}, m.packs.map((k) => h('div.panel.row', {}, sprite('key', 28), h('div.grow', {}, h('b', {}, PACKS[k.type].name), h('div.tiny.dim', {}, k.from || 'Earned')), h('button.btn.primary', { type: 'button', onclick: async () => { const r = await openPackRitual(app, pid, k); if (r) { await sleep(150); paint(); } } }, 'Open')))) : h('div.panel.inset.empty-state', {}, sprite('lock', 32), h('p', {}, 'No packs waiting.'), h('p.tiny', {}, 'Finish a game or claim your daily pack.')),
      ],
      style: () => {
        const lv = levelOf(m.xp).level;
        const eq = m.cos.equipped;
        const act = async (fn) => { try { await fn(); await paint(); } catch (e) { toast(e.message, 'err'); } };
        const titleBtns = TITLES.map((t) => h('button.ward', { type: 'button', 'aria-pressed': String((eq.title ?? bestTitle(lv).id) === t.id), class: t.level > lv ? 'locked' : '', disabled: t.level > lv, onclick: () => { sfx.select(); act(() => app.repo.equipCosmetic(pid, 'title', t.id)); } }, h('div', {}, h('b', {}, t.name), h('small', {}, t.level > lv ? `Level ${t.level}` : 'Unlocked'))));
        const section = ([slot, label]) => {
          const items = cosmeticsIn(slot);
          const none = h('button.ward', { type: 'button', 'aria-pressed': String(!eq[slot]), onclick: () => { sfx.select(); act(() => app.repo.equipCosmetic(pid, slot, null)); } }, avatar({ ...fresh, cos: { equipped: {} } }, 24), h('div', {}, h('b', {}, 'None'), h('small', {}, 'Plain')));
          return [h('h3', {}, label), h('div.wardrobe-grid', {}, none, ...items.map((c) => {
            const own = m.cos.owned.includes(c.id);
            const locked = !own && lv < c.level;
            const sub = own ? (eq[slot] === c.id ? 'Worn' : 'Owned') : locked ? `Level ${c.level}` : `✦ ${c.cost} dust`;
            return h('button.ward', { type: 'button', class: locked ? 'locked' : '', 'aria-pressed': String(eq[slot] === c.id), disabled: locked || (!own && m.hexes.dust < c.cost), onclick: () => { sfx.select(); act(async () => { if (own) await app.repo.equipCosmetic(pid, slot, c.id); else { await app.repo.buyCosmetic(pid, c.id); sfx.cash?.(); toast(`${c.name} is yours`); } }); } }, avatar({ ...fresh, cos: { equipped: { [slot]: c.id } } }, 24), h('div', {}, h('b', {}, c.name), h('small', {}, sub)));
          }))];
        };
        return [
          h('p.small.dim', {}, 'Dust also buys looks for your portrait. Frames, backgrounds, colours and costume pieces unlock as your level rises. Titles are free with your level.'),
          h('h3', {}, 'Title'), h('div.wardrobe-grid', {}, titleBtns),
          ...SLOTS.flatMap(section),
        ];
      },
      forge: () => {
        const missing = [...HEX_IDS].filter((id) => !owned.has(id)).sort(byRarity);
        return [
          h('p.small.dim', {}, 'Spend dust to craft a hex you have not found yet. Duplicates from packs give you dust.'),
          h('div.panel.row', {}, h('b.grow', {}, 'Dust'), h('span.pill', {}, m.hexes.dust)),
          missing.length ? h('div.col.gap-s', {}, missing.map((id) => {
            const cost = FORGE_COST[HEXES[id].rarity];
            return h('div.panel.row', {}, sprite(HEXES[id].icon, 28), h('div.grow', {}, h('b', {}, HEXES[id].name), h('div.tiny.dim', {}, rarityLabel(HEXES[id].rarity))), h('button.btn', { type: 'button', disabled: m.hexes.dust < cost, onclick: async () => { try { await app.repo.forgeHex(pid, id); await cardReveal(id, { title: 'Forged!' }); paint(); } catch (e) { toast(e.message, 'err'); } } }, `${cost} dust`));
          })) : h('div.panel.inset.empty-state', {}, 'You own every hex. Nothing left to forge.'),
        ];
      },
    }[tab]();

    mount(root,
      screenHeader('Hexes', () => goBack('menu')),
      profiles.length > 1 ? h('div.tabs', {}, profiles.map((x) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(x.id === pid), onclick: () => { pid = x.id; sfx.select(); paint(); } }, x.name))) : null,
      h('div.row.between', {}, h('div.lvl-card', {}, avatar(fresh, 32), h('div', {}, h('h3', {}, fresh.name), h('div.tiny.dim', {}, (titleById(m.cos.equipped.title) ?? bestTitle(lvl.level)).name))), h('span.pill', { title: 'Dust' }, `✦ ${m.hexes.dust}`)),
      h('div.panel.tight', {}, h('div.row.between', {}, h('b', {}, `Level ${lvl.level}`), h('span.tiny.dim', {}, lvl.need ? `${lvl.into} / ${lvl.need} XP` : 'Max level')), h('div.progress', {}, h('i', { style: { width: `${lvl.pct * 100}%` } }))),
      dailyReady ? dailyBtn : h('p.tiny.mute.center', {}, `Daily pack claimed · come back tomorrow (day streak ${m.daily.streak})`),
      h('div.tabs', {}, TABS.map(([k, label]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; sfx.select(); paint(); } }, k === 'packs' && m.packs.length ? `${label} (${m.packs.length})` : label))),
      ...body,
    );
  };
  await paint();
  void rarityFx;
  return root;
}
