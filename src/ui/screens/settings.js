import { h, mount, downloadJson, pickFile, readFileText, formatDate } from '../dom.js';
import { go, goBack, applySettings } from '../app.js';
import { setMood } from '../lighting.js';
import { screenHeader, toast, confirmDialog, modal, infoDialog } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { CATEGORIES } from '../../engine/bank.js';
import { statCategory } from '../../engine/bank.js';
import { formatKey } from '../../storage/cloud.js';

export async function settingsScreen(app) {
  setMood('calm');
  const root = h('div.screen');
  const paint = async () => {
    const st = await app.repo.getSettings();
    const save = async (partial) => { await app.repo.saveSettings(partial); await applySettings(); };
    const counts = {};
    for (const q of app.bank.questions) counts[statCategory(q)] = (counts[statCategory(q)] ?? 0) + 1;
    const unreviewed = app.bank.questions.filter((q) => q.review !== 'verified').length;
    const info = app.repo.storageInfo();

    mount(root, 
      screenHeader('Settings', () => goBack('menu')),
      h('div.panel', {},
        h('h3', {}, 'Sound & motion'),
        h('label.switch', {}, h('span', {}, 'Sound effects'), h('input', { type: 'checkbox', checked: st.sound, onchange: async (e) => { await save({ sound: e.target.checked }); unlockAudio(); sfx.coin(); } })),
        h('label.field', {}, h('span', {}, `Volume · ${Math.round(st.volume * 100)}%`), h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(st.volume), onchange: async (e) => { await save({ volume: Number(e.target.value) }); sfx.tap(); paint(); } })),
        h('label.switch', {}, h('span', {}, 'Vibration (phones that support it)'), h('input', { type: 'checkbox', checked: st.haptics !== false, onchange: async (e) => { await save({ haptics: e.target.checked }); } })),
        h('label.switch', {}, h('span', {}, 'Reduce motion (no flicker, sway or shake)'), h('input', { type: 'checkbox', checked: st.reduceMotion, onchange: async (e) => { await save({ reduceMotion: e.target.checked }); } })),
      ),
      h('div.panel', {},
        h('h3', {}, 'Statistics thresholds'),
        h('p.small.dim', {}, 'How much data the stats need before they say something. Raise these to be stricter.'),
        numberField('Answers needed to rank a category', st.minSample, 3, 50, (v) => save({ minSample: v }).then(paint)),
        numberField('Answers before a result stops being "provisional"', st.confidentSample, st.minSample, 200, (v) => save({ confidentSample: v }).then(paint)),
      ),
      cloudPanel(app),
      h('div.panel', {},
        h('h3', {}, 'Your data'),
        h('p.small.dim', {}, info.persistent ? 'Everything is stored on this device only, in this browser. It does not sync between devices. Use export to move or back up your players.' : 'Storage is unavailable in this browser session, so nothing will be kept. Export before you close the tab.'),
        h('div.col.gap-s', {},
          h('button.btn.block', { type: 'button', onclick: () => exportAll(app) }, 'Export all data'),
          h('button.btn.block', { type: 'button', onclick: () => importFlow(app) }, 'Import data'),
          h('button.btn.block.danger', { type: 'button', onclick: () => wipe(app) }, 'Delete all data'),
        ),
        h('p.tiny.mute', {}, `Storage: ${info.kind}${info.persistent ? '' : ' (temporary)'} · save format v${app.repo.migration.to}`),
      ),
      h('div.panel', {},
        h('h3', {}, 'Question bank'),
        h('p.small', {}, `${app.bank.questions.length} questions. ${unreviewed} are unreviewed drafts: no human has fact-checked them yet. Each answer shows an explanation so you can verify it yourself, and dated news questions show the date they were written for.`),
        ...Object.entries(CATEGORIES).map(([k, c]) => h('div.kv', {}, h('span', {}, c.label), h('b', {}, counts[k] ?? 0))),
        !counts.tunes ? h('p.small.amber', {}, 'Name That Tune has no song clips installed yet. Lyrics and recordings are copyrighted, so the song list has to be supplied or licensed separately; until then that slot uses music questions.') : null,
      ),
      h('div.panel', {}, h('h3', {}, 'About'), h('p.small', {}, 'The House Knows is an original game. All pixel art is drawn in code and all sounds are synthesised, so there are no third-party assets.'), h('p.small.dim', {}, 'Made as a static web app: open it on any phone browser and add it to your home screen.')),
    );
  };
  await paint();
  return root;
}

function numberField(label, value, min, max, onchange) {
  const input = h('input', { type: 'text', inputmode: 'numeric', value: String(value), 'aria-label': label, onchange: (e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) onchange(Math.max(min, Math.min(max, v))); } });
  return h('label.field', {}, h('span', {}, `${label} (${min}–${max})`), input);
}

async function exportAll(app) {
  const data = await app.repo.exportData();
  downloadJson(`the-house-knows-${formatDate(Date.now(), { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-')}.json`, data);
  toast(`Exported ${data.profiles.length} players and ${data.results.length} answers`);
}

