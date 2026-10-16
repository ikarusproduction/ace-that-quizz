// The game screen: a controller that owns the game state, saves it after every
// action, drives the question clock, and renders whichever phase is active.
import { h, mount, localDateKey } from '../dom.js';
import { sprite } from '../pixel.js';
import { go } from '../app.js';
import { lightsOn, setMood, pulse, blackout, shake } from '../lighting.js';
import { sfx, playClip, stopClip, unlockAudio } from '../audio.js';
import { avatar, cardTile, emptySlot, categoryTag, categoryIcon, diffPips, chipsLine, bulbs, modal, confirmDialog, toast, floatText } from '../components.js';
import { createGame, dispatch, getQuestionView, getStakeOptions, cardReward } from '../../engine/game.js';
import { roundInfo, roundCategories } from '../../engine/rounds.js';
import { CARDS, equippableCards } from '../../engine/cards.js';
import { RULES, HAZARDS, BOSSES, SHOP_ITEMS } from '../../engine/modifiers.js';
import { CATEGORIES, DIFFICULTIES } from '../../engine/bank.js';
import { haptic, confetti, coinBurst, stamp, streakHype } from '../fx.js';
import { languageOf } from '../../i18n/languages.js';
import { createTranslator, applyTranslation } from '../../i18n/translate.js';
import { recentlySeenIds, seenCounts } from '../../stats/stats.js';
import { CARDS as ALL_CARDS } from '../../engine/cards.js';
import { STARTER_CARDS } from '../../engine/cards.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const MODE_NAME = { solo: 'Solo run', quick: 'Quick run', versus: 'Versus', daily: 'Daily' };

export async function gameScreen(app, params) {
  const ctl = new GameController(app);
  const ok = await ctl.init(params);
  if (!ok) {
    go('menu', {}, { replace: true });
    return h('div.screen');
  }
  app.current.guardBack = () => ctl.openPause();
  return { el: ctl.root, dispose: () => ctl.dispose() };
}

class GameController {
  constructor(app) {
    this.app = app;
    this.root = h('div.screen');
    this.state = null;
    this.persisted = 0;
    this.saveChain = Promise.resolve();
    this.saveFailed = false;
    this.gateKey = null; // pass-the-phone gate already acknowledged for this turn
    this.stakeSel = null;
    this.loadoutTab = 0;
    this.timer = null; // { raf, key, start }
    this.revealKey = null;
    this.disposed = false;
    this.profiles = new Map();
    this.label = 'solo';
    this.keyHandler = null;
    this.notes = []; // transient notices shown on the next render
    this.translator = createTranslator({ fetchJson: (p) => app.readJson(p) });
    this.trCache = new Map(); // `${lang}:${questionId}` -> translation | null
    this.trPending = new Map();
  }

  /* ------------------------------------------------------ translation */

  langOf(pid) {
    return this.profiles.get(pid)?.language ?? 'en';
  }

  /** Kick off (or reuse) translation of the current question for a player. Never rejects. */
  ensureTranslation(pid) {
    const lang = this.langOf(pid);
    const qid = this.s.q?.questionId;
    if (!qid || lang === 'en') return Promise.resolve(null);
    const key = `${lang}:${qid}`;
    if (this.trCache.has(key)) return Promise.resolve(this.trCache.get(key));
    if (!this.trPending.has(key)) {
      const q = this.ctx.byId.get(qid);
      this.trPending.set(key, this.translator.translateQuestion(q, lang).catch(() => null).then((r) => {
        this.trCache.set(key, r);
        this.trPending.delete(key);
        return r;
      }));
    }
    return this.trPending.get(key);
  }

  /** The question view for a player, in that player's language when a translation is ready. */
  view(pid, langPid = pid) {
    const v = getQuestionView(this.s, this.ctx, pid);
    const lang = this.langOf(langPid);
    if (!v || lang === 'en') return v;
    return applyTranslation(v, this.trCache.get(`${lang}:${v.id}`) ?? null);
  }

  /* ------------------------------------------------------------ online */

  get myPlayerId() {
    return this.net?.myPlayerId ?? null;
  }
  get myPlayer() {
    return this.net ? this.s.players.find((p) => p.playerId === this.myPlayerId) ?? this.s.players[0] : null;
  }
  get isMyTurn() {
    return !this.net || this.turnPlayer.playerId === this.myPlayerId;
  }
  get passPhone() {
    return this.multi && !this.net;
  }

  async initOnline(params, localProfiles) {
    const { app } = this;
    const net = app.online;
    if (!net || net.closed) { toast('The room is not open any more', 'err'); return false; }
    this.net = net;
    this.label = 'versus';
    this.rev = 0;
    this.lastProgress = Date.now();

    // Everyone's display data (name, portrait, language) comes from the room.
    for (const m of net.members) {
      const local = localProfiles.find((p) => p.id === net.playerIdOf(m));
      this.profiles.set(net.playerIdOf(m), local ?? { id: net.playerIdOf(m), name: m.name, avatar: { key: m.avatar }, language: m.language || 'en' });
    }

    if (net.isHost && !net.startInfo) {
      const infos = net.infos;
      const seen = {};
      const avoid = new Set();
      const valid = (list) => [...new Set([...(Array.isArray(list) ? list : []).filter((c) => ALL_CARDS[c]), ...STARTER_CARDS])];
      const players = net.members.map((m) => {
        const pid = net.playerIdOf(m);
        const info = infos.get(m.id);
        for (const [id, n] of Object.entries(info?.seen ?? {})) if (typeof n === 'number' && this.ctx.byId.has(id)) seen[id] = (seen[id] ?? 0) + Math.min(n, 50);
        for (const id of (info?.recent ?? []).slice(0, 150)) avoid.add(id);
        return { id: pid, name: m.name, ownedCards: valid(info?.ownedCards) };
      });
      this.state = createGame({
        mode: 'versus', players, ctx: app.ctx,
        overrides: { themes: params.themes },
        avoidIds: [...avoid], seenCounts: seen,
      });
      this.rev = 1;
      await net.start({ rev: 1, state: this.state });
    } else {
      const latest = net.latest ?? (net.startInfo ? { rev: net.startInfo.rev, state: net.startInfo.state } : null);
      if (!latest) { toast('The game has not started yet', 'err'); return false; }
      this.state = latest.state;
      this.rev = latest.rev;
    }
    this.persisted = 0;
    this.myIds = [this.myPlayerId];

    this.offs = [
      net.on('state', ({ rev, state }) => this.onRemoteState(rev, state)),
      net.on('members', () => this.onMembers()),
      net.on('closed', () => this.onRoomClosed()),
      net.on('status', () => this.render()),
    ];
    if (net.isHost) {
      this.offs.push(net.on('action', (m) => this.onRemoteAction(m)));
      this.watchdog = setInterval(() => this.checkAfk(), 1000);
    }
    lightsOn();
    this.render();
    return true;
  }

