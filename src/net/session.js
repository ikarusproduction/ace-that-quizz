// Online play, client side. One phone is the HOST: it runs the game engine and is
// the single source of truth. Every other phone is a GUEST: it sends its own
// actions to the host and renders whatever state the host broadcasts back.
// A small relay server (server/relay.js) only forwards messages between phones.
//
// Trust model (be honest about it): the host's phone decides everything, and
// guests could read the answers out of their own copy of the question bank with
// developer tools. This is built for friends in a room, not for tournaments.

const trimSlash = (s) => String(s ?? '').replace(/\/+$/, '');

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
      res = await this.fetch(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    } catch {
      throw new Error('Could not reach the game server. Check the address and your connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `Server error (${res.status})`), { status: res.status });
    return data;
  }

  static async health(base, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    try {
      const res = await fetchImpl(`${trimSlash(base)}/api/health`, { cache: 'no-store' });
      const j = await res.json();
      return j?.ok === true;
    } catch {
      return false;
    }
  }

  /** Ask the relay whether an access code is right. Resolves { ok, error? }. */
  static async checkAccess(base, access, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    try {
      const res = await fetchImpl(`${trimSlash(base)}/api/check?access=${encodeURIComponent(access ?? '')}`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      return res.ok ? { ok: true } : { ok: false, error: j.error ?? `Server error (${res.status})` };
    } catch {
      return { ok: false, error: 'Could not reach the game server.' };
    }
  }
  static async gateInfo(base, fetchImpl = globalThis.fetch?.bind(globalThis)) {
    try {
      const j = await (await fetchImpl(`${trimSlash(base)}/api/health`, { cache: 'no-store' })).json();
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
  #adopt(role, d, profile) {
    this.role = role;
    this.code = d.code;
    this.hostId = d.hostId;
    this.members = d.members ?? [];
    this.me = { id: d.memberId, token: d.token, profileId: profile.id, name: profile.name };
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

  /** Open the live connection. Safe to call once; EventSource reconnects by itself. */
  open() {
    if (this.es || !this.ES) return;
    this.status = 'connecting';
    const url = `${this.base}/api/rooms/${this.code}/events?token=${encodeURIComponent(this.me.token)}`;
    const es = new this.ES(url);
    this.es = es;
    es.addEventListener('open', () => { this.status = 'online'; this.emit('status', this.status); });
    es.addEventListener('error', () => {
      if (this.closed) return;
      this.status = es.readyState === 2 ? 'closed' : 'reconnecting';
      this.emit('status', this.status);
    });
    es.addEventListener('hello', (e) => {
      const d = JSON.parse(e.data);
      this.members = d.members;
      this.hostId = d.hostId;
      this.locked = d.locked;
      this.status = 'online';
      this.emit('status', this.status);
      this.emit('members', this.members);
      if (d.latest) this.#handle(d.latest);
    });
    es.addEventListener('members', (e) => {
      const d = JSON.parse(e.data);
      this.members = d.members;
      this.locked = d.locked;
      this.emit('members', this.members);
    });
    es.addEventListener('msg', (e) => this.#handle(JSON.parse(e.data)));
    es.addEventListener('closed', () => {
      this.closed = true;
      this.status = 'closed';
      this.es?.close();
      this.emit('closed', { reason: 'The host left, so the room is closed.' });
    });
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
    return this.#post(`/api/rooms/${this.code}/send`, { token: this.me.token, type, payload, ...(to ? { to } : {}) });
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
    if (this.base && this.base !== trimSlash(u.origin)) u.searchParams.set('relay', this.base);
    return u.toString();
  }
}

function profileFields(p) {
  return { name: p.name, avatar: p.avatar?.key ?? p.avatar ?? '', language: p.language ?? 'en', profileId: p.id };
}
