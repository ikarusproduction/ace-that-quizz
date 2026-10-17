import { h } from '../dom.js';
import { sprite } from '../pixel.js';
import { go } from '../app.js';
import { lightsOn, setMood } from '../lighting.js';
import { sfx, unlockAudio } from '../audio.js';
import { confirmDialog, toast } from '../components.js';
import { dispatch } from '../../engine/game.js';
import { metaOf } from '../../storage/meta.js';
import { localDateKey } from '../dom.js';

let introPlayed = false;

export async function menuScreen(app) {
  setMood('idle');
  const profiles = await app.repo.listProfiles();
  const active = await app.repo.loadActiveGame();
  const rewards = await app.repo.listPendingRewards();
  const metas = profiles.map((p) => metaOf(p));
  const packsWaiting = metas.reduce((n, m) => n + m.packs.length, 0);
  const dailyReady = metas.some((m) => m.daily.lastDay !== localDateKey());

  const el = h('div.screen', {},
    h('div.title-stage', {},
      h('div.hang', {}, h('div.cord'), sprite('bulb_on', 64)),
      h('h1.logo', {}, h('small', {}, 'The'), 'House', h('br'), 'Knows'),
      h('div.tagline', {}, 'A trivia game of nerve · 1–4 players'),
    ),
    active ? resumeCard(app, active) : null,
    rewards.length ? h('button.btn.good.block', { type: 'button', onclick: () => go('rewards') }, sprite('key', 28), `${rewards.length} card reward${rewards.length > 1 ? 's' : ''} waiting`) : null,
    packsWaiting ? h('button.btn.good.block', { type: 'button', onclick: () => go('hexes', { tab: 'packs' }) }, sprite('ink', 28), `${packsWaiting} hex pack${packsWaiting > 1 ? 's' : ''} to open`) : dailyReady && profiles.length ? h('button.btn.block', { type: 'button', onclick: () => go('hexes') }, sprite('flame', 28), 'Daily pack ready') : null,
    h('div.menu', {},
      menuBtn('primary', 'star', 'Play', profiles.length ? 'solo · versus · daily' : 'start here', () => go('setup')),
      menuBtn('', 'radio', 'Online', 'friends on their own phones', () => go('online')),
      menuBtn('', 'gasmask', 'Players', `${profiles.length} on this device`, () => go('profiles')),
      menuBtn('', 'key', 'Cards', 'bonus collection', () => go('cards')),
      menuBtn('', 'ink', 'Hexes', 'deck · packs · daily', () => go('hexes')),
      menuBtn('', 'science', 'Stats', 'strengths & weaknesses', () => go('stats')),
      menuBtn('', 'lock', 'Settings', 'sound · data · about', () => go('settings')),
    ),
    app.storageWarning ? h('div.panel.warn.tight.notice', {}, sprite('cross', 20), h('div', {}, h('b', {}, 'Progress will not be saved. '), 'This browser blocked local storage (private mode?), so profiles and stats last only until you close the tab. Export your data from Settings before leaving.')) : null,
    h('footer.legal', {}, 'Questions are unreviewed drafts. Every answer shows an explanation so you can check it yourself.'),
  );

  if (!introPlayed) {
    introPlayed = true;
    // First visit this session: the room starts dark and the bulb stutters on.
    lightsOn({ sound: false });
    const unlock = () => { unlockAudio(); };
    el.addEventListener('pointerdown', unlock, { once: true });
  }
  return el;
}

function menuBtn(kind, icon, label, sub, onclick) {
  return h('button.btn', { class: kind, type: 'button', onclick: () => { unlockAudio(); sfx.tap(); onclick(); } }, sprite(icon, 32), label, h('small', {}, sub));
}

function resumeCard(app, state) {
  const names = state.players.map((p) => p.name).join(', ');
  const modeName = { solo: 'Solo run', versus: 'Versus', daily: 'Daily' }[state.mode] ?? state.mode;
  const abandon = async () => {
    const ok = await confirmDialog({
      title: 'Abandon this game?',
      body: ['The answers you already gave stay in your statistics. The game itself will be marked abandoned: no score, no win or loss, and no card reward.'],
      confirmLabel: 'Abandon game',
      danger: true,
    });
    if (!ok) return;
    const res = dispatch(state, { type: 'ABANDON' }, app.ctx);
    await app.repo.finalizeSession(res.state);
    toast('Game abandoned');
    go('menu', {}, { replace: true });
  };
  return h('div.panel', {},
    h('div.tiny.amber', {}, 'Game in progress'),
    h('h3', {}, `${modeName} · ${names}`),
    h('p.small.dim', {}, `Round ${state.roundIndex + 1}, question ${Math.min(5, state.qIndex + 1)} of 5.`),
    h('div.row', {},
      h('button.btn.primary.grow', { type: 'button', onclick: () => go('game', { resume: true }) }, 'Resume'),
      h('button.btn.ghost', { type: 'button', onclick: abandon }, 'Abandon'),
    ),
  );
}
