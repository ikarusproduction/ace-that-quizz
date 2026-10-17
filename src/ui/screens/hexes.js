import { h, mount, localDateKey, sleep } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { cardTile, screenHeader, rarityLabel, avatar, toast } from '../components.js';
import { HEXES, HEX_IDS, HEX_RARITY_ORDER, HEX_NUMBERS, PACKS, FORGE_COST, STREAK_TIERS } from '../../engine/hexes.js';
import { CARD_IDS } from '../../engine/cards.js';
import { metaOf } from '../../storage/meta.js';
import { sfx, unlockAudio } from '../audio.js';
import { cardReveal, rarityFx } from '../rarityfx.js';

const TABS = [['deck', 'Deck'], ['book', 'Collection'], ['packs', 'Packs'], ['forge', 'Forge']];
const byRarity = (a, b) => HEX_RARITY_ORDER.indexOf(HEXES[a].rarity) - HEX_RARITY_ORDER.indexOf(HEXES[b].rarity);

/** The pack-opening ritual: shake, tear, then reveal each card from the weakest to the best. */
export async function openPackRitual(app, playerId, pack) {
  unlockAudio();
  const sealed = h('button.pack-sealed', { type: 'button', class: pack.type, 'aria-label': `Open ${PACKS[pack.type].name}` },
    h('div.pack-name', {}, PACKS[pack.type].name), sprite('key', 48), h('div.tiny', {}, 'Tap to tear it open'));
  const ov = h('div.reveal-overlay', {}, h('div.reveal-box', {}, h('div.tiny.dim', {}, pack.from || 'New pack'), sealed));
  document.body.append(ov);
  await new Promise((res) => {
    let taps = 0;
    sealed.addEventListener('click', () => {
      taps += 1;
      sfx.packShake();
      sealed.classList.remove('shake'); void sealed.offsetWidth; sealed.classList.add('shake');
      if (taps >= 2) res();
    });
  });
  sfx.packTear();
  ov.remove();
  let result;
  try { result = await app.repo.openPack(playerId, pack.id); } catch (e) { toast(e.message, 'err'); return null; }
  for (let i = 0; i < result.cards.length; i++) {
    const c = result.cards[i];
    await cardReveal(c.id, { title: `${PACKS[result.type].name} · ${i + 1}/${result.cards.length}`, sub: c.dup ? `Duplicate: +${c.dust} dust` : 'New hex for your collection!' });
  }
  return result;
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
        m.packs.length ? h('div.col.gap-s', {}, m.packs.map((k) => h('div.panel.row', {}, sprite('key', 28), h('div.grow', {}, h('b', {}, PACKS[k.type].name), h('div.tiny.dim', {}, k.from || 'Earned')), h('button.btn.primary', { type: 'button', onclick: async () => { const r = await openPackRitual(app, pid, k); if (r) { await sleep(150); paint(); } } }, 'Open')))) : h('div.panel.inset.empty-state', {}, sprite('lock', 32), h('p', {}, 'No packs waiting.'), h('p.tiny', {}, 'Finish a game or claim your daily pack.')),
      ],
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
      h('div.row.between', {}, h('div.row', {}, avatar(fresh, 16), h('h3', {}, fresh.name)), h('span.pill', { title: 'Dust' }, `✦ ${m.hexes.dust}`)),
      dailyReady ? dailyBtn : h('p.tiny.mute.center', {}, `Daily pack claimed · come back tomorrow (day streak ${m.daily.streak})`),
      h('div.tabs', {}, TABS.map(([k, label]) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; sfx.select(); paint(); } }, k === 'packs' && m.packs.length ? `${label} (${m.packs.length})` : label))),
      ...body,
    );
  };
  await paint();
  void rarityFx;
  return root;
}
