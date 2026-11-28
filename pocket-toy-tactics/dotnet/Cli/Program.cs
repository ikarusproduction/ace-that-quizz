using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Threading;
using PocketToyTactics.Core;
using PocketToyTactics.Core.Net;

namespace PocketToyTactics.Cli
{
    /// <summary>
    /// ptt - text-mode test harness for the Pocket Toy Tactics core.
    ///   ptt terrains
    ///   ptt play     [--terrain id] [--blue human|easy|normal|hard] [--red ...] [--seed n] [--beginner]
    ///   ptt simulate [--terrain id|all] [--blue level] [--red level] [--games n] [--seed n]
    ///   ptt host     [--terrain id] [--name x] [--port n] [--side blue|red] [--ai level] [--seed n]
    ///   ptt join     [code|ip[:port]] [--name x] [--ai level]
    ///   ptt discover [--seconds n]
    /// </summary>
    public static class Program
    {
        private static readonly Stopwatch Clock = Stopwatch.StartNew();
        private static double Now() => Clock.Elapsed.TotalSeconds;

        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            var a = new Args(args);
            var db = ContentFiles.Load();
            switch (a.Verb)
            {
                case "terrains": return Terrains(db);
                case "play": return Play(db, a);
                case "simulate": return Simulate(db, a);
                case "host": return Host(db, a);
                case "join": return Join(db, a);
                case "discover": return Discover(a);
                default:
                    Console.WriteLine("usage: ptt terrains | play | simulate | host | join | discover  (see Program.cs header)");
                    return 2;
            }
        }

        private static int Terrains(ContentDatabase db)
        {
            foreach (var id in db.TerrainOrder)
            {
                var t = db.Terrain(id);
                Console.WriteLine($"{t.Id,-18} {t.Name,-26} ref={t.ReferenceTerrain,-22} effet={t.SpecialEffect,-24} " +
                                  $"bases={t.Nodes.Count(n => n.IsBase),2} spéciales={t.Nodes.Count(n => n.IsSpecial)} régions={t.Regions.Count,2} " +
                                  $"médailles={t.TotalMedals,2} objectif B{t.MedalGoal[0]}/R{t.MedalGoal[1]}");
            }
            return 0;
        }

        private static AiLevel? ParseLevel(string s)
        {
            switch ((s ?? "human").ToLowerInvariant())
            {
                case "easy": return AiLevel.Easy;
                case "normal": return AiLevel.Normal;
                case "hard": return AiLevel.Hard;
                default: return null;
            }
        }

        // ------------------------------------------------------------------ local play

        private static int Play(ContentDatabase db, Args a)
        {
            var engine = new RulesEngine(db);
            var ui = new TextUi(db);
            ulong seed = (ulong)a.Long("seed", Environment.TickCount);
            var options = new GameOptions { SpecialBasesEnabled = !a.Has("beginner") };
            var s = engine.NewGame(a.Get("terrain", "castle_plain"), seed, options);
            var ai = new Dictionary<Side, AiPlayer>();
            foreach (var side in new[] { Side.Blue, Side.Red })
            {
                var lvl = ParseLevel(a.Get(side.Key(), side == Side.Blue ? "human" : "normal"));
                if (lvl != null) ai[side] = new AiPlayer(db, lvl.Value, seed ^ (ulong)(side + 1));
            }
            Console.WriteLine($"Graine {seed}. Premier joueur : {TextUi.SideFr(s.FirstPlayer)}.");
            while (s.Phase != Phase.GameOver)
            {
                var view = PlayerView.Create(s, s.Active);
                Command c;
                if (ai.TryGetValue(s.Active, out var bot))
                {
                    c = bot.Choose(view);
                    Console.WriteLine($"[IA {TextUi.SideFr(s.Active)}] {c}");
                }
                else
                {
                    Console.WriteLine(ui.Render(view));
                    Console.Write(ui.Options(view));
                    Console.Write("> ");
                    var line = Console.ReadLine();
                    if (line == null || line.Trim() == "q") return 0;
                    c = ui.Parse(view, line, out var msg);
                    if (msg != null) Console.WriteLine(msg);
                    if (c == null) continue;
                }
                var r = engine.Apply(s, c);
                if (!r.Ok) { Console.WriteLine("Impossible : " + RuleMessages.Fr(r.Error)); continue; }
                foreach (var e in r.Events)
                {
                    var txt = ui.Describe(e.RedactFor(ai.ContainsKey(Side.Blue) ? Side.Red : Side.Blue));
                    if (txt != null) Console.WriteLine("  · " + txt);
                }
            }
            Console.WriteLine(ui.Render(PlayerView.Create(s, Side.Blue)));
            return 0;
        }

