import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood, pulse } from '../lighting.js';
import { avatar, cardTile, screenHeader, toast } from '../components.js';
import { sfx } from '../audio.js';
import { CARDS } from '../../engine/cards.js';
import { cardReveal } from '../rarityfx.js';

export async function rewardsScreen(app) {
  setMood('win');
  const root = h('div.screen');
  const paint = async () => {
    const offers = await app.repo.listPendingRewards();
    const profiles = new Map((await app.repo.listProfiles()).map((p) => [p.id, p]));
    mount(root, 
      screenHeader('Card rewards', () => goBack('menu')),
      offers.length ? h('p.small.dim', {}, 'Pick one card per player. It joins that player’s collection for good.') : null,
      ...(offers.length
        ? offers.map((o) => {
            const p = profiles.get(o.playerId);
            return h('div.panel', {},
              h('div.row', { style: { marginBottom: '10px' } }, avatar(p, 24), h('h3', {}, `${p?.name ?? 'Player'}: choose a card`)),
              h('div.reward-grid', {}, o.options.map((id, i) => h('div.flip-in', { style: { animationDelay: `${i * 140}ms` } }, cardTile(id, {
                onclick: async () => {
                  try {
                    await app.repo.claimReward(o.sessionId, o.playerId, id);
                    pulse('good');
                    await cardReveal(id, { title: 'New bonus card', sub: `Added to ${p?.name}'s collection` });
                    paint();
                  } catch (e) {
                    toast(e.message, 'err');
                    paint();
                  }
                },
              })))),
            );
          })
        : [h('div.panel.inset.empty-state', {}, sprite('key', 32), h('p', {}, 'No cards waiting.'), h('p.tiny', {}, 'Finish a game to earn new ones.'))]),
      h('button.btn.block', { type: 'button', onclick: () => go('menu', {}, { replace: true }) }, 'Done'),
    );
  };
  await paint();
  return root;
}
