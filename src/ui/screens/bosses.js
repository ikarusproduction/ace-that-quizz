// Boss Rush: choose which boss to duel.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { createRig } from '../bossrig.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { screenHeader, categoryTag } from '../components.js';
import { sfx } from '../audio.js';
import { BOSS_ROSTER, INTENTS, DUEL } from '../../engine/duel.js';
import '../art_bosses.js';

const LEVEL = { 1: 'Warm-up', 2: 'Tough', 3: 'Brutal', 4: 'Final' };

export async function bossesScreen(app, params) {
  setMood('boss');
  const bosses = Object.values(BOSS_ROSTER).filter((b) => !b.final).sort((a, b) => a.tier - b.tier);
  let picked = null;
  const root = h('div.screen');

  const paint = () => {
    const moves = (b) => [...new Set(b.intents)].map((id) => h('span.pat', { title: `${INTENTS[id].label}: ${INTENTS[id].text}` }, sprite(INTENTS[id].icon, 20)));
    mount(root,
      screenHeader('Choose your boss', () => goBack('setup')),
      h('p.small.dim', {}, 'One duel, no safety net. Each boss has a specialty subject, a health bar and a pattern it repeats. Harder bosses ask harder questions.'),
      h('div.boss-grid', {}, bosses.map((b) => {
        const el = h('button.boss-pick', { type: 'button', 'aria-pressed': String(picked === b.id), onclick: () => { picked = b.id; sfx.select(); paint(); } },
          h('div.pick-rig', {}, createRig(b.sprite, 96, b.name).el),
          h('div', {},
            h('div.nm', {}, b.name),
            h('div.tiny.dim', {}, b.title),
            h('div.row.wrap', { style: { gap: '6px', marginTop: '4px' } }, categoryTag(b.cat), h('span.tag', {}, LEVEL[b.tier]), h('span.tag', {}, `HP ${b.hp}`)),
            h('div.small.dim', { style: { marginTop: '4px' } }, b.blurb),
            h('div.moves', {}, moves(b)),
          ));
        el.style.setProperty('--boss', b.color);
        return el;
      })),
      h('button.btn.ghost.block', { type: 'button', onclick: () => { picked = null; sfx.tap(); go('game', { mode: 'rush', playerIds: params.playerIds, bossId: null }); } }, 'Surprise me'),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', disabled: !picked, onclick: () => { sfx.stake(); go('game', { mode: 'rush', playerIds: params.playerIds, bossId: picked }); } }, picked ? `Fight ${BOSS_ROSTER[picked].name}` : 'Pick a boss')),
    );
  };
  paint();
  return root;
}