        // ------------------------------------------------------------------ AI tournaments

        private static int Simulate(ContentDatabase db, Args a)
        {
            var engine = new RulesEngine(db);
            var blue = ParseLevel(a.Get("blue", "hard"));
            var red = ParseLevel(a.Get("red", "normal"));
            int games = (int)a.Long("games", 10);
            ulong seed = (ulong)a.Long("seed", 1);
            var terrains = a.Get("terrain", "all") == "all" ? db.TerrainOrder.ToList() : new List<string> { a.Get("terrain", "") };
            int bw = 0, rw = 0;
            var reasons = new Dictionary<WinReason, int>();
            var turns = new List<int>();
            var sw = Stopwatch.StartNew();
            long decisions = 0;
            foreach (var terrain in terrains)
            {
                int tb = 0, tr = 0;
                for (int g = 0; g < games; g++)
                {
                    ulong gs = seed * 1000 + (ulong)g;
                    var s = engine.NewGame(terrain, gs);
                    var players = new Dictionary<Side, AiPlayer>();
                    if (blue != null) players[Side.Blue] = new AiPlayer(db, blue.Value, gs * 3 + 1);
                    if (red != null) players[Side.Red] = new AiPlayer(db, red.Value, gs * 3 + 2);
                    var rnd = new Rng(gs);
                    while (s.Phase != Phase.GameOver)
                    {
                        Command c;
                        if (players.TryGetValue(s.Active, out var p)) c = p.Choose(PlayerView.Create(s, s.Active));
                        else { var legal = engine.LegalCommands(s); c = legal[rnd.Next(legal.Count)]; }
                        var r = engine.Apply(s, c);
                        if (!r.Ok) throw new Exception("AI produced illegal command " + c + ": " + r.Error);
                        decisions++;
                    }
                    if (s.Winner == Side.Blue) { bw++; tb++; } else { rw++; tr++; }
                    reasons[s.WinReason] = reasons.TryGetValue(s.WinReason, out var n) ? n + 1 : 1;
                    turns.Add(s.Turn);
                }
                Console.WriteLine($"{terrain,-18} bleu({a.Get("blue", "hard")}) {tb} - {tr} rouge({a.Get("red", "normal")})");
            }
            Console.WriteLine($"TOTAL bleu {bw} - {rw} rouge | fins : {string.Join(", ", reasons.Select(kv => kv.Key + "=" + kv.Value))}");
            Console.WriteLine($"tours moyens {turns.Average():0.0} (min {turns.Min()}, max {turns.Max()}) | {decisions} décisions en {sw.Elapsed.TotalSeconds:0.0}s ({1000.0 * sw.Elapsed.TotalSeconds / Math.Max(1, decisions):0.0} ms/décision)");
            return 0;
        }

        // ------------------------------------------------------------------ LAN

