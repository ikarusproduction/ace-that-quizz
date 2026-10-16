import { h } from '../dom.js';
import { sprite, AVATAR_SPRITES } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { avatar, modal, confirmDialog, toast, screenHeader, pct } from '../components.js';
import { computeStats } from '../../stats/stats.js';
import { NAME_MAX } from '../../storage/repo.js';
import { sfx } from '../audio.js';
import { LANGUAGES, guessLanguage } from '../../i18n/languages.js';

/** Create or edit a profile in a modal. Resolves with the saved profile, or undefined. */
export function profileEditor(app, profile = null) {
  return modal((close) => {
    let avatarKey = profile?.avatar?.key ?? AVATAR_SPRITES[Math.floor(Math.random() * AVATAR_SPRITES.length)];
    const err = h('div.error', { role: 'alert' });
    const input = h('input', { type: 'text', value: profile?.name ?? '', maxlength: String(NAME_MAX), placeholder: 'Player name', autocomplete: 'off', autofocus: true, 'aria-label': 'Player name' });
    const langSel = h('select', { 'aria-label': 'Question language' }, LANGUAGES.map((l) => h('option', { value: l.code, selected: l.code === (profile?.language ?? guessLanguage()) }, `${l.native}${l.native !== l.name ? ` (${l.name})` : ''}`)));
    const grid = h('div.avatar-grid');
    const paint = () => {
      grid.replaceChildren(...AVATAR_SPRITES.map((k) => h('button', { type: 'button', 'aria-pressed': String(k === avatarKey), 'aria-label': k, onclick: () => { avatarKey = k; sfx.select(); paint(); } }, sprite(k, 48))));
    };
    paint();
    const save = async () => {
      err.textContent = '';
      try {
        const saved = profile ? await app.repo.updateProfile(profile.id, { name: input.value, avatar: avatarKey, language: langSel.value }) : await app.repo.createProfile({ name: input.value, avatar: avatarKey, language: langSel.value });
        close(saved);
      } catch (e) {
        err.textContent = e.message;
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    return [
      h('h2', {}, profile ? 'Edit player' : 'New player'),
      h('label.field', {}, h('span', {}, 'Name'), input),
      h('label.field', {}, h('span', {}, 'Question language'), langSel, h('span.tiny.dim', {}, 'Questions are shown to you in this language. Statistics are unaffected.')),
      h('div', {}, h('div.tiny.dim', { style: { marginBottom: '6px' } }, 'Portrait'), grid),
      err,
      h('button.btn.primary.block', { type: 'button', onclick: save }, profile ? 'Save' : 'Create player'),
      h('button.btn.ghost.block', { type: 'button', onclick: () => close(undefined) }, 'Cancel'),
    ];
  });
}

export async function profilesScreen(app) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  const allResults = await app.repo.storage.getAll('results');
  const sessions = await app.repo.listSessions();
  const settings = app.settings;

  const rows = profiles.map((p) => {
    const s = computeStats({ results: allResults, sessions, playerId: p.id, opts: { minSample: settings.minSample, confidentSample: settings.confidentSample } });
    return h('div.panel', {},
      h('div.profile-row', {},
        avatar(p, 40),
        h('div.grow', {},
          h('div.name', {}, p.name),
          h('div.small.dim.mono', {}, s.totals.answered ? `${s.totals.answered} answered · ${pct(s.totals.accuracy)} · ${s.games.completed} games` : 'No games yet'),
        ),
      ),
      h('div.row.wrap', { style: { marginTop: '12px' } },
        h('button.btn.small', { type: 'button', onclick: () => go('stats', { playerId: p.id }) }, 'Stats'),
        h('button.btn.small', { type: 'button', onclick: () => go('cards', { playerId: p.id }) }, 'Cards'),
        h('button.btn.small', { type: 'button', onclick: async () => { if (await profileEditor(app, p)) go('profiles', {}, { replace: true }); } }, 'Edit'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => resetStats(app, p, s) }, 'Reset stats'),
        h('button.btn.small.danger', { type: 'button', onclick: () => remove(app, p, s) }, 'Delete'),
      ),
    );
  });

  return h('div.screen', {},
    screenHeader('Players', () => goBack('menu')),
    h('p.small.dim', {}, 'Each player has their own statistics and card collection, stored on this device. Names are labels: renaming keeps all history.'),
    ...(rows.length ? rows : [h('div.panel.inset.empty-state', {}, 'No players yet. Create the first one to start playing.')]),
    h('button.btn.primary.block', { type: 'button', onclick: async () => { if (await profileEditor(app)) go('profiles', {}, { replace: true }); } }, '+ New player'),
  );
}

async function resetStats(app, p, s) {
  const ok = await confirmDialog({
    title: `Reset ${p.name}'s stats?`,
    body: [
      `This permanently deletes ${s.totals.answered} recorded answers and ${s.games.total} games for ${p.name}.`,
      `${p.name} keeps their name, portrait and card collection. Other players are not affected.`,
    ],
    confirmLabel: 'Reset stats',
    danger: true,
  });
  if (!ok) return;
  try {
    await app.repo.resetProfileStats(p.id);
    toast(`${p.name}'s stats were reset`);
    go('profiles', {}, { replace: true });
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function remove(app, p, s) {
  const ok = await confirmDialog({
    title: `Delete ${p.name}?`,
    body: [
      `This permanently deletes the player ${p.name}, ${s.totals.answered} recorded answers, ${s.games.total} games and all collected cards. It cannot be undone.`,
      'In shared Versus games only this player is removed; the other players keep their own records.',
      'Tip: use Export in Settings first if you want a backup.',
    ],
    confirmLabel: 'Delete player',
    danger: true,
    requireText: p.name,
  });
  if (!ok) return;
  try {
    await app.repo.deleteProfile(p.id);
    toast(`${p.name} was deleted`);
    go('profiles', {}, { replace: true });
  } catch (e) {
    toast(e.message, 'err');
  }
}
