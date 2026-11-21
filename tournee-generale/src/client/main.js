// Tournée Générale — phone client. Shows whatever the server's state says, sends taps back.
import { h, avatar, hearts, toast, banner, bigMoment, confetti } from './ui.js';
import { createRoom, joinRoom, connect, savedSession, saveSession } from './net.js';
import { createBoardView } from './board-view.js';
import { createDie } from './dice.js';
import { unlockAudio, sfx, vibrate, isMuted, setMuted } from './audio.js';
import { requestMotion, motionNeedsPermission, motionSupported, onMotion, keepAwake } from './sensors.js';
import { createStage } from './games/stage.js';
import { GAMES } from './games/index.js';
import { CHARACTERS, characterById } from '../shared/characters.js';
import { MINIGAMES, minigameById } from '../shared/minigames.js';
import { RULES, INTENSITIES, drinkText } from '../shared/rules.js';

const app = document.getElementById('app');
const overlays = document.getElementById('overlays');

const local = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } },
};

let session = savedSession();
let conn = null;
let S = null;              // latest game state
let offset = 0;            // server clock - local clock
let online = true;
let lastEventId = null;
let screenKey = '';
const now = () => Date.now() + offset;
const me = () => S?.players.find((p) => p.id === session?.pid);
const byId = (id) => S?.players.find((p) => p.id === id);
const nameOf = (id) => (id === session?.pid ? 'Toi' : byId(id)?.name ?? '?');

// ---------------------------------------------------------------- start
function boot() {
  document.addEventListener('pointerdown', () => unlockAudio(), { once: false, passive: true });
  if (session) startConnection();
  else renderHome();
  requestAnimationFrame(ticker);
}

function startConnection() {
  conn?.close();
  lastEventId = null;
  conn = connect(session, {
    onState(state, serverNow) {
      offset = serverNow - Date.now();
      const prev = S;
      S = state;
      render(prev);
    },
    onStatus(ok) { online = ok; document.body.classList.toggle('offline', !ok); updateOnlinePill(); },
    onExpired() {
      leaveToHome('Cette partie n\'existe plus.');
    },
  });
}

function leaveToHome(msg) {
  conn?.close();
  conn = null;
  session = null;
  saveSession(null);
  S = null;
  clearOverlays();
  screenKey = '';
  renderHome();
  if (msg) toast(msg);
}

async function send(action) {
  try {
    await conn.send(action);
    return true;
  } catch (e) {
    toast(e.message, 'bad');
    return false;
  }
}

