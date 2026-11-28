// Replays games recorded by the C# engine (`ptt dump`) in the JavaScript engine and compares final states.
// Usage: dotnet ptt.dll dump --games 30 > dump.jsonl ; node web/tools/crosscheck.mjs dump.jsonl
// Then plays random and AI games in JS to check invariants.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const contentDir = path.join(root, "Packages", "com.pockettoytactics.core", "Content");
await import(path.join(here, "..", "src", "engine.js"));
const { Content, Engine, Ai } = globalThis.PTT;

const troops = JSON.parse(fs.readFileSync(path.join(contentDir, "troops.json"), "utf8"));
const terrains = fs.readdirSync(path.join(contentDir, "terrains")).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(contentDir, "terrains", f), "utf8")));
const content = new Content(troops, terrains);
const engine = new Engine(content);
const side = k => (k === "blue" ? 0 : 1);
let failures = 0;

function compare(label, a, b) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) { failures++; if (failures < 10) console.log("MISMATCH", label, "\n  C#:", sb.slice(0, 300), "\n  JS:", sa.slice(0, 300)); }
}

const file = process.argv[2];
let replayed = 0;
if (file) {
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const g = JSON.parse(line), f = g.final;
    const s = engine.newGame(g.terrain, BigInt(g.seed), { special: g.special });
    for (const c of f.history) {
      const cmd = { t: c.t, p: side(c.p) };
      if (c.tile != null) cmd.tile = c.tile;
      if (c.node != null) cmd.node = c.node;
      if (c.idx != null) cmd.idx = c.idx;
      const r = engine.apply(s, cmd);
      if (r.error !== "None") { failures++; console.log("REJECTED", g.terrain, JSON.stringify(c), r.error); break; }
    }
    const id = g.terrain + "#" + g.seed;
    compare(id + " players", s.players.map(p => [p.reserve, p.rack, p.removed, p.laid, p.known, p.medals]),
      f.players.map(p => [p.reserve, p.rack, p.removed, p.laid, p.known, p.medals]));
    compare(id + " stacks", s.stacks, f.stacks);
    compare(id + " discard", s.discard, f.discard);
    compare(id + " claims", Object.fromEntries(Object.entries(s.claims).map(([k, v]) => [k, v ? "red" : "blue"])), f.claims);
    compare(id + " end", [s.phase, s.turn, s.seq, s.winner == null ? null : s.winner ? "red" : "blue", s.winReason, s.endedBy == null ? null : s.endedBy ? "red" : "blue", s.rng],
      [f.phase, f.turn, f.seq, f.winner, f.winReason, f.endedBy, f.rng]);
    replayed++;
  }
  console.log(`replayed ${replayed} C# games, ${failures} mismatches`);
}

// Random and AI self-play in JS: termination and tile conservation.
let games = 0;
for (const t of content.order) {
  for (let g = 0; g < 12; g++) {
    const s = engine.newGame(t, BigInt(9000 + g), { special: g % 4 !== 3 });
    const ais = g % 3 === 0 ? [new Ai(engine, "normal"), new Ai(engine, g % 2 ? "hard" : "easy")] : null;
    let steps = 0;
    while (s.phase !== "GameOver") {
      const c = ais ? ais[s.active].choose(s, s.active) : (l => l[Math.floor(Math.random() * l.length)])(engine.legal(s));
      const r = engine.apply(s, c);
      if (r.error !== "None") { failures++; console.log("AI/random illegal", t, JSON.stringify(c), r.error); break; }
      if (++steps > 3000) { failures++; console.log("no end", t); break; }
    }
    const all = [];
    for (const p of s.players) all.push(...p.reserve, ...p.rack, ...p.removed);
    for (const st of Object.values(s.stacks)) all.push(...st);
    all.push(...s.discard);
    if (all.length !== 48 || new Set(all).size !== 48) { failures++; console.log("conservation broken", t); }
    games++;
  }
}
console.log(`self-played ${games} JS games`);
console.log(failures ? `FAILED (${failures})` : "OK");
process.exit(failures ? 1 : 0);