  onRemoteState(rev, state) {
    if (rev <= this.rev && this.state) return;
    this.rev = rev;
    this.state = state;
    this.lastProgress = Date.now();
    this.save();
    if (state.phase === 'finished') this.onFinished();
    this.render();
  }

  onMembers() {
    if (!this.net) return;
    for (const m of this.net.members) {
      const pid = this.net.playerIdOf(m);
      if (!this.profiles.has(pid)) this.profiles.set(pid, { id: pid, name: m.name, avatar: { key: m.avatar }, language: m.language || 'en' });
    }
    if (this.s?.phase === 'stake' || this.s?.phase === 'question') { if (!this.isMyTurn) this.render(); }
  }

  async onRoomClosed() {
    if (this.disposed || !this.s || this.s.phase === 'finished') return;
    toast('The host left, so the game ended.', 'err');
    const res = dispatch(this.s, { type: 'ABANDON' }, this.ctx);
    if (res.ok) { this.state = res.state; await this.save(); }
    go('menu', {}, { replace: true });
  }

  /** Host: apply an action sent by a guest after checking it is really theirs. */
  onRemoteAction({ from, action, rev }) {
    if (!this.net?.isHost || !action || typeof action.type !== 'string') return;
    const member = this.net.members.find((m) => m.id === from);
    if (!member) return;
    const pid = this.net.playerIdOf(member);
    const allowed = ['SET_LOADOUT', 'USE_CARD', 'CONFIRM_STAKE', 'ANSWER', 'NEXT', 'CONTINUE'];
    if (!allowed.includes(action.type)) return;
    if (action.type === 'NEXT' || action.type === 'CONTINUE') {
      if (rev !== this.rev) return; // stale: someone already advanced
    } else if (action.playerId !== pid) {
      return; // you can only act for yourself
    }
    if (action.type === 'ANSWER') {
      // A phone's own clock cannot be trusted to be faster than the host's view of it.
      const qp = this.s.q?.byPlayer?.[pid];
      if (qp?.startedAt) action = { ...action, elapsedMs: Math.max(Number(action.elapsedMs) || 0, this.ctx.now() - qp.startedAt - 2500) };
    }
    this.act(action, { silent: true, remote: true });
  }

  /** Host: keep the game moving if the player whose turn it is has gone quiet. */
  checkAfk() {
    const s = this.s;
    if (!this.net?.isHost || this.disposed || !s || this.isMyTurn) return;
    if (s.phase !== 'stake' && s.phase !== 'question') return;
    const p = this.turnPlayer;
    const member = this.net.memberByPlayerId(p.playerId);
    const gone = member && !member.connected;
    const idle = Date.now() - this.lastProgress;
    if (s.phase === 'stake' && (idle > 45000 || (gone && idle > 6000))) {
      this.act({ type: 'CONFIRM_STAKE', playerId: p.playerId, stake: 1 }, { silent: true });
    } else if (s.phase === 'question') {
      const timerMs = s.q.byPlayer[p.playerId]?.timerMs ?? 20000;
      if (idle > timerMs + 9000 || (gone && idle > 6000)) this.act({ type: 'ANSWER', playerId: p.playerId, choice: null, elapsedMs: timerMs }, { silent: true });
    }
  }

  /* ------------------------------------------------------------ setup */

  async init(params) {
    const { app } = this;
    const profiles = await app.repo.listProfiles();
    profiles.forEach((p) => this.profiles.set(p.id, p));

    if (params.online) return this.initOnline(params, profiles);

    if (params.resume) {
      const state = await app.repo.loadActiveGame();
      if (!state) {
        toast('There is no game to resume');
        return false;
      }
      this.state = state;
      this.persisted = state.log.length;
      this.label = state.mode;
      // Leaving mid-question must not be a free retry of the clock.
      if (state.phase === 'question') {
        const p = state.players[state.turn];
        const res = dispatch(state, { type: 'ANSWER', playerId: p.playerId, choice: null, elapsedMs: state.q.byPlayer[p.playerId].timerMs ?? 0 }, app.ctx);
        if (res.ok) {
          this.state = res.state;
          this.notes.push('You left during a question, so it counted as a timeout.');
          await this.save();
        }
      }
    } else {
      const ids = params.playerIds ?? [];
      const players = ids.map((id) => this.profiles.get(id)).filter(Boolean);
      if (!players.length) return false;
      const mode = params.mode === 'quick' ? 'solo' : params.mode;
      this.label = params.mode;
      const results = await app.repo.storage.getAll('results');
      const avoidIds = mode === 'daily' ? [] : recentlySeenIds(results, ids);
      this.state = createGame({
        mode,
        players: players.map((p) => ({ id: p.id, name: p.name, ownedCards: p.ownedCards })),
        ctx: app.ctx,
        seed: mode === 'daily' ? `daily-${localDateKey()}` : undefined,
        overrides: { ...(params.mode === 'quick' ? { acts: 1 } : {}), ...(params.themes && mode !== 'daily' ? { themes: params.themes } : {}) },
        avoidIds,
        seenCounts: mode === 'daily' ? {} : seenCounts(results, ids),
      });
      await app.repo.pushRecent(ids, mode);
      this.persisted = await app.repo.saveProgress(this.state, 0).catch((e) => this.reportSaveError(e) ?? 0);
      lightsOn();
    }
    this.render();
    return true;
  }

  dispose() {
    this.disposed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.offs?.forEach((f) => f());
    if (this.net) { const n = this.net; this.app.online = null; n.leave(); }
    this.stopTimer();
    stopClip();
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
  }

  /* ---------------------------------------------------------- helpers */

  get s() {
    return this.state;
  }
  get ctx() {
    return this.app.ctx;
  }
  get turnPlayer() {
    return this.s.players[this.s.turn];
  }
  get multi() {
    return this.s.players.length > 1;
  }
  get profileOf() {
    return (id) => this.profiles.get(id);
  }

  reportSaveError(e) {
    console.error(e);
    if (!this.saveFailed) toast('Could not save progress on this device', 'err');
    this.saveFailed = true;
    return null;
  }

  /** Persist the current state. Writes are chained so they land in order. */
  save() {
    const state = this.s;
    this.saveChain = this.saveChain.then(async () => {
      try {
        const online = this.net ? { onlyPlayers: this.myIds, resumable: false } : undefined;
        if (state.status === 'active') this.persisted = await this.app.repo.saveProgress(state, this.persisted, online);
        else {
          await this.app.repo.finalizeSession(state, online ? { onlyPlayers: this.myIds } : undefined);
          this.persisted = state.log.length;
        }
      } catch (e) {
        this.reportSaveError(e);
      }
    });
    return this.saveChain;
  }

