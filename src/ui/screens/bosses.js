// Boss Rush: choose which boss to duel.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { createRig } from '../bossrig.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { screenHeader, categoryTag } from '../components.js';
import { sfx } from '../audio.js';
import { BOSS_ROSTER, INTENTS, DUEL, evolveBoss, evolutionText, RANK_NAMES } from '../../engine/duel.js';
import { metaOf } from '../../storage/meta.js';
import '../art_bosses.js';

const LEVEL = { 1: 'Warm-up', 2: 'Tough', 3: 'Brutal', 4: 'Final', 5: 'Nightmare' };

export async function bossesScreen(app, params) {
  setMood('boss');
  const first = params.playerIds?.[0] ? await app.repo.getProfile(params.playerIds[0]) : null;
  const ranks = first ? metaOf(first).bosses : {};
  const bosses = Object.values(BOSS_ROSTER).filter((b) => !b.final).sort((a, b) => a.tier - b.tier).map((b) => evolveBoss(b, ranks[b.id] ?? 0));
  let picked = null;
  const root = h('div.screen');

  const paint = () => {
    const moves = (b) => [...new Set(b.intents)].map((id) => h('span.pat', { title: `${INTENTS[id].label}: ${INTENTS[id].text}` }, sprite(INTENTS[id].icon, 20)));
    mount(root,
      screenHeader('Choose your boss', () => goBack('setup')),
      h('p.small.dim', {}, 'One duel, no safety net. Each boss has a specialty subject, a health bar and a pattern it repeats. Beat a boss and it evolves: it comes back stronger, with harder questions and nastier moves.'),
      h('div.boss-grid', {}, bosses.map((b) => {
        const el = h('button.boss-pick', { type: 'button', 'aria-pressed': String(picked === b.id), onclick: () => { picked = b.id; sfx.select(); paint(); } },
          h('div.pick-rig', { class: b.rank ? `evolved evo-${b.rank}` : '' }, createRig(b.sprite, 96, b.name).el),
          h('div', {},
            h('div.nm', {}, b.name, b.rank ? h('span.rank-pips', { title: RANK_NAMES[b.rank] }, ' ' + '★'.repeat(b.rank)) : null),
            h('div.tiny.dim', {}, b.title),
            h('div.row.wrap', { style: { gap: '6px', marginTop: '4px' } }, categoryTag(b.cat), h('span.tag', {}, LEVEL[b.tier]), h('span.tag', {}, `HP ${b.hp}`)),
            h('div.small.dim', { style: { marginTop: '4px' } }, b.blurb),
            h('div.tiny.amber', { style: { marginTop: '4px' } }, evolutionText(b.rank)),
            h('div.moves', {}, moves(b)),
          ));
        el.style.setProperty('--boss', b.color);
        return el;
      })),
      h('button.btn.ghost.block', { type: 'button', onclick: () => { picked = null; sfx.tap(); go('game', { mode: 'rush', playerIds: params.playerIds, bossId: null }); } }, 'Surprise me'),
      h('div.stick-bottom', {}, h('button.btn.ghost.block', { type: 'button', onclick: () => { sfx.tap(); goBack('setup'); } }, '← Back'), h('button.btn.primary.block', { type: 'button', disabled: !picked, onclick: () => { sfx.stake(); go('game', { mode: 'rush', playerIds: params.playerIds, bossId: picked }); } }, picked ? `Fight ${BOSS_ROSTER[picked].name}` : 'Pick a boss')),
    );
  };
  paint();
  return root;
}