// ---------------------------------------------------------------- home
function renderHome() {
  screenKey = 'home';
  board?.destroy();
  board = null;
  app.replaceChildren();
  const code0 = (new URLSearchParams(location.search).get('r') || '').toUpperCase().slice(0, 4);
  let character = local.get('tg.char', CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id);
  const err = h('div', { class: 'err' });
  const name = h('input', { class: 'field', maxlength: 16, placeholder: 'Ton blaze', value: local.get('tg.name', ''), autocomplete: 'nickname' });
  const code = h('input', { class: 'field code', maxlength: 4, placeholder: 'CODE', value: code0, autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });
  const grid = h('div', { class: 'char-grid' });
  const drawGrid = () => {
    grid.replaceChildren(...CHARACTERS.map((c) => h('button', { class: `char ${c.id === character ? 'on' : ''}`, onclick: () => { character = c.id; local.set('tg.char', c.id); sfx.tap(); drawGrid(); } }, avatar(c.id), c.name)));
  };
  drawGrid();

  const prepare = async () => {
    unlockAudio();
    requestMotion();
    keepAwake();
    const n = name.value.trim();
    if (!n) { err.textContent = 'Donne-toi un nom.'; name.focus(); return null; }
    local.set('tg.name', n);
    return n;
  };
  const go = async (fn) => {
    err.textContent = '';
    const n = await prepare();
    if (!n) return;
    try {
      const r = await fn(n);
      session = { code: r.code, pid: r.pid, token: r.token };
      saveSession(session);
      history.replaceState(null, '', `?r=${r.code}${location.search.includes('server=') ? `&${location.search.match(/server=[^&]*/)[0]}` : ''}`);
      startConnection();
    } catch (e) {
      err.textContent = e.message;
    }
  };

  const adult = local.get('tg.adult', '') === '1';
  const gate = h('div', { class: 'paper-card col', style: { padding: '18px', textAlign: 'center' } },
    h('h3', {}, '🔞 Réservé aux majeurs'),
    h('div', { style: { fontSize: '15px', lineHeight: '1.4' } }, 'Tournée Générale est un jeu à boire. Bois avec modération, alterne avec de l\'eau, et personne ne prend le volant ce soir. Le mode « Sans alcool » marche aussi très bien.'),
    h('button', { class: 'btn', onclick: () => { local.set('tg.adult', '1'); renderHome(); } }, 'J\'ai 18 ans ou plus'));

  const form = h('div', { class: 'col' },
    h('label', { class: 'lab' }, 'Ton nom'), name,
    h('label', { class: 'lab' }, 'Ton perso'), grid,
    h('button', { class: 'btn magenta', onclick: () => go((n) => createRoom(n, character)) }, 'Créer une partie', h('span', { class: 'sub' }, 'Tu seras l\'hôte')),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('div', { style: { flex: '1.1' } }, code),
      h('button', { class: 'btn teal', style: { flex: '1' }, onclick: () => go((n) => joinRoom(code.value.trim().toUpperCase(), n, character)) }, 'Rejoindre')),
    err);

  app.append(h('div', { class: 'screen center', style: { justifyContent: 'flex-start', gap: '14px' } },
    h('div', { class: 'logo' }, h('span', { class: 'foam' }, '🍺'), h('span', { class: 'l1' }, 'TOURNÉE'), h('span', { class: 'l2' }, 'GÉNÉRALE')),
    h('div', { class: 'muted', style: { marginTop: '-8px' } }, 'Le jeu de plateau qui fait boire tes potes'),
    h('div', { style: { width: '100%', maxWidth: '440px' } }, adult ? form : gate),
    h('button', { class: 'link', onclick: (e) => { setMuted(!isMuted()); e.target.textContent = isMuted() ? '🔇 Son coupé' : '🔊 Son activé'; } }, isMuted() ? '🔇 Son coupé' : '🔊 Son activé')));
  if (code0 && adult) code.style.outline = '3px solid var(--teal)';
}

// ---------------------------------------------------------------- render switch
let board = null;
const GAME_PHASES = new Set(['roll', 'move', 'intro', 'play', 'results', 'pick', 'hit', 'recap']);

function render(prev) {
  if (!S) return;
  if (!me()) { leaveToHome('Tu ne fais plus partie de cette partie.'); return; }
  if (S.phase === 'lobby') renderLobby();
  else if (GAME_PHASES.has(S.phase)) renderGame(prev);
  else if (S.phase === 'end') renderEnd();
  handleEvents();
}