        private static int Host(ContentDatabase db, Args a)
        {
            var engine = new RulesEngine(db);
            ulong seed = (ulong)a.Long("seed", Environment.TickCount);
            var hostSide = SideExt.ParseSide(a.Get("side", "blue"));
            var terrain = a.Get("terrain", "castle_plain");
            var state = engine.NewGame(terrain, seed, new GameOptions { SpecialBasesEnabled = !a.Has("beginner") });
            var sessionId = Guid.NewGuid().ToString("N").Substring(0, 12);
            var name = a.Get("name", "Hôte");
            using var listener = new TcpHostListener((int)a.Long("port", Protocol.DefaultGamePort));
            var ip = LocalNetwork.LocalIPv4().FirstOrDefault() ?? IPAddress.Loopback;
            var code = JoinCode.Encode(ip, listener.Port);
            using var beacon = new DiscoveryBeacon(name, sessionId, terrain, listener.Port, code,
                extraTargets: new List<IPEndPoint> { new IPEndPoint(IPAddress.Loopback, Protocol.DiscoveryPort) });
            var host = new HostSession(engine, state, hostSide, sessionId, name, Now);
            var ui = new TextUi(db);
            AiPlayer bot = ParseLevel(a.Get("ai", "human")) is AiLevel lvl ? new AiPlayer(db, lvl, seed) : null;
            host.StatusChanged += st => Console.WriteLine($"[réseau] adversaire : {st}");
            host.Updated += (events, view) => { foreach (var e in events) { var t = ui.Describe(e); if (t != null) Console.WriteLine("  · " + t); } };
            Console.WriteLine($"Partie créée sur {ip}:{listener.Port} — code {code} — session {sessionId}. En attente d'un joueur…");
            bool shown = false;
            while (host.State.Phase != Phase.GameOver)
            {
                while (listener.TryAccept(out var conn)) host.Accept(conn);
                host.Poll();
                if (host.State.Phase == Phase.GameOver) break;
                if (host.Status != PeerStatus.Connected || host.State.Active != hostSide) { shown = false; Thread.Sleep(30); continue; }
                var view = host.HostView;
                Command c;
                if (bot != null) c = bot.Choose(view);
                else
                {
                    if (!shown) { Console.WriteLine(ui.Render(view)); Console.Write(ui.Options(view)); shown = true; }
                    if (!Console.KeyAvailable && !Console.IsInputRedirected) { Thread.Sleep(30); continue; }
                    Console.Write("> ");
                    var line = Console.ReadLine();
                    if (line == null || line.Trim() == "q") { host.Close(); return 0; }
                    c = ui.Parse(view, line, out var msg);
                    if (msg != null) Console.WriteLine(msg);
                    if (c == null) continue;
                }
                var r = host.SubmitLocal(c);
                if (!r.Ok) Console.WriteLine("Impossible : " + RuleMessages.Fr(r.Error));
                shown = false;
            }
            Console.WriteLine(ui.Render(host.HostView));
            for (int i = 0; i < 20; i++) { host.Poll(); Thread.Sleep(50); } // let the last update reach the client
            host.Close();
            return 0;
        }

