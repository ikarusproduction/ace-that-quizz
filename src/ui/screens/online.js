// Play online: create or join a room, wait in the lobby, then the host starts the game.
import { metaOf } from '../../storage/meta.js';
import { h, mount } from '../dom.js';
import { sprite } from '../pixel.js';
import { go, goBack } from '../app.js';
import { setMood } from '../lighting.js';
import { avatar, screenHeader, toast } from '../components.js';
import { sfx, unlockAudio } from '../audio.js';
import { haptic } from '../fx.js';
import { OnlineSession } from '../../net/session.js';
import { seenCounts, recentlySeenIds } from '../../stats/stats.js';
import { languageOf } from '../../i18n/languages.js';

const LAST_KEY = 'thk-online-profile';
const RELAY_KEY = 'thk-relay-url';
import { ACCESS_KEY } from '../gate.js';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Which relay server to use: a saved address, else this site if it is one. */
export async function resolveRelay(preferred) {
  const candidates = [preferred, lsGet(RELAY_KEY), location.protocol.startsWith('http') ? location.origin : null].filter(Boolean);
  for (const c of candidates) if (await OnlineSession.health(c)) return c;
  return null;
}

export async function onlineScreen(app, params) {
  setMood('calm');
  const profiles = await app.repo.listProfiles();
  let chosen = lsGet(LAST_KEY);
  if (!profiles.some((p) => p.id === chosen)) chosen = profiles[0]?.id ?? null;
  let relay = params.relay ?? app.config?.relay ?? lsGet(RELAY_KEY) ?? '';
  let relayState = 'checking'; // checking | ok | none
  let customRelay = Boolean(params.relay);
  let busy = false;
  let code = (params.joinCode ?? '').toUpperCase();
  const offs = [];

  const root = h('div.screen');
  const net = () => app.online;
  const inLobby = () => net() && !net().closed && net().code && !net().startInfo;

  async function sendMyInfo() {
    const s = net();
    if (!s) return;
    const me = profiles.find((p) => p.id === s.me.profileId);
    const results = await app.repo.storage.getAll('results');
    const info = { ownedCards: me?.ownedCards ?? [], ownedHexes: metaOf(me ?? {}).hexes.owned, hexDeck: metaOf(me ?? {}).hexes.deck, seen: seenCounts(results, [s.me.profileId]), recent: recentlySeenIds(results, [s.me.profileId], { learns: me ? [metaOf(me).learn] : [] }) };
    s.infos.set(s.me.id, info);
    if (!s.isHost) s.sendInfo(info);
  }

  function wire(s) {
    offs.forEach((f) => f());
    offs.length = 0;
    offs.push(
      s.on('members', () => { if (s.iAmReady) s.setReady(true); paint(); }),
      s.on('status', () => paint()),
      s.on('ready', () => paint()),
      s.on('closed', (d) => { toast(d.reason, 'err'); app.online = null; paint(); }),
      s.on('start', () => { sfx.stake(); haptic('big'); go('game', { online: true }); }),
      s.on('hello', () => {}),
    );
    // Send our details to the host now and after any reconnect.
    offs.push(s.on('status', (st) => { if (st === 'online') sendMyInfo(); }));
    s.open();
  }

  async function connect(kind) {
    if (busy) return;
    const profile = profiles.find((p) => p.id === chosen);
    if (!profile) return toast('Pick which player you are first', 'err');
    if (!relay) return toast('Enter the game server address first', 'err');
    if (kind === 'join' && !/^[A-Za-z]{4}$/.test(code)) return toast('Room codes are 4 letters', 'err');
    busy = true; paint();
    unlockAudio(); sfx.tap();
    try {
      const s = new OnlineSession({ base: relay, access: lsGet(ACCESS_KEY) ?? '' });
      if (kind === 'create') await s.create(profile);
      else await s.join(code, profile);
      lsSet(LAST_KEY, profile.id);
      lsSet(RELAY_KEY, relay);
      app.online = s;
      wire(s);
      sfx.select();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy = false; paint();
    }
  }

  async function leave() {
    const s = net();
    offs.forEach((f) => f());
    offs.length = 0;
    app.online = null;
    await s?.leave();
    paint();
  }

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast(text); }
  };

  function paint() {
    const s = net();
    const y = window.scrollY;
    if (s && !s.closed && s.code) mount(root, lobby(s));
    else mount(root, connectView());
    if (y) window.scrollTo(0, y);
  }

  function connectView() {
    const relayRow = relayState === 'ok' && !customRelay
      ? h('p.small.green', {}, `Game server: ${relay.replace(/^https?:\/\//, '')} ✓ `, h('button.btn.small.ghost', { type: 'button', onclick: () => { customRelay = true; paint(); } }, 'change'))
      : h('label.field', {}, h('span', {}, 'Game server address'),
        h('input', { type: 'url', value: relay, placeholder: 'https://play.yoursite.com', autocomplete: 'off', inputmode: 'url', 'aria-label': 'Game server address', oninput: (e) => { relay = e.target.value.trim(); relayState = 'checking'; } , onchange: async () => { relayState = (await OnlineSession.health(relay)) ? 'ok' : 'none'; if (relayState !== 'ok') toast('Could not reach that server', 'err'); paint(); } }),
        relayState === 'none' ? h('span.tiny.red', {}, 'No game server answered at this address. See docs/ONLINE.md to run one.') : null);
    return [
      screenHeader('Play online', () => goBack('menu')),
      h('p.small.dim', {}, 'Each person plays on their own phone. One of you creates a room and shares the 4-letter code; everyone else joins it. Turns are taken one at a time.'),
      h('div.row.between', {}, h('h3', {}, 'You are'), h('span.tiny.dim', {}, 'your question language is part of your player')),
      h('div.col.gap-s', {}, profiles.length ? profiles.map((p) => h('button.pick', { type: 'button', 'aria-pressed': String(p.id === chosen), onclick: () => { chosen = p.id; sfx.select(); paint(); } }, avatar(p, 32), h('span.name.profile-row', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, textTransform: 'uppercase' } }, p.name), h('span.tiny.dim', { style: { marginLeft: 'auto' } }, languageOf(p.language).native))) : [h('div.panel.inset.empty-state', {}, 'Create a player first (Players menu).')]),
      relayRow,
      h('div.hr'),
      h('button.btn.primary.block', { type: 'button', disabled: busy || !profiles.length, onclick: () => connect('create') }, busy ? 'Connecting…' : 'Create a room'),
      h('div.row', {}, h('input', { class: 'code-input', type: 'text', value: code, maxlength: '4', placeholder: 'CODE', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': 'Room code', oninput: (e) => { code = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); e.target.value = code; } }), h('button.btn.block', { type: 'button', disabled: busy || !profiles.length, onclick: () => connect('join') }, 'Join')),
    ];
  }

  function lobby(s) {
    const link = s.joinLink();
    const ready = s.members.length >= 2 && s.allReady();
    const waitingFor = s.members.filter((m) => !m.host && !s.isReady(m.id)).length;
    const connected = (m) => m.connected;
    return [
      screenHeader('Room', () => leave().then(() => goBack('menu'))),
      h('div.panel.center', {},
        h('div.tiny.dim', {}, s.isHost ? 'Share this code' : 'You joined room'),
        h('div.room-code', {}, s.code),
        h('div.row', { style: { justifyContent: 'center' } },
          h('button.btn.small', { type: 'button', onclick: () => copy(link) }, 'Copy join link'),
          navigator.share ? h('button.btn.small', { type: 'button', onclick: () => navigator.share({ title: 'The House Knows', text: `Join my room ${s.code}`, url: link }).catch(() => {}) }, 'Share…') : null,
        ),
        s.status !== 'online' ? h('p.tiny.amber', {}, s.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…') : null,
      ),
      h('div.row.between', {}, h('h3', {}, `Players (${s.members.length}/4)`), h('span.tiny.dim', {}, '2–4 to start')),
      h('div.col.gap-s', {}, s.members.map((m) => h('div.pick.static', {}, avatar({ avatar: { key: m.avatar } }, 32), h('div', {}, h('div.name', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 } }, m.name), h('div.tiny.dim', {}, `${m.host ? 'Host · ' : ''}${languageOf(m.language).native}`)), m.host ? null : h('span.tiny', { class: s.isReady(m.id) ? 'green' : 'amber', style: { marginLeft: 'auto' } }, s.isReady(m.id) ? 'READY' : 'not ready'), h('span.dot', { class: connected(m) ? 'on' : 'off', title: connected(m) ? 'connected' : 'disconnected' })))),
      s.isHost
        ? h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', disabled: !ready, onclick: () => { sfx.tap(); go('themes', { mode: 'versus', online: true }); } }, ready ? 'Everyone is ready · choose themes' : s.members.length < 2 ? 'Waiting for another player…' : `Waiting for ${waitingFor} player${waitingFor > 1 ? 's' : ''} to be ready…`))
        : h('div.stick-bottom', {}, h('button.btn.block', { type: 'button', class: s.iAmReady ? '' : 'primary', onclick: () => { sfx.tap(); haptic('tap'); s.setReady(!s.iAmReady); paint(); } }, s.iAmReady ? 'Ready ✓ (tap to cancel)' : "I'm ready"), h('p.small.dim.center', {}, s.iAmReady ? 'Waiting for the host to pick themes and start…' : 'Tap ready so the host can start.'), h('button.btn.ghost.block', { type: 'button', onclick: () => leave() }, 'Leave room')),
    ];
  }

  // Initial state.
  if (inLobby()) wire(net());
  paint();
  (async () => {
    if (!relay || relayState === 'checking') {
      const found = await resolveRelay(relay);
      if (found) { relay = found; relayState = 'ok'; } else relayState = 'none';
      if (!net()) paint();
    }
  })();
  return { el: root, dispose: () => offs.forEach((f) => f()) };
}
