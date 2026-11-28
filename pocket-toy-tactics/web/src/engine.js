/* Pocket Toy Tactics — rules engine (JavaScript port of Runtime/Rules/RulesEngine.cs).
 * Same rules, same deterministic RNG and same state shape as the C# core, so that a game
 * recorded by one engine replays identically in the other (checked by web/tools/crosscheck.mjs).
 * Sides: 0 = blue, 1 = red. State is plain JSON (saves, network sync). */
(function (root) {
  "use strict";
  const MASK = (1n << 64n) - 1n;
  const RACK = 8, REMOVED = 4, FIRST_RACK = 3, SECOND_RACK = 4, DRAW = 2;
  const SIDE_KEY = ["blue", "red"];

  // ---------------------------------------------------------------- RNG (SplitMix64, bit-identical to Rng.cs)
  class Rng {
    constructor(seed) { this.s = BigInt.asUintN(64, BigInt(seed)); }
    static fromHex(h) { const r = new Rng(0); r.s = BigInt("0x" + h); return r; }
    hex() { return this.s.toString(16).padStart(16, "0"); }
    nextU() {
      this.s = (this.s + 0x9E3779B97F4A7C15n) & MASK;
      let z = this.s;
      z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK;
      return z ^ (z >> 31n);
    }
    next(max) {
      const b = BigInt(max);
      const th = ((1n << 64n) - b) % b;
      for (;;) { const r = this.nextU(); if (r >= th) return Number(r % b); }
    }
    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.next(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } }
  }

  // ---------------------------------------------------------------- content
  class Content {
    constructor(troopsJson, terrainJsons) {
      this.troops = troopsJson.troops.map(t => ({
        id: t.id, ref: t.referenceName, name: t.name, tagline: t.tagline || "", effect: t.effect || "",
        strength: t.strength | 0, joker: !!t.joker, ability: t.ability || "none", amount: t.amount | 0,
        copies: t.copies || 3, color: t.color || "#ccc",
      }));
      this.tilesPerPlayer = this.troops.reduce((a, t) => a + t.copies, 0);
      this.troopById = Object.fromEntries(this.troops.map(t => [t.id, t]));
      this.terrains = {};
      this.order = [];
      for (const j of terrainJsons) this.addTerrain(j);
    }
    addTerrain(j) {
      const t = {
        id: j.id, name: j.name, ref: j.referenceTerrain, source: j.layoutSource, flavor: j.flavor || "",
        effect: j.specialEffect || "none", goal: [j.medalGoal.blue, j.medalGoal.red],
        nodes: j.nodes.map(n => ({ id: n.id, type: n.type, owner: n.type === "hq" ? SIDE_KEY.indexOf(n.owner) : -1, x: n.x, y: n.y,
          allowed: n.allowedStrengths || null, allowJoker: !!n.allowJoker })),
        edges: j.edges, regions: j.regions.map(r => ({ id: r.id, bases: r.bases, medals: r.medals })),
      };
      t.node = Object.fromEntries(t.nodes.map(n => [n.id, n]));
      t.adj = Object.fromEntries(t.nodes.map(n => [n.id, []]));
      for (const [a, b] of t.edges) { t.adj[a].push(b); t.adj[b].push(a); }
      t.hqs = [t.nodes.filter(n => n.owner === 0).map(n => n.id), t.nodes.filter(n => n.owner === 1).map(n => n.id)];
      t.total = t.regions.reduce((a, r) => a + r.medals, 0);
      if (!this.terrains[t.id]) this.order.push(t.id);
      this.terrains[t.id] = t;
    }
    owner(tile) { return tile < this.tilesPerPlayer ? 0 : 1; }
    troop(tile) {
      let local = tile % this.tilesPerPlayer;
      for (const t of this.troops) { if (local < t.copies) return t; local -= t.copies; }
      throw new Error("bad tile " + tile);
    }
    tilesOf(side) { const s = side * this.tilesPerPlayer; return Array.from({ length: this.tilesPerPlayer }, (_, i) => s + i); }
  }

  // ---------------------------------------------------------------- engine
  class Engine {
    constructor(content) { this.c = content; }
    T(s) { return this.c.terrains[s.terrain]; }

    newGame(terrain, seed, opts = {}) {
      const rng = new Rng(seed);
      const t = this.c.terrains[terrain];
      if (!t) throw new Error("unknown terrain " + terrain);
      const s = {
        terrain, special: opts.special !== false, seed: BigInt.asUintN(64, BigInt(seed)).toString(), turn: 1, active: 0, first: 0,
        phase: "TurnAction", seq: 0,
        players: [0, 1].map(() => ({ reserve: [], rack: [], removed: [], laid: [], known: [], medals: 0 })),
        stacks: Object.fromEntries(t.nodes.map(n => [n.id, []])), discard: [], claims: {}, pending: null,
        chain: [], troopStack: [], baseCursor: 0, winner: null, winReason: "None", endedBy: null, rng: "", history: [],
      };
      for (const side of [0, 1]) {
        const p = s.players[side];
        p.reserve = this.c.tilesOf(side);
        rng.shuffle(p.reserve);
        for (let i = 0; i < REMOVED; i++) p.removed.push(p.reserve.shift());
      }
      s.first = opts.first != null ? opts.first : rng.next(2);
      s.active = s.first;
      s.rng = rng.hex();
      this.drawInto(s, s.first, FIRST_RACK, null);
      this.drawInto(s, 1 - s.first, SECOND_RACK, null);
      return s;
    }

    clone(s) { return JSON.parse(JSON.stringify(s)); }

    // ---------------- queries
    adjacent(s, id) {
      const t = this.T(s);
      const direct = t.adj[id];
      if (!s.special || t.effect !== "railway") return direct;
      const n = t.node[id];
      if (!n || n.type !== "special") return direct;
      const all = direct.slice();
      for (const o of t.nodes) if (o.type === "special" && o.id !== id && !all.includes(o.id)) all.push(o.id);
      return all;
    }
    top(s, id) { const st = s.stacks[id]; return st && st.length ? st[st.length - 1] : -1; }
    topOwner(s, id) { const t = this.top(s, id); return t < 0 ? -1 : this.c.owner(t); }
    canDraw(s, side) { const p = s.players[side]; return p.rack.length < RACK && p.reserve.length > 0; }
    isBase(s, id) { const n = this.T(s).node[id]; return n && n.type !== "hq"; }

    connected(s, side) {
      const t = this.T(s), seen = new Set(), stack = t.hqs[side].slice();
      while (stack.length) {
        const v = stack.pop();
        for (const w of this.adjacent(s, v)) {
          if (seen.has(w) || t.node[w].type === "hq" || this.topOwner(s, w) !== side) continue;
          seen.add(w); stack.push(w);
        }
      }
      return seen;
    }
    isConnectedTarget(s, side, id, conn) {
      const t = this.T(s);
      conn = conn || this.connected(s, side);
      for (const w of this.adjacent(s, id)) {
        const n = t.node[w];
        if (n.type === "hq" && n.owner === side) return true;
        if (conn.has(w)) return true;
      }
      return false;
    }
    shielded(s, n) { return s.special && n.type === "special" && this.T(s).effect === "effect_shield"; }
    strengthAllowed(tr, n) { if (!n.allowed) return true; return tr.joker ? n.allowJoker : n.allowed.includes(tr.strength); }

    checkPlacement(s, side, tile, id, conn) {
      const p = s.players[side];
      if (!p.rack.includes(tile)) return "TileNotInRack";
      if (p.laid.includes(tile)) return "TileLaidDown";
      const t = this.T(s), n = t.node[id];
      if (!n) return "UnknownNode";
      const tr = this.c.troop(tile);
      if (n.type === "hq") {
        if (n.owner === side) return "OwnHq";
        if (!this.strengthAllowed(tr, n)) return "StrengthNotAllowed";
        return this.isConnectedTarget(s, side, id, conn) ? "None" : "NotConnected";
      }
      if (n.type === "special" && s.special && t.effect === "strength_restriction" && !this.strengthAllowed(tr, n)) return "StrengthNotAllowed";
      const top = this.top(s, id);
      if (top >= 0 && this.c.owner(top) !== side) {
        const o = this.c.troop(top);
        if (!(tr.joker || o.joker || tr.strength > o.strength)) return "TooWeak";
      }
      const ignores = tr.ability === "ignore_connection" && !this.shielded(s, n);
      if (!ignores && !this.isConnectedTarget(s, side, id, conn)) return "NotConnected";
      return "None";
    }
    legalTargets(s, side, tile) {
      const conn = this.connected(s, side);
      return this.T(s).nodes.filter(n => this.checkPlacement(s, side, tile, n.id, conn) === "None").map(n => n.id);
    }
    anyPlacement(s, side) {
      const conn = this.connected(s, side), p = s.players[side], tried = new Set();
      for (const tile of p.rack) {
        if (p.laid.includes(tile)) continue;
        const id = this.c.troop(tile).id;
        if (tried.has(id)) continue;
        tried.add(id);
        for (const n of this.T(s).nodes) if (this.checkPlacement(s, side, tile, n.id, conn) === "None") return true;
      }
      return false;
    }
    hasAction(s, side) { return this.canDraw(s, side) || this.anyPlacement(s, side); }

    discardTargets(s, side, from) {
      const t = this.T(s);
      return this.adjacent(s, from).filter(w => t.node[w].type !== "hq" && !this.shielded(s, t.node[w]) && this.topOwner(s, w) === 1 - side);
    }
    recallTargets(s, side, placed) {
      if (s.players[side].rack.length >= RACK) return [];
      return this.T(s).nodes.filter(n => n.type !== "hq").map(n => n.id)
        .filter(id => { const tp = this.top(s, id); return tp >= 0 && tp !== placed && this.c.owner(tp) === side; });
    }
    moveSources(s, side, special) {
      const t = this.T(s);
      return this.adjacent(s, special).filter(w => t.node[w].type !== "hq" && this.topOwner(s, w) === 1 - side && this.moveDestinations(s, w).length > 0);
    }
    moveDestinations(s, src) { const t = this.T(s); return this.adjacent(s, src).filter(w => t.node[w].type !== "hq"); }
    bounceTargets(s, placed, special) {
      if (this.top(s, special) !== placed) return [];
      const t = this.T(s);
      return this.adjacent(s, special).filter(w => t.node[w].type !== "hq" && s.stacks[w].length === 0);
    }
    recoverable(s, side) { if (s.players[side].rack.length >= RACK) return []; return s.discard.filter(t => this.c.owner(t) === side); }
    designatable(s, side) { const op = s.players[1 - side]; const r = []; op.rack.forEach((t, i) => { if (!op.laid.includes(t)) r.push(i); }); return r; }
    drawable(s, side, wanted) { const p = s.players[side]; return Math.max(0, Math.min(wanted, RACK - p.rack.length, p.reserve.length)); }

    // ---------------- legal commands
    legal(s, distinct = false) {
      const r = [];
      if (s.phase === "GameOver") return r;
      const side = s.active;
      if (s.phase === "TurnAction") {
        if (this.canDraw(s, side)) r.push({ t: "Draw", p: side });
        this.addPlacements(s, side, r, distinct);
        return r;
      }
      const d = s.pending;
      const node = n => ({ t: "Choose", p: side, node: n });
      switch (d.kind) {
        case "ExtraPlacement": this.addPlacements(s, side, r, distinct); break;
        case "TroopDraw": case "DiscardRandomConfirm": case "TerrainDraw": r.push({ t: "Choose", p: side }); break;
        case "DiscardAdjacentTarget": this.discardTargets(s, side, d.node).forEach(n => r.push(node(n))); break;
        case "RecallOwnTroop": this.recallTargets(s, side, d.src).forEach(n => r.push(node(n))); break;
        case "MoveEnemySource": this.moveSources(s, side, d.node).forEach(n => r.push(node(n))); break;
        case "MoveEnemyDestination": this.moveDestinations(s, d.sel).forEach(n => r.push(node(n))); break;
        case "RecoverFromDiscard": this.recoverable(s, side).forEach(t => r.push({ t: "Choose", p: side, tile: t })); break;
        case "DesignateOpponentRack": this.designatable(s, side).forEach(i => r.push({ t: "Choose", p: side, idx: i })); break;
        case "Bounce": this.bounceTargets(s, d.src, d.node).forEach(n => r.push(node(n))); break;
      }
      if (d.opt) r.push({ t: "Skip", p: side });
      return r;
    }
    addPlacements(s, side, r, distinct) {
      const conn = this.connected(s, side), seen = new Set();
      for (const tile of s.players[side].rack) {
        if (distinct) { const id = this.c.troop(tile).id; if (seen.has(id)) continue; seen.add(id); }
        for (const n of this.T(s).nodes) if (this.checkPlacement(s, side, tile, n.id, conn) === "None") r.push({ t: "Place", p: side, tile, node: n.id });
      }
    }

    // ---------------- validation / application
    validate(s, c) {
      if (!c) return "InvalidCommand";
      if (s.phase === "GameOver") return "GameOver";
      if (c.p !== s.active) return "NotYourTurn";
      if (s.phase === "TurnAction") {
        if (c.t === "Draw") {
          if (s.players[c.p].rack.length >= RACK) return "RackFull";
          if (!s.players[c.p].reserve.length) return "ReserveEmpty";
          return "None";
        }
        if (c.t === "Place") return this.checkPlacement(s, c.p, c.tile, c.node);
        return "WrongPhase";
      }
      const d = s.pending;
      if (c.t === "Skip") return d.opt ? "None" : "NotOptional";
      if (d.kind === "ExtraPlacement") return c.t === "Place" ? this.checkPlacement(s, c.p, c.tile, c.node) : "WrongPhase";
      if (c.t !== "Choose") return "WrongPhase";
      const ok = b => (b ? "None" : "InvalidTarget");
      switch (d.kind) {
        case "TroopDraw": case "DiscardRandomConfirm": case "TerrainDraw": return "None";
        case "DiscardAdjacentTarget": return ok(this.discardTargets(s, c.p, d.node).includes(c.node));
        case "RecallOwnTroop": return ok(this.recallTargets(s, c.p, d.src).includes(c.node));
        case "MoveEnemySource": return ok(this.moveSources(s, c.p, d.node).includes(c.node));
        case "MoveEnemyDestination": return ok(this.moveDestinations(s, d.sel).includes(c.node));
        case "RecoverFromDiscard": return ok(this.recoverable(s, c.p).includes(c.tile));
        case "DesignateOpponentRack": return ok(this.designatable(s, c.p).includes(c.idx));
        case "Bounce": return ok(this.bounceTargets(s, d.src, d.node).includes(c.node));
        default: return "WrongPhase";
      }
    }

    apply(s, c) {
      const err = this.validate(s, c);
      const ev = [];
      if (err !== "None") return { error: err, events: ev };
      s.history.push(Object.assign({}, c));
      s.seq++;
      if (s.phase === "TurnAction") {
        s.chain = []; s.troopStack = []; s.baseCursor = 0;
        if (c.t === "Draw") { this.drawInto(s, c.p, DRAW, ev); this.endTurn(s, ev); return { error: "None", events: ev }; }
        s.phase = "Decision";
        this.place(s, c.p, c.tile, c.node, ev);
        this.cont(s, ev);
        return { error: "None", events: ev };
      }
      const d = s.pending, side = c.p, opp = 1 - side;
      s.pending = null;
      if (c.t === "Skip") {
        ev.push({ type: "EffectSkipped", p: side, decision: d.kind, tile: d.src, node: d.node });
        this.cont(s, ev);
        return { error: "None", events: ev };
      }
      const troopId = t => this.c.troop(t).id;
      switch (d.kind) {
        case "ExtraPlacement": this.place(s, side, c.tile, c.node, ev); break;
        case "TroopDraw": case "TerrainDraw": this.drawInto(s, side, d.n, ev); break;
        case "DiscardAdjacentTarget": {
          const t = s.stacks[c.node].pop();
          s.discard.push(t);
          ev.push({ type: "TroopDiscarded", p: side, tile: t, troop: troopId(t), node: c.node });
          this.checkRegions(s, ev);
          break;
        }
        case "DiscardRandomConfirm": {
          const op = s.players[opp];
          if (op.rack.length) {
            const rng = Rng.fromHex(s.rng);
            const idx = rng.next(op.rack.length);
            s.rng = rng.hex();
            const t = op.rack[idx];
            this.removeFromRack(op, t);
            s.discard.push(t);
            ev.push({ type: "TroopDiscarded", p: side, tile: t, troop: troopId(t), n: idx });
          }
          break;
        }
        case "RecallOwnTroop": {
          const t = s.stacks[c.node].pop(), me = s.players[side];
          me.rack.push(t); me.known.push(t);
          ev.push({ type: "TroopReturnedToRack", p: side, tile: t, troop: troopId(t), node: c.node });
          this.checkRegions(s, ev);
          break;
        }
        case "MoveEnemySource":
          s.pending = { kind: "MoveEnemyDestination", p: side, src: d.src, node: d.node, n: 0, sel: c.node, opt: false };
          ev.push({ type: "DecisionOpened", p: side, decision: s.pending.kind, node: c.node });
          return { error: "None", events: ev };
        case "MoveEnemyDestination": case "Bounce": {
          const from = d.kind === "Bounce" ? d.node : d.sel;
          const t = s.stacks[from].pop();
          s.stacks[c.node].push(t);
          ev.push({ type: "TroopMoved", p: side, tile: t, troop: troopId(t), node: from, to: c.node });
          this.checkRegions(s, ev);
          break;
        }
        case "RecoverFromDiscard": {
          s.discard.splice(s.discard.indexOf(c.tile), 1);
          const me = s.players[side];
          me.rack.push(c.tile); me.known.push(c.tile);
          ev.push({ type: "TroopRecovered", p: side, tile: c.tile, troop: troopId(c.tile) });
          break;
        }
        case "DesignateOpponentRack": {
          const op = s.players[opp], t = op.rack[c.idx];
          op.laid.push(t);
          ev.push({ type: "TroopLaidDown", p: side, tile: t, troop: troopId(t), n: c.idx });
          break;
        }
      }
      this.cont(s, ev);
      return { error: "None", events: ev };
    }

    // ---------------- internals
    drawInto(s, side, wanted, ev) {
      const n = this.drawable(s, side, wanted), p = s.players[side], e = { type: "TilesDrawn", p: side, n, tiles: [] };
      for (let i = 0; i < n; i++) { const t = p.reserve.shift(); p.rack.push(t); e.tiles.push(t); }
      if (ev) ev.push(e);
    }
    removeFromRack(p, t) {
      for (const k of ["rack", "laid", "known"]) { const i = p[k].indexOf(t); if (i >= 0) p[k].splice(i, 1); }
    }
    place(s, side, tile, id, ev) {
      this.removeFromRack(s.players[side], tile);
      const covered = this.top(s, id);
      s.stacks[id].push(tile);
      ev.push({ type: "TroopPlaced", p: side, tile, troop: this.c.troop(tile).id, node: id, covered });
      if (this.T(s).node[id].type === "hq") {
        ev.push({ type: "HqCaptured", p: side, tile, node: id });
        this.endGame(s, side, "HqCaptured", ev);
        return;
      }
      this.checkRegions(s, ev);
      if (s.phase === "GameOver") return;
      s.chain.push({ tile, node: id });
      s.troopStack.push(s.chain.length - 1);
    }
    checkRegions(s, ev) {
      const t = this.T(s);
      for (const r of t.regions) {
        if (r.medals <= 0 || s.claims[r.id] != null) continue;
        const o = this.topOwner(s, r.bases[0]);
        if (o < 0 || !r.bases.every(b => this.topOwner(s, b) === o)) continue;
        s.claims[r.id] = o;
        s.players[o].medals += r.medals;
        ev.push({ type: "RegionCaptured", p: o, region: r.id, n: r.medals });
        if (s.players[o].medals >= t.goal[o]) { this.endGame(s, o, "MedalGoal", ev); return; }
      }
    }
    endGame(s, winner, reason, ev) {
      s.phase = "GameOver"; s.pending = null; s.winner = winner; s.winReason = reason;
      ev.push({ type: "GameOver", p: winner, win: reason });
    }
    open(s, kind, side, rec, n = 0, opt = true) { s.pending = { kind, p: side, src: rec.tile, node: rec.node, n, sel: null, opt }; }
    cont(s, ev) {
      while (s.phase !== "GameOver" && !s.pending) {
        if (s.troopStack.length) { this.openTroop(s, s.chain[s.troopStack.pop()], ev); continue; }
        if (s.baseCursor < s.chain.length) { this.openBase(s, s.chain[s.baseCursor++], ev); continue; }
        this.endTurn(s, ev);
        return;
      }
      if (s.pending) ev.push({ type: "DecisionOpened", p: s.pending.p, decision: s.pending.kind, tile: s.pending.src, node: s.pending.node, n: s.pending.n });
    }
    openTroop(s, rec, ev) {
      const tr = this.c.troop(rec.tile), side = this.c.owner(rec.tile);
      if (tr.ability === "none" || tr.ability === "ignore_connection") return;
      if (this.shielded(s, this.T(s).node[rec.node])) { ev.push({ type: "AbilityBlocked", p: side, tile: rec.tile, troop: tr.id, node: rec.node }); return; }
      switch (tr.ability) {
        case "draw": { const n = this.drawable(s, side, tr.amount); if (n > 0) this.open(s, "TroopDraw", side, rec, n); break; }
        case "extra_placement": if (this.anyPlacement(s, side)) this.open(s, "ExtraPlacement", side, rec); break;
        case "discard_adjacent_enemy": if (this.discardTargets(s, side, rec.node).length) this.open(s, "DiscardAdjacentTarget", side, rec); break;
        case "discard_random_from_opponent_rack": if (s.players[1 - side].rack.length) this.open(s, "DiscardRandomConfirm", side, rec); break;
      }
      if (s.pending) ev.push({ type: "AbilityActivated", p: side, tile: rec.tile, troop: tr.id, node: rec.node });
    }
    openBase(s, rec, ev) {
      if (!s.special) return;
      const t = this.T(s);
      if (t.node[rec.node].type !== "special") return;
      const side = this.c.owner(rec.tile);
      switch (t.effect) {
        case "recall_own_troop": if (this.recallTargets(s, side, rec.tile).length) this.open(s, "RecallOwnTroop", side, rec); break;
        case "draw_one": if (this.drawable(s, side, 1) > 0) this.open(s, "TerrainDraw", side, rec, 1); break;
        case "move_adjacent_enemy": if (this.moveSources(s, side, rec.node).length) this.open(s, "MoveEnemySource", side, rec); break;
        case "recover_from_discard": if (this.recoverable(s, side).length) this.open(s, "RecoverFromDiscard", side, rec); break;
        case "designate_opponent_rack": if (this.designatable(s, side).length) this.open(s, "DesignateOpponentRack", side, rec, 0, false); break;
        case "bounce": if (this.bounceTargets(s, rec.tile, rec.node).length) this.open(s, "Bounce", side, rec); break;
      }
      if (s.pending) ev.push({ type: "BaseEffectActivated", p: side, tile: rec.tile, node: rec.node });
    }
    endTurn(s, ev) {
      const ending = s.players[s.active];
      for (const t of ending.laid) ev.push({ type: "TroopStoodUp", p: s.active, tile: t, troop: this.c.troop(t).id });
      ending.laid = [];
      s.chain = []; s.troopStack = []; s.baseCursor = 0; s.pending = null;
      s.active = 1 - s.active; s.turn++; s.phase = "TurnAction";
      ev.push({ type: "TurnStarted", p: s.active, n: s.turn });
      if (!this.hasAction(s, s.active)) {
        const stuck = s.active, mine = s.players[stuck].medals, theirs = s.players[1 - stuck].medals;
        s.endedBy = stuck;
        if (mine > theirs) this.endGame(s, stuck, "NoActionMoreMedals", ev);
        else if (theirs > mine) this.endGame(s, 1 - stuck, "NoActionMoreMedals", ev);
        else this.endGame(s, 1 - stuck, "NoActionTieBreak", ev);
      }
    }

    /** A state consistent with what `viewer` knows: hidden tiles are reshuffled among hidden zones. */
    determinize(s, viewer, rand) {
      const d = this.clone(s), me = d.players[viewer], op = d.players[1 - viewer];
      const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } };
      const mine = me.reserve.concat(me.removed); shuffle(mine);
      me.reserve = mine.slice(0, me.reserve.length); me.removed = mine.slice(me.reserve.length);
      const slots = op.rack.map((t, i) => (op.known.includes(t) ? t : null));
      const laidIdx = op.rack.map((t, i) => (op.laid.includes(t) ? i : -1)).filter(i => i >= 0);
      const pool = op.rack.filter(t => !op.known.includes(t)).concat(op.reserve, op.removed); shuffle(pool);
      op.rack = slots.map(t => (t != null ? t : pool.pop()));
      op.reserve = pool.splice(0, op.reserve.length);
      op.removed = pool;
      op.laid = laidIdx.map(i => op.rack[i]);
      d.rng = new Rng(BigInt(Math.floor(rand() * 2 ** 52))).hex();
      return d;
    }
  }

  // ---------------------------------------------------------------- AI (port of AiPlayer.cs)
  class Ai {
    constructor(engine, level) {
      this.e = engine; this.level = level; this.rand = Math.random;
      this.w = { medal: 140, goal: 400, region: 30, threatMe: 6000, threatThem: 350, conn: 10, str: 4, rack: 14 };
    }
    choose(s, me) {
      const e = this.e, samples = this.level === "easy" ? 1 : this.level === "normal" ? 4 : 8;
      const states = Array.from({ length: samples }, () => e.determinize(s, me, this.rand));
      const cands = e.legal(states[0], true);
      if (cands.length === 1) return cands[0];
      if (this.level === "easy" && this.rand() < 0.35) return cands[Math.floor(this.rand() * cands.length)];
      const score = cands.map(c => {
        let tot = 0;
        for (const st of states) { const x = e.clone(st); e.apply(x, c); this.finish(x, me); tot += this.eval(x, me); }
        return tot / states.length + (this.level === "easy" ? this.rand() * 60 : 0);
      });
      if (this.level === "hard") {
        const order = cands.map((_, i) => i).sort((a, b) => score[b] - score[a]).slice(0, 8);
        let best = order[0], bestV = -Infinity;
        for (const i of order) {
          let tot = 0;
          for (const st of states) { const x = e.clone(st); e.apply(x, cands[i]); this.finish(x, me); tot += this.reply(x, me); }
          if (tot / states.length > bestV) { bestV = tot / states.length; best = i; }
        }
        return cands[best];
      }
      let b = 0; for (let i = 1; i < score.length; i++) if (score[i] > score[b]) b = i;
      return cands[b];
    }
    reply(s, me) {
      if (s.phase === "GameOver" || s.active === me) return this.eval(s, me);
      let worst = Infinity;
      for (const r of this.e.legal(s, true)) {
        const x = this.e.clone(s); this.e.apply(x, r); this.finish(x, 1 - me);
        worst = Math.min(worst, this.eval(x, me));
        if (worst <= -5e5) break;
      }
      return worst;
    }
    finish(s, side) {
      let guard = 0;
      while (s.phase === "Decision" && s.active === side && guard++ < 32) {
        let best = null, bv = -Infinity;
        for (const o of this.e.legal(s, true)) { const x = this.e.clone(s); this.e.apply(x, o); const v = this.eval(x, side); if (v > bv) { bv = v; best = o; } }
        this.e.apply(s, best);
      }
    }
    eval(s, me) {
      const e = this.e, w = this.w;
      if (s.phase === "GameOver") return s.winner === me ? 1e6 - s.turn : -1e6 + s.turn;
      const t = e.T(s), opp = 1 - me, sq = x => x * x;
      const myM = s.players[me].medals, opM = s.players[opp].medals, myG = t.goal[me], opG = t.goal[opp];
      let v = w.medal * (myM - opM) + w.goal * (sq(myM / myG) - sq(opM / opG));
      for (const r of t.regions) {
        if (r.medals <= 0 || s.claims[r.id] != null) continue;
        let mine = 0, theirs = 0;
        for (const b of r.bases) { const o = e.topOwner(s, b); if (o === me) mine++; else if (o === opp) theirs++; }
        const n = r.bases.length;
        if (!theirs) v += w.region * r.medals * sq(mine / n) * (myM + r.medals >= myG ? 3 : 1);
        if (!mine) v -= w.region * r.medals * sq(theirs / n) * (opM + r.medals >= opG ? 3 : 1);
      }
      const myC = e.connected(s, me), opC = e.connected(s, opp);
      v += w.conn * (myC.size - opC.size);
      const oppToMove = s.active === opp;
      const playable = side => s.players[side].rack.length - s.players[side].laid.length;
      const threat = (att, conn) => t.hqs[1 - att].some(h => e.adjacent(s, h).some(x => conn.has(x) || (t.node[x].type === "hq" && t.node[x].owner === att)));
      if (threat(opp, opC) && playable(opp) > 0) v -= oppToMove ? w.threatMe : w.threatMe / 4;
      if (threat(me, myC) && playable(me) > 0) v += oppToMove ? w.threatThem : w.threatMe / 2;
      for (const n of t.nodes) {
        if (n.type === "hq") continue;
        const tp = e.top(s, n.id); if (tp < 0) continue;
        const tr = e.c.troop(tp);
        v += (e.c.owner(tp) === me ? 1 : -1) * w.str * (tr.joker ? 1 : tr.strength);
      }
      v += w.rack * (Math.min(s.players[me].rack.length, 6) - Math.min(s.players[opp].rack.length, 6));
      if (!s.players[me].rack.length && !s.players[me].reserve.length) v -= 200;
      return v;
    }
  }

  root.PTT = { Rng, Content, Engine, Ai, SIDE_KEY, RACK };
})(typeof globalThis !== "undefined" ? globalThis : window);