  act(action, { silent = false, remote = false } = {}) {
    if (this.net && !this.net.isHost) {
      // Guests never change the game themselves: the host does, and sends the result back.
      this.net.sendAction(action, this.rev);
      return true;
    }
    const res = dispatch(this.s, action, this.ctx);
    if (!res.ok) {
      if (!silent) toast(res.reason.charAt(0).toUpperCase() + res.reason.slice(1));
      return false;
    }
    this.state = res.state;
    this.lastProgress = Date.now();
    if (this.net?.isHost) {
      this.rev += 1;
      this.net.broadcastState(this.rev, this.s);
    }
    this.save();
    if (this.s.phase === 'finished') this.onFinished();
    this.render();
    return true;
  }

  async onFinished() {
    const s = this.s;
    if (s.status !== 'completed') return;
    const offers = s.players.filter((p) => !this.net || this.myIds.includes(p.playerId)).map((p) => ({ sessionId: s.sessionId, playerId: p.playerId, options: cardReward(s, p.playerId).options }));
    await this.saveChain;
    try {
      await this.app.repo.addPendingRewards(offers);
    } catch (e) {
      this.reportSaveError(e);
    }
    if (!this.disposed && this.s.phase === 'finished') this.render();
  }

  /* ------------------------------------------------------------ render */

  render() {
    if (this.disposed) return;
    this.stopTimer();
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    const phase = this.s.phase;
    this.setMoodForState();
    if (this.net && (phase === 'stake' || phase === 'question') && !this.isMyTurn) {
      mount(this.root, this.viewWaiting());
      window.scrollTo(0, 0);
      return;
    }
    const body = {
      loadout: () => this.viewLoadout(),
      stake: () => this.viewStake(),
      question: () => this.viewQuestion(),
      reveal: () => this.viewReveal(),
      'round-summary': () => this.viewSummary(),
      crossroads: () => this.viewCrossroads(),
      shop: () => this.viewShop(),
      finished: () => this.viewFinished(),
    }[phase]();
    mount(this.root, body);
    if (phase !== 'question') window.scrollTo(0, 0);
    const notes = this.notes.splice(0);
    notes.forEach((n) => toast(n));
  }

  setMoodForState() {
    const s = this.s;
    if (s.phase === 'finished') return setMood(s.players.some((p) => p.result === 'won') ? 'win' : 'out');
    if (s.round?.isBoss) return setMood('boss');
    if (s.config.strikes && s.players.some((p) => p.strikes === 1 && !p.defeated)) return setMood('danger');
    if (s.round && s.round.hazardId !== 'none') return setMood('tense');
    setMood('calm');
  }

  roundTitle() {
    const s = this.s;
    const info = roundInfo(s.roundIndex, s.config);
    if (s.config.noBoss) return `Round ${s.roundIndex + 1} of ${info.totalRounds}`;
    return info.isBoss ? `Act ${info.act + 1} · Boss` : `Act ${info.act + 1} · Round ${info.inAct + 1}`;
  }

  hud(p = this.turnPlayer, { menu = true } = {}) {
    const s = this.s;
    if (this.net) p = this.myPlayer;
    return h('div.hud', {},
      avatar(this.profileOf(p.playerId), 16),
      h('span.who', {}, p.name),
      h('span.pill', { title: 'Chips on the table' }, sprite('chip', 16), p.chips),
      p.vault > 0 ? h('span.pill', { title: 'Banked chips (safe)' }, sprite('vault', 16), p.vault) : null,
      p.streak > 0 ? h('span.pill', { title: 'Streak' }, sprite('flame', 16), p.streak) : null,
      s.config.strikes ? h('span.bulbs', { style: { marginLeft: 'auto' } }, bulbs(p.strikes)) : h('span', { style: { marginLeft: 'auto' } }),
      menu ? h('button.btn.small.icon.ghost', { type: 'button', 'aria-label': 'Menu', onclick: () => this.openPause() }, '☰') : null,
    );
  }

  slotDots(extraNow = true) {
    const s = this.s;
    const p = this.turnPlayer;
    return h('div.dots', { 'aria-label': `Question ${s.qIndex + 1} of ${RULES.questionsPerRound}` }, s.round.slots.map((_, i) => {
      const rec = s.log.find((r) => r.playerId === p.playerId && r.roundIndex === s.roundIndex && r.slot === i);
      const cls = rec ? (rec.correct ? 'done' : 'miss') : i === s.qIndex && extraNow ? 'now' : '';
      return h('i', { class: `${cls} ${s.round.markedSlot === i ? 'hot' : ''}` });
    }));
  }

  /* ----------------------------------------------------------- pause */

  openPause() {
    const s = this.s;
    if (s.phase === 'finished') return false;
    if (this.pauseOpen) return true;
    this.pauseOpen = true;
    if (this.net) {
      modal((close) => [
        h('h2', {}, 'Room menu'),
        h('p.small.dim', {}, this.net.isHost ? 'You are the host. If you leave, the game ends for everyone.' : 'If you leave, the others carry on and your remaining questions count as timeouts.'),
        h('button.btn.primary.block', { type: 'button', onclick: () => close('resume') }, 'Back to the game'),
        h('button.btn.danger.block', { type: 'button', onclick: () => close('leave') }, this.net.isHost ? 'End game for everyone' : 'Leave game'),
      ]).then(async (choice) => {
        this.pauseOpen = false;
        if (choice === 'leave') {
          await this.save();
          go('menu', {}, { replace: true });
        }
      });
      return true;
    }
    modal((close) => [
      h('h2', {}, 'Paused'),
      s.phase === 'question' ? h('p.small.red', {}, 'The clock keeps running while this menu is open.') : null,
      h('p.small.dim', {}, 'Your game is saved after every answer. If you leave in the middle of a question it counts as a timeout when you come back.'),
      h('button.btn.primary.block', { type: 'button', onclick: () => close('resume') }, 'Back to the game'),
      h('button.btn.block', { type: 'button', onclick: () => close('quit') }, 'Save & leave'),
      h('button.btn.danger.block', { type: 'button', onclick: () => close('abandon') }, 'Abandon game'),
    ]).then(async (choice) => {
      this.pauseOpen = false;
      if (choice === 'quit') {
        await this.save();
        go('menu', {}, { replace: true });
      } else if (choice === 'abandon') {
        const ok = await confirmDialog({
          title: 'Abandon this game?',
          body: ['Your answers so far stay in your statistics, but the game is marked abandoned: no score, no win or loss, no card reward.'],
          confirmLabel: 'Abandon game',
          danger: true,
        });
        if (ok && this.act({ type: 'ABANDON' }, { silent: true })) {
          await this.save();
          go('menu', {}, { replace: true });
        }
      }
    });
    return true;
  }

