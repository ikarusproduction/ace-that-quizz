// Friends: your friend code, a list of friends (stored inside your profile) and a side-by-side comparison of stat cards.
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { avatar, screenHeader, toast, confirmDialog } from '../components.js';
import { sfx } from '../audio.js';
import { CATEGORIES } from '../../engine/bank.js';
import { normalizeFriendCode, FRIEND_CODE_RE, accuracyOf } from '../../stats/card.js';

const STALE_MS = 10 * 60 * 1000;
const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const ago = (t) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export async function friendsScreen(app, params = {}) {
  setMood('calm');
  const root = h('div.screen');
  const profiles = await app.repo.listProfiles();
  const recent = await app.repo.getRecent();
  if (!profiles.length) return h('div.screen', {}, screenHeader('Friends', () => goBack('menu')), h('div.panel.inset.empty-state', {}, 'Create a player first, then come back to add friends.'));
  if (!app.cloud) {
    return h('div.screen', {}, screenHeader('Friends', () => goBack('menu')), h('div.panel', {}, h('h3', {}, 'Friends need the website'), h('p.small.dim', {}, 'Friend cards are kept on the game server of your site (the PHP relay). This copy of the game is not connected to one, so friends are not available here.')));
  }
  let pid = params.playerId && profiles.some((p) => p.id === params.playerId) ? params.playerId : (recent.ids.find((i) => profiles.some((p) => p.id === i)) ?? profiles[0].id);
  let compare = params.compare ?? null;
  let my = null; let identity = null; let friends = [];
  let busy = false;

  const load = async () => {
    identity = await app.repo.friendIdentity(pid);
    friends = await app.repo.listFriends(pid);
    my = await app.repo.friendCard(pid);
  };
  const publish = async () => {
    try { await app.cloud.publishFriendCard(pid); return true; } catch (e) { toast(`Could not publish your card: ${e.message}`, 'err'); return false; }
  };
  const refreshAll = async ({ onlyStale = false } = {}) => {
    let changed = 0;
    for (const f of [...friends]) {
      if (onlyStale && Date.now() - f.fetchedAt < STALE_MS) continue;
      try {
        const got = await app.cloud.lookupFriend(f.code);
        await app.repo.saveFriend(pid, { code: f.code, card: got.card });
        changed++;
      } catch { /* a friend that is not reachable keeps the card we have */ }
    }
    if (changed) friends = await app.repo.listFriends(pid);
    return changed;
  };

  const profileTabs = () => (profiles.length > 1
    ? h('div.tabs', {}, profiles.map((p) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(p.id === pid), onclick: async () => { pid = p.id; compare = null; await load(); sfx.select(); paint(); publish(); } }, p.name)))
    : null);

  const addFriend = async (raw, input) => {
    const code = normalizeFriendCode(raw);
    if (!FRIEND_CODE_RE.test(code)) return toast('A friend code looks like K7QD-4MXP', 'err');
    if (busy) return;
    busy = true;
    try {
      const got = await app.cloud.lookupFriend(code);
      const r = await app.repo.saveFriend(pid, { code, card: got.card });
      friends = r.friends;
      sfx.coin?.();
      toast(r.added ? `${got.card.name} is now your friend` : `${got.card.name} refreshed`);
      if (input) input.value = '';
      paint();
    } catch (e) { toast(e.message, 'err'); }
    busy = false;
  };

  const invite = async () => {
    const url = location.origin + location.pathname;
    const text = `Come and play The House Knows with me! Add my friend code ${identity.code}.`;
    sfx.tap();
    if (navigator.share) { try { await navigator.share({ title: 'The House Knows', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite copied. Paste it in any chat.'); } catch { toast(`${text} ${url}`); }
  };

  const listView = () => {
    const input = h('input', { type: 'text', placeholder: 'Friend code, e.g. K7QD-4MXP', maxlength: 9, autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Friend code' });
    input.addEventListener('input', () => { const v = normalizeFriendCode(input.value); if (v !== input.value.toUpperCase()) input.value = v; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFriend(input.value, input); });
    return [
      screenHeader('Friends', () => goBack('menu')),
      profileTabs(),
      h('button.btn.primary.block.invite-btn', { type: 'button', onclick: invite }, '✉ Invite friends to play'),
      h('div.panel', {},
        h('div.tiny.dim', {}, `${profiles.find((p) => p.id === pid)?.name}'s friend code`),
        h('div.code-box', {}, identity.code),
        h('div.row', {},
          h('button.btn.small.grow', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(identity.code); toast('Code copied'); } catch { toast(identity.code); } } }, 'Copy'),
          navigator.share ? h('button.btn.small.grow', { type: 'button', onclick: () => navigator.share({ title: 'The House Knows', text: `Add me on The House Knows: ${identity.code}`, url: location.origin + location.pathname }).catch(() => {}) }, 'Share') : null),
        h('p.tiny.dim', {}, 'Friends who have your code see your name, portrait and totals (wins, accuracy by subject, bosses beaten). Never your individual answers.'),
      ),
      h('div.panel', {}, h('h3', {}, 'Add a friend'), h('div.row', {}, h('div.grow', {}, input), h('button.btn.primary', { type: 'button', onclick: () => addFriend(input.value, input) }, 'Add'))),
      h('div.row.between', {}, h('h3', {}, `Friends (${friends.length})`), friends.length ? h('button.btn.small.ghost', { type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; const n = await refreshAll(); toast(n ? `Updated ${n}` : 'Nothing new'); paint(); } }, 'Refresh') : null),
      friends.length
        ? h('div.col.gap-s', {}, friends.map((f) => h('div.panel.tight.friend-row', {},
            avatar(f.avatar || f.card?.avatar, 24),
            h('div.grow', {}, h('b', {}, f.name), h('div.tiny.dim', {}, f.card ? `${f.card.wins} wins · ${pct(accuracyOf(f.card))} accuracy · ${ago(f.fetchedAt)}` : 'No card yet')),
            h('button.btn.small', { type: 'button', onclick: () => { compare = f.code; sfx.select(); paint(); } }, 'Compare'),
            h('button.btn.small.ghost.icon', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: async () => { const ok = await confirmDialog({ title: `Remove ${f.name}?`, body: ['You can add them again any time with their code.'], confirmLabel: 'Remove', danger: true }); if (ok) { friends = await app.repo.removeFriend(pid, f.code); paint(); } } }, '✕'))))
        : h('div.panel.inset.empty-state', {}, 'No friends yet. Send them your code, or type theirs above.'),
    ];
  };

  const compareView = () => {
    const f = friends.find((x) => x.code === compare);
    if (!f?.card) { compare = null; return listView(); }
    const me = profiles.find((p) => p.id === pid);
    const a = my; const b = f.card;
    const rows = [
      ['Games won', a.wins, b.wins, String],
      ['Games played', a.games, b.games, String],
      ['Best solo score', a.best, b.best, String],
      ['Longest streak', a.streak, b.streak, String],
      ['Accuracy', accuracyOf(a), accuracyOf(b), pct, 1],
      ['Bosses beaten', a.bosses, b.bosses, String],
      ['Boss Rush wins', a.rush, b.rush, String],
      ['Map run wins', a.maps, b.maps, String],
      ['Hexes collected', a.hexes, b.hexes, String],
    ];
    const cats = Object.keys(CATEGORIES).filter((k) => (a.cats[k]?.[0] ?? 0) + (b.cats[k]?.[0] ?? 0) > 0)
      .map((k) => [CATEGORIES[k].short, a.cats[k]?.[0] ? a.cats[k][1] / a.cats[k][0] : null, b.cats[k]?.[0] ? b.cats[k][1] / b.cats[k][0] : null, pct, 1]);
    let lead = 0; let behind = 0;
    const line = ([label, x, y, fmt, max]) => {
      const mx = max ?? Math.max(x ?? 0, y ?? 0, 1);
      const w = (v) => `${Math.round(((v ?? 0) / mx) * 100)}%`;
      if (x != null && y != null) { if (x > y) lead++; else if (y > x) behind++; }
      const xl = x != null && y != null && x > y; const yl = x != null && y != null && y > x;
      return [
        h('div.col', { style: { gap: '2px' } }, h('div.v.l', {}, fmt(x)), h('div.bar.l', { class: xl ? 'lead' : '' }, h('i', { style: { width: w(x) } }))),
        h('div.lab', {}, label),
        h('div.col', { style: { gap: '2px' } }, h('div.v', {}, fmt(y)), h('div.bar.r', { class: yl ? 'lead' : '' }, h('i', { style: { width: w(y) } }))),
      ];
    };
    const body = rows.map(line);
    const catBody = cats.map(line);
    return [
      screenHeader(`You vs ${f.name}`, () => { compare = null; paint(); }),
      h('div.panel', {},
        h('div.row.between', {}, h('div.col', { style: { alignItems: 'center', gap: '4px' } }, avatar(me, 32), h('b', {}, me.name)), h('span.tiny.dim', {}, 'vs'), h('div.col', { style: { alignItems: 'center', gap: '4px' } }, avatar(f.avatar || b.avatar, 32), h('b', {}, f.name))),
        h('p.small.center', {}, lead > behind ? `You lead on ${lead} of ${lead + behind} stats.` : lead < behind ? `${f.name} leads on ${behind} of ${lead + behind} stats.` : 'Dead even.'),
        h('p.tiny.dim.center', {}, `${f.name}'s card was updated ${ago(f.fetchedAt)}.`),
      ),
      h('div.panel', {}, h('h3', {}, 'Totals'), h('div.cmp', {}, body)),
      cats.length ? h('div.panel', {}, h('h3', {}, 'Accuracy by subject'), h('div.cmp', {}, catBody)) : null,
      h('button.btn.block', { type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { const got = await app.cloud.lookupFriend(f.code); await app.repo.saveFriend(pid, { code: f.code, card: got.card }); friends = await app.repo.listFriends(pid); my = await app.repo.friendCard(pid); toast('Updated'); } catch (err) { toast(err.message, 'err'); } paint(); } }, 'Refresh this comparison'),
    ];
  };

  const paint = () => { mount(root, compare ? compareView() : listView()); window.scrollTo(0, 0); };

  await load();
  paint();
  // Publish my latest card, then quietly refresh friends whose card is old.
  publish().then(async () => { const n = await refreshAll({ onlyStale: true }); if (n) { my = await app.repo.friendCard(pid); paint(); } });
  return root;
}
