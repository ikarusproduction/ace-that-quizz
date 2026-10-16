// Online play, client side. One phone is the HOST: it runs the game engine and is
// the single source of truth. Every other phone is a GUEST: it sends its own
// actions to the host and renders whatever state the host broadcasts back.
// A small relay server (server/relay.js) only forwards messages between phones.
//
// Trust model (be honest about it): the host's phone decides everything, and
// guests could read the answers out of their own copy of the question bank with
// developer tools. This is built for friends in a room, not for tournaments.

const trimSlash = (s) => String(s ?? '').replace(/\/+$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVE_KEY = 'thk-online-session';
const SAVE_TTL = 3 * 3600 * 1000;
const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** A base ending in .php is the PHP relay (poll mode, call as index.php?p=/api/...); anything else is the Node relay. */
export const isPollBase = (base) => /\.php$/i.test(trimSlash(base));
export function apiUrl(base, path, query = {}) {
  const b = trimSlash(base);
  const qs = Object.entries(query).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  if (isPollBase(b)) return `${b}?p=${encodeURIComponent(path)}${qs ? `&${qs}` : ''}`;
  return `${b}${path}${qs ? `?${qs}` : ''}`;
}

export class OnlineSession {
  /**
   * @param {Object} o
   * @param {string} o.base          relay base URL, e.g. https://play.example.com
   * @param {typeof fetch} [o.fetchImpl]
   * @param {typeof EventSource} [o.EventSourceImpl]
   */
  constructor({ base, access = '', fetchImpl, EventSourceImpl } = {}) {
    this.base = trimSlash(base);
    this.access = access;
    this.fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.ES = EventSourceImpl ?? globalThis.EventSource;
    this.listeners = new Map();
    this.role = null;
    this.code = null;
    this.me = null; // { id, token, profileId, name, ... }
    this.hostId = null;
    this.members = [];
    this.locked = false;
    this.rev = 0;
    this.latest = null; // { rev, state } most recent state seen
    this.startInfo = null;
    this.closed = false;
    this.status = 'idle';
    this.infos = new Map(); // memberId -> info sent by that phone (host only)
    this.es = null;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }
  emit(event, data) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  async #post(path, body) {
    let res;
    try {
      res = await this.fetch(apiUrl(this.base, path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    } catch {
      throw new Error('Could not reach the game server. Check the address and your connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `Server error (${res.status})`), { status: res.status });
    return data;
  }

  static async health(base, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    try {
      const res = await fetchImpl(apiUrl(base, '/api/health'), { cache: 'no-store' });
      const j = await res.json();
      return j?.ok === true;
    } catch {
      return false;
    }
  }

  /** Ask the relay whether an access code is right. Resolves { ok, error? }. */
  static async checkAccess(base, access, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    try {
      const res = await fetchImpl(apiUrl(base, '/api/check', { access: access ?? '' }), { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      return res.ok ? { ok: true } : { ok: false, error: j.error ?? `Server error (${res.status})` };
    } catch {
      return { ok: false, error: 'Could not reach the game server.' };
    }
  }
  static async gateInfo(base, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    try {
      const j = await (await fetchImpl(apiUrl(base, '/api/health'), { cache: 'no-store' })).json();
      return j?.ok ? { reachable: true, gated: Boolean(j.gated) } : { reachable: false, gated: false };
    } catch {
      return { reachable: false, gated: false };
    }
  }

  async create(profile) {
    const d = await this.#post('/api/rooms', { ...profileFields(profile), access: this.access });
    this.#adopt('host', d, profile);
    return this;
  }
  async join(code, profile) {
    const c = String(code).trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) throw new Error('Room codes are 4 letters.');
    const d = await this.#post(`/api/rooms/${c}/join`, { ...profileFields(profile), access: this.access });
    this.#adopt('guest', d, profile);
    return this;
  }
  /** Remember this room on the device so a reload or a killed tab can come back to it. */
  #persist() {
    try {
      store()?.setItem(SAVE_KEY, JSON.stringify({ base: this.base, access: this.access, role: this.role, code: this.code, hostId: this.hostId, me: this.me, savedAt: Date.now() }));
    } catch { /* ignore */ }
  }
  static clearSaved() {
    try { store()?.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }
  /** The room this device was in a moment ago, if any (rooms expire after 3 hours). */
  static loadSaved() {
    try {
      const j = JSON.parse(store()?.getItem(SAVE_KEY) ?? 'null');
      if (!j?.code || !j?.me?.token || Date.now() - (j.savedAt ?? 0) > SAVE_TTL) return null;
      return j;
    } catch { return null; }
  }
  /** Rebuild a session from loadSaved(); call open() then ready() to rejoin with the same identity. */
  static fromSaved(saved, opts = {}) {
    const s = new OnlineSession({ base: saved.base, access: saved.access, ...opts });
    s.role = saved.role;
    s.code = saved.code;
    s.hostId = saved.hostId;
    s.me = saved.me;
    return s;
  }
  /** Resolves with the room once the first reply from the server has arrived; rejects if the room is gone. */
  ready(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (this.status === 'online') return resolve(this);
      const off = [];
      const done = (fn, v) => { off.forEach((f) => f()); clearTimeout(t); fn(v); };
      const t = setTimeout(() => done(reject, new Error('Could not reach the room.')), timeoutMs);
      off.push(this.on('members', () => done(resolve, this)), this.on('closed', () => done(reject, new Error('The room is closed.'))));
    });
  }

  #adopt(role, d, profile) {
    this.role = role;
    this.code = d.code;
    this.hostId = d.hostId;
    this.members = d.members ?? [];
    this.me = { id: d.memberId, token: d.token, profileId: profile.id, name: profile.name };
    this.#persist();
  }

  get isHost() {
    return this.role === 'host';
  }
  /** The game-state player id for a member: its profile id (unique per player). */
  playerIdOf(member) {
    return member.profileId || member.id;
  }
  get myPlayerId() {
    return this.me?.profileId || this.me?.id;
  }
  memberByPlayerId(pid) {
    return this.members.find((m) => this.playerIdOf(m) === pid) ?? null;
  }

  #onHello(d) {
    this.members = d.members;
    this.hostId = d.hostId;
    this.locked = d.locked;
    this.status = 'online';
    this.emit('status', this.status);
    this.emit('members', this.members);
    if (d.latest) this.#handle(d.latest);
  }
  #onMembers(d) {
    this.members = d.members;
    this.locked = d.locked;
    this.emit('members', this.members);
  }
  #onClosed() {
    if (this.closed) return;
    this.closed = true;
    this.status = 'closed';
    this.es?.close?.();
    OnlineSession.clearSaved();
    this.emit('closed', { reason: 'The host left, so the room is closed.' });
  }

  /** Open the live connection. Safe to call once; reconnects by itself. */
  open() {
    if (this.es || this.polling) return;
    if (!this.wired && typeof document !== 'undefined') {
      this.wired = true;
      const nudge = () => { if (!this.closed && document.visibilityState !== 'hidden') this.wake?.(); };
      document.addEventListener('visibilitychange', nudge);
      globalThis.addEventListener?.('online', nudge);
    }
    if (isPollBase(this.base)) return this.#poll();
    if (!this.ES) return;
    this.status = 'connecting';
    const url = apiUrl(this.base, `/api/rooms/${this.code}/events`, { token: this.me.token });
    const es = new this.ES(url);
    this.es = es;
    es.addEventListener('open', () => { this.status = 'online'; this.emit('status', this.status); });
    es.addEventListener('error', () => {
      if (this.closed) return;
      this.status = es.readyState === 2 ? 'closed' : 'reconnecting';
      this.emit('status', this.status);
    });
    es.addEventListener('hello', (e) => this.#onHello(JSON.parse(e.data)));
    es.addEventListener('members', (e) => this.#onMembers(JSON.parse(e.data)));
    es.addEventListener('msg', (e) => this.#handle(JSON.parse(e.data)));
    es.addEventListener('closed', () => this.#onClosed());
  }

  /** Poll mode (PHP relay on ordinary web hosting): ask for news about once a second. */
  async #poll() {
    this.polling = true;
    this.status = 'connecting';
    let after = -1;
    let fails = 0;
    let lastMembers = '';
    while (!this.closed && this.polling) {
      let wait = 900;
      try {
        const res = await this.fetch(apiUrl(this.base, `/api/rooms/${this.code}/events`, { token: this.me.token, after }), { cache: 'no-store' });
        if (res.status === 404 || res.status === 403) { this.#onClosed(); break; }
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? 'poll failed');
        fails = 0;
        if (this.status !== 'online') { this.status = 'online'; this.emit('status', this.status); }
        if (d.hello) { this.#onHello({ ...d.hello, members: d.members, hostId: d.hostId, locked: d.locked }); lastMembers = JSON.stringify(d.members); }
        else {
          const sig = JSON.stringify(d.members);
          if (sig !== lastMembers || d.locked !== this.locked) { lastMembers = sig; this.#onMembers(d); }
        }
        for (const m of d.events ?? []) this.#handle(m);
        after = d.seq;
        if (d.closed) { this.#onClosed(); break; }
        wait = d.events?.length ? 120 : 900;
      } catch {
        fails++;
        if (this.status !== 'reconnecting') { this.status = 'reconnecting'; this.emit('status', this.status); }
        wait = Math.min(4000, 800 + fails * 600);
      }
      await Promise.race([sleep(wait), new Promise((r) => { this.wake = r; })]);
    }
    this.polling = false;
  }

  #handle(msg) {
    const { type, payload, from } = msg;
    if (type === 'state') {
      if (payload.rev > this.rev || !this.latest) {
        this.rev = Math.max(this.rev, payload.rev);
        this.latest = payload;
        this.emit('state', payload);
      }
    } else if (type === 'start') {
      this.startInfo = payload;
      this.locked = true;
      if (payload.rev != null) { this.rev = payload.rev; this.latest = { rev: payload.rev, state: payload.state }; }
      this.emit('start', payload);
    } else if (type === 'action') {
      this.emit('action', { from, ...payload });
    } else if (type === 'info') {
      this.infos.set(from, payload);
      this.emit('info', { from, info: payload });
    } else if (type === 'end') {
      this.emit('end', payload);
    } else {
      this.emit(type, { from, payload });
    }
  }

  async send(type, payload, to) {
    if (this.closed) return { ok: false };
    const r = await this.#post(`/api/rooms/${this.code}/send`, { token: this.me.token, type, payload, ...(to ? { to } : {}) });
    this.wake?.();
    return r;
  }
  sendInfo(info) {
    return this.send('info', info, 'host').catch(() => {});
  }
  sendAction(action, rev) {
    return this.send('action', { action, rev }, 'host').catch((e) => this.emit('error', e));
  }
  broadcastState(rev, state) {
    this.rev = Math.max(this.rev, rev);
    this.latest = { rev, state };
    return this.send('state', { rev, state }, 'all').catch((e) => this.emit('error', e));
  }
  start(payload) {
    return this.send('start', payload, 'all');
  }

  async leave() {
    this.closed = true;
    this.polling = false;
    this.wake?.();
    OnlineSession.clearSaved();
    try { this.es?.close(); } catch { /* ignore */ }
    this.es = null;
    if (this.code && this.me) await this.#post(`/api/rooms/${this.code}/leave`, { token: this.me.token }).catch(() => {});
    this.emit('left', {});
  }

  /** Link someone can open to join this room. */
  joinLink(origin = globalThis.location?.href ?? '') {
    const u = new URL(origin);
    u.hash = '';
    u.search = '';
    u.searchParams.set('room', this.code);
    if (this.base && !this.base.startsWith('/') && this.base !== trimSlash(u.origin)) u.searchParams.set('relay', this.base);
    return u.toString();
  }
}

function profileFields(p) {
  return { name: p.name, avatar: p.avatar?.key ?? p.avatar ?? '', language: p.language ?? 'en', profileId: p.id };
}