  /* ----------------------------------------------------------- waiting */

  viewWaiting() {
    const s = this.s;
    const p = this.turnPlayer;
    const member = this.net.memberByPlayerId(p.playerId);
    const doing = s.phase === 'stake' ? 'is choosing a stake' : 'is answering';
    return [
      this.hud(),
      h('div.row.between', {}, h('span.tiny.dim', {}, this.roundTitle()), h('span.tiny.dim', {}, `Question ${s.qIndex + 1} of 5`)),
      h('div.panel.waiting-card', {},
        avatar(this.profileOf(p.playerId), 48),
        h('h2', {}, p.name),
        h('p.dim', {}, member && !member.connected ? 'lost connection… the game will move on without them' : `${doing}…`),
        h('div.tiny.mute', {}, 'The question stays hidden until everyone has answered.'),
      ),
      h('div.standings', {}, [...s.players].sort((a, b) => b.chips + b.vault - (a.chips + a.vault)).map((pl) => h('div.panel.tight.row', { class: pl.playerId === p.playerId ? 'now' : '' }, avatar(this.profileOf(pl.playerId), 16), h('b.grow', {}, pl.name), h('span.pill', {}, sprite('chip', 16), pl.chips)))),
    ];
  }

  /* ---------------------------------------------------------- loadout */

