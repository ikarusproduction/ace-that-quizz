import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { avatar, screenHeader, toast, confirmDialog } from '../components.js';
import { dispatch } from '../../engine/game.js';
import { sfx, unlockAudio } from '../audio.js';
import { profileEditor } from './profiles.js';
import { localDateKey } from '../dom.js';

const MODES = [
  { id: 'rush', icon: 'skull', name: 'Boss Rush', sub: 'pick a boss · one duel · ~5 min', min: 1, max: 1, text: 'Pick one boss and fight it alone. Right answers hit, wrong answers crack your bulbs. Read its moves, spend your heat wisely.' },
  { id: 'map', icon: 'swords', name: 'Map run', sub: 'five rooms deep · ~10 min', min: 1, max: 1, text: 'Climb a branching map: contestants, a champion, a boss, shops, rests and shady deals, then The House. Every path is your call.' },
  { id: 'versus', icon: 'jammer', name: 'Versus', sub: '2–4 players · one phone', min: 2, max: 4, text: 'Pass the phone. Three rounds, most chips wins. Attack cards are live.' },
  { id: 'daily', icon: 'hourglass', name: 'Daily', sub: 'same seed for everyone', min: 1, max: 1, text: "Today's fixed run: the same questions in the same order for everyone. No cards." },
];

let lastMode = 'map';
let chosen = [];

export async function setupScreen(app, params) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  const sessions = await app.repo.listSessions();
  const hasTunes = app.bank.questions.some((q) => q.category === 'tunes');
  let mode = params.mode ?? lastMode;
  if (mode === 'solo' || mode === 'quick' || !['rush', 'map', 'versus', 'daily'].includes(mode)) mode = 'map';
  chosen = chosen.filter((id) => profiles.some((p) => p.id === id));
  if (!chosen.length && recent.ids.length) chosen = [recent.ids[0]];

  const root = h('div.screen');
  const fit = () => {
    const m = MODES.find((x) => x.id === mode);
    if (chosen.length > m.max) chosen = chosen.slice(-m.max);
  };

  const paint = () => {
    fit();
    const m = MODES.find((x) => x.id === mode);
    const today = `daily-${localDateKey()}`;
    const playedToday = mode === 'daily' && chosen.length === 1
      ? sessions.find((s) => s.seed === today && s.status === 'completed' && s.players.some((p) => p.playerId === chosen[0]))
      : null;
    const ready = chosen.length >= m.min && chosen.length <= m.max;
    const lastGroup = recent.lastGroup && (recent.lastGroup.mode === mode || (['rush', 'map'].includes(mode) && recent.lastGroup.mode === 'solo')) ? recent.lastGroup : null;

    mount(root, 
      screenHeader('New game', () => goBack('menu')),
      h('div.col.gap-s', {}, MODES.map((x) => h('button.pick', { type: 'button', 'aria-pressed': String(x.id === mode), onclick: () => { mode = x.id; lastMode = mode; sfx.select(); paint(); } }, sprite(x.icon, 32), h('div', {}, h('div.name.profile-row', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 } }, x.name), h('div.tiny.dim', {}, x.sub))))),
      h('p.small.dim', {}, m.text),
      h('div.hr'),
      h('div.row.between', {}, h('h3', {}, m.max > 1 ? `Players (${m.min}–${m.max})` : 'Player'), m.max > 1 ? h('span.tiny.dim', {}, 'tap in turn order') : null),
      lastGroup && lastGroup.ids.length >= m.min && lastGroup.ids.length <= m.max
        ? h('button.btn.small.ghost', { type: 'button', onclick: () => { chosen = [...lastGroup.ids]; sfx.select(); paint(); } }, `↺ Same as last time (${lastGroup.ids.map((id) => profiles.find((p) => p.id === id)?.name).join(', ')})`)
        : null,
      h('div.col.gap-s', {}, profiles.length ? profiles.map((p) => {
        const idx = chosen.indexOf(p.id);
        return h('button.pick', {
          type: 'button', 'aria-pressed': String(idx >= 0),
          onclick: () => {
            sfx.select();
            if (idx >= 0) chosen.splice(idx, 1);
            else if (m.max === 1) chosen = [p.id];
            else if (chosen.length < m.max) chosen.push(p.id);
            else toast(`Up to ${m.max} players`);
            paint();
          },
        }, avatar(p, 32), h('span.name.profile-row', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, textTransform: 'uppercase' } }, p.name), idx >= 0 && m.max > 1 ? h('span.order', {}, String(idx + 1)) : null);
      }) : [h('div.panel.inset.empty-state', {}, 'Create your first player to begin.')]),
      h('button.btn.ghost.block', { type: 'button', onclick: async () => { const p = await profileEditor(app); if (p) { profiles.push(p); if (m.max === 1) chosen = [p.id]; else if (chosen.length < m.max) chosen.push(p.id); paint(); } } }, '+ New player'),
      playedToday ? h('div.panel.tight.good.small', {}, `${profiles.find((p) => p.id === chosen[0])?.name} already played today's daily and scored ${playedToday.players.find((p) => p.playerId === chosen[0])?.score ?? 0}. You can play it again; each attempt is recorded as its own game.`) : null,
      !hasTunes ? h('p.tiny.mute', {}, 'Name That Tune: no song clips are installed yet, so that slot uses music questions from Arts.') : null,
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', disabled: !ready, onclick: () => start(app, mode, [...chosen]) }, ready ? 'Start game' : m.max > 1 ? `Pick ${m.min}–${m.max} players` : 'Pick a player')),
    );
  };
  paint();
  return root;
}

async function start(app, mode, playerIds) {
  unlockAudio();
  sfx.tap();
  const active = await app.repo.loadActiveGame();
  if (active) {
    const ok = await confirmDialog({
      title: 'A game is already in progress',
      body: ['Starting a new game abandons the unfinished one. Its answers stay in your statistics, but it gets no score and no card reward.'],
      confirmLabel: 'Abandon it and start',
      danger: true,
    });
    if (!ok) return;
    const res = dispatch(active, { type: 'ABANDON' }, app.ctx);
    await app.repo.finalizeSession(res.state);
  }
  // Daily is a fixed shared run and the solo duels pick their own questions, so none of them has a theme choice.
  if (mode === 'rush') return go('bosses', { mode, playerIds });
  go(mode === 'daily' || mode === 'map' ? 'game' : 'themes', { mode, playerIds });
}
