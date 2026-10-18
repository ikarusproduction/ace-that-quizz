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
import { splash, clearHexFx, unblurOnFirstTap } from '../hexfx.js';
import { cardReveal, rarityFx } from '../rarityfx.js';
import { HEXES, HEX_NUMBERS, STREAK_TIERS, tierForStreak, packsEarned, evaluateMissions, usableHexes } from '../../engine/hexes.js';
import { metaOf } from '../../storage/meta.js';
import { WaitGame } from '../waitgame.js';
import { languageOf } from '../../i18n/languages.js';
import { createTranslator, applyTranslation } from '../../i18n/translate.js';
import { recentlySeenIds, seenCounts } from '../../stats/stats.js';
import { CARDS as ALL_CARDS } from '../../engine/cards.js';
import { STARTER_CARDS } from '../../engine/cards.js';
import { DUEL, INTENTS, NODE_KINDS, DEALS, DUEL_SHOP_ITEMS, BOSS_ROSTER, availableNodes, startHeat } from '../../engine/duel.js';
import { createStage, stageFor } from '../stage.js';
import '../art_bosses.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const chipsText = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n)} chips`;
const MODE_NAME = { solo: 'Solo run', quick: 'Quick run', versus: 'Versus', daily: 'Daily', rush: 'Boss Rush', map: 'Map run' };

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

    if (net.isHost && !net.startInfo && !net.latest) {
      const infos = net.infos;
      const seen = {};
      const avoid = new Set();
      const valid = (list) => [...new Set([...(Array.isArray(list) ? list : []).filter((c) => ALL_CARDS[c]), ...STARTER_CARDS])];
      const players = net.members.map((m) => {
        const pid = net.playerIdOf(m);
        const info = infos.get(m.id);
        for (const [id, n] of Object.entries(info?.seen ?? {})) if (typeof n === 'number' && this.ctx.byId.has(id)) seen[id] = (seen[id] ?? 0) + Math.min(n, 50);
        for (const id of (info?.recent ?? []).slice(0, 150)) avoid.add(id);
        return { id: pid, name: m.name, ownedCards: valid(info?.ownedCards), ownedHexes: info?.ownedHexes, hexDeck: info?.hexDeck };
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
      net.on('status', () => this.updateNetBanner()),
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
    const calm = this.puzzleOnly(this.state, state);
    this.rev = rev;
    this.state = state;
    this.lastProgress = Date.now();
    this.save();
    if (state.phase === 'finished') this.onFinished();
    if (!calm) this.render();
  }

  /** True when only another player's puzzle changed the state and I am the one answering: do not rebuild my screen under my finger. */
  puzzleOnly(prev, next) {
    if (!prev || !this.net || !next) return false;
    const same = prev.phase === next.phase && prev.turn === next.turn && prev.qIndex === next.qIndex && prev.roundIndex === next.roundIndex;
    const mine = next.players?.[next.turn]?.playerId === this.myPlayerId && (next.phase === 'stake' || next.phase === 'question');
    return same && mine && (next.puzzleSeq ?? 0) !== (prev.puzzleSeq ?? 0);
  }

  /** A thin bar at the top while this phone is not connected; no re-render, so a question in progress is untouched. */
  updateNetBanner() {
    if (this.disposed) return;
    const bad = this.net && this.net.status !== 'online';
    if (!bad) { this.banner?.remove(); this.banner = null; return; }
    if (!this.banner) {
      this.banner = h('div.net-banner', { role: 'status' }, 'Connection lost. Reconnecting… your game is safe.');
      document.body.append(this.banner);
    }
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
    const allowed = ['SET_LOADOUT', 'USE_CARD', 'CONFIRM_STAKE', 'ANSWER', 'NEXT', 'CONTINUE', 'PUZZLE'];
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
    // A dropped connection gets a generous grace period (a reload or a tunnel takes a while).
    if (s.phase === 'stake' && (idle > 60000 || (gone && idle > 45000))) {
      this.act({ type: 'CONFIRM_STAKE', playerId: p.playerId, stake: 1 }, { silent: true });
    } else if (s.phase === 'question') {
      const timerMs = s.q.byPlayer[p.playerId]?.timerMs ?? 20000;
      if (idle > timerMs + 12000 || (gone && idle > timerMs + 30000)) this.act({ type: 'ANSWER', playerId: p.playerId, choice: null, elapsedMs: timerMs }, { silent: true });
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
      this.label = state.config?.variant ?? state.mode;
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
      const duelVariant = params.mode === 'rush' || params.mode === 'map' ? params.mode : null;
      const mode = params.mode === 'quick' || duelVariant ? 'solo' : params.mode;
      this.label = params.mode;
      const results = await app.repo.storage.getAll('results');
      const avoidIds = mode === 'daily' ? [] : recentlySeenIds(results, ids);
      this.state = createGame({
        mode,
        players: players.map((p) => ({ id: p.id, name: p.name, ownedCards: p.ownedCards, ownedHexes: metaOf(p).hexes.owned, hexDeck: metaOf(p).hexes.deck })),
        ctx: app.ctx,
        seed: mode === 'daily' ? `daily-${localDateKey()}` : undefined,
        overrides: { ...(params.mode === 'quick' ? { acts: 1 } : {}), ...(duelVariant ? { variant: duelVariant, bossId: params.bossId ?? null } : {}), ...(params.themes && mode !== 'daily' && !duelVariant ? { themes: params.themes } : {}) },
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
    this.banner?.remove();
    clearHexFx();
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
    const calm = action.type === 'PUZZLE' && this.isMyTurn;
    this.state = res.state;
    if (action.type !== 'PUZZLE') this.lastProgress = Date.now(); // puzzles must not keep an idle turn alive
    if (this.net?.isHost) {
      this.rev += 1;
      this.net.broadcastState(this.rev, this.s);
    }
    this.save();
    if (this.s.phase === 'finished') this.onFinished();
    if (!calm) this.render();
    return true;
  }

  async onFinished() {
    const s = this.s;
    if (s.status !== 'completed') return;
    const offers = s.players.filter((p) => !this.net || this.myIds.includes(p.playerId)).map((p) => ({ sessionId: s.sessionId, playerId: p.playerId, options: cardReward(s, p.playerId).options }));
    await this.saveChain;
    try {
      await this.app.repo.addPendingRewards(offers);
      for (const p of s.players.filter((x) => !this.net || this.myIds.includes(x.playerId))) {
        const list = packsEarned(s, p.playerId).map((type, i) => ({ id: `${s.sessionId}:${p.playerId}:g${i}`, type, from: i === 0 ? 'Game pack' : i === 1 ? 'Great game' : 'Streak master' }));
        for (const m of evaluateMissions(s, p.playerId, p.missions ?? []).filter((x) => x.done)) list.push({ id: `${s.sessionId}:${p.playerId}:m:${m.id}`, type: 'bronze', from: `Mission: ${m.text}` });
        await this.app.repo.addPacks(p.playerId, list);
        // A player who has shared a friend code keeps their public card fresh.
        const prof = await this.app.repo.getProfile(p.playerId);
        if (prof?.friendCode && this.app.cloud) this.app.cloud.publishFriendCard(p.playerId).catch(() => {});
      }
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
    this.noticeHex();
    if (phase !== 'question') clearHexFx();
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
      map: () => this.viewMap(),
      rest: () => this.viewRest(),
      event: () => this.viewEvent(),
      finished: () => this.viewFinished(),
    }[phase]();
    mount(this.root, body);
    if (phase !== 'question') window.scrollTo(0, 0);
    this.runStagePlay();
    const notes = this.notes.splice(0);
    notes.forEach((n) => toast(n));
  }

  /** Announce hexes (once per phone) and the hexes this player just earned. */
  noticeHex() {
    const s = this.s;
    const hx = s.lastHex;
    if (this.seenHexSeq === undefined) this.seenHexSeq = hx?.seq ?? 0;
    else if (hx && hx.seq > this.seenHexSeq) {
      this.seenHexSeq = hx.seq;
      if (this.net) {
        const name = (id) => s.players.find((x) => x.playerId === id)?.name ?? 'Someone';
        const hex = HEXES[hx.hexId];
        const iBy = this.myIds.includes(hx.by); const iAt = this.myIds.includes(hx.at);
        const bits = [];
        if (hex.kind === 'defense') bits.push(iBy ? `${hex.name} is up. Your next hex-hit is covered.` : `${name(hx.by)} raised a ${hex.name}.`);
        else if (iBy) bits.push(`You played ${hex.name} on ${name(hx.at)}${hx.stolen ? ` and took ${hx.stolen} chips` : ''}.`);
        else if (iAt) bits.push(`${name(hx.by)} played ${hex.name} on you${hx.stolen ? ` and took ${hx.stolen} chips` : ''}!`);
        else bits.push(`${name(hx.by)} played ${hex.name} on ${name(hx.at)}.`);
        if (hx.blocked) bits.push(hx.blocked === 'mirror' ? 'A Mirror bounced it back!' : `It was soaked up by a ${hx.blocked === 'cloth' ? 'Wet Cloth' : 'Sponge'}.`);
        this.notes.push(bits.join(' '));
        if (hx.blocked || hex.kind === 'defense') sfx.shield?.(); else if (iAt && !iBy) { sfx.splat?.(); haptic('warn'); } else if (hx.stolen) sfx.steal?.();
      }
    }
    const dl = s.lastDeal;
    if (this.seenDealSeq === undefined) this.seenDealSeq = dl?.seq ?? 0;
    else if (dl && dl.seq > this.seenDealSeq) {
      this.seenDealSeq = dl.seq;
      if (dl.id === 'gamble') { this.notes.push(dl.won ? 'Heads. +70 chips.' : 'Tails. −35 chips.'); dl.won ? sfx.coin?.() : sfx.wrong?.(); }
      else { this.notes.push('Deal done.'); sfx.coin?.(); }
    }
    // Hexes earned by a streak or by puzzles: a reveal, shown only to the player who earned it.
    const ea = s.lastEarn;
    if (this.seenEarnSeq === undefined) { this.seenEarnSeq = ea?.seq ?? 0; return; }
    if (ea && ea.seq > this.seenEarnSeq) {
      this.seenEarnSeq = ea.seq;
      if (!this.net || this.myIds.includes(ea.playerId)) {
        const who = s.players.find((x) => x.playerId === ea.playerId)?.name;
        const show = () => cardReveal(ea.hexId, { title: ea.from === 'puzzles' ? 'Prank earned' : ea.from === 'fight' ? `Spoils: ${HEXES[ea.hexId].rarity} hex` : ea.from === 'deal' ? 'A stranger\'s hex' : `Streak! ${HEXES[ea.hexId].rarity} hex`, sub: `${this.net || !this.passPhone ? '' : `${who}: `}Added to your hand. Play it before a stake${this.net ? ', or prank the answerer while you wait' : ''}.` });
        if (this.passPhone) {
          // One shared phone: never show a hex to the next player. It is revealed when its owner's turn comes back.
          (this.earnQueue ??= {})[ea.playerId] = [...((this.earnQueue ??= {})[ea.playerId] ?? []), show];
          this.notes.push(`${who} earned a hex! They see it on their next turn.`);
        } else setTimeout(() => { if (!this.disposed) show(); }, 350);
      }
    }
  }

  /* ------------------------------------------------------------ hexes */

  /** Next streak that earns a hex, with its rarity. */
  nextStreakTier(streak) {
    let n = streak + 1;
    while (!tierForStreak(n)) n += 1;
    return { at: n, rarity: tierForStreak(n) };
  }

  /** The player's hex hand: tap a hex to play it. `where` is 'stake', 'question' or 'waiting'. */
  hexBar(where) {
    const s = this.s;
    if (!s.config.cardsEnabled) return null;
    const me = this.net ? this.myPlayer : this.turnPlayer;
    if (!me || me.defeated) return null;
    const turn = this.turnPlayer;
    const myTurn = me.playerId === turn.playerId;
    const next = this.nextStreakTier(me.streak);
    const hand = me.hexHand ?? [];
    const full = hand.length >= HEX_NUMBERS.handMax;
    const usedThisQ = s.q?.hexBy?.includes(me.playerId);
    const chips = hand.map((id, i) => {
      const hx = HEXES[id];
      let why = null;
      if (usedThisQ) why = 'One per question';
      else if (hx.kind === 'defense') why = me.shield ? 'Shield is up' : null;
      else if (hx.versusOnly && s.mode !== 'versus') why = 'Versus only';
      else if (myTurn && s.phase !== 'stake') why = 'Before staking';
      else if (!myTurn && s.mode !== 'versus') why = 'Versus only';
      return h('button.card-mini.hex-chip', { type: 'button', class: hx.rarity, disabled: Boolean(why), title: `${hx.text} ${hx.drawback}`, onclick: () => this.useHex(id, i) },
        sprite(hx.icon, 28), h('span', {}, hx.name, h('small', {}, why ?? (hx.kind === 'defense' ? 'Shield' : !myTurn ? `Prank ${turn.name}` : hx.targets === 'rival' ? 'On a rival' : 'You or a rival'))));
    });
    return h('div.col.gap-s.hexbar', {},
      h('div.row.between', {}, h('div.tiny.dim', {}, where === 'waiting' ? 'Your hexes · prank the player answering' : 'Your hexes'), h('span.tiny.mute', {}, full ? 'Hand full' : `Streak ${me.streak} · next hex at ${next.at}`)),
      me.shield ? h('p.tiny.green', {}, `Shield up: ${me.shield === 'mirror' ? 'Mirror' : me.shield === 'cloth' ? 'Wet Cloth' : 'Sponge'}. It catches the next hex played on you.`) : null,
      chips.length ? h('div.cards-bar', {}, chips) : h('p.tiny.mute', {}, `No hex yet. Streak of ${next.at} earns a ${next.rarity} one, drawn from your hex deck.${where === 'waiting' && s.mode === 'versus' ? ' Solving puzzles fills a prank meter too.' : ''}`),
    );
  }

  async useHex(id) {
    const s = this.s;
    const hex = HEXES[id];
    const me = this.net ? this.myPlayer : this.turnPlayer;
    const turn = this.turnPlayer;
    unlockAudio();
    let targetId;
    if (hex.kind !== 'defense') {
      if (me.playerId !== turn.playerId) targetId = turn.playerId;
      else {
        const options = [];
        if (hex.targets !== 'rival') options.push({ playerId: me.playerId, label: 'Yourself', note: 'A dare: +20% if you still answer right' });
        if (s.mode === 'versus') for (const r of s.players) if (r.playerId !== me.playerId) options.push({ playerId: r.playerId, label: r.name, note: hex.steal ? '' : '−15% on their win' });
        if (!options.length) return toast('No valid target');
        targetId = options[0].playerId;
        if (options.length > 1) {
          targetId = await modal((close) => [
            h('h2', {}, hex.name), h('p', {}, hex.text), h('p.small.dim', {}, `Drawback: ${hex.drawback}`),
            h('div.col.gap-s', {}, options.map((o) => h('button.pick', { type: 'button', onclick: () => close(o.playerId) }, avatar(this.profileOf(o.playerId), 32), h('span.name.profile-row', { style: { fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 800, textTransform: 'uppercase' } }, o.label), o.note ? h('span.tiny.dim', {}, o.note) : null))),
            h('button.btn.ghost.block', { type: 'button', onclick: () => close(undefined) }, 'Cancel'),
          ]);
          if (!targetId) return;
        }
      }
    }
    if (this.act({ type: 'USE_HEX', playerId: me.playerId, hexId: id, targetId })) {
      const hx = this.s.lastHex;
      if (hex.kind === 'defense') sfx.shield?.(); else if (hx?.stolen) { sfx.steal?.(); floatText?.(`+${hx.stolen}`); } else sfx.splat?.();
      rarityFx(hex.rarity);
      haptic('big');
      if (!this.net) {
        const tn = this.s.players.find((x) => x.playerId === (hx?.at ?? targetId))?.name;
        toast(hex.kind === 'defense' ? `${hex.name} is up` : `${hex.name} on ${tn}${hx?.stolen ? ` · took ${hx.stolen} chips` : ''}${hx?.blocked ? ' · blocked!' : ''}`);
      }
    }
  }

  /** The three missions of this game: each one finished is a free Bronze Pack at the end. */
  missionsPanel(p) {
    const list = evaluateMissions(this.s, p.playerId, p.missions ?? []);
    if (!list.length) return null;
    return h('div.panel.tight', {},
      h('div.row.between', {}, h('h3', {}, 'Missions'), h('span.tiny.dim', {}, 'each = 1 free pack')),
      ...list.map((m) => h('div.kv', {}, h('span', {}, `${m.done ? '✔' : '○'} ${m.text}`), h('b', { class: m.done ? 'green' : 'dim' }, m.done ? 'done' : ''))));
  }

  /** Hex deck editor shown with the loadout: four hexes per game, drawn when you earn streaks. */
  hexDeckSection(p) {
    const s = this.s;
    const owned = usableHexes(p.hexOwned ?? [], s.mode);
    const rest = owned.filter((id) => !p.hexDeck.includes(id));
    const mine = !this.net || this.myIds.includes(p.playerId);
    const set = (deck) => {
      this.act({ type: 'SET_HEXDECK', playerId: p.playerId, deck }, { silent: false });
      if (mine) this.app.repo.setHexDeck(p.playerId, deck).catch(() => {});
    };
    return [
      h('div.row.between', {}, h('h3', {}, 'Hex deck'), h('span.tiny.dim', {}, `${p.hexDeck.length}/${HEX_NUMBERS.deckSize} · earned by streaks`)),
      h('p.tiny.dim', {}, 'Streak 2 earns a common hex, 4 an uncommon, 6 a rare, 8 a legendary, drawn from this deck. Tap to swap.'),
      h('div.reward-grid', {}, p.hexDeck.map((id) => cardTile(id, { selected: true, compact: true, onclick: () => set(p.hexDeck.filter((x) => x !== id)) }))),
      rest.length ? h('div.reward-grid', {}, rest.map((id) => cardTile(id, { compact: true, onclick: () => (p.hexDeck.length >= HEX_NUMBERS.deckSize ? toast('The deck is full. Tap a deck hex to remove it.') : set([...p.hexDeck, id])) }))) : null,
    ];
  }

  setMoodForState() {
    const s = this.s;
    if (s.phase === 'finished') return setMood(s.players.some((p) => p.result === 'won') ? 'win' : 'out');
    if (s.enc && ['map', 'rest', 'event', 'shop'].includes(s.phase)) return setMood('calm');
    if (s.enc && s.round) {
      if (s.enc.kind !== 'minion' && s.enc.hp <= s.enc.maxHp * DUEL.enrageAt) return setMood('boss');
      if (s.players.some((p) => p.strikes <= 1 && !p.defeated)) return setMood('danger');
      return setMood(s.enc.kind === 'minion' ? 'tense' : 'boss');
    }
    if (s.round?.isBoss) return setMood('boss');
    if (s.config.strikes && s.players.some((p) => p.strikes === 1 && !p.defeated)) return setMood('danger');
    if (s.round && s.round.hazardId !== 'none') return setMood('tense');
    setMood('calm');
  }

  roundTitle() {
    const s = this.s;
    if (s.enc) return s.config.variant === 'rush' ? `Boss Rush · ${s.enc.name}` : `${s.enc.kind === 'minion' ? 'Fight' : s.enc.kind === 'elite' ? 'Champion' : s.enc.kind === 'final' ? 'The last room' : 'Boss'} · ${s.enc.name}`;
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
      s.config.strikes && !(s.enc && ['stake', 'question', 'reveal'].includes(s.phase)) ? h('span.bulbs', { style: { marginLeft: 'auto' } }, bulbs(p.strikes, DUEL.startLives)) : h('span', { style: { marginLeft: 'auto' } }),
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

  waitGameEl() {
    if (!this.net || !this.myPlayerId) return null;
    if (!this.myPlayer?.puzzle) return null; // the host runs an older version without puzzles
    if (!this.waitGame) this.waitGame = new WaitGame({ getState: () => this.s, myId: this.myPlayerId, lang: this.langOf(this.myPlayerId), act: (a) => this.act(a, { silent: true }) });
    this.waitGame.refresh();
    return this.waitGame.el;
  }

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
        h('p.dim', {}, member && !member.connected ? 'lost connection… waiting for them to come back (the game moves on after a minute)' : `${doing}…`),
        h('div.tiny.mute', {}, 'The question stays hidden until everyone has answered.'),
      ),
      this.hexBar('waiting'),
      this.waitGameEl(),
      h('div.standings', {}, [...s.players].sort((a, b) => b.chips + b.vault - (a.chips + a.vault)).map((pl) => h('div.panel.tight.row', { class: pl.playerId === p.playerId ? 'now' : '' }, avatar(this.profileOf(pl.playerId), 16), h('b.grow', {}, pl.name), h('span.pill', {}, sprite('chip', 16), pl.chips)))),
    ];
  }

  /* ---------------------------------------------------------- loadout */

  viewLoadout() {
    const s = this.s;
    const round = s.round;
    const boss = round.bossId ? BOSSES[round.bossId] : null;
    const hazard = HAZARDS[round.hazardId];
    const cats = s.enc ? [] : roundCategories(round, this.ctx.byId);
    const tab = this.net ? s.players.indexOf(this.myPlayer) : Math.min(this.loadoutTab, s.players.length - 1);
    const p = s.players[tab];
    const owned = equippableCards(p.owned, s.mode);
    const locked = !s.config.cardsEnabled || Boolean(boss?.cardsLocked);
    const duel = Boolean(s.enc);
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
      duel ? this.enemyCard(p) : h('div.panel.banner', { class: boss ? 'boss' : '' },
        h('div.tiny.dim', {}, this.roundTitle()),
        h('h3', {}, boss ? boss.name : hazard.name),
        h('p.small', {}, boss ? boss.text : hazard.text),
        boss && round.hazardId !== 'none' ? h('p.small', {}, hazard.text) : null,
      ),
      duel ? null : h('div.row.wrap', { style: { justifyContent: 'center', gap: '6px' } }, [...new Set(cats)].map((c) => categoryTag(c))),
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
        : h('p.small.dim.center', {}, 'No bonus cards or hexes in the Daily, so everyone plays the same game.'),
      s.config.cardsEnabled ? this.hexDeckSection(p) : null,
      s.config.cardsEnabled ? this.missionsPanel(p) : null,
      this.net && !this.net.isHost
        ? h('div.stick-bottom', {}, h('p.small.dim.center', {}, 'Equip your cards. The host starts the round.'))
        : h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { unlockAudio(); sfx.stake(); if (round.isBoss) sfx.boss(); this.gateKey = null; this.act({ type: 'START_ROUND' }); if (round.isBoss || round.hazardId === 'cold_table') lightsOn({ sound: false }); } }, duel ? (s.enc.kind === 'minion' ? 'Start the fight' : `Face ${s.enc.name}`) : round.isBoss ? 'Face the boss' : 'Start round')),
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
    const queued = this.earnQueue?.[p.playerId];
    if (queued?.length) { this.earnQueue[p.playerId] = []; setTimeout(() => queued.forEach((f) => f()), 250); }
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
      s.enc ? stageFor(s, p, { compact: true }).el : this.slotDots(),
      h('div.cat-line', {}, categoryIcon(view.category, 20), CATEGORIES[view.category]?.label ?? view.category, h('span', { style: { marginLeft: 'auto' } }, diffPips(view.difficulty))),
      this.questionCard(view, { hidden: view.text == null, tune: view.type === 'tune' }),
      this.cardsBar('pre-stake'),
      this.hexBar('stake'),
      h('div.row.between', {}, h('h3', {}, boss?.lockStake ? 'Stake locked' : 'Choose your stake'), h('span.tiny.dim', {}, `${p.chips} chips`)),
      s.enc ? h('div.heat-bar-line', {}, h('span.small', {}, `Heat ${p.heat}: a ×2 stake burns 1, a ×3 burns 2. Fast answers and streaks refund it.`)) : null,
      p.chips <= 0 ? h('p.small.green', {}, 'You are out of chips, so this one is played for free. A correct answer still pays.') : null,
      h('div.stakes', {}, options.map((o) => h('button.stake', {
        type: 'button', 'aria-pressed': String(o.stake === this.stakeSel), disabled: options.length === 1 || Boolean(o.locked), class: o.locked ? 'locked' : '',
        onclick: () => { this.stakeSel = o.stake; sfx.select(); this.render(); },
      },
      h('span.mult', {}, `${o.stake}×`),
      h('span.nums', {}, h('span.w', {}, `Win +${o.win}`), h('span.l', {}, `Lose −${o.lose}`)),
      s.enc
        ? h('span.note', {}, h('span.dmg', {}, `Hit ${o.dmg}${o.dmgFast > o.dmg ? `–${o.dmgFast} fast` : ''}`), ' · ', h('span.heat-cost', {}, o.heatCost ? `Heat −${o.heatCost}${o.locked ? ' (not enough)' : ''}` : 'Free'), o.broke ? ' · free play' : ` · risk ${Math.min(p.chips, o.stake * RULES.baseWager)} chips`)
        : h('span.note', {}, o.broke ? 'Free play' : `Risk ${Math.min(p.chips, o.stake * RULES.baseWager)} chips · up to +${o.winFast} if you answer in the first ${Math.round(RULES.speedThreshold * 100)}% of the clock`),
      ))),
      qp.usedCards.length ? h('p.tiny.amber', {}, `Armed: ${qp.usedCards.map((c) => CARDS[c].name).join(', ')}`) : null,
      h('div.stick-bottom', {}, h('button.btn.primary.block', {
        type: 'button', disabled: !sel || Boolean(sel.locked),
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
      else if (id === 'skeleton_key' && (boss || (s.enc && s.enc.kind !== 'minion'))) why = 'Not vs bosses';
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
      rarityFx(c.rarity);
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
    const hexKey = `${s.roundIndex}:${s.qIndex}:${p.playerId}:${qp.startedAt}`;
    const hexes = view.hexes ?? [];
    if (this.hexShown !== hexKey) { this.hexShown = hexKey; this.hexSplashed = new Set(); }
    const freshFx = hexes.filter((e) => !this.hexSplashed.has(e));
    if (freshFx.length) { freshFx.forEach((e) => this.hexSplashed.add(e)); splash(freshFx); }

    return [
      this.hud(p),
      h('div.row.between', {}, h('span.tiny.dim', {}, this.roundTitle()), s.round.markedSlot === s.qIndex ? h('span.tag.amber', {}, '★ Marked question') : null),
      s.enc ? stageFor(s, p, { compact: true, showPattern: false }).el : this.slotDots(),
      h('div.cat-line', {}, categoryIcon(view.category, 20), CATEGORIES[view.category]?.label ?? view.category, h('span', { style: { marginLeft: 'auto' } }, diffPips(view.difficulty))),
      hexes.length ? h('p.tiny.amber.center.hex-tag', {}, `Hexed: ${hexes.join(', ')}`) : null,
      h('div', { class: hexes.includes('flip') ? 'hex-flip' : '' }, this.questionCard(view, { tune: view.type === 'tune', dir: view.translated ? (languageOf(this.langOf(p.playerId)).rtl ? 'rtl' : null) : null })),
      this.langOf(p.playerId) !== 'en' && !view.translated && view.type !== 'tune' ? h('p.tiny.amber.center', {}, `No ${languageOf(this.langOf(p.playerId)).name} translation was available, so this one is in English.`) : null,
      h('div.row', {}, h('div.grow', {}, timerBar), timerText),
      view.retry ? h('p.small.amber.center.pop', {}, 'Rewind! One wrong option is gone. Try again.') : null,
      view.ghostLetter ? h('p.small.amber.center', {}, `Ghost Note: the answer starts with “${view.ghostLetter}”`) : null,
      this.choicesBox(hexes, h('div.choices', { class: isTf ? 'grid2' : '', dir: view.translated && languageOf(this.langOf(p.playerId)).rtl ? 'rtl' : null }, choiceEls)),
      this.cardsBar('question'),
      this.hexBar('question'),
    ];
  }

  choicesBox(hexes, el) {
    if (hexes.includes('flip')) el.classList.add('hex-flip');
    if (hexes.includes('blur') && this.blurClearedKey !== this.hexShown) {
      el.classList.add('hex-blur');
      unblurOnFirstTap(el);
      el.addEventListener('click', () => { this.blurClearedKey = this.hexShown; }, { once: true });
    }
    return el;
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
      if (!rec.duel) shake(this.root);
      haptic(rec.outcome === 'timeout' ? 'timeout' : 'wrong');
      if ((rec.stake ?? 1) >= 3) { sfx.sadTrombone(); stamp('OUCH!', { kind: 'bad' }); }
      else if (rec.outcome !== 'timeout') sfx.boing();
    }
    floatText(`${rec.delta > 0 ? '+' : rec.delta < 0 ? '−' : ''}${Math.abs(rec.delta)}`, rec.delta >= 0 ? 'up' : 'down');
    if (rec.strikeLost && !rec.duel) blackout();
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
    const banner = s.enc && r0.duel ? this.duelBanner(r0) : solo
      ? h('div.panel.reveal-banner.pop', { class: r0.correct ? 'good' : 'bad', role: 'status' },
          h('h2', {}, r0.correct ? 'Correct' : r0.outcome === 'timeout' ? "Time's up" : 'Wrong'),
          h('p.small.dim', {}, `${r0.delta >= 0 ? 'Won' : 'Lost'} ${Math.abs(r0.delta)} chips${r0.streakAfter > 1 ? ` · streak ${r0.streakAfter}` : ''}${r0.usedCards.length ? ` · ${r0.usedCards.map((c) => CARDS[c].name).join(', ')}` : ''}`),
        )
      : h('div.panel.tight', {}, s.players.map(resultLine));

    const audio = v.audio;
    return [
      this.hud(solo ? s.players[0] : this.turnPlayer),
      s.enc && r0.duel ? this.revealStage(r0, key) : null,
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
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { stopClip(); sfx.tap(); this.act({ type: 'NEXT' }); } }, s.enc ? (s.enc.over ? (s.enc.over === 'won' ? 'Claim the win' : 'Continue') : 'Next question') : last ? 'Round results' : 'Next question')),
    ];
  }

  recapChoices(v, r) {
    return h('div.choices', {}, v.choices.map((c) => h('div.choice', { class: `${c.correct ? 'right' : r.choice === c.display ? 'wrong' : ''} ${c.hidden ? 'removed' : ''}`, style: { cursor: 'default' } }, v.type === 'tf' ? null : h('span.key', {}, LETTERS[c.display]), c.text)));
  }

  /* ---------------------------------------------------------- summary */

  viewSummary() {
    const s = this.s;
    if (s.enc) return this.duelSummary();
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
    const act = s.config.duel ? `n${s.map?.at ?? 0}` : s.round.act;
    const buy = (item) => { if (this.act({ type: 'BUY', playerId: p.playerId, item })) sfx.coin(); };
    const state = (id) => {
      const it = SHOP_ITEMS[id] ?? DUEL_SHOP_ITEMS[id];
      if (p.chips < it.cost) return 'Not enough chips';
      if (id === 'spare_bulb') return p.strikes >= RULES.maxStrikes ? 'Bulbs full' : p.shopBought[`bulb${act}`] ? 'Bought this act' : null;
      if (id === 'spare_battery') return p.bonusCharges ? 'Already bought' : null;
      if (id === 'slow_clock') return p.slowClock ? 'Already bought' : null;
      if (id === 'ice_pack') return p.shopBought[`ice${act}`] ? 'Bought here' : null;
      if (id === 'whetstone') return (p.edge ?? 0) >= 2 ? 'Sharp enough' : null;
      return null;
    };
    return [
      this.hud(p, {}),
      h('div.panel.banner', {}, h('div.tiny.dim', {}, 'The shop'), h('h2', {}, 'Spend or save')),
      ...[...Object.values(SHOP_ITEMS), ...(s.config.duel ? Object.values(DUEL_SHOP_ITEMS) : [])].map((it) => {
        const why = state(it.id);
        return h('div.panel.shop-item', {}, sprite(it.id === 'spare_bulb' ? 'bulb_on' : it.id === 'spare_battery' ? 'key' : it.id === 'ice_pack' ? 'blur' : it.id === 'whetstone' ? 'swords' : 'hourglass', 40), h('div.grow', {}, h('b', {}, it.name), h('p.small.dim', { style: { margin: 0 } }, it.text)), h('button.btn.small', { class: why ? '' : 'primary', type: 'button', disabled: Boolean(why), onclick: () => buy(it.id) }, why ?? it.cost));
      }),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { sfx.tap(); this.act({ type: 'LEAVE_SHOP' }); } }, s.config.duel ? 'Back to the map' : 'Next round')),
    ];
  }

  /* ------------------------------------------------------------ duels */

  /** The enemy before the fight: portrait, health, what it does and what it pays. */
  enemyCard(p) {
    const enc = this.s.enc;
    const roster = BOSS_ROSTER[enc.id];
    const heat = startHeat(enc.kind, p.heatBonus ?? 0);
    const uniq = (list) => [...new Set(list ?? [])];
    const moveRow = (id) => { const it = INTENTS[id]; return h('div.row', { style: { gap: '8px', alignItems: 'flex-start' } }, sprite(it.icon, 24), h('div', {}, h('b.small', {}, it.label), h('div.tiny.dim', {}, it.text))); };
    const rw = DUEL.rewards[enc.kind] ?? DUEL.rewards.minion;
    const extra = uniq(enc.enraged).filter((id) => !enc.intents.includes(id));
    return h('div.panel.enemy-card', {},
      h('div.tiny.dim', {}, this.roundTitle()),
      createStage({ enc, hp: enc.hp, lives: p.strikes, heat, showPattern: false }).el,
      h('p.small', {}, roster?.blurb ?? 'A rival with a point to prove.'),
      h('div.row.wrap', { style: { gap: '6px' } }, enc.cat !== 'any' ? categoryTag(enc.cat) : h('span.tag', {}, 'Every subject'), h('span.tag', {}, `Health ${enc.maxHp}`), h('span.tag.amber', {}, `Heat ${heat}`)),
      enc.kind === 'minion'
        ? h('p.small.dim', {}, `Three misses and ${enc.name.split(',')[0]} beats you: you lose one bulb and the run goes on. A right answer hits for 1 to 3.`)
        : [h('div.tiny.dim', {}, 'What it does'), h('div.pattern-list', {}, uniq(enc.intents).map(moveRow)), extra.length ? [h('div.tiny.red', {}, 'When hurt (under 40% health) it also uses'), h('div.pattern-list', {}, extra.map(moveRow))] : null],
      h('p.tiny.dim', {}, `Win: ${rw.chips} chips${rw.hex ? ', an uncommon hex' : ''}${rw.heal ? ', and a bulb back' : ''}. ${enc.kind === 'minion' ? '' : 'A wrong answer costs a bulb. Run out and the run is over.'}`),
    );
  }

  duelBanner(r) {
    const d = r.duel;
    const enc = this.s.enc;
    const bits = [];
    if (r.correct) {
      if (d.crit) bits.push('fast');
      if (d.streakHit || d.streak) bits.push('streak');
      if (d.curseThrough) bits.push('through the curse');
      if (d.guarded) bits.push('half: armor held');
      return h('div.panel.reveal-banner.pop.good', { role: 'status' },
        h('h2', {}, d.guarded ? 'Blocked, half damage' : d.crit ? 'Critical hit!' : 'Hit!'),
        h('p.small.dim', {}, `−${d.dmg} to ${enc.name.split(',')[0]}${bits.length ? ` · ${bits.join(' · ')}` : ''} · ${chipsText(r.delta)}${r.streakAfter > 1 ? ` · streak ${r.streakAfter}` : ''}`),
        d.heatGain ? h('p.tiny.amber', {}, `+${d.heatGain} heat back`) : null,
      );
    }
    const lines = [];
    if (d.bulbsLost) lines.push(d.bulbsLost > 1 ? `Two bulbs crack.` : 'A bulb cracks.');
    else if (enc.kind === 'minion') lines.push(`Miss ${d.misses} of ${DUEL.minionMisses}.`);
    if (d.heal) lines.push(`It heals ${d.heal}.`);
    if (d.leech) lines.push(`It takes ${d.leech} chips.`);
    return h('div.panel.reveal-banner.pop.bad', { role: 'status' },
      h('h2', {}, r.outcome === 'timeout' ? "Time's up" : 'Wrong'),
      h('p.small.dim', {}, `${lines.join(' ')} ${chipsText(r.delta)}`),
    );
  }

  /** The stage on the reveal screen: it shows the health before the answer, then plays what happened. */
  revealStage(r, key) {
    const s = this.s;
    const p = s.players[0];
    const d = r.duel;
    const enc = s.enc;
    const played = this.stagePlayed === key;
    const hp = played ? d.hpAfter : d.hpBefore;
    const livesAfter = p.strikes;
    const livesBefore = livesAfter + d.bulbsLost;
    const enraged = Boolean(enc.enraged) && hp > 0 && hp <= enc.maxHp * DUEL.enrageAt;
    const missesBefore = enc.kind === 'minion' ? d.misses - (r.correct ? 0 : 1) : 0;
    const stage = createStage({ enc, hp, lives: played ? livesAfter : livesBefore, heat: p.heat ?? 0, qIndex: s.qIndex, intent: null, enraged, misses: played ? d.misses : missesBefore, showPattern: false });
    if (played && d.over === 'won') stage.boss.classList.add('gone');
    if (!played) this.pendingPlay = { stage, d, key, ctx: { livesBefore, livesAfter, heatAfter: p.heat ?? 0 } };
    return stage.el;
  }

  runStagePlay() {
    const pp = this.pendingPlay;
    if (!pp) return;
    this.pendingPlay = null;
    this.stagePlayed = pp.key;
    setTimeout(() => { if (!this.disposed) pp.stage.play(pp.d, pp.ctx); }, 140);
  }

  duelSummary() {
    const s = this.s;
    const p = s.players[0];
    const enc = s.enc;
    const last = s.roundLog[s.roundLog.length - 1];
    const r = last.players[p.playerId];
    const won = last.result === 'won';
    const big = enc.kind !== 'minion';
    if (this.summaryKey !== s.roundIndex) {
      this.summaryKey = s.roundIndex;
      if (won) { sfx.win(); haptic('big'); confetti({ count: big ? 90 : 40 }); if (big) { sfx.jackpot(); stamp(enc.kind === 'elite' ? 'CHAMPION DOWN!' : 'BOSS DOWN!', { kind: 'jackpot' }); } }
      else { sfx.wrong(); haptic('warn'); blackout(); }
    }
    const stage = createStage({ enc, hp: enc.hp, lives: p.strikes, heat: p.heat ?? 0, showPattern: false, misses: enc.misses ?? 0 });
    if (won) stage.boss.classList.add('gone');
    const hexName = r.hex ? HEXES[r.hex]?.name : null;
    const finalFight = s.config.variant === 'rush' || enc.kind === 'final';
    return [
      this.hud(p, {}),
      h('div.panel.banner', { class: won ? '' : 'boss' }, h('div.tiny.dim', {}, this.roundTitle()), h('h2', {}, won ? (enc.kind === 'minion' ? `${enc.name.split(',')[0]} is beaten` : `${enc.name} is down`) : last.result === 'beaten' ? `${enc.name.split(',')[0]} got you this time` : 'The lights go out')),
      stage.el,
      h('div.panel', {},
        h('div.kv', {}, h('span', {}, 'Questions'), h('b', {}, enc.qCount)),
        h('div.kv', {}, h('span', {}, 'Hits landed'), h('b', {}, enc.hits)),
        won ? h('div.kv', {}, h('span', {}, 'Reward'), h('b.amber', {}, `+${r.bonus} chips`)) : null,
        r.healed ? h('p.small.green', {}, 'A bulb comes back on.') : null,
        hexName ? h('p.small.amber', {}, `Spoils: ${hexName} added to your hex hand.`) : null,
        last.result === 'beaten' ? h('p.small.red', {}, 'You lose a bulb. The run goes on.') : null,
        p.defeated ? h('p.small.red', {}, 'Out of bulbs. The run ends here.') : null,
        h('div.row', {}, chipsLine(p.chips), bulbs(p.strikes, DUEL.startLives)),
      ),
      h('div.stick-bottom', {}, h('button.btn.primary.block', { type: 'button', onclick: () => { sfx.tap(); this.act({ type: 'CONTINUE' }); } }, p.defeated || (finalFight && won) ? 'See results' : finalFight ? 'See results' : 'Back to the map')),
    ];
  }

  /* -------------------------------------------------------------- map */

  viewMap() {
    const s = this.s;
    const p = s.players[0];
    const map = s.map;
    const avail = availableNodes(map);
    const isAvail = (l, i) => avail.some((n) => n.layer === l && n.index === i);
    const total = map.layers.length;
    const ROW = 96;
    const pos = (l, i) => ({ x: ((i + 1) / (map.layers[l].length + 1)) * 100, y: (total - 1 - l) * ROW + ROW / 2 });
    if (this.mapKey !== map.at) { this.mapKey = map.at; this.mapSel = null; }
    const sel = this.mapSel && isAvail(this.mapSel.layer, this.mapSel.index) ? this.mapSel : null;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 100 ${total * ROW}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'map-lines');
    map.layers.forEach((layer, l) => layer.forEach((node, i) => node.next.forEach((j) => {
      const a = pos(l, i); const b = pos(l + 1, j);
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      const walked = map.trail[l] === i && map.trail[l + 1] === j;
      const live = map.at === l - 0 && map.pick === i && l === map.at;
      const fromStart = map.at < 0 && l === 0;
      line.setAttribute('class', walked ? 'walked' : live ? 'live' : fromStart ? 'live' : '');
      svg.append(line);
    })));

    const nodes = map.layers.flatMap((layer, l) => layer.map((node, i) => {
      const k = NODE_KINDS[node.kind];
      const here = map.trail[l] === i && l <= map.at;
      const done = l < map.at ? map.trail[l] === i : l === map.at && map.trail[l] === i;
      const can = isAvail(l, i);
      const { x, y } = pos(l, i);
      const icon = node.kind === 'final' ? 'crown' : k.icon;
      const b = h('button.map-node', {
        type: 'button', class: `${node.kind} ${can ? 'avail' : ''} ${done ? 'done' : ''} ${sel && sel.layer === l && sel.index === i ? 'sel' : ''} ${here && l === map.at ? 'here' : ''}`,
        disabled: !can, 'aria-label': `${k.label}${can ? ', reachable' : ''}`, title: k.text,
        onclick: () => { this.mapSel = { layer: l, index: i }; sfx.node?.(); this.render(); },
      }, sprite(icon, 36));
      b.style.left = `${x}%`;
      b.style.top = `${y}px`;
      return b;
    }));

    const selNode = sel ? map.layers[sel.layer][sel.index] : null;
    const go = () => { sfx.select(); this.act({ type: 'MAP_PICK', layer: sel.layer, index: sel.index }); };
    return [
      this.hud(p),
      h('div.panel.banner', {}, h('div.tiny.dim', {}, 'The map'), h('h2', {}, map.at < 0 ? 'Choose your first fight' : map.at === total - 2 ? 'The House is waiting' : 'Choose your next room'), h('p.small.dim', {}, 'Climb to the top. Every room is a choice: fights pay chips, champions pay hexes, rests and deals shape the run.')),
      h('div.map-wrap', { style: { height: `${total * ROW}px` } }, svg, nodes),
      h('div.row.wrap', { style: { gap: '6px', justifyContent: 'center' } }, Object.entries({ fight: 'Contestant', elite: 'Champion', boss: 'Boss', shop: 'Shop', rest: 'Rest', event: 'Deal' }).map(([k, label]) => h('span.tag', {}, sprite(NODE_KINDS[k].icon, 16), label))),
      p.hexHand?.length ? h('p.tiny.dim.center', {}, `Hex hand: ${p.hexHand.map((id) => HEXES[id].name).join(', ')}`) : null,
      h('div.stick-bottom', {}, selNode
        ? h('div.col.gap-s', {}, h('div.panel.tight', {}, h('b', {}, NODE_KINDS[selNode.kind].label), h('div.small.dim', {}, NODE_KINDS[selNode.kind].text)), h('button.btn.primary.block', { type: 'button', onclick: go }, selNode.kind === 'fight' || selNode.kind === 'elite' || selNode.kind === 'boss' || selNode.kind === 'final' ? 'Enter the fight' : 'Go in'))
        : h('p.small.dim.center', {}, 'Tap a glowing room.')),
    ];
  }

  viewRest() {
    const s = this.s;
    const p = s.players[0];
    const full = p.strikes >= DUEL.maxLives;
    const pick = (choice) => { if (this.act({ type: 'REST', choice })) { sfx.rest?.(); if (choice === 'heal') { sfx.heal?.(); this.notes.push('A bulb flickers back on.'); } else this.notes.push(`+${DUEL.restChips} chips and +1 heat for the next fight.`); } };
    return [
      this.hud(p, {}),
      h('div.panel.banner', {}, h('div.tiny.dim', {}, 'Rest'), h('h2', {}, 'A quiet room'), h('p.small.dim', {}, 'A chair, a kettle, a dead telephone. You get one thing.')),
      h('div.col', {},
        h('button.crossroads-opt', { type: 'button', disabled: full, onclick: () => pick('heal') }, sprite('bulb_on', 48), h('div', {}, h('b', {}, full ? 'Bulbs are full' : 'Heal a bulb'), h('span.small.dim', {}, 'Screw a fresh bulb in. You have ' + p.strikes + ' of ' + DUEL.maxLives + '.'))),
        h('button.crossroads-opt', { type: 'button', onclick: () => pick('train') }, sprite('flame', 48), h('div', {}, h('b', {}, 'Train'), h('span.small.dim', {}, `+${DUEL.restChips} chips now and +1 heat in the next fight.`))),
      ),
    ];
  }

  viewEvent() {
    const s = this.s;
    const p = s.players[0];
    const pick = (choice) => { sfx.select(); this.act({ type: 'EVENT', choice }); };
    return [
      this.hud(p, {}),
      h('div.panel.banner', {}, h('div.tiny.dim', {}, 'A deal'), h('h2', {}, 'A stranger in the doorway'), h('p.small.dim', {}, 'Two offers. One handshake. Or you can walk away.')),
      h('div.col', {},
        s.event.deals.map((id) => { const d = DEALS[id]; const ok = d.ok(p); return h('button.crossroads-opt', { type: 'button', disabled: !ok, onclick: () => pick(id) }, sprite(id === 'gamble' ? 'dice' : id === 'sell_bulb' || id === 'buy_bulb' ? 'bulb_on' : id === 'free_hex' ? 'key' : id === 'sharpen' ? 'swords' : 'flame', 48), h('div', {}, h('b', {}, d.text), h('span.small.dim', {}, ok ? d.detail : `${d.detail} (you cannot right now)`))); }),
        h('button.btn.ghost.block', { type: 'button', onclick: () => pick('walk') }, 'Walk away'),
      ),
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
    const title = !done ? 'Game abandoned' : s.config.duel ? (s.players[0].result === 'won' ? (s.config.variant === 'rush' ? `${s.enc.name} falls` : 'You beat the House') : 'The lights go out') : solo ? (s.players[0].result === 'won' ? 'You beat the house' : 'The house wins') : 'Final standings';
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
            h('div.kv', {}, h('span', {}, s.config.duel ? 'Fights won' : 'Rounds cleared'), h('b', {}, p.roundsCleared)),
            h('div.kv', {}, h('span', {}, s.config.duel ? 'Bosses and champions beaten' : 'Bosses cleared'), h('b', {}, p.bossesCleared)),
            s.config.duel ? h('div.kv', {}, h('span', {}, 'Bulbs left'), h('b', {}, p.strikes)) : h('div.kv', {}, h('span', {}, 'Banked chips'), h('b', {}, p.vault)),
            p.result === 'won' ? h('div.kv', {}, h('span', {}, 'Chips kept'), h('b', {}, p.chips)) : h('div.kv', {}, h('span', {}, 'Chips lost with the run'), h('b', {}, p.chips)),
          ] : null,
          !solo && done ? h('div.kv', {}, h('span', {}, 'Chips'), h('b', {}, p.chips)) : null,
          done && (p.missions ?? []).length ? [h('div.hr'), h('div.tiny.dim', {}, 'Missions'), ...evaluateMissions(s, p.playerId, p.missions).map((m) => h('div.kv', {}, h('span', {}, `${m.done ? '✔' : '✖'} ${m.text}`), h('b', { class: m.done ? 'green' : 'dim' }, m.done ? '+1 pack' : '')))] : null,
          done ? h('div.kv', {}, h('span', {}, 'Packs earned'), h('b', {}, `${packsEarned(s, p.playerId).length + evaluateMissions(s, p.playerId, p.missions ?? []).filter((m) => m.done).length}`)) : null,
        );
      }),
      done ? h('div.panel.good.tight.small', {}, sprite('key', 24), ' New cards are waiting for you. Claim them now or any time from the main menu.') : h('p.small.dim.center', {}, 'Your answers were kept in your statistics.'),
      h('div.stick-bottom.col', {},
        done ? h('button.btn.primary.block', { type: 'button', onclick: () => go('rewards') }, 'Claim cards') : null,
        done ? h('button.btn.block', { type: 'button', onclick: () => go('hexes', { tab: 'packs', playerId: this.net ? this.myPlayerId : s.players[0].playerId }) }, 'Open hex packs') : null,
        h('button.btn.block', { type: 'button', onclick: () => go('setup', { mode: this.label }, { replace: true }) }, 'Play again'),
        h('div.row', {}, h('button.btn.ghost.grow', { type: 'button', onclick: () => go('stats', { playerId: s.players[0].playerId }) }, 'Stats'), h('button.btn.ghost.grow', { type: 'button', onclick: () => go('menu', {}, { replace: true }) }, 'Menu')),
      ),
    ];
  }
}