        private static int Join(ContentDatabase db, Args a)
        {
            var target = a.Positional;
            IPAddress ip;
            int port = Protocol.DefaultGamePort;
            if (string.IsNullOrEmpty(target))
            {
                Console.WriteLine("Recherche des parties sur le réseau local…");
                using var browser = new DiscoveryBrowser(Now);
                DiscoveredHost found = null;
                var until = Now() + a.Long("seconds", 8);
                while (Now() < until && found == null) { found = browser.Poll().FirstOrDefault(); Thread.Sleep(100); }
                if (found == null) { Console.WriteLine("Aucune partie trouvée. Utilisez le code affiché par l'hôte."); return 1; }
                Console.WriteLine($"Trouvé : {found.Name} ({found.Address}:{found.Port}, code {found.Code})");
                ip = found.Address; port = found.Port;
            }
            else if (JoinCode.TryDecode(target, out var decoded, out var p)) { ip = decoded; port = p; }
            else
            {
                var parts = target.Split(':');
                ip = IPAddress.Parse(parts[0]);
                if (parts.Length > 1) port = int.Parse(parts[1]);
            }
            var ui = new TextUi(db);
            var client = new ClientSession(a.Get("name", "Invité"), Now);
            AiPlayer bot = ParseLevel(a.Get("ai", "human")) is AiLevel lvl ? new AiPlayer(db, lvl, (ulong)Environment.TickCount) : null;
            client.Updated += (events, view, animate) => { foreach (var e in events) { var t = ui.Describe(e); if (t != null) Console.WriteLine("  · " + t); } };
            client.Rejected += (aid, err) => Console.WriteLine("Refusé par l'hôte : " + RuleMessages.Fr(err));
            client.StatusChanged += st => Console.WriteLine($"[réseau] hôte : {st}");
            client.Connect(TcpConnection.Connect(ip.ToString(), port));
            long shownSeq = -2;
            double reconnectAt = 0;
            while (client.View == null || client.View.Phase != Phase.GameOver)
            {
                client.Poll();
                if (client.Status == PeerStatus.Disconnected)
                {
                    if (client.RefusedReason != null) { Console.WriteLine("Connexion refusée : " + client.RefusedReason); return 1; }
                    if (Now() >= reconnectAt)
                    {
                        reconnectAt = Now() + 2;
                        try { client.Connect(TcpConnection.Connect(ip.ToString(), port, 1500)); Console.WriteLine("[réseau] reconnexion…"); }
                        catch (Exception) { Console.WriteLine("[réseau] hôte injoignable, nouvel essai…"); }
                    }
                    Thread.Sleep(50);
                    continue;
                }
                var view = client.View;
                if (view == null || !view.IsMyTurn || client.PendingCount > 0) { Thread.Sleep(20); continue; }
                Command c;
                if (bot != null) c = bot.Choose(view);
                else
                {
                    if (shownSeq != client.LastSeq) { Console.WriteLine(ui.Render(view)); Console.Write(ui.Options(view)); shownSeq = client.LastSeq; }
                    if (!Console.KeyAvailable && !Console.IsInputRedirected) { Thread.Sleep(30); continue; }
                    Console.Write("> ");
                    var line = Console.ReadLine();
                    if (line == null || line.Trim() == "q") { client.Close(); return 0; }
                    c = ui.Parse(view, line, out var msg);
                    if (msg != null) Console.WriteLine(msg);
                    if (c == null) continue;
                }
                client.Submit(c);
            }
            Console.WriteLine(ui.Render(client.View));
            client.Close();
            return 0;
        }

        private static int Discover(Args a)
        {
            Console.WriteLine("Adresses locales : " + string.Join(", ", LocalNetwork.LocalIPv4()));
            Console.WriteLine("Cibles broadcast : " + string.Join(", ", LocalNetwork.BroadcastTargets(Protocol.DiscoveryPort)));
            using var browser = new DiscoveryBrowser(Now);
            var until = Now() + a.Long("seconds", 5);
            while (Now() < until) Thread.Sleep(200);
            var hosts = browser.Poll(100);
            Console.WriteLine($"{browser.BeaconsReceived} balise(s) reçue(s), {hosts.Count} partie(s) :");
            foreach (var h in hosts) Console.WriteLine($"  {h.Name} — {h.Address}:{h.Port} — code {h.Code} — terrain {h.TerrainId}");
            return 0;
        }
    }

    internal sealed class Args
    {
        private readonly Dictionary<string, string> _opts = new Dictionary<string, string>();
        public readonly string Verb;
        public readonly string Positional;

        public Args(string[] args)
        {
            Verb = args.Length > 0 ? args[0] : "";
            for (int i = 1; i < args.Length; i++)
            {
                if (args[i].StartsWith("--"))
                {
                    var k = args[i].Substring(2);
                    if (i + 1 < args.Length && !args[i + 1].StartsWith("--")) _opts[k] = args[++i];
                    else _opts[k] = "true";
                }
                else if (Positional == null) Positional = args[i];
            }
        }

        public string Get(string k, string def) => _opts.TryGetValue(k, out var v) ? v : def;
        public bool Has(string k) => _opts.ContainsKey(k);
        public long Long(string k, long def) => _opts.TryGetValue(k, out var v) ? long.Parse(v) : def;
    }
}
