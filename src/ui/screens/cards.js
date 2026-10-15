import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { cardTile, screenHeader, rarityLabel, avatar } from '../components.js';
import { CARDS, CARD_IDS, RARITY_ORDER } from '../../engine/cards.js';
import { sfx } from '../audio.js';

export async function cardsScreen(app, params) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  let pid = params.playerId ?? recent.ids[0] ?? profiles[0]?.id;
  const root = h('div.screen');
  const pending = await app.repo.listPendingRewards();

  const paint = async () => {
    const p = profiles.find((x) => x.id === pid);
    if (!p) {
      mount(root, screenHeader('Cards', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player to start a collection.'), h('button.btn.primary.block', { type: 'button', onclick: () => go('profiles') }, 'Players'));
      return;
    }
    const fresh = await app.repo.getProfile(p.id);
    const owned = new Set(fresh.ownedCards);
    const sorted = [...CARD_IDS].sort((a, b) => RARITY_ORDER.indexOf(CARDS[a].rarity) - RARITY_ORDER.indexOf(CARDS[b].rarity));
    mount(root, 
      screenHeader('Cards', () => goBack('menu')),
      profiles.length > 1 ? h('div.tabs', {}, profiles.map((x) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(x.id === pid), onclick: () => { pid = x.id; sfx.select(); paint(); } }, x.name))) : null,
      pending.some((o) => o.playerId === pid) ? h('button.btn.primary.block', { type: 'button', onclick: () => go('rewards') }, 'New cards to claim!') : null,
      h('div.row.between', {}, h('div.row', {}, avatar(fresh, 16), h('h3', {}, fresh.name)), h('span.mono', {}, `${owned.size} / ${CARD_IDS.length}`)),
      h('div.progress', {}, h('i', { style: { width: `${(owned.size / CARD_IDS.length) * 100}%` } })),
      h('p.small.dim', {}, 'Equip two cards before each round. Every card has a drawback, so no card is simply the best one.'),
      h('div.reward-grid', {}, sorted.map((id) => owned.has(id)
        ? cardTile(id, { interactive: false })
        : h('div.card-tile.locked.panel', { style: { minHeight: '84px', justifyContent: 'center', alignItems: 'center', display: 'flex', gap: '12px' } }, sprite('lock', 32), h('div', {}, h('div.nm', { style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', textTransform: 'uppercase' } }, 'Not found yet'), h('div.tiny', {}, rarityLabel(CARDS[id].rarity) + ' card'))))),
    );
  };
  await paint();
  return root;
}