// ---------------------------------------------------------------- lobby
function renderLobby() {
  const first = screenKey !== 'lobby';
  screenKey = 'lobby';
  if (first) { clearOverlays(); board?.destroy(); board = null; }
  const host = S.hostId === session.pid;
  const p = me();
  const link = `${location.origin}${location.pathname}?r=${S.code}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Tournée Générale', text: `Rejoins la tournée ! Code ${S.code}`, url: link });
      else { await navigator.clipboard.writeText(link); toast('Lien copié !', 'good'); }
    } catch { /* cancelled */ }
  };
  const taken = new Set(S.players.filter((q) => q.id !== p.id).map((q) => q.character));
  const seg = (options, value, onPick) => h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', disabled: !host, onclick: () => { sfx.tap(); onPick(v); } }, label)));

  const sensorRow = !motionSupported()
    ? h('div', { class: 'muted small' }, '📳 Pas de capteur de mouvement sur cet appareil : les jeux à secouer passeront en mode tactile.')
    : motionNeedsPermission()
      ? h('button', { class: 'btn teal small', onclick: async () => { const ok = await requestMotion(); toast(ok ? 'Capteurs activés 📳' : 'Capteurs refusés : mode tactile', ok ? 'good' : 'bad'); renderLobby(); } }, '📳 Activer les capteurs')
      : h('div', { class: 'small sensor-ok' }, '📳 Capteurs prêts');

  app.replaceChildren(h('div', { class: 'screen', style: { gap: '14px' } },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('button', { class: 'link', onclick: async () => { if (await send({ type: 'leave' })) leaveToHome(); } }, '← Quitter'),
      onlinePill()),
    h('div', { class: 'center col', style: { gap: '4px' } },
      h('div', { class: 'muted small' }, 'CODE DE LA PARTIE'),
      h('div', { class: 'room-code' }, S.code),
      h('button', { class: 'btn small teal', style: { width: 'auto', padding: '8px 18px' }, onclick: share }, '📲 Inviter des potes')),
    h('div', { class: 'card col' },
      h('h3', {}, `Joueurs ${S.players.length}/${RULES.maxPlayers}`),
      h('div', { class: 'plist' }, S.players.map((q) => h('div', { class: 'pitem' },
        avatar(q.character, { off: !q.connected, badge: q.id === S.hostId ? '👑' : null }),
        h('div', { class: 'name' }, q.name, q.id === p.id ? h('span', { class: 'muted small' }, '  (toi)') : null),
        h('span', { class: `dot ${q.connected ? '' : 'off'}` }))))),
    h('div', { class: 'card col' },
      h('h3', {}, 'Ton perso'),
      h('div', { class: 'char-grid' }, CHARACTERS.map((c) => h('button', {
        class: `char ${c.id === p.character ? 'on' : ''} ${taken.has(c.id) ? 'taken' : ''}`,
        disabled: taken.has(c.id),
        onclick: () => { sfx.tap(); send({ type: 'profile', character: c.id }); local.set('tg.char', c.id); },
      }, avatar(c.id), c.name)))),
    h('div', { class: 'card col' },
      h('h3', {}, 'Réglages'),
      h('label', { class: 'lab' }, 'Nombre de tours'),
      seg(RULES.turnOptions.map((t) => [t, `${t}`]), S.settings.turns, (v) => send({ type: 'settings', turns: v })),
      h('label', { class: 'lab' }, 'Intensité'),
      seg(Object.entries(INTENSITIES).map(([k, v]) => [k, v.label]), S.settings.intensity, (v) => send({ type: 'settings', intensity: v })),
      h('div', { class: 'muted small' }, `K.O. = ${INTENSITIES[S.settings.intensity].ko}. 1 ❤️ perdu = ${drinkText(S.settings.intensity, 1)}.`),
      host ? null : h('div', { class: 'muted small' }, 'Seul l\'hôte peut changer les réglages.')),
    h('div', { class: 'card col' }, sensorRow),
    host
      ? h('button', { class: 'btn magenta', disabled: S.players.length < RULES.minPlayers, onclick: () => { unlockAudio(); keepAwake(); send({ type: 'start' }); } },
        'Lancer la tournée !', h('span', { class: 'sub' }, S.players.length < 3 ? 'Plus fun à 3 ou plus' : `${S.players.length} joueurs, ${S.settings.turns} tours`))
      : h('div', { class: 'card center muted' }, `En attente que ${byId(S.hostId)?.name ?? 'l\'hôte'} lance la partie…`)));
}

function onlinePill() {
  return h('span', { id: 'online-pill', class: 'muted small' }, online ? '' : '⚠️ Reconnexion…');
}
function updateOnlinePill() {
  const el = document.getElementById('online-pill');
  if (el) el.textContent = online ? '' : '⚠️ Reconnexion…';
}

// ---------------------------------------------------------------- game screen
let hud = null;
let dock = null;
let die = null;
let rollSent = false;
let shakeOff = null;
let prevMine = null;

function renderGame(prev) {
  if (screenKey !== 'game') {
    screenKey = 'game';
    clearOverlays();
    hud = h('div', { class: 'hud' });
    dock = h('div', { class: 'dock' });
    const canvas = h('canvas');
    app.replaceChildren(h('div', { class: 'screen', style: { padding: 0, overflow: 'hidden' } }, hud, h('div', { class: 'board-wrap' }, canvas), dock));
    board = createBoardView(canvas);
    keepAwake();
  }
  board.update(S, now, session.pid);
  renderHud();
  const phaseChanged = !prev || prev.phase !== S.phase || prev.phaseStartedAt !== S.phaseStartedAt;
  renderDock(phaseChanged);
  renderPhaseOverlay(prev, phaseChanged);
}

function renderHud() {
  const p = me();
  const changed = (k) => prevMine && prevMine[k] !== p[k];
  const capChip = h('span', { class: `chip ${changed('capsules') ? 'bump' : ''}` }, '🪙', String(p.capsules));
  const crownChip = h('span', { class: `chip ${changed('crowns') ? 'bump' : ''}` }, '👑', String(p.crowns));
  const last = S.turn === S.settings.turns;
  hud.replaceChildren(
    h('div', { class: 'hud-me' },
      avatar(p.character),
      h('div', { class: 'hud-stats' }, hearts(p.hp), h('div', { class: 'chips' }, capChip, crownChip)),
      h('div', { class: 'turn-pill' }, last ? 'DERNIER' : `TOUR ${S.turn}`, h('small', {}, `sur ${S.settings.turns}`))),
    h('div', { class: 'others' }, [...S.players].sort((a, b) => b.crowns - a.crowns || b.capsules - a.capsules).map((q) => h('div', { class: `mini ${q.id === session.pid ? 'active' : ''}` },
      avatar(q.character, { off: !q.connected }),
      h('span', {}, `${q.id === session.pid ? 'Toi' : q.name}`), h('span', {}, `❤️${q.hp} 🪙${q.capsules} 👑${q.crowns}`)))),
    h('div', { id: 'online-pill', class: 'muted small', style: { textAlign: 'center' } }, online ? '' : '⚠️ Reconnexion…'));
  prevMine = { capsules: p.capsules, crowns: p.crowns, hp: p.hp };
}

function timerBar() {
  return h('div', { class: 'timer' }, h('i', { 'data-timer': '1' }));
}

function renderDock(phaseChanged) {
  const myRoll = S.rolls?.[session.pid];
  if (S.phase === 'roll') {
    if (phaseChanged) {
      rollSent = false;
      die = createDie();
      die.spin(false);
      const doRoll = () => {
        if (rollSent || S.phase !== 'roll' || S.rolls[session.pid] != null) return;
        rollSent = true;
        die.spin(true);
        sfx.dice();
        vibrate(30);
        send({ type: 'roll' }).then((ok) => { if (!ok) rollSent = false; });
      };
      die.el.addEventListener('click', doRoll);
      shakeOff?.();
      let energy = 0;
      shakeOff = onMotion(({ mag, dt }) => {
        if (S.phase !== 'roll' || rollSent) return;
        if (mag > 13) { energy += dt; die.spin(true); } else energy = Math.max(0, energy - dt * 0.5);
        if (energy > 0.45) doRoll();
      });
      dock.replaceChildren(h('div', { class: 'dice-zone' }, die.el, h('div', { class: 'say', id: 'roll-say' }, '')), timerBar());
    }
    const say = document.getElementById('roll-say');
    if (myRoll != null) {
      if (!die.shown) { die.show(myRoll); die.shown = true; setTimeout(() => sfx.land(), 700); }
      const waiting = S.players.filter((q) => S.rolls[q.id] == null).map((q) => q.name);
      say.replaceChildren('Tu fais ', h('b', {}, String(myRoll)), ' !', waiting.length ? h('div', { class: 'muted small' }, `On attend : ${waiting.join(', ')}`) : null);
    } else {
      say.replaceChildren(h('b', {}, motionSupported() ? 'SECOUE ton téléphone' : 'TOUCHE le dé'), motionSupported() ? ' ou touche le dé !' : ' pour le lancer !');
    }
    return;
  }
  shakeOff?.();
  shakeOff = null;
  if (S.phase === 'move') {
    if (phaseChanged) dock.replaceChildren(h('div', { class: 'say', id: 'move-say' }, ''));
    return; // text updated by the ticker
  }
  if (S.phase === 'recap') {
    if (phaseChanged) dock.replaceChildren(h('div', { class: 'say' }, S.turn >= S.settings.turns ? 'C\'était le dernier tour…' : 'Tour suivant !'));
    return;
  }
  if (phaseChanged) dock.replaceChildren(h('div', { class: 'say muted' }, '…'));
}

// ---------------------------------------------------------------- phase overlays
let phaseOverlay = null;
let phaseOverlayKey = '';
let stage = null;
let stageRound = null;

function clearOverlays() {
  stage?.destroy();
  stage = null;
  stageRound = null;
  phaseOverlay?.remove();
  phaseOverlay = null;
  phaseOverlayKey = '';
}

function renderPhaseOverlay(prev, phaseChanged) {
  const r = S.round;
  const key = `${S.phase}:${r?.n ?? ''}`;
  if (S.phase === 'intro') {
    if (phaseOverlayKey !== key) { clearOverlays(); phaseOverlayKey = key; phaseOverlay = introOverlay(); overlays.append(phaseOverlay); }
    return;
  }
  if (S.phase === 'play') {
    if (phaseOverlayKey !== key) { phaseOverlay?.remove(); phaseOverlay = null; phaseOverlayKey = key; startMinigame(); }
    updateWaiting();
    return;
  }
  if (S.phase === 'results' || S.phase === 'pick' || S.phase === 'hit') {
    stage?.destroy();
    stage = null;
    if (!phaseOverlay || !phaseOverlayKey.startsWith('sheet')) {
      phaseOverlay?.remove();
      phaseOverlay = h('div', { class: 'overlay' });
      overlays.append(phaseOverlay);
      if (S.phase === 'results') { sfx.win(); }
    }
    phaseOverlayKey = `sheet:${r.n}`;
    renderSheet(phaseChanged);
    return;
  }
  if (phaseOverlay || stage) clearOverlays();
}

function introOverlay() {
  const g = minigameById(S.round.game);
  const elapsed = now() - S.phaseStartedAt;
  const wrap = h('div', { class: 'overlay solid' });
  const screen = h('div', { class: 'screen center', style: { gap: '18px' } });
  wrap.append(screen);
  const showRules = () => {
    const needPerm = g.id === 'pression' && motionNeedsPermission();
    screen.replaceChildren(
      h('div', { class: 'paper-card rule-card', style: { width: '100%', maxWidth: '420px' } },
        h('div', { class: 'icon' }, g.icon),
        h('h2', {}, g.name),
        h('div', { class: 'sensor-chip' }, g.sensor),
        h('p', {}, g.rule),
        h('p', { class: 'tip' }, g.tip),
        needPerm ? h('button', { class: 'btn teal small', onclick: async () => { const ok = await requestMotion(); toast(ok ? 'Capteurs activés 📳' : 'Mode tactile', ok ? 'good' : ''); } }, '📳 Activer le capteur') : null),
      h('div', { id: 'countdown', style: { height: '130px' } }));
  };
  if (elapsed > 2000) { showRules(); return wrap; }
  // Slot-machine reel landing on the chosen game.
  const list = [];
  for (let i = 0; i < 16; i++) list.push(MINIGAMES[i % MINIGAMES.length]);
  list.push(g);
  const strip = h('div', { class: 'reel-strip' }, list.map((m) => h('div', { class: 'reel-item' }, h('span', {}, m.icon), m.name)));
  screen.append(h('div', { class: 'title', style: { fontSize: '30px', color: 'var(--gold)' } }, '🎰 MINI-JEU !'), h('div', { class: 'reel', style: { width: '100%', maxWidth: '420px' } }, strip));
  requestAnimationFrame(() => {
    strip.style.transition = 'transform 2.2s cubic-bezier(.12,.8,.2,1)';
    strip.style.transform = `translateY(-${(list.length - 1) * 120}px)`;
  });
  let k = 0;
  const tickReel = () => { if (k++ < 22 && wrap.isConnected) { sfx.reel(); setTimeout(tickReel, 40 + k * k * 0.9); } };
  tickReel();
  setTimeout(() => { if (wrap.isConnected) { sfx.land(); showRules(); } }, 2500);
  return wrap;
}

async function startMinigame() {
  const r = S.round;
  const g = minigameById(r.game);
  const run = GAMES[g.id];
  stageRound = r.n;
  stage = createStage({ name: g.name, durationMs: g.durationMs });
  const myStage = stage;
  sfx.go();
  vibrate(60);
  let result;
  try {
    result = await run(myStage, { seed: r.seed });
  } catch (e) {
    console.error(e);
    result = { score: -1e9, display: 'Bug 🐞' };
  }
  if (!myStage.alive || stageRound !== r.n) return;
  send({ type: 'score', round: r.n, score: result.score, display: result.display });
  myStage.done('TERMINÉ !', result.display, h('div', { class: 'col center', style: { gap: '8px' } }, h('div', { class: 'muted' }, 'En attente des autres…'), h('div', { class: 'waiting-list', id: 'waiting-list' })));
  updateWaiting();
}

function updateWaiting() {
  const el = document.getElementById('waiting-list');
  if (!el || !S.round) return;
  el.replaceChildren(...S.players.map((q) => avatar(q.character, { cls: S.round.scores[q.id] ? 'done' : '', off: !q.connected })));
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderSheet(phaseChanged) {
  const r = S.round;
  const g = minigameById(r.game);
  const picker = r.pickers[r.pickIndex];
  const myRow = r.ranking.find((x) => x.pid === session.pid);
  const sheet = h('div', { class: 'sheet col' });
  sheet.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', {}, `${g.icon} Résultats`), h('div', { class: 'muted small' }, g.name)));
  sheet.append(h('div', { class: 'rank-list' }, r.ranking.map((row, i) => h('div', { class: `rank ${row.pid === session.pid ? 'me' : ''}`, style: { animationDelay: `${i * 0.08}s` } },
    h('div', { class: 'medal' }, row.rank ? MEDALS[row.rank - 1] ?? row.rank : '—'),
    avatar(byId(row.pid)?.character),
    h('div', { class: 'who' }, h('b', {}, nameOf(row.pid)), h('span', {}, row.display)),
    h('div', { class: 'gain' }, row.dmg ? h('div', { class: 'dmg' }, `💥 ${row.dmg}`) : null, row.caps ? h('div', {}, `+${row.caps} 🪙`) : null)))));

  if (S.phase === 'results') {
    const order = r.pickers.map((pid) => `${MEDALS[(r.ranking.find((x) => x.pid === pid).rank) - 1] ?? ''} ${nameOf(pid)}`);
    sheet.append(h('div', { class: 'card center col', style: { gap: '6px' } },
      myRow?.rank === 1 ? h('div', { class: 'title', style: { fontSize: '28px', color: 'var(--gold)' } }, 'TU GAGNES ! 🏆') : null,
      order.length ? h('div', {}, 'Ils vont faire boire, dans l\'ordre :') : h('div', {}, 'Personne ne frappe cette fois.'),
      order.length ? h('div', { class: 'title', style: { fontSize: '20px' } }, order.join('  →  ')) : null,
      timerBar()));
    if (phaseChanged && myRow?.rank === 1) { confetti(); vibrate([50, 40, 50]); }
  } else if (S.phase === 'pick') {
    const row = r.ranking.find((x) => x.pid === picker);
    if (picker === session.pid) {
      const targets = S.players.filter((q) => q.id !== session.pid);
      const valid = (q) => (r.taken[q.id] ?? 0) < RULES.maxDamagePerRound;
      sheet.append(h('div', { class: 'col center', style: { gap: '10px' } },
        h('div', { class: 'title', style: { fontSize: '30px', color: 'var(--magenta)' } }, 'À TOI DE FAIRE BOIRE !'),
        h('div', {}, `Choisis qui perd ${Math.min(row.dmg, RULES.maxDamagePerRound)} ❤️ :`),
        h('div', { class: 'targets', style: { width: '100%' } }, targets.map((q) => h('button', {
          class: 'target',
          disabled: !valid(q),
          onclick: (e) => {
            sfx.hit();
            vibrate(40);
            e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            send({ type: 'pick', target: q.id });
          },
        }, avatar(q.character), q.name, hearts(q.hp), valid(q) ? null : h('span', { class: 'small' }, 'déjà assez bu')))),
        timerBar()));
      if (phaseChanged) { sfx.coin(); vibrate([30, 30, 30]); }
    } else {
      sheet.append(h('div', { class: 'card center col', style: { gap: '8px' } },
        h('div', { class: 'title', style: { fontSize: '24px' } }, `${MEDALS[row.rank - 1] ?? ''} ${nameOf(picker)} choisit sa victime…`),
        h('div', { class: 'muted small' }, `${row.dmg} ❤️ à distribuer`),
        timerBar()));
    }
  } else if (S.phase === 'hit' && r.lastHit) {
    sheet.append(h('div', { class: 'card center title', style: { fontSize: '24px' } }, `${nameOf(r.lastHit.from)} ➜ ${nameOf(r.lastHit.to)} : −${r.lastHit.amount} ❤️`));
  }
  phaseOverlay.replaceChildren(sheet);
}

// ---------------------------------------------------------------- events → big moments
const moments = [];
let momentBusy = false;
function queueMoment(m) { moments.push(m); if (!momentBusy) nextMoment(); }
function nextMoment() {
  const m = moments.shift();
  if (!m) { momentBusy = false; return; }
  momentBusy = true;
  m.sound?.();
  if (m.vibrate) vibrate(m.vibrate);
  if (m.confetti) confetti();
  bigMoment(m);
  setTimeout(nextMoment, (m.ms ?? 2600) + 150);
}

function handleEvents() {
  const evs = S.events ?? [];
  const maxId = evs.length ? evs[evs.length - 1].id : 0;
  if (lastEventId == null) { lastEventId = maxId; return; } // do not replay history after a reload
  const intensity = S.settings.intensity;
  for (const e of evs) {
    if (e.id <= lastEventId) continue;
    if (e.type === 'damage') {
      if (e.to === session.pid) {
        queueMoment({
          emoji: '🍺', t1: 'BOIS !', t2: e.drinks ? drinkText(intensity, e.drinks) : null,
          t3: e.from ? `${nameOf(e.from)} t'a mis −${e.amount} ❤️` : 'Case rouge, pas de chance !',
          sound: sfx.hit, vibrate: [120, 60, 180], ms: 2600,
        });
      } else {
        toast(`${e.from ? nameOf(e.from) : 'Case rouge'} ➜ ${nameOf(e.to)} : −${e.amount} ❤️`, 'bad');
        if (!e.from) sfx.bad();
      }
    } else if (e.type === 'ko') {
      const mine = e.pid === session.pid;
      queueMoment({
        cls: 'ko', emoji: '😵', t1: 'K.O. !', t2: mine ? `${INTENSITIES[intensity].ko} !` : `${nameOf(e.pid)} : ${INTENSITIES[intensity].ko}`,
        t3: `${mine ? 'Tu perds' : `${nameOf(e.pid)} perd`} ${e.lostCaps} 🪙 et revient à ${RULES.maxHp} ❤️.${e.by ? ` ${nameOf(e.by)} empoche la prime de ${e.bounty} 🪙.` : ''}`,
        sound: sfx.ko, vibrate: mine ? [300, 100, 300] : 60, ms: 3400,
      });
    } else if (e.type === 'crown') {
      queueMoment({ cls: 'crown', emoji: '👑', t1: 'COURONNE !', t2: e.pid === session.pid ? 'Pour toi !' : nameOf(e.pid), t3: `−${RULES.crownPrice} 🪙. Le Bar Doré déménage…`, sound: sfx.crown, confetti: true, ms: 2200 });
    } else if (e.type === 'case' && e.pid === session.pid) {
      if (e.dCaps > 0) { toast(`+${e.dCaps} 🪙 Case bonus !`, 'gold'); sfx.coin(); }
      else if (e.dCaps < 0) { toast(`${e.dCaps} 🪙 Case malus…`, 'bad'); sfx.bad(); }
    } else if (e.type === 'turn') {
      const last = e.turn === S.settings.turns;
      banner(last ? 'DERNIER TOUR !' : `TOUR ${e.turn}`, last ? 'Tout se joue maintenant' : `sur ${S.settings.turns}`);
      sfx.go();
    }
  }
  lastEventId = maxId;
}

