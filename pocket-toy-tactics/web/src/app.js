/* Pocket Toy Tactics — mobile web client. Rules live in engine.js; this file only renders and routes taps. */
(function () {
  "use strict";
  const DATA = window.PTT_DATA;
  const { Content, Engine, Ai } = window.PTT;
  const content = new Content(DATA.troops, DATA.terrains);
  const engine = new Engine(content);
  const $ = id => document.getElementById(id);
  const SIDE = ["BLEU", "ROUGE"];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ------------------------------------------------------------------ assets
  function b64Url(b64, type) {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type }));
  }
  const IMG = {};
  for (const t of content.troops) IMG[t.id] = b64Url(DATA.images[t.id], "image/webp");
  $("keyart").src = b64Url(DATA.keyart, "image/webp");

  // ------------------------------------------------------------------ storage (per-device conveniences)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
  };
  const opts = Object.assign({ sound: true, autoDraw: true, speed: 1 }, store.get("ptt-opts", {}));

  // ------------------------------------------------------------------ texts
  const RULE_FR = {
    None: "Action possible.", GameOver: "La partie est terminée.", NotYourTurn: "Ce n'est pas votre tour.",
    WrongPhase: "Terminez d'abord l'effet en cours.", RackFull: "Votre support contient déjà 8 troupes.",
    ReserveEmpty: "Votre réserve est vide.", TileNotInRack: "Cette troupe n'est pas sur votre support.",
    TileLaidDown: "Cette troupe est couchée : elle ne peut pas être posée ce tour-ci.", UnknownNode: "Emplacement inconnu.",
    OwnHq: "On ne pose jamais de troupe sur son propre Q.G.",
    NotConnected: "Pas relié à votre Q.G. : il faut un chemin continu de bases que vous occupez.",
    TooWeak: "La troupe adverse visible est aussi forte ou plus forte que la vôtre.",
    StrengthNotAllowed: "Cette valeur n'est pas autorisée ici (voir les chiffres sous la bouée).",
    InvalidTarget: "Cible impossible pour cet effet.", NotOptional: "Cet effet est obligatoire.", InvalidCommand: "Action invalide.",
  };
  const THEME = {
    castle_plain: { bg: "#7cc46a", path: "#f1dfa2", dark: "#4f8f45", label: "Plaine des châteaux" },
    tropical_pool: { bg: "#56c1e6", path: "#ffffff", dark: "#2b86a8", label: "Piscine des tropiques" },
    cloud_city: { bg: "#c7b8ef", path: "#ffffff", dark: "#8a76c9", label: "Cité des nuages" },
    volcano_jungle: { bg: "#3f8f4a", path: "#d59a62", dark: "#2a6131", label: "Jungle volcanique" },
    cursed_graveyard: { bg: "#46695a", path: "#c9b993", dark: "#2c473b", label: "Cimetière maudit" },
    pirate_sea: { bg: "#3e8dd1", path: "#b07a45", dark: "#25609a", label: "Mer des Caraïbes" },
    metalx_station: { bg: "#5b6273", path: "#9fb4ff", dark: "#3c4150", label: "Station Métal-X" },
    battlefield: { bg: "#e5c487", path: "#9a6639", dark: "#b28c4c", label: "Champ de bataille" },
    toy_train: { bg: "#a7d58c", path: "#e9cf9c", dark: "#6fa257", label: "Création originale" },
    bouncy_fair: { bg: "#ffc59e", path: "#ff9fb7", dark: "#e3906b", label: "Création originale" },
  };
  const EFFECT_FR = {
    recall_own_troop: "Base spéciale : reprenez une autre de vos troupes visibles, n'importe où, sur votre support.",
    strength_restriction: "Bouées : seules les valeurs indiquées peuvent être posées sur ces bases spéciales et sur les Q.G.",
    draw_one: "Base spéciale : piochez 1 troupe.",
    move_adjacent_enemy: "Volcan : déplacez une troupe adverse voisine de la base spéciale vers une base voisine de sa position, sans tenir compte des règles de pose.",
    recover_from_discard: "Base spéciale : reprenez une de vos troupes dans la défausse.",
    none: "Pas de base spéciale. Terrain asymétrique : 2 Q.G. bleus, 1 Q.G. rouge.",
    effect_shield: "Bouclier : les effets des troupes ne s'appliquent pas sur ces bases spéciales, ni contre elles.",
    designate_opponent_rack: "Sniper : couchez une troupe du support adverse, sans la voir ; elle ne pourra pas être posée au tour suivant.",
    railway: "Gares : toutes les gares sont reliées par le petit train et comptent comme voisines, pour la connexion comme pour les effets.",
    bounce: "Château gonflable : votre troupe peut rebondir vers une base vide voisine.",
  };
  const GLYPH = { recall_own_troop: "↺", strength_restriction: "", draw_one: "+1", move_adjacent_enemy: "⇄", recover_from_discard: "↩", effect_shield: "⛨", designate_opponent_rack: "⌖", railway: "▤", bounce: "⤒" };
  const WIN_FR = {
    HqCaptured: "Q.G. adverse capturé !", MedalGoal: "Objectif de médailles atteint !",
    NoActionMoreMedals: "Un joueur ne pouvait plus agir : la victoire revient à celui qui a le plus de médailles.",
    NoActionTieBreak: "Un joueur ne pouvait plus agir, à égalité de médailles : celui qui a bloqué la partie perd.",
  };
  const troopName = t => content.troop(t).name;

  // ------------------------------------------------------------------ sound (synthesized, original)
  let ac = null;
  function tone(freq, dur, type = "sine", vol = 0.15, slide = null, delay = 0) {
    if (!opts.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  const SFX = {
    click: () => tone(880, 0.05, "triangle", 0.12),
    place: () => { tone(420, 0.09, "square", 0.06, 220); tone(1200, 0.04, "triangle", 0.08, null, 0.05); },
    cover: () => { tone(300, 0.08, "square", 0.08, 120); tone(160, 0.12, "triangle", 0.12, 90, 0.05); },
    boing: () => tone(180, 0.38, "sine", 0.22, 720),
    pop: () => { tone(700, 0.06, "square", 0.06, 1400); tone(300, 0.1, "triangle", 0.08, 90, 0.04); },
    draw: () => { tone(660, 0.06, "triangle", 0.12); tone(990, 0.07, "triangle", 0.12, null, 0.07); },
    medal: () => { tone(1320, 0.45, "sine", 0.13); tone(1760, 0.5, "sine", 0.09, null, 0.09); },
    win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.28, "triangle", 0.16, null, i * 0.11)),
    lose: () => [440, 370, 311, 262].forEach((f, i) => tone(f, 0.3, "triangle", 0.12, null, i * 0.14)),
    error: () => tone(160, 0.16, "sawtooth", 0.06),
  };

  // ------------------------------------------------------------------ screens
  const screens = ["home", "setup", "lobby", "chars", "rules", "settings", "game"];
  let screenStack = ["home"];
  function show(id, push = true) {
    for (const s of screens) $(s).hidden = s !== id;
    if (push) screenStack.push(id);
  }
  function back() {
    screenStack.pop();
    const prev = screenStack[screenStack.length - 1] || "home";
    show(prev, false);
    if (prev === "home") refreshHome();
  }
  document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => { SFX.click(); back(); }));

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    $("layer").appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }
  function modal(html, onReady) {
    const o = document.createElement("div");
    o.className = "overlay";
    o.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    $("layer").appendChild(o);
    const close = () => o.remove();
    o.addEventListener("click", e => { if (e.target === o && !o.dataset.locked) close(); });
    if (onReady) onReady(o, close);
    return close;
  }

  // ------------------------------------------------------------------ board geometry and SVG
  const U = 64;
  function project(t, viewer) {
    const pts = {};
    for (const n of t.nodes) pts[n.id] = viewer === 0 ? [n.y * U, -n.x * U] : [-n.y * U, n.x * U];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of Object.values(pts)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const pad = 54;
    return { pts, vb: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad] };
  }
  function tokenSvg(tile, cls) {
    const side = content.owner(tile), tr = content.troop(tile);
    const ring = side === 0
      ? `<circle r="27" fill="#2f7fd8" stroke="#fff" stroke-width="3"/>`
      : `<polygon points="-14,-26 14,-26 29,0 14,26 -14,26 -29,0" fill="#e2483d" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
    return `<g class="tok ${cls || ""}">${ring}<use href="#im-${tr.id}" clip-path="url(#cc)"/>` +
      `<circle cx="19" cy="19" r="11" fill="#fff" stroke="#2b2240" stroke-width="2"/><text x="19" y="23.5" text-anchor="middle" font-size="13" font-weight="700" fill="#2b2240" font-family="Fredoka, sans-serif">${tr.joker ? "★" : tr.strength}</text></g>`;
  }
  function boardSvg(tid, s, viewer, o = {}) {
    const t = content.terrains[tid], th = THEME[tid], { pts, vb } = project(t, viewer);
    const special = s ? s.special : true;
    const out = [];
    out.push(`<defs><clipPath id="cc${o.mini ? "m" : ""}"><circle r="22"/></clipPath>`);
    if (!o.mini) for (const tr of content.troops) out.push(`<image id="im-${tr.id}" href="${IMG[tr.id]}" x="-22" y="-22" width="44" height="44" preserveAspectRatio="xMidYMid slice"/>`);
    out.push(`<pattern id="dots${o.mini ? "m" : ""}" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="rgba(255,255,255,.18)"/></pattern></defs>`);
    out.push(`<rect x="${vb[0] + 6}" y="${vb[1] + 6}" width="${vb[2] - 12}" height="${vb[3] - 12}" rx="28" fill="${th.bg}" stroke="${th.dark}" stroke-width="6"/>`);
    out.push(`<rect x="${vb[0] + 6}" y="${vb[1] + 6}" width="${vb[2] - 12}" height="${vb[3] - 12}" rx="28" fill="url(#dots${o.mini ? "m" : ""})"/>`);
    // regions
    for (const r of t.regions) {
      const poly = r.bases.map(b => pts[b].join(",")).join(" ");
      const claim = s ? s.claims[r.id] : null;
      const fill = claim == null ? "#fff" : claim === 0 ? "#2f7fd8" : "#e2483d";
      const op = claim == null ? 0.16 : 0.32;
      const flash = o.flash && o.flash.has(r.id) ? " flash" : "";
      out.push(`<polygon class="${flash}" points="${poly}" fill="${fill}" fill-opacity="${op}" stroke="none"/>`);
      if (o.mini) continue;
      const cx = r.bases.reduce((a, b) => a + pts[b][0], 0) / r.bases.length, cy = r.bases.reduce((a, b) => a + pts[b][1], 0) / r.bases.length;
      if (claim == null) {
        for (let i = 0; i < r.medals; i++) {
          const ox = (i - (r.medals - 1) / 2) * 17;
          out.push(`<circle cx="${cx + ox}" cy="${cy}" r="9" fill="#ffc94a" stroke="#b07d10" stroke-width="2"/><text x="${cx + ox}" y="${cy + 4}" text-anchor="middle" font-size="10" fill="#7a5200">★</text>`);
        }
      } else {
        out.push(`<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="16" font-weight="700" font-family="Fredoka, sans-serif" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width="3" paint-order="stroke">+${r.medals}★</text>`);
      }
    }
    // paths
    for (const [a, b] of t.edges) {
      const [x1, y1] = pts[a], [x2, y2] = pts[b];
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${th.dark}" stroke-width="${o.mini ? 16 : 15}" stroke-linecap="round"/>`);
      out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${th.path}" stroke-width="${o.mini ? 10 : 9}" stroke-linecap="round"/>`);
    }
    if (t.effect === "railway" && special) {
      const st = t.nodes.filter(n => n.type === "special");
      for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
        const [x1, y1] = pts[st[i].id], [x2, y2] = pts[st[j].id];
        out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b4a2b" stroke-width="5" stroke-dasharray="3 9" stroke-linecap="round" opacity=".75"/>`);
      }
    }
    // nodes
    for (const n of t.nodes) {
      const [x, y] = pts[n.id], tg = o.targets && o.targets.has(n.id);
      const g = [`<g class="node${tg ? " target" : ""}" data-node="${n.id}" transform="translate(${x},${y})">`];
      if (tg) g.push(`<rect class="halo" x="-38" y="-38" width="76" height="76" rx="20" fill="none" stroke="#ffe066" stroke-width="7"/>`);
      if (n.type === "hq") {
        const c = n.owner === 0 ? "#2f7fd8" : "#e2483d", cd = n.owner === 0 ? "#1c4f96" : "#9b2a22";
        g.push(`<rect x="-34" y="-30" width="68" height="62" rx="14" fill="${c}" stroke="${cd}" stroke-width="4"/>`);
        g.push(`<path d="M-30,-30 v-10 h12 v8 h10 v-8 h16 v8 h10 v-8 h12 v10 z" fill="${c}" stroke="${cd}" stroke-width="4" stroke-linejoin="round"/>`);
        if (!o.mini) g.push(`<text y="9" text-anchor="middle" font-size="20" font-weight="700" font-family="Fredoka, sans-serif" fill="#fff">QG</text>`);
      } else {
        const sp = n.type === "special" && special;
        g.push(`<rect x="-26" y="-26" width="52" height="52" rx="13" fill="${sp ? "#ffc94a" : "#e4dfd2"}" stroke="${sp ? "#b07d10" : "#8c8170"}" stroke-width="4"/>`);
        g.push(`<rect x="-19" y="-19" width="38" height="38" rx="8" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3"/>`);
        if (sp && GLYPH[t.effect] && !o.mini) g.push(`<circle cx="24" cy="-24" r="11" fill="#2b2240"/><text x="24" y="-19.5" text-anchor="middle" font-size="12" font-weight="700" fill="#ffc94a">${GLYPH[t.effect]}</text>`);
      }
      if (n.allowed && (n.type === "hq" || special) && !o.mini) {
        g.push(`<rect x="-30" y="31" width="60" height="18" rx="9" fill="#2b2240"/><text y="44" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="Nunito, sans-serif">${n.allowed.join("·")}</text>`);
      }
      if (s && !o.mini) {
        const st = s.stacks[n.id];
        if (st.length) {
          const top = st[st.length - 1];
          g.push(tokenSvg(top, o.drop && o.drop.has(n.id) ? "drop" : "idle"));
          if (st.length > 1) g.push(`<circle cx="-22" cy="-22" r="11" fill="#fff" stroke="#2b2240" stroke-width="2"/><text x="-22" y="-17.5" text-anchor="middle" font-size="12" font-weight="800" fill="#2b2240">${st.length}</text>`);
        }
      }
      g.push(`</g>`);
      out.push(g.join(""));
    }
    return { svg: out.join(""), vb };
  }

  // ------------------------------------------------------------------ menu / setup
  let setup = { mode: "ai", terrain: "castle_plain", level: "normal", special: true };
  function refreshHome() {
    const sv = store.get("ptt-save", null);
    const ok = sv && sv.state && sv.state.phase !== "GameOver" && content.terrains[sv.state.terrain];
    $("resumeBtn").hidden = !ok;
    if (ok) $("resumeSub").textContent = (sv.mode === "ai" ? "Contre l'ordinateur" : sv.mode === "online" ? "Deux téléphones, code " + sv.code : "À deux sur ce téléphone") + " · " + content.terrains[sv.state.terrain].name + " · tour " + sv.state.turn;
  }
  document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    SFX.click();
    setup.mode = b.dataset.mode;
    if (setup.mode === "online") { openLobby(); return; }
    openSetup();
  }));
  // character portraits as menu icons
  const icoMap = { ai: "xb42", hotseat: "captain", online: "star" };
  document.querySelectorAll("[data-mode]").forEach(b => {
    const ico = b.querySelector(".ico");
    ico.textContent = "";
    ico.style.background = `center/cover url(${IMG[icoMap[b.dataset.mode]]})`;
  });
  $("resumeBtn").addEventListener("click", () => { SFX.click(); resume(); });

  function openSetup() {
    $("setupTitle").textContent = setup.mode === "ai" ? "Contre l'ordinateur" : setup.mode === "hotseat" ? "À deux sur ce téléphone" : "Créer une partie en ligne";
    $("levelBox").hidden = setup.mode !== "ai";
    const grid = $("terrainGrid");
    grid.innerHTML = "";
    for (const id of content.order) {
      const t = content.terrains[id], { svg, vb } = boardSvg(id, null, 0, { mini: true });
      const b = document.createElement("button");
      b.className = "tcard";
      b.setAttribute("aria-pressed", String(id === setup.terrain));
      b.innerHTML = `${t.ref === "original" ? '<span class="badge">Nouveau</span>' : ""}<svg viewBox="${vb.join(" ")}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${svg}</svg><div class="tname">${esc(t.name)}<small>${esc(THEME[id].label)}</small></div>`;
      b.addEventListener("click", () => { SFX.click(); setup.terrain = id; grid.querySelectorAll(".tcard").forEach(x => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); terrainInfo(); });
      grid.appendChild(b);
    }
    terrainInfo();
    show("setup");
  }
  function terrainInfo() {
    const t = content.terrains[setup.terrain];
    $("terrainInfo").innerHTML = `<b>${esc(t.name)}</b>${esc(EFFECT_FR[t.effect])}<br><span style="color:var(--ink-soft)">Objectif : ${t.goal[0]} médailles pour Bleu, ${t.goal[1]} pour Rouge (${t.total} en jeu).</span>`;
  }
  $("levelSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    setup.level = b.dataset.v;
    $("levelSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  $("specialToggle").addEventListener("change", e => { setup.special = e.target.checked; });
  $("startBtn").addEventListener("click", () => {
    SFX.click();
    if (setup.mode === "online") { onlineCreate(); return; }
    startLocal();
  });

  // settings
  $("settingsBtn").addEventListener("click", () => { SFX.click(); show("settings"); });
  $("optSound").checked = opts.sound;
  $("optAutoDraw").checked = opts.autoDraw;
  $("speedSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(Number(x.dataset.v) === opts.speed)));
  $("optSound").addEventListener("change", e => { opts.sound = e.target.checked; store.set("ptt-opts", opts); });
  $("optAutoDraw").addEventListener("change", e => { opts.autoDraw = e.target.checked; store.set("ptt-opts", opts); });
  $("speedSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    opts.speed = Number(b.dataset.v); store.set("ptt-opts", opts);
    $("speedSeg").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });

  // characters & rules
  $("charsBtn").addEventListener("click", () => {
    SFX.click();
    $("charGrid").innerHTML = content.troops.map(t => `<article class="ccard"><img src="${IMG[t.id]}" alt="${esc(t.name)}"><div class="cbody"><h3>${esc(t.name)} <span class="str">${t.joker ? "★" : t.strength}</span></h3><p class="tag">« ${esc(t.tagline)} »</p><p>${esc(t.effect)}</p></div></article>`).join("");
    show("chars");
  });
  $("rulesBtn").addEventListener("click", () => { SFX.click(); $("rulesText").innerHTML = RULES_HTML; show("rules"); });
  const RULES_HTML = `
    <h3>But du jeu</h3><p>Posez vos troupes sur les bases du plateau. Vous gagnez immédiatement si vous <b>posez une troupe sur un Q.G. adverse</b>, ou si vous <b>atteignez l'objectif de médailles</b> du terrain.</p>
    <h3>À votre tour, une seule action</h3><ul><li><b>Piocher</b> : 2 troupes de votre réserve (1 seule s'il ne reste qu'une place ou qu'une tuile). Le support contient 8 troupes au maximum.</li><li><b>Poser</b> : touchez une troupe de votre support, puis une base en surbrillance. Appliquez ensuite son effet, puis celui de la base spéciale.</li></ul>
    <h3>Où poser ?</h3><ul><li>Sur une base vide, sur l'une de vos troupes, ou sur une troupe adverse <b>strictement plus faible</b>.</li><li>Toujours <b>reliée à votre Q.G.</b> par un chemin continu de bases que vous occupez. Une base vide ou adverse coupe le chemin.</li><li>Jamais sur votre propre Q.G. Seule la troupe du dessus d'une pile compte.</li></ul>
    <h3>Régions et médailles</h3><p>Une région est une zone fermée entourée de bases. Dès que vous occupez toutes ses bases, vous gagnez ses médailles pour toute la partie, même si vous perdez la région ensuite.</p>
    <h3>Fin de partie bloquée</h3><p>Si un joueur ne peut plus ni piocher ni poser, la partie s'arrête : le plus de médailles l'emporte. À égalité, celui qui ne pouvait plus jouer perd.</p>
    <h3>Les jouets</h3><ul>${content.troops.map(t => `<li><b>${esc(t.name)} (${t.joker ? "joker" : t.strength})</b> : ${esc(t.effect)}</li>`).join("")}</ul>
    <h3>Les terrains</h3><ul>${content.order.map(id => `<li><b>${esc(content.terrains[id].name)}</b> : ${esc(EFFECT_FR[content.terrains[id].effect])}</li>`).join("")}</ul>
    <p style="color:var(--ink-soft);font-size:13px">Mécaniques inspirées du jeu de société Toy Battle (Repos Production). Personnages, illustrations et terrains de cette version sont originaux.</p>`;

  // ------------------------------------------------------------------ game state
  let G = null;           // { mode, s, viewer, ai:[], names:[], level, code, mySide }
  let UI = { sel: null, busy: false, drop: new Set(), flash: new Set(), newTiles: new Set(), log: [] };

  function randomSeed() { return BigInt(Math.floor(Math.random() * 2 ** 31)) * 4294967296n + BigInt(Math.floor(Math.random() * 2 ** 32)); }

  function startLocal() {
    const s = engine.newGame(setup.terrain, randomSeed(), { special: setup.special });
    G = { mode: setup.mode, s, level: setup.level, viewer: 0 };
    initGame();
    if (G.mode === "hotseat") { G.viewer = s.active; passScreen(true); }
    afterTurnChange();
  }
  function initGame() {
    const m = G.mode;
    G.ai = [null, null];
    if (m === "ai") { G.ai[1] = new Ai(engine, G.level); G.viewer = 0; G.names = ["Vous", "Ordinateur (" + { easy: "facile", normal: "normal", hard: "difficile" }[G.level] + ")"]; }
    else if (m === "hotseat") G.names = ["Joueur Bleu", "Joueur Rouge"];
    else G.names = G.mySide === 0 ? ["Vous", "Adversaire"] : ["Adversaire", "Vous"];
    if (m === "online") G.viewer = G.mySide;
    UI = { sel: null, busy: false, drop: new Set(), flash: new Set(), newTiles: new Set(), log: [] };
    document.getElementById("game").style.setProperty("--board-bg", THEME[G.s.terrain].bg);
    screenStack = ["home", "game"];
    show("game", false);
    requestWake();
    render();
  }
  function resume() {
    const sv = store.get("ptt-save", null);
    if (!sv) return;
    if (sv.mode === "online") { onlineRejoin(sv.code); return; }
    G = { mode: sv.mode, s: sv.state, level: sv.level || "normal", viewer: sv.viewer || 0 };
    initGame();
    if (G.mode === "hotseat") { G.viewer = G.s.active; passScreen(true); }
    afterTurnChange();
  }
  function save() {
    if (!G) return;
    if (G.s.phase === "GameOver") { store.del("ptt-save"); return; }
    store.set("ptt-save", { mode: G.mode, state: G.s, level: G.level, viewer: G.viewer, code: G.code });
  }
  let wake = null;
  async function requestWake() { try { wake = await navigator.wakeLock.request("screen"); } catch (e) { /* not granted */ } }

  const myControl = () => G && G.s.phase !== "GameOver" && G.s.active === G.viewer && !G.ai[G.s.active] && (G.mode !== "online" || G.s.active === G.mySide);

  // ------------------------------------------------------------------ rendering
  function render() {
    if (!G) return;
    const s = G.s, me = G.viewer, opp = 1 - me, t = content.terrains[s.terrain];
    const targets = new Set();
    if (myControl()) {
      if ((s.phase === "TurnAction" || (s.pending && s.pending.kind === "ExtraPlacement")) && UI.sel != null) engine.legalTargets(s, me, UI.sel).forEach(n => targets.add(n));
      if (s.pending) engine.legal(s).forEach(c => { if (c.t === "Choose" && c.node) targets.add(c.node); });
    }
    const { svg, vb } = boardSvg(s.terrain, s, me, { targets, drop: UI.drop, flash: UI.flash });
    const board = $("board");
    board.setAttribute("viewBox", vb.join(" "));
    board.innerHTML = svg;
    UI.drop = new Set(); UI.flash = new Set();

    // opponent pill
    const op = s.players[opp], mp = s.players[me];
    $("oppPill").className = "side-pill " + (opp === 0 ? "blue" : "red") + (s.active === opp && s.phase !== "GameOver" ? " active" : "");
    $("oppName").textContent = G.names[opp];
    const picking = myControl() && s.pending && s.pending.kind === "DesignateOpponentRack";
    const pickable = picking ? new Set(engine.designatable(s, me)) : new Set();
    $("oppRack").innerHTML = op.rack.map((tile, i) => `<button class="back ${opp === 0 ? "blue" : ""} ${op.laid.includes(tile) ? "laid" : ""} ${pickable.has(i) ? "pick" : ""}" data-slot="${i}" aria-label="Troupe cachée ${i + 1}" ${pickable.has(i) ? "" : "tabindex=-1"}></button>`).join("") +
      `<span style="margin-left:6px">${op.rack.length}/8 · réserve ${op.reserve.length}</span>`;
    $("oppMedals").innerHTML = `<span class="coin">★</span>${op.medals}/${t.goal[opp]}`;
    $("myPill").className = "side-pill " + (me === 0 ? "blue" : "red") + (s.active === me && s.phase !== "GameOver" ? " active" : "");
    $("myName").textContent = G.names[me];
    $("myMeta").textContent = `Réserve ${mp.reserve.length} · Défausse ${s.discard.length}`;
    $("myMedals").innerHTML = `<span class="coin">★</span>${mp.medals}/${t.goal[me]}`;

    // rack
    const sideVar = me === 0 ? "--side:#2f7fd8;--side-dark:#1c4f96" : "--side:#e2483d;--side-dark:#9b2a22";
    const canPick = myControl() && (s.phase === "TurnAction" || (s.pending && s.pending.kind === "ExtraPlacement"));
    $("rack").innerHTML = mp.rack.map((tile, i) => {
      const tr = content.troop(tile);
      return `<button class="rtile ${mp.laid.includes(tile) ? "laid" : ""} ${UI.newTiles.has(tile) ? "new" : ""}" style="${sideVar};--i:${i}" data-tile="${tile}" aria-pressed="${UI.sel === tile}" aria-label="${esc(tr.name)}, force ${tr.joker ? "joker" : tr.strength}" ${canPick ? "" : 'aria-disabled="true"'}><img src="${IMG[tr.id]}" alt=""><span class="str s">${tr.joker ? "★" : tr.strength}</span></button>`;
    }).join("") || `<div class="info" style="padding:18px 4px">Support vide : piochez !</div>`;
    UI.newTiles = new Set();
    const n = engine.drawable(s, me, 2);
    $("drawBtn").textContent = n > 0 ? `Piocher ${n}` : "Piocher";
    $("drawBtn").disabled = !(myControl() && s.phase === "TurnAction" && engine.canDraw(s, me));
    const selT = UI.sel != null ? content.troop(UI.sel) : null;
    $("tileInfo").textContent = selT ? `${selT.name} (${selT.joker ? "joker" : selT.strength}) : ${selT.effect}` : "Touchez une troupe pour voir son effet.";
    renderPrompt();
  }

  function setPrompt(text, buttons = [], extra = "") {
    $("promptTxt").innerHTML = text + extra;
    const acts = $("promptActs");
    acts.innerHTML = "";
    for (const [label, cls, fn] of buttons) {
      const b = document.createElement("button");
      b.className = "btn small " + (cls || "");
      b.textContent = label;
      b.addEventListener("click", () => { SFX.click(); fn(); });
      acts.appendChild(b);
    }
  }
  function renderPrompt() {
    const s = G.s, me = G.viewer;
    if (s.phase === "GameOver") {
      const head = G.mode === "hotseat" ? "Victoire " + SIDE[s.winner] : s.winner === me ? "Victoire !" : "Défaite…";
      setPrompt(`<b>${head}</b> · ${esc(WIN_FR[s.winReason])}`, [["Résultat", "primary", showResult]]);
      return;
    }
    if (!myControl()) {
      if (G.ai[s.active]) setPrompt(`<span class="thinking">${esc(G.names[s.active])} réfléchit</span>`);
      else if (G.mode === "online") setPrompt(`<span class="thinking">Tour de l'adversaire</span>`);
      else setPrompt("");
      return;
    }
    const d = s.pending, side = me, skip = ["Passer", "", () => act({ t: "Skip", p: side })];
    if (!d) {
      setPrompt(UI.sel == null ? "<b>À vous !</b> Touchez une troupe de votre support, ou piochez." : `Touchez une base en surbrillance pour poser <b>${esc(troopName(UI.sel))}</b>.`);
      return;
    }
    const src = d.src >= 0 ? esc(troopName(d.src)) : "";
    switch (d.kind) {
      case "ExtraPlacement": setPrompt(`<b>${src}</b> : posez une troupe supplémentaire.`, [skip]); break;
      case "TroopDraw": setPrompt(`<b>${src}</b> : piocher ${d.n} troupe${d.n > 1 ? "s" : ""} ?`, [["Piocher", "primary", () => act({ t: "Choose", p: side })], ["Non", "", skip[2]]]); break;
      case "TerrainDraw": setPrompt(`Base spéciale : piocher 1 troupe ?`, [["Piocher", "primary", () => act({ t: "Choose", p: side })], ["Non", "", skip[2]]]); break;
      case "DiscardRandomConfirm": setPrompt(`<b>${src}</b> : arroser une troupe au hasard du support adverse ?`, [["Arroser !", "red", () => act({ t: "Choose", p: side })], ["Non", "", skip[2]]]); break;
      case "DiscardAdjacentTarget": setPrompt(`<b>${src}</b> : touchez une troupe adverse voisine pour la défausser.`, [skip]); break;
      case "RecallOwnTroop": setPrompt(`Base spéciale : touchez une autre de vos troupes pour la reprendre sur votre support.`, [skip]); break;
      case "MoveEnemySource": setPrompt(`Éruption ! Touchez une troupe adverse voisine à déplacer.`, [skip]); break;
      case "MoveEnemyDestination": setPrompt(`Touchez la base où la troupe atterrit.`); break;
      case "Bounce": setPrompt(`Boing ! Touchez une base vide voisine pour faire rebondir <b>${src}</b>.`, [["Rester", "", skip[2]]]); break;
      case "DesignateOpponentRack": setPrompt(`Sniper : touchez une troupe cachée du support adverse (en haut) pour la coucher.`); break;
      case "RecoverFromDiscard": {
        const tiles = engine.recoverable(s, side);
        setPrompt(`Base spéciale : reprenez une troupe défaussée.`, [skip],
          `<div class="mini">${tiles.map(tl => `<button data-recover="${tl}" aria-label="${esc(troopName(tl))}" style="background-image:url(${IMG[content.troop(tl).id]})"></button>`).join("")}</div>`);
        $("promptTxt").querySelectorAll("[data-recover]").forEach(b => b.addEventListener("click", () => act({ t: "Choose", p: side, tile: Number(b.dataset.recover) })));
        break;
      }
      default: setPrompt(d.kind);
    }
  }

  // ------------------------------------------------------------------ input
  $("rack").addEventListener("click", e => {
    const b = e.target.closest("[data-tile]");
    if (!b) return;
    const tile = Number(b.dataset.tile), s = G.s;
    SFX.click();
    if (!myControl() || !(s.phase === "TurnAction" || (s.pending && s.pending.kind === "ExtraPlacement"))) {
      UI.sel = UI.sel === tile ? null : tile; render(); UI.sel = null; return; // inspect only
    }
    if (s.players[G.viewer].laid.includes(tile)) { toast(RULE_FR.TileLaidDown); return; }
    UI.sel = UI.sel === tile ? null : tile;
    if (UI.sel != null && engine.legalTargets(s, G.viewer, tile).length === 0) toast("Aucune base possible pour cette troupe en ce moment.");
    render();
  });
  $("drawBtn").addEventListener("click", () => { UI.sel = null; act({ t: "Draw", p: G.viewer }); });
  $("oppRack").addEventListener("click", e => {
    const b = e.target.closest("[data-slot]");
    if (!b || !myControl() || !G.s.pending || G.s.pending.kind !== "DesignateOpponentRack") return;
    act({ t: "Choose", p: G.viewer, idx: Number(b.dataset.slot) });
  });
  $("board").addEventListener("click", e => {
    const g = e.target.closest("[data-node]");
    if (!g || !G) return;
    const id = g.dataset.node, s = G.s, me = G.viewer;
    if (myControl()) {
      const placing = s.phase === "TurnAction" || (s.pending && s.pending.kind === "ExtraPlacement");
      if (placing && UI.sel != null) {
        const err = engine.checkPlacement(s, me, UI.sel, id);
        if (err === "None") { const tile = UI.sel; UI.sel = null; act({ t: "Place", p: me, tile, node: id }); }
        else { SFX.error(); toast(RULE_FR[err] || err); }
        return;
      }
      if (s.pending) {
        const c = engine.legal(s).find(c => c.t === "Choose" && c.node === id);
        if (c) { act(c); return; }
      }
    }
    inspect(id);
  });
  function inspect(id) {
    const s = G.s, st = s.stacks[id], n = content.terrains[s.terrain].node[id];
    if (!st || !st.length) {
      if (n.type === "hq") toast(`Q.G. ${SIDE[n.owner]}${n.allowed ? " : valeurs " + n.allowed.join(", ") : ""}`);
      else if (n.type === "special" && s.special) toast(EFFECT_FR[content.terrains[s.terrain].effect]);
      return;
    }
    const rows = st.slice().reverse().map((tile, i) => {
      const tr = content.troop(tile);
      return `<div style="display:flex;gap:10px;align-items:center;text-align:left"><img src="${IMG[tr.id]}" alt="" style="width:46px;height:46px;border-radius:50%;border:4px solid ${content.owner(tile) ? "#e2483d" : "#2f7fd8"}"><div><b>${esc(tr.name)}</b> (${tr.joker ? "joker" : tr.strength}) · ${SIDE[content.owner(tile)]}${i === 0 ? " · <i>visible</i>" : ""}</div></div>`;
    }).join("");
    modal(`<h2>Pile (${st.length})</h2><p style="font-size:13px;color:var(--ink-soft)">Du dessus vers le dessous. Seule la troupe du dessus occupe la base.</p><div style="display:grid;gap:8px">${rows}</div><button class="btn" data-close>Fermer</button>`,
      (o, close) => o.querySelector("[data-close]").addEventListener("click", close));
  }

  $("menuBtn").addEventListener("click", () => {
    SFX.click();
    const logHtml = UI.log.slice(-40).reverse().map(l => `<div class="${l.side === 0 ? "b" : "r"}">${esc(l.text)}</div>`).join("") || "<div>Rien pour l'instant.</div>";
    modal(`<h2>Partie</h2>
      <p style="font-size:14px">${esc(content.terrains[G.s.terrain].name)} · tour ${G.s.turn}${G.mode === "online" ? " · code " + esc(G.code) : ""}</p>
      <button class="btn" data-a="rules">Règles</button>
      <button class="btn" data-a="sound">${opts.sound ? "Couper le son" : "Activer le son"}</button>
      <button class="btn red" data-a="quit">Quitter la partie</button>
      <div class="label" style="text-align:left">Historique</div><div class="log">${logHtml}</div>
      <button class="btn primary" data-a="close">Continuer</button>`, (o, close) => {
      o.addEventListener("click", e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        SFX.click();
        if (a.dataset.a === "close") close();
        if (a.dataset.a === "sound") { opts.sound = !opts.sound; store.set("ptt-opts", opts); $("optSound").checked = opts.sound; close(); }
        if (a.dataset.a === "rules") { close(); $("rulesText").innerHTML = RULES_HTML; show("rules"); }
        if (a.dataset.a === "quit") { close(); quitGame(); }
      });
    });
  });
  function quitGame() {
    save();
    if (ON.unsub) { ON.unsub(); ON.unsub = null; }
    G = null; screenStack = ["home"]; show("home", false); refreshHome();
  }

  // ------------------------------------------------------------------ applying commands
  function act(cmd) {
    if (!G || UI.busy) return;
    if (!myControl() && !G.ai[G.s.active]) return;
    const prevActive = G.s.active;
    const r = engine.apply(G.s, cmd);
    if (r.error !== "None") { SFX.error(); toast(RULE_FR[r.error] || r.error); render(); return; }
    if (G.mode === "online") onlinePush(r.events);
    handleEvents(r.events, prevActive);
  }

  function describe(e) {
    const who = SIDE[e.p];
    const nm = t => (t != null && t >= 0 ? troopName(t) : "une troupe");
    switch (e.type) {
      case "TilesDrawn": return `${who} pioche ${e.n} troupe${e.n > 1 ? "s" : ""}`;
      case "TroopPlaced": return `${who} pose ${nm(e.tile)} sur ${e.node}${e.covered >= 0 ? " (recouvre " + nm(e.covered) + ")" : ""}`;
      case "AbilityBlocked": return `Bouclier : l'effet de ${nm(e.tile)} est annulé`;
      case "EffectSkipped": return `${who} renonce à l'effet`;
      case "TroopDiscarded": return `${nm(e.tile)} est défaussée${e.node ? " de " + e.node : " du support"}`;
      case "TroopReturnedToRack": return `${nm(e.tile)} retourne sur le support ${e.p ? "rouge" : "bleu"}`;
      case "TroopMoved": return `${nm(e.tile)} va de ${e.node} à ${e.to}`;
      case "TroopRecovered": return `${who} récupère ${nm(e.tile)} dans la défausse`;
      case "TroopLaidDown": return `${who} couche une troupe adverse`;
      case "RegionCaptured": return `${who} prend une région : +${e.n} médaille${e.n > 1 ? "s" : ""}`;
      case "HqCaptured": return `${who} capture le Q.G. !`;
      case "GameOver": return `Victoire ${who}`;
      default: return null;
    }
  }

  function nodeCenter(id) {
    const el = $("board").querySelector(`[data-node="${CSS.escape(id)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function ghost(tile, from, to, spin) {
    if (!opts.speed || !from || !to) return;
    const d = document.createElement("div");
    d.className = "ghost";
    d.style.backgroundImage = `url(${IMG[content.troop(tile).id]})`;
    d.style.borderColor = content.owner(tile) ? "#e2483d" : "#2f7fd8";
    d.style.left = from[0] - 23 + "px"; d.style.top = from[1] - 23 + "px";
    $("layer").appendChild(d);
    const dx = to[0] - from[0], dy = to[1] - from[1], dur = 700 * opts.speed;
    d.animate([{ transform: "translate(0,0) scale(1) rotate(0)" }, { transform: `translate(${dx / 2}px,${dy / 2 - 60}px) scale(1.15) rotate(${spin ? 200 : 0}deg)`, offset: 0.5 },
      { transform: `translate(${dx}px,${dy}px) scale(${spin ? 0.3 : 1}) rotate(${spin ? 400 : 0}deg)`, opacity: spin ? 0 : 1 }], { duration: dur, easing: "ease-in-out" }).onfinish = () => d.remove();
  }
  function floater(text, at, color) {
    if (!at) return;
    const f = document.createElement("div");
    f.className = "floater"; f.textContent = text; f.style.left = at[0] + "px"; f.style.top = at[1] + "px";
    if (color) f.style.color = color;
    $("layer").appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
  function confetti() {
    if (!opts.speed) return;
    const colors = ["#f6c343", "#f2845c", "#2f7fd8", "#e2483d", "#6bbf59", "#b8a1e3"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.6 + "s";
      c.style.animationDuration = 1.8 + Math.random() * 1.4 + "s";
      $("layer").appendChild(c);
      setTimeout(() => c.remove(), 3600);
    }
  }

  function handleEvents(events, prevActive) {
    // positions of nodes before re-render (for things leaving the board)
    const before = {};
    for (const e of events) if (e.node && (e.type === "TroopDiscarded" || e.type === "TroopReturnedToRack" || e.type === "TroopMoved")) before[e.node] = nodeCenter(e.node);
    const me = G.viewer;
    let sound = null;
    for (const e of events) {
      const txt = describe(e);
      if (txt) UI.log.push({ side: e.p, text: txt });
      switch (e.type) {
        case "TroopPlaced": UI.drop.add(e.node); sound = sound || (e.covered >= 0 ? "cover" : "place"); break;
        case "TilesDrawn":
          if (e.p === me) e.tiles.forEach(t => UI.newTiles.add(t)); else if (e.n) toast(`${G.names[e.p]} pioche ${e.n} troupe${e.n > 1 ? "s" : ""}`);
          sound = sound || "draw"; break;
        case "RegionCaptured": UI.flash.add(e.region); break;
        case "AbilityBlocked": toast("Bouclier anti-effet : l'effet ne s'applique pas ici."); break;
        case "TroopLaidDown": if (content.owner(e.tile) === me) toast(`Votre ${troopName(e.tile)} est couchée pour un tour.`); break;
        case "TroopDiscarded": if (!e.node && content.owner(e.tile) === me) toast(`Pif-Pof arrose votre ${troopName(e.tile)} !`); break;
      }
    }
    render();
    if (sound) SFX[sound]();
    let delay = 0;
    const step = 220 * (opts.speed || 0);
    for (const e of events) {
      if (e.type === "TroopDiscarded" && e.node) { const f = before[e.node]; setTimeout(() => { ghost(e.tile, f, f && [f[0], -60], true); SFX.pop(); }, delay); delay += step; }
      if (e.type === "TroopReturnedToRack") { const f = before[e.node]; setTimeout(() => { ghost(e.tile, f, [window.innerWidth / 2, window.innerHeight], false); SFX.pop(); }, delay); delay += step; }
      if (e.type === "TroopMoved") { const f = before[e.node], to = nodeCenter(e.to); setTimeout(() => { ghost(e.tile, f, to, false); SFX.boing(); }, delay); delay += step; }
      if (e.type === "RegionCaptured") {
        const r = content.terrains[G.s.terrain].regions.find(x => x.id === e.region);
        const ps = r.bases.map(nodeCenter).filter(Boolean);
        const at = ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] : null;
        setTimeout(() => { floater(`+${e.n}★`, at, e.p ? "#ffd6cf" : "#d6e8ff"); SFX.medal(); }, delay); delay += step;
      }
    }
    save();
    const over = events.find(e => e.type === "GameOver");
    if (over) {
      setTimeout(() => {
        const human = G.mode === "ai" ? G.s.winner === 0 : G.mode === "online" ? G.s.winner === G.mySide : true;
        (human ? SFX.win : SFX.lose)(); if (human) confetti();
        setTimeout(showResult, 900 * Math.max(opts.speed, 0.3));
      }, delay + 300);
      return;
    }
    afterTurnChange(prevActive);
  }

  function afterTurnChange(prevActive) {
    const s = G.s;
    if (s.phase === "GameOver") return;
    // auto-accept draw effects for the local human
    if (myControl() && opts.autoDraw && s.pending && (s.pending.kind === "TroopDraw" || s.pending.kind === "TerrainDraw")) {
      setTimeout(() => act({ t: "Choose", p: s.active }), 350 * Math.max(opts.speed, 0.4));
      return;
    }
    if (G.mode === "hotseat" && prevActive != null && s.active !== prevActive) { passScreen(false); return; }
    if (G.ai[s.active]) {
      UI.busy = true;
      render();
      setTimeout(() => {
        const bot = G && G.ai[G.s.active];
        if (!bot) { UI.busy = false; return; }
        const cmd = bot.choose(G.s, G.s.active);
        UI.busy = false;
        act(cmd);
      }, (s.phase === "TurnAction" ? 750 : 450) * Math.max(opts.speed, 0.25));
    }
  }

  function passScreen(first) {
    const s = G.s, next = s.active;
    setTimeout(() => {
      modal(`<h2 style="color:${next ? "var(--tomato)" : "var(--blue)"}">Au tour de ${SIDE[next]}</h2>
        <p>${first ? `${SIDE[next]} commence la partie. ` : ""}Passez le téléphone : le support de l'autre joueur reste caché.</p>
        <button class="btn ${next ? "red" : "blue"}" data-go>Je suis ${SIDE[next]}, c'est parti !</button>`, (o, close) => {
        o.dataset.locked = "1";
        o.style.background = next ? "#e2483d" : "#2f7fd8";
        o.querySelector("[data-go]").addEventListener("click", () => { SFX.click(); G.viewer = next; close(); render(); });
      });
    }, first ? 0 : 900 * Math.max(opts.speed, 0.3));
  }

  function showResult() {
    const s = G.s, t = content.terrains[s.terrain];
    let title = `Victoire ${SIDE[s.winner]} !`;
    if (G.mode === "ai") title = s.winner === 0 ? "Vous avez gagné !" : "L'ordinateur gagne…";
    if (G.mode === "online") title = s.winner === G.mySide ? "Vous avez gagné !" : "Votre adversaire gagne…";
    const hero = [...s.stacks[Object.keys(s.stacks).find(k => t.node[k].type === "hq" && s.stacks[k].length)] || []].pop();
    const img = hero != null ? IMG[content.troop(hero).id] : IMG[s.winner ? "roxy" : "captain"];
    modal(`<img class="big" src="${img}" alt=""><h2>${esc(title)}</h2><p>${esc(WIN_FR[s.winReason])}</p>
      <p style="font-family:var(--font-display);font-size:20px">Médailles : <span style="color:var(--blue)">Bleu ${s.players[0].medals}</span> · <span style="color:var(--tomato)">Rouge ${s.players[1].medals}</span></p>
      ${G.mode !== "online" ? '<button class="btn primary" data-a="again">Rejouer ce terrain</button>' : ""}
      <button class="btn" data-a="board">Revoir le plateau</button><button class="btn" data-a="menu">Menu</button>`, (o, close) => {
      o.addEventListener("click", e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        SFX.click(); close();
        if (a.dataset.a === "again") { setup.mode = G.mode; setup.terrain = s.terrain; setup.level = G.level; setup.special = s.special; startLocal(); }
        if (a.dataset.a === "menu") quitGame();
      });
    });
  }

  // ------------------------------------------------------------------ two phones (shared artifact store)
  const ON = { db: null, uid: null, ref: null, unsub: null, writing: Promise.resolve(), ready: false };
  const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function lobbyStatus(html) { $("lobbyStatus").innerHTML = html; }
  async function onlineInit() {
    if (ON.ready) return true;
    if (!window.claude || !window.claude.use) { lobbyStatus("Le mode deux téléphones fonctionne quand le jeu est ouvert dans Claude (lien de partage). Ici, jouez contre l'ordinateur ou à deux sur ce téléphone."); return false; }
    const timer = new Promise(r => setTimeout(() => r(null), 10000));
    ON.db = await Promise.race([window.claude.use("db"), timer]);
    if (!ON.db) { lobbyStatus("Le partage de partie n'est pas disponible pour vous sur cette page (connexion à Claude requise, avec un accès en modification au jeu)."); return false; }
    let uid = null;
    try { const user = await window.claude.use("user"); uid = user ? await user.id() : null; } catch (e) { uid = null; }
    if (!uid) { uid = store.get("ptt-uid", null) || "dev-" + Math.random().toString(36).slice(2, 10); store.set("ptt-uid", uid); }
    ON.uid = uid; ON.ready = true;
    return true;
  }
  async function openLobby() {
    show("lobby");
    $("waitBox").hidden = true;
    $("lobbyActions").hidden = true;
    lobbyStatus("Connexion au service de partage…");
    if (await onlineInit()) {
      lobbyStatus("Créez une partie et donnez le code à votre adversaire, ou entrez son code. Chaque joueur ouvre ce même jeu sur son téléphone.");
      $("lobbyActions").hidden = false;
    }
  }
  $("createOnline").addEventListener("click", () => { SFX.click(); setup.mode = "online"; openSetup(); });
  $("joinOnline").addEventListener("click", () => { SFX.click(); onlineJoin($("codeIn").value.trim().toUpperCase()); });
  async function onlineCreate() {
    if (!(await onlineInit())) { openLobby(); return; }
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
    const s = engine.newGame(setup.terrain, randomSeed(), { special: setup.special });
    ON.ref = ON.db.doc("games/" + code);
    try {
      await ON.ref.set({ v: 1, code, seq: 0, state: JSON.stringify(s), events: "[]", blue: ON.uid, red: "", created: Date.now() });
    } catch (e) { toast("Impossible de créer la partie (" + (e && e.code || "erreur") + ")."); return; }
    show("lobby");
    $("lobbyActions").hidden = true;
    $("waitBox").hidden = false;
    $("codeOut").textContent = code;
    lobbyStatus("Partie créée sur « " + esc(content.terrains[setup.terrain].name) + " ». Vous jouez les Bleus.");
    subscribe(code, 0);
  }
  async function onlineJoin(code) {
    if (!/^[A-Z0-9]{5}$/.test(code)) { toast("Le code fait 5 caractères."); return; }
    if (!(await onlineInit())) return;
    ON.ref = ON.db.doc("games/" + code);
    let snap;
    try { snap = await ON.ref.get(); } catch (e) { toast("Service indisponible, réessayez."); return; }
    if (!snap.exists) { toast("Aucune partie avec ce code."); return; }
    const d = snap.data();
    let side;
    if (d.blue === ON.uid) side = 0;
    else if (d.red === ON.uid) side = 1;
    else if (!d.red) {
      try { await ON.ref.update({ red: ON.uid }); } catch (e) { toast("Impossible de rejoindre : il faut un accès en modification au jeu."); return; }
      side = 1;
    } else { toast("Cette partie a déjà deux joueurs."); return; }
    subscribe(code, side);
  }
  async function onlineRejoin(code) {
    show("lobby");
    if (await onlineInit()) onlineJoin(code);
  }
  function subscribe(code, side) {
    if (ON.unsub) ON.unsub();
    let started = false;
    ON.unsub = ON.ref.onSnapshot(snap => {
      if (!snap.exists) return;
      const d = snap.data();
      if (!started) {
        if (!d.red) return; // waiting for the second player
        started = true;
        G = { mode: "online", s: JSON.parse(d.state), mySide: side, code, level: null };
        initGame();
        SFX.win();
        toast(side === 0 ? "Votre adversaire est là !" : "Vous jouez les Rouges.");
        afterTurnChange();
        return;
      }
      if (!G || G.mode !== "online" || G.code !== code) return;
      if (d.seq > G.s.seq) {
        const prevActive = G.s.active;
        G.s = JSON.parse(d.state);
        const evs = JSON.parse(d.events || "[]").map(e => Object.assign({}, e, e.type === "TilesDrawn" && e.p !== G.mySide ? { tiles: [] } : {}));
        handleEvents(evs, prevActive);
      }
    }, err => { toast("Connexion à la partie perdue (" + (err && err.code) + "). Revenez au menu pour la reprendre."); });
  }
  function onlinePush(events) {
    const payload = { seq: G.s.seq, state: JSON.stringify(G.s), events: JSON.stringify(events) };
    ON.writing = ON.writing.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await ON.ref.update(payload); return; }
        catch (e) { if (attempt === 2) toast("Coup non envoyé : vérifiez la connexion, puis rouvrez la partie depuis le menu."); else await new Promise(r => setTimeout(r, 800 + Math.random() * 600)); }
      }
    });
  }

  refreshHome();
})();