async function importFlow(app) {
  const file = await pickFile();
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await readFileText(file));
  } catch {
    toast('That file is not valid JSON', 'err');
    return;
  }
  const mode = await modal((close) => [
    h('h2', {}, 'Import data'),
    h('p', {}, `The file has ${data.profiles?.length ?? 0} players, ${data.sessions?.length ?? 0} games and ${data.results?.length ?? 0} answers.`),
    h('button.btn.primary.block', { type: 'button', onclick: () => close('merge') }, 'Merge into what I have'),
    h('p.small.dim', {}, 'Adds new players and answers. Nothing here is deleted or overwritten. Players with the same name but a different identity are kept apart.'),
    h('button.btn.danger.block', { type: 'button', onclick: () => close('replace') }, 'Replace everything'),
    h('p.small.dim', {}, 'Deletes all current players and history first.'),
    h('button.btn.ghost.block', { type: 'button', onclick: () => close(undefined) }, 'Cancel'),
  ]);
  if (!mode) return;
  if (mode === 'replace' && !(await confirmDialog({ title: 'Replace everything?', body: 'All current players, stats and settings on this device will be deleted and replaced by the file. This cannot be undone.', confirmLabel: 'Replace', danger: true, requireText: 'REPLACE' }))) return;
  try {
    const s = await app.repo.importData(data, { mode });
    const skipped = s.skipped.profiles + s.skipped.sessions + s.skipped.results;
    await infoDialog('Import complete', [
      `${s.profilesAdded} players added, ${s.profilesUpdated} updated, ${s.resultsAdded} new answers, ${s.sessionsAdded} new games.`,
      s.renamed.length ? `Renamed to avoid clashes: ${s.renamed.map((r) => `${r.from} → ${r.to}`).join(', ')}.` : null,
      skipped ? `${skipped} damaged or orphaned records were skipped.` : null,
    ].filter(Boolean));
    await applySettings();
    go('settings', {}, { replace: true });
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function wipe(app) {
  const ok = await confirmDialog({
    title: 'Delete all data?',
    body: ['This permanently deletes every player, every statistic, every card and your settings from this device.', 'Export first if you want a backup.'],
    confirmLabel: 'Delete everything',
    danger: true,
    requireText: 'DELETE',
  });
  if (!ok) return;
  await app.repo.wipeAll();
  await applySettings();
  toast('All data deleted');
  go('menu', {}, { replace: true });
}

/* ---------------- cloud save (website) ---------------- */
function cloudPanel(app) {
  const cloud = app.cloud;
  if (!cloud) return null;
  const when = (t) => (t ? new Date(t).toLocaleString() : 'not yet');
  const status = h('p.small.dim', {});
  const paintStatus = () => {
    const m = cloud.meta();
    status.textContent = m.error ? `Last attempt failed: ${m.error}` : `Last saved on the site: ${when(m.lastSavedAt)}`;
  };
  paintStatus();
  const codeEl = h('div.room-code', { style: { fontSize: '26px', letterSpacing: '2px' } }, cloud.ensureKey());
  const off = cloud.onChange(paintStatus);
  return h('div.panel', {},
    h('h3', {}, 'Cloud save'),
    h('p.small', {}, 'Your players, cards, stats and progress are also kept on this website, so clearing the browser or changing phone does not lose them. Write down your save code: it is the only key.'),
    h('div.center', {}, codeEl),
    status,
    h('div.col.gap-s', {},
      h('button.btn.block', { type: 'button', onclick: async (e) => { e.target.disabled = true; try { await cloud.push({ force: true }); toast('Saved on the site'); } catch (err) { toast(err.message, 'err'); } e.target.disabled = false; paintStatus(); } }, 'Save now'),
      h('button.btn.block', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(cloud.key()); toast('Save code copied'); } catch { toast(cloud.key()); } } }, 'Copy my save code'),
      h('button.btn.block', { type: 'button', onclick: () => restoreFlow(app).then((done) => { if (done) { off(); go('settings', {}, { replace: true }); } }) }, 'Restore from a save code'),
    ),
  );
}

/** Ask for a save code and merge that save into this device. Resolves true when something was restored. */
export async function restoreFlow(app) {
  const code = await modal((close) => {
    const input = h('input', { type: 'text', placeholder: 'AB12-CD34-EF56-GH78', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Save code', style: { textAlign: 'center' }, oninput: (e) => { e.target.value = formatKey(e.target.value); } });
    return [
      h('h2', {}, 'Restore from a save code'),
      h('p', {}, 'Type the save code of the device you want to recover. Players and progress from that save are merged into this device; nothing here is deleted.'),
      input,
      h('button.btn.primary.block', { type: 'button', onclick: () => close(input.value) }, 'Restore'),
      h('button.btn.ghost.block', { type: 'button', onclick: () => close(undefined) }, 'Cancel'),
    ];
  });
  if (!code) return false;
  try {
    const sum = await app.cloud.restore(code);
    await applySettings();
    await infoDialog('Restored', [`${sum.profilesAdded} players added, ${sum.profilesUpdated} updated, ${sum.resultsAdded} answers and ${sum.sessionsAdded} games recovered.`]);
    return true;
  } catch (e) {
    toast(e.message, 'err');
    return false;
  }
}