// ---------------------------------------------------------------- end
function renderEnd() {
  if (screenKey === 'end' && renderEnd.v === S.v) return;
  renderEnd.v = S.v;
  const first = screenKey !== 'end';
  screenKey = 'end';
  if (first) { clearOverlays(); board?.destroy(); board = null; }
  const st = [...S.players].sort((a, b) => b.crowns - a.crowns || b.capsules - a.capsules || a.order - b.order);
  const host = S.hostId === session.pid;
  const top = (key) => [...S.players].sort((a, b) => b.stats[key] - a.stats[key])[0];
  const award = (e, title, p, txt) => h('div', { class: 'award' }, h('div', { class: 'e' }, e), h('b', {}, title), `${nameOf(p.id)} · ${txt}`);
  const step = (p, cls) => p ? h('div', { class: `step ${cls}` }, avatar(p.character), h('div', { class: 'nm' }, nameOf(p.id)), h('div', { class: 'block' }, `${p.crowns}👑`)) : h('div', { class: `step ${cls}` });
  const sponge = top('drinks');
  const killer = top('dealt');
  const champ = top('wins');
  const koKing = top('knockedOut');
  app.replaceChildren(h('div', { class: 'screen', style: { gap: '14px' } },
    h('div', { class: 'logo center', style: { textAlign: 'center' } }, h('span', { class: 'l1', style: { fontSize: '44px' } }, 'FIN DE LA'), h('span', { class: 'l2', style: { fontSize: '54px' } }, 'TOURNÉE')),
    h('div', { class: 'title center', style: { fontSize: '26px', textAlign: 'center' } }, `${st[0].id === session.pid ? 'TU GAGNES' : `${st[0].name} gagne`} ! 🏆`),
    h('div', { class: 'podium' }, step(st[1], 'p2'), step(st[0], 'p1'), step(st[2], 'p3')),
    h('div', { class: 'card rank-list' }, st.map((p, i) => h('div', { class: `rank ${p.id === session.pid ? 'me' : ''}` },
      h('div', { class: 'medal' }, MEDALS[i] ?? i + 1), avatar(p.character),
      h('div', { class: 'who' }, h('b', {}, nameOf(p.id)), h('span', {}, `${p.stats.wins} victoire${p.stats.wins > 1 ? 's' : ''} · ${drinkText(S.settings.intensity, p.stats.drinks)}`)),
      h('div', { class: 'gain' }, h('div', { class: 'title', style: { fontSize: '20px' } }, `${p.crowns} 👑`), `${p.capsules} 🪙`)))),
    h('div', { class: 'awards' },
      award('🧽', 'L\'Éponge', sponge, `${drinkText(S.settings.intensity, sponge.stats.drinks)}`),
      award('🪓', 'Le Bourreau', killer, `${killer.stats.dealt} ❤️ infligés`),
      award('🏆', 'Roi des mini-jeux', champ, `${champ.stats.wins} victoires`),
      award('😵', 'Abonné au K.O.', koKing, `${koKing.stats.knockedOut} K.O.`)),
    host ? h('button', { class: 'btn magenta', onclick: () => send({ type: 'restart' }) }, 'Nouvelle tournée !') : h('div', { class: 'card center muted' }, 'L\'hôte peut relancer une partie.'),
    h('button', { class: 'btn ghost', onclick: () => leaveToHome() }, 'Quitter')));
  if (first) { confetti(140); sfx.win(); }
}