  viewLoadout() {
    const s = this.s;
    const round = s.round;
    const boss = round.bossId ? BOSSES[round.bossId] : null;
    const hazard = HAZARDS[round.hazardId];
    const cats = roundCategories(round, this.ctx.byId);
    const tab = this.net ? s.players.indexOf(this.myPlayer) : Math.min(this.loadoutTab, s.players.length - 1);
    const p = s.players[tab];
    const owned = equippableCards(p.owned, s.mode);
    const locked = !s.config.cardsEnabled || Boolean(boss?.cardsLocked);
    const hand = owned.filter((id) => !p.loadout.includes(id));

    const setLoadout = (cards) => this.act({ type: 'SET_LOADOUT', playerId: p.playerId, cards }, { silent: false });
    const equip = (id) => {
      const slots = [...p.loadout];
      const free = slots.indexOf(null);
      if (free < 0) return toast('Both slots are full. Tap an equipped card to remove it.');
      slots[free] = id;
      setLoadout(slots);
    };
    const unequip = (i) => {
      const slots = [...p.loadout];
      slots[i] = null;
      setLoadout(slots);
    };

    return [
      this.hud(this.s.players[0], { menu: true }),
      h('div.panel.banner', { class: boss ? 'boss' : '' },
        h('div.tiny.dim', {}, this.roundTitle()),
        h('h3', {}, boss ? boss.name : hazard.name),
        h('p.small', {}, boss ? boss.text : hazard.text),
        boss && round.hazardId !== 'none' ? h('p.small', {}, hazard.text) : null,
      ),
      h('div.row.wrap', { style: { justifyContent: 'center', gap: '6px' } }, [...new Set(cats)].map((c) => categoryTag(c))),
      round.markedSlot != null ? h('p.small.amber.center', {}, '★ One question this round is marked. You will see which when it comes up.') : null,
      s.players.some((x) => x.comeback) ? h('p.small.green.center', {}, `Comeback charge: ${s.players.filter((x) => x.comeback).map((x) => x.name).join(', ')} get an extra use of each equipped card.`) : null,
      s.config.cardsEnabled
        ? [
            this.multi && !this.net ? h('div.tabs', {}, s.players.map((pl, i) => h('button.tab', { type: 'button', role: 'tab', 'aria-selected': String(i === tab), onclick: () => { this.loadoutTab = i; this.render(); } }, pl.name))) : null,
            h('div.row.between', {}, h('h3', {}, this.multi && !this.net ? `${p.name}: equip two` : 'Equip two cards'), h('span.tiny.dim', {}, `${p.loadout.filter(Boolean).length}/2`)),
            locked ? h('p.small.red', {}, `Cards are locked this round (${boss?.name}). You can still equip for later rounds.`) : round.hazardId === 'cold_table' ? h('p.small.red', {}, 'Cold Table: Scalpel, Peek and Ghost Note are locked this round.') : null,
            h('div.hand', {}, p.loadout.map((id, i) => h('div.slot', {}, id ? cardTile(id, { selected: true, onclick: () => unequip(i), charges: CARDS[id].timing === 'run' ? p.runCharges[id] : CARDS[id].uses + (p.bonusCharges ? 1 : 0) + (p.comeback ? 1 : 0) }) : emptySlot('Empty slot')))),
            hand.length ? h('div.tiny.dim', {}, 'Your collection · tap to equip') : null,
            h('div.reward-grid', {}, hand.map((id) => cardTile(id, { onclick: equip }))),
            !owned.length ? h('p.small.dim', {}, 'No cards available in this mode yet. Win cards by finishing games.') : null,
          ]
        : h('p.small.dim.center', {}, 'No bonus cards in the Daily, so everyone plays the same game.'),
      this.net && !this.net.isHost
        ? h('div.stick-bottom', {}, h('p.small.dim.center', {}, 'Equip your cards. The host starts the round.'))
        : h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { unlockAudio(); sfx.stake(); if (round.isBoss) sfx.boss(); this.gateKey = null; this.act({ type: 'START_ROUND' }); if (round.isBoss || round.hazardId === 'cold_table') lightsOn({ sound: false }); } }, round.isBoss ? 'Face the boss' : 'Start round')),
    ];
  }

  /* ------------------------------------------------------------ stake */

  turnKey() {
    const s = this.s;
    return `${s.roundIndex}:${s.qIndex}:${s.turn}`;
  }

  gate(p, text) {
    return [
      h('div.gate', {},
        h('div.tiny.amber', {}, 'Pass the phone'),
        avatar(this.profileOf(p.playerId), 48),
        h('h1', {}, p.name),
        h('p.dim', {}, text),
        h('button.btn.primary', { type: 'button', onclick: () => { unlockAudio(); sfx.tap(); this.gateKey = this.turnKey(); this.render(); } }, `I'm ${p.name}`),
      ),
    ];
  }

  viewStake() {
    const s = this.s;
    const p = this.turnPlayer;
    if (this.passPhone && this.gateKey !== this.turnKey()) return this.gate(p, `${this.roundTitle()} · question ${s.qIndex + 1} of 5. Make sure the others look away from the screen.`);

    this.ensureTranslation(p.playerId).then(() => {});
    const view = this.view(p.playerId);
    const options = getStakeOptions(s, this.ctx, p.playerId);
    const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
    if (this.stakeSelKey !== this.turnKey()) {
      this.stakeSelKey = this.turnKey();
      this.stakeSel = options.length === 1 ? options[0].stake : null;
    }
    const sel = options.find((o) => o.stake === this.stakeSel);
    const qp = s.q.byPlayer[p.playerId];

    return [
      this.hud(p),
      h('div.row.between', {}, h('span.tiny.dim', {}, this.roundTitle()), s.round.markedSlot === s.qIndex ? h('span.tag.amber', {}, `★ Marked: ${HAZARDS[s.round.hazardId].slotLossMult ? 'pays ×2, misses cost ×2' : 'pays ×2'}`) : null),
      this.slotDots(),
      h('div.cat-line', {}, categoryIcon(view.category, 20), CATEGORIES[view.category]?.label ?? view.category, h('span', { style: { marginLeft: 'auto' } }, diffPips(view.difficulty))),
      this.questionCard(view, { hidden: view.text == null, tune: view.type === 'tune' }),
      this.cardsBar('pre-stake'),
      h('div.row.between', {}, h('h3', {}, boss?.lockStake ? 'Stake locked' : 'Choose your stake'), h('span.tiny.dim', {}, `${p.chips} chips`)),
      p.chips <= 0 ? h('p.small.green', {}, 'You are out of chips, so this one is played for free. A correct answer still pays.') : null,
      h('div.stakes', {}, options.map((o) => h('button.stake', {
        type: 'button', 'aria-pressed': String(o.stake === this.stakeSel), disabled: options.length === 1,
        onclick: () => { this.stakeSel = o.stake; sfx.select(); this.render(); },
      },
      h('span.mult', {}, `${o.stake}×`),
      h('span.nums', {}, h('span.w', {}, `Win +${o.win}`), h('span.l', {}, `Lose −${o.lose}`)),
      h('span.note', {}, o.broke ? 'Free play' : `Risk ${Math.min(p.chips, o.stake * RULES.baseWager)} chips · up to +${o.winFast} if you answer in the first ${Math.round(RULES.speedThreshold * 100)}% of the clock`),
      ))),
      qp.usedCards.length ? h('p.tiny.amber', {}, `Armed: ${qp.usedCards.map((c) => CARDS[c].name).join(', ')}`) : null,
      h('div.stick-bottom', {}, h('button.btn.primary.block', {
        type: 'button', disabled: !sel,
        onclick: async (e) => { sfx.stake(); if (sel.stake >= 3) { sfx.drumroll(); haptic('big'); } e.currentTarget.disabled = true; await Promise.race([this.ensureTranslation(p.playerId), new Promise((r) => setTimeout(r, 3500))]); this.act({ type: 'CONFIRM_STAKE', playerId: p.playerId, stake: sel.stake }); },
      }, sel ? `Lock in ${sel.stake}× · start the clock` : 'Pick a stake')),
    ];
  }

  questionCard(view, { hidden = false, tune = false, dir = null } = {}) {
    return h('div.panel.paper.qcard', { dir, class: `${tune ? 'lyric' : ''} ${hidden ? 'hidden-q' : ''}` },
      tune ? h('div.tiny', { style: { textAlign: 'center', marginBottom: '6px' } }, 'Name that tune: which song are these lyrics from?') : null,
      h('div.q', {}, hidden ? 'Question hidden until you stake' : view.text),
    );
  }

  /* ------------------------------------------------------------ cards */

  cardsBar(timing) {
    const s = this.s;
    const p = this.turnPlayer;
    if (!s.config.cardsEnabled) return null;
    const ids = p.loadout.filter(Boolean);
    if (!ids.length) return null;
    const qp = s.q.byPlayer[p.playerId];
    const hazard = HAZARDS[s.round.hazardId];
    const boss = s.round.bossId ? BOSSES[s.round.bossId] : null;
    const q = this.ctx.byId.get(s.q.questionId);
    const mcq4 = q.type !== 'tf' && q.choices.length >= 4;

    const buttons = ids.map((id) => {
      const c = CARDS[id];
      const left = c.timing === 'run' ? p.runCharges[id] ?? 0 : p.charges[id] ?? 0;
      const here = (timing === 'pre-stake' && c.timing === 'pre-stake') || (timing === 'question' && c.timing !== 'pre-stake');
      let why = null;
      if (s.cardsLockedThisRound) why = 'Locked';
      else if (hazard.cluesLocked && c.clue) why = 'Locked';
      else if (qp.usedCards.includes(id)) why = 'Used';
      else if (left <= 0) why = 'None left';
      else if (!here) why = timing === 'pre-stake' ? 'During question' : 'Before staking';
      else if ((id === 'scalpel' || id === 'rewind') && !mcq4) why = 'Needs 4 options';
      else if (id === 'ghost_note' && q.type === 'tf') why = 'Needs choices';
      else if (id === 'skeleton_key' && boss) why = 'Not vs bosses';
      const armed = qp.usedCards.includes(id);
      return h('button.card-mini', {
        type: 'button', class: armed ? 'armed' : '', disabled: Boolean(why), title: `${c.text} Drawback: ${c.drawback}`,
        onclick: () => this.useCard(id),
      }, sprite(c.icon, 28), h('span', {}, c.name, h('small', {}, why ?? `${c.text.slice(0, 34)}${c.text.length > 34 ? '…' : ''}`)));
    });
    return h('div.col.gap-s', {}, h('div.tiny.dim', {}, 'Your cards'), h('div.cards-bar', {}, buttons));
  }

  async useCard(id) {
    const c = CARDS[id];
    const p = this.turnPlayer;
    unlockAudio();
    if (c.kind === 'attack') {
      const rivals = this.s.players.filter((x) => x.playerId !== p.playerId);
      const target = await modal((close) => [
        h('h2', {}, c.name),
        h('p', {}, c.text),
        h('div.col.gap-s', {}, rivals.map((r) => h('button.pick', { type: 'button', onclick: () => close(r.playerId) }, avatar(this.profileOf(r.playerId), 32), h('span.name.profile-row', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, textTransform: 'uppercase' } }, r.name)))),
        h('button.btn.ghost.block', { type: 'button', onclick: () => close(undefined) }, 'Cancel'),
      ]);
      if (!target) return;
      if (this.act({ type: 'USE_CARD', playerId: p.playerId, cardId: id, targetId: target })) {
        sfx.card();
        toast(`${c.name} played on ${this.s.players.find((x) => x.playerId === target).name}`);
      }
      return;
    }
    if (this.act({ type: 'USE_CARD', playerId: p.playerId, cardId: id })) {
      sfx.card();
    }
  }

  /* --------------------------------------------------------- question */

  viewQuestion() {
    const s = this.s;
    const p = this.turnPlayer;
    const view = this.view(p.playerId);
    const qp = s.q.byPlayer[p.playerId];
    const isTf = view.type === 'tf';

    const timerFill = h('i');
    const timerBar = h('div.timer', { role: 'timer', 'aria-label': 'Time left' }, timerFill);
    const timerText = h('span.timer-text', {}, `${Math.ceil(view.timerMs / 1000)}s`);

    const choiceEls = view.choices.map((c) => h('button.choice', {
      type: 'button', class: `${c.hidden ? 'removed' : ''} ${isTf ? 'tf' : ''}`, disabled: c.hidden, 'data-display': c.display,
      onclick: (e) => this.answer(c.display, e.currentTarget),
    }, isTf ? null : h('span.key', {}, LETTERS[c.display]), c.text));

    this.startTimer(view, qp, { fill: timerFill, bar: timerBar, text: timerText });
    this.bindKeys(view, choiceEls);

    return [
      this.hud(p),
      h('div.row.between', {}, h('span.tiny.dim', {}, this.roundTitle()), s.round.markedSlot === s.qIndex ? h('span.tag.amber', {}, '★ Marked question') : null),
      this.slotDots(),
      h('div.cat-line', {}, categoryIcon(view.category, 20), CATEGORIES[view.category]?.label ?? view.category, h('span', { style: { marginLeft: 'auto' } }, diffPips(view.difficulty))),
      this.questionCard(view, { tune: view.type === 'tune', dir: view.translated ? (languageOf(this.langOf(p.playerId)).rtl ? 'rtl' : null) : null }),
      this.langOf(p.playerId) !== 'en' && !view.translated && view.type !== 'tune' ? h('p.tiny.amber.center', {}, `No ${languageOf(this.langOf(p.playerId)).name} translation was available, so this one is in English.`) : null,
      h('div.row', {}, h('div.grow', {}, timerBar), timerText),
      view.retry ? h('p.small.amber.center.pop', {}, 'Rewind! One wrong option is gone. Try again.') : null,
      view.ghostLetter ? h('p.small.amber.center', {}, `Ghost Note: the answer starts with “${view.ghostLetter}”`) : null,
      h('div.choices', { class: isTf ? 'grid2' : '', dir: view.translated && languageOf(this.langOf(p.playerId)).rtl ? 'rtl' : null }, choiceEls),
      this.cardsBar('question'),
    ];
  }

  bindKeys(view, els) {
    this.keyHandler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      let i = '1234'.indexOf(k);
      if (i < 0) i = 'abcd'.indexOf(k);
      if (i < 0 && view.type === 'tf') i = k === 't' ? 0 : k === 'f' ? 1 : -1;
      if (i >= 0 && els[i] && !els[i].disabled) els[i].click();
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  startTimer(view, qp, { fill, bar, text }) {
    const key = `${this.turnKey()}:${qp.startedAt}`;
    if (this.timerKeyUsed !== key) {
      this.timerKeyUsed = key;
      this.timerStart = performance.now();
    }
    let lastWhole = null;
    const tick = () => {
      if (this.disposed) return;
      const elapsed = performance.now() - this.timerStart;
      const left = Math.max(0, view.timerMs - elapsed);
      fill.style.transform = `scaleX(${left / view.timerMs})`;
      const whole = Math.ceil(left / 1000);
      if (whole !== lastWhole) {
        text.textContent = `${whole}s`;
        if (left <= 5000 && left > 0 && lastWhole != null) sfx.tick();
        lastWhole = whole;
      }
      bar.classList.toggle('low', left <= 5000);
      if (left <= 0) {
        this.timer = null;
        this.finishAnswer(null, view.timerMs, null);
        return;
      }
      this.timer = requestAnimationFrame(tick);
    };
    this.timer = requestAnimationFrame(tick);
  }

  stopTimer() {
    if (this.timer) cancelAnimationFrame(this.timer);
    this.timer = null;
  }

  answer(display, el) {
    const elapsed = performance.now() - this.timerStart;
    this.stopTimer();
    if (el) el.classList.add('picked');
    sfx.tap();
    haptic('tap');
    this.finishAnswer(display, elapsed, el);
  }

  finishAnswer(choice, elapsedMs, el) {
    const p = this.turnPlayer;
    const before = this.s.log.length;
    const ok = this.act({ type: 'ANSWER', playerId: p.playerId, choice, elapsedMs: Math.round(elapsedMs) }, { silent: true });
    if (!ok) return;
    const rec = this.s.log.length > before ? this.s.log[this.s.log.length - 1] : null;
    if (!rec) return; // rewind: the question stays open with a fresh clock
    if (this.multi) return; // results stay hidden until everyone has answered
    this.feedback(rec);
  }

  /** Sound, light and a floating number for a single result. */
  feedback(rec) {
    if (rec.correct) {
      sfx.correct();
      sfx.coin();
      pulse('good');
      haptic('correct');
      const big = (rec.stake ?? 1) >= 3;
      coinBurst(this.root.querySelector('.hud') ?? this.root, big ? 22 : 9);
      if (big) { sfx.cash(); stamp('BIG WIN!', { kind: 'jackpot' }); confetti({ count: 50 }); haptic('big'); }
      else streakHype(rec.streakAfter ?? 0);
    } else {
      rec.outcome === 'timeout' ? sfx.timeout() : sfx.wrong();
      pulse('bad');
      shake(this.root);
      haptic(rec.outcome === 'timeout' ? 'timeout' : 'wrong');
      if ((rec.stake ?? 1) >= 3) { sfx.sadTrombone(); stamp('OUCH!', { kind: 'bad' }); }
      else if (rec.outcome !== 'timeout') sfx.boing();
    }
    floatText(`${rec.delta > 0 ? '+' : rec.delta < 0 ? '−' : ''}${Math.abs(rec.delta)}`, rec.delta >= 0 ? 'up' : 'down');
    if (rec.strikeLost) blackout();
  }

  /* ----------------------------------------------------------- reveal */

  viewReveal() {
    const s = this.s;
    const q = this.ctx.byId.get(s.q.questionId);
    const langs = new Set(s.players.map((x) => this.langOf(x.playerId)));
    const v = this.net ? this.view(this.myPlayerId) : langs.size === 1 ? this.view(s.players[0].playerId) : getQuestionView(s, this.ctx, s.players[0].playerId);
    const rightText = v.choices.find((c) => c.correct).text;
    const last = s.qIndex + 1 >= RULES.questionsPerRound;
    const key = `${s.roundIndex}:${s.qIndex}`;

    if (this.multi && this.revealKey !== key) {
      // Everyone has answered: reveal together.
      this.revealKey = key;
      const mine = s.players.map((p) => s.q.byPlayer[p.playerId].result);
      const anyRight = mine.some((r) => r.correct);
      anyRight ? sfx.correct() : sfx.wrong();
      pulse(anyRight ? 'good' : 'bad');
      haptic(anyRight ? 'correct' : 'wrong');
      if (anyRight) coinBurst(this.root, 12);
    }
    if (!this.multi) this.revealKey = key;

    const resultLine = (p) => {
      const r = s.q.byPlayer[p.playerId].result;
      const picked = r.choice == null ? (r.usedCards.includes('skeleton_key') ? 'Skeleton Key' : 'No answer') : v.choices[r.choice]?.text;
      return h('div.result-line', {},
        avatar(this.profileOf(p.playerId), 16),
        h('div.grow', {}, h('b', {}, p.name), h('div.small.dim', {}, r.outcome === 'timeout' ? 'Out of time' : `Answered: ${picked}`)),
        h('span', { class: `mono delta ${r.delta >= 0 ? 'up' : 'down'}` }, r.correct ? '✓ ' : '✗ ', chipsLine(r.delta, { sign: true })),
      );
    };

    const solo = !this.multi;
    const r0 = s.q.byPlayer[s.players[0].playerId].result;
    const banner = solo
      ? h('div.panel.reveal-banner.pop', { class: r0.correct ? 'good' : 'bad', role: 'status' },
          h('h2', {}, r0.correct ? 'Correct' : r0.outcome === 'timeout' ? "Time's up" : 'Wrong'),
          h('p.small.dim', {}, `${r0.delta >= 0 ? 'Won' : 'Lost'} ${Math.abs(r0.delta)} chips${r0.streakAfter > 1 ? ` · streak ${r0.streakAfter}` : ''}${r0.usedCards.length ? ` · ${r0.usedCards.map((c) => CARDS[c].name).join(', ')}` : ''}`),
        )
      : h('div.panel.tight', {}, s.players.map(resultLine));

    const audio = v.audio;
    return [
      this.hud(solo ? s.players[0] : this.turnPlayer),
      banner,
      solo ? this.recapChoices(v, r0) : null,
      h('div.panel.paper', {},
        h('div.explain', {}, h('span.ans', {}, `Answer: ${rightText}`), v.explanation),
        h('div.row.wrap', { style: { marginTop: '10px', gap: '6px' } },
          categoryTag(v.category),
          h('span.tag', {}, DIFFICULTIES[q.difficulty]),
          q.review !== 'verified' ? h('span.tag', { title: 'No human has fact-checked this question yet. Check the explanation yourself.' }, 'Unreviewed') : h('span.tag.green', {}, 'Verified'),
          q.freshness === 'dated' && q.asOf ? h('span.tag.amber', {}, `As of ${q.asOf}`) : null,
        ),
        audio
          ? h('div.row', { style: { marginTop: '10px' } }, h('button.btn.small', { type: 'button', onclick: () => playClip(audio) }, sprite('speaker', 20), 'Play the song'), q.audioCredit ? h('span.tiny.mute', {}, q.audioCredit) : null)
          : null,
      ),
      !solo ? h('div.panel.inset.tight', {}, s.players.map((p) => h('div.kv', {}, h('span', {}, p.name), h('b', {}, `${p.chips} chips`)))) : null,
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { stopClip(); sfx.tap(); this.act({ type: 'NEXT' }); } }, last ? 'Round results' : 'Next question')),
    ];
  }

  recapChoices(v, r) {
    return h('div.choices', {}, v.choices.map((c) => h('div.choice', { class: `${c.correct ? 'right' : r.choice === c.display ? 'wrong' : ''} ${c.hidden ? 'removed' : ''}`, style: { cursor: 'default' } }, v.type === 'tf' ? null : h('span.key', {}, LETTERS[c.display]), c.text)));
  }

  /* ---------------------------------------------------------- summary */

  viewSummary() {
    const s = this.s;
    const last = s.roundLog[s.roundLog.length - 1];
    const boss = last.bossId ? BOSSES[last.bossId] : null;
    const threshold = boss?.passThreshold ?? RULES.passThreshold;
    const lostBulb = s.players.some((p) => last.players[p.playerId].strikesLost > 0);
    if (this.summaryKey !== s.roundIndex) {
      this.summaryKey = s.roundIndex;
      if (lostBulb) { sfx.wrong(); blackout(); haptic('warn'); } else { sfx.win(); haptic('big'); confetti({ count: boss ? 90 : 45 }); if (boss) { sfx.jackpot(); stamp('BOSS DOWN!', { kind: 'jackpot' }); } }
    }
    return [
      this.hud(s.players[0], {}),
      h('div.panel.banner', { class: boss ? 'boss' : '' }, h('div.tiny.dim', {}, this.roundTitle()), h('h2', {}, boss ? `${boss.name} complete` : 'Round complete')),
      ...s.players.map((p) => {
        const r = last.players[p.playerId];
        const recs = s.log.filter((x) => x.playerId === p.playerId && x.roundIndex === s.roundIndex).sort((a, b) => a.slot - b.slot);
        return h('div.panel', {},
          h('div.row', {}, avatar(this.profileOf(p.playerId), 16), h('h3.grow', {}, p.name), h('span.mono', {}, `${r.correct}/5`)),
          h('div.dots', { style: { margin: '10px 0' } }, recs.map((x) => h('i', { class: x.correct ? 'done' : 'miss' }))),
          s.config.strikes
            ? h('p.small', { class: r.cleared ? 'green' : 'red' }, r.cleared ? `Cleared (${threshold}+ needed).` : r.strikesLost ? `Not cleared: you needed ${threshold}. A bulb goes out.` : `Not cleared (needed ${threshold}).`)
            : null,
          r.bonus ? h('p.small.amber', {}, `Bonus: +${r.bonus} chips${r.bonus >= RULES.perfectRoundBonus ? ' for a perfect round' : ''}`) : null,
          h('div.row', {}, chipsLine(r.chips), s.config.strikes ? bulbs(p.strikes) : null),
          p.defeated ? h('p.small.red', {}, 'Out of bulbs. The run ends here.') : null,
        );
      }),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { sfx.tap(); this.act({ type: 'CONTINUE' }); } }, 'Continue')),
    ];
  }

  /* -------------------------------------------------------- crossroads */

  viewCrossroads() {
    const s = this.s;
    const p = s.players[0];
    const bank = Math.floor(p.chips * RULES.bankFraction);
    const choose = (choice) => { sfx.coin(); this.act({ type: 'CROSSROADS', playerId: p.playerId, choice }); };
    const info = roundInfo(s.roundIndex + 1, s.config);
    return [
      this.hud(p, {}),
      h('div.panel.banner', {}, h('div.tiny.dim', {}, 'Crossroads'), h('h2', {}, 'Bank it or press on?'), h('p.small.dim', {}, `Next: ${info.isBoss ? 'a boss round' : `Act ${info.act + 1}, round ${info.inAct + 1}`}. Chips on the table are lost if you run out of bulbs; banked chips are always safe.`)),
      h('div.row.between', {}, chipsLine(p.chips), h('span.chips-line', {}, sprite('vault', 16), `${p.vault} banked`)),
      h('div.col', {},
        h('button.crossroads-opt', { type: 'button', disabled: bank <= 0, onclick: () => choose('bank') }, sprite('vault', 48), h('div', {}, h('b', {}, `Bank ${bank}`), h('span.small.dim', {}, `Move half your chips (${bank}) into the vault. Safe for good, but you play the next round with ${p.chips - bank}.`))),
        h('button.crossroads-opt', { type: 'button', onclick: () => choose('hold') }, sprite('chip', 48), h('div', {}, h('b', {}, 'Hold'), h('span.small.dim', {}, 'Keep everything on the table. No change.'))),
        h('button.crossroads-opt', { type: 'button', onclick: () => choose('push') }, sprite('flame', 48), h('div', {}, h('b', {}, 'Push'), h('span.small.dim', {}, `Next round every win and every loss is ×${RULES.pushMult}. High risk, high reward.`))),
      ),
    ];
  }

  /* -------------------------------------------------------------- shop */

  viewShop() {
    const s = this.s;
    const p = s.players[0];
    const act = s.round.act;
    const buy = (item) => { if (this.act({ type: 'BUY', playerId: p.playerId, item })) sfx.coin(); };
    const state = (id) => {
      const it = SHOP_ITEMS[id];
      if (p.chips < it.cost) return 'Not enough chips';
      if (id === 'spare_bulb') return p.strikes >= RULES.maxStrikes ? 'Bulbs full' : p.shopBought[`bulb${act}`] ? 'Bought this act' : null;
      if (id === 'spare_battery') return p.bonusCharges ? 'Already bought' : null;
      if (id === 'slow_clock') return p.slowClock ? 'Already bought' : null;
      return null;
    };
    return [
      this.hud(p, {}),
      h('div.panel.banner', {}, h('div.tiny.dim', {}, 'The shop'), h('h2', {}, 'Spend or save')),
      ...Object.values(SHOP_ITEMS).map((it) => {
        const why = state(it.id);
        return h('div.panel.shop-item', {}, sprite(it.id === 'spare_bulb' ? 'bulb_on' : it.id === 'spare_battery' ? 'key' : 'hourglass', 40), h('div.grow', {}, h('b', {}, it.name), h('p.small.dim', { style: { margin: 0 } }, it.text)), h('button.btn.small', { class: why ? '' : 'primary', type: 'button', disabled: Boolean(why), onclick: () => buy(it.id) }, why ?? it.cost));
      }),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { sfx.tap(); this.act({ type: 'LEAVE_SHOP' }); } }, 'Next round')),
    ];
  }

  /* ---------------------------------------------------------- finished */

  viewFinished() {
    const s = this.s;
    const done = s.status === 'completed';
    if (this.finishKey !== s.sessionId) {
      this.finishKey = s.sessionId;
      if (done && s.players.some((p) => p.result === 'won')) { sfx.jackpot(); haptic('jackpot'); confetti({ count: 120, duration: 2600 }); }
      else if (done) { sfx.sadTrombone(); haptic('wrong'); }
    }
    const solo = s.mode !== 'versus';
    const title = !done ? 'Game abandoned' : solo ? (s.players[0].result === 'won' ? 'You beat the house' : 'The house wins') : 'Final standings';
    const players = [...s.players].sort((a, b) => (a.placement ?? 9) - (b.placement ?? 9));

    return [
      h('div.panel.banner', { class: done && s.players.some((p) => p.result === 'won') ? '' : 'boss' }, h('div.tiny.dim', {}, MODE_NAME[this.label] ?? s.mode), h('h1', {}, title)),
      ...players.map((p) => {
        const mine = s.log.filter((r) => r.playerId === p.playerId);
        const right = mine.filter((r) => r.correct).length;
        return h('div.panel', {},
          h('div.row', {}, avatar(this.profileOf(p.playerId), 32), h('div.grow', {}, h('h3', {}, p.name), h('div.tiny.dim', {}, done ? (solo ? p.result === 'won' ? 'Run won' : 'Run lost' : `Place ${p.placement}`) : 'Abandoned')), done ? h('div.big-num.amber', {}, p.finalScore ?? 0) : null),
          h('div.hr'),
          h('div.kv', {}, h('span', {}, 'Answered correctly'), h('b', {}, `${right} of ${mine.length}`)),
          h('div.kv', {}, h('span', {}, 'Longest streak'), h('b', {}, p.longestStreak)),
          solo && done ? [
            h('div.kv', {}, h('span', {}, 'Rounds cleared'), h('b', {}, p.roundsCleared)),
            h('div.kv', {}, h('span', {}, 'Bosses cleared'), h('b', {}, p.bossesCleared)),
            h('div.kv', {}, h('span', {}, 'Banked chips'), h('b', {}, p.vault)),
            p.result === 'won' ? h('div.kv', {}, h('span', {}, 'Chips kept'), h('b', {}, p.chips)) : h('div.kv', {}, h('span', {}, 'Chips lost with the run'), h('b', {}, p.chips)),
          ] : null,
          !solo && done ? h('div.kv', {}, h('span', {}, 'Chips'), h('b', {}, p.chips)) : null,
        );
      }),
      done ? h('div.panel.good.tight.small', {}, sprite('key', 24), ' New cards are waiting for you. Claim them now or any time from the main menu.') : h('p.small.dim.center', {}, 'Your answers were kept in your statistics.'),
      h('div.stick-bottom.col', {},
        done ? h('button.btn.primary.block', { type: 'button', onclick: () => go('rewards') }, 'Claim cards') : null,
        h('button.btn.block', { type: 'button', onclick: () => go('setup', { mode: this.label }, { replace: true }) }, 'Play again'),
        h('div.row', {}, h('button.btn.ghost.grow', { type: 'button', onclick: () => go('stats', { playerId: s.players[0].playerId }) }, 'Stats'), h('button.btn.ghost.grow', { type: 'button', onclick: () => go('menu', {}, { replace: true }) }, 'Menu')),
      ),
    ];
  }
}