// ---------------------------------------------------------------- per-frame updates
function ticker() {
  requestAnimationFrame(ticker);
  if (!S) return;
  if (S.deadline) {
    const frac = (S.deadline - now()) / Math.max(1, S.deadline - S.phaseStartedAt);
    document.querySelectorAll('[data-timer]').forEach((el) => { el.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`; });
  }
  if (S.phase === 'move' && S.move) {
    const t = now() - S.phaseStartedAt;
    const cur = S.move.script.find((e) => t >= e.startAt && t < e.endAt + 450) ?? null;
    const el = document.getElementById('move-say');
    if (el) {
      const txt = cur ? (cur.pid === session.pid ? `🎲 Tu avances de ${cur.value}` : `🎲 ${nameOf(cur.pid)} avance de ${cur.value}`) : '…';
      if (el.textContent !== txt) el.textContent = txt;
    }
  }
  if (S.phase === 'intro') {
    const el = document.getElementById('countdown');
    if (el) {
      const left = Math.ceil((S.deadline - now()) / 1000);
      const show = left <= 3 && left >= 1 ? String(left) : '';
      if (el.dataset.v !== show) {
        el.dataset.v = show;
        el.replaceChildren(show ? h('div', { class: 'count' }, show) : '');
        if (show) sfx.tick();
      }
    }
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conn?.reopen(); });

// For automated tests and debugging from the console.
window.tg = { state: () => S, me: () => session?.pid };

boot();
