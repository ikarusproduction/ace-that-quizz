using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using PocketToyTactics.Core;
using PocketToyTactics.Core.Net;
using Xunit;

namespace PocketToyTactics.Tests
{
    public class NetworkTests
    {
        private sealed class FakeClock
        {
            public double T;
            public double Now() => T;
        }

        private sealed class Rig
        {
            public readonly RulesEngine Engine = new RulesEngine(TestContent.Db);
            public readonly FakeClock Clock = new FakeClock();
            public HostSession Host;
            public ClientSession Client;
            public MemoryConnection HostEnd, ClientEnd;
            public readonly List<RuleError> Rejections = new List<RuleError>();
            public int Updates;

            public Rig(string terrain = "castle_plain", ulong seed = 11, Side hostSide = Side.Blue)
            {
                var state = Engine.NewGame(terrain, seed);
                Host = new HostSession(Engine, state, hostSide, "sess-1", "host", Clock.Now);
                Client = new ClientSession("guest", Clock.Now, "c1");
                Client.Rejected += (aid, e) => Rejections.Add(e);
                Client.Updated += (ev, v, anim) => Updates++;
                Link();
            }

            public void Link()
            {
                MemoryConnection.CreatePair(out HostEnd, out ClientEnd);
                Host.Accept(HostEnd);
                Client.Connect(ClientEnd);
                Pump();
            }

            public void Pump(int rounds = 4)
            {
                for (int i = 0; i < rounds; i++) { Host.Poll(); Client.Poll(); }
            }

            public void AssertInSync()
            {
                var expected = Json.Write(PlayerView.Create(Host.State, Host.ClientSide).ToJson());
                Assert.Equal(expected, Json.Write(Client.View.ToJson()));
                Assert.Equal(Host.State.Seq, Client.LastSeq);
            }
        }

        [Fact]
        public void Client_joins_and_receives_its_side_and_view()
        {
            var r = new Rig();
            Assert.Equal(PeerStatus.Connected, r.Host.Status);
            Assert.Equal(PeerStatus.Connected, r.Client.Status);
            Assert.Equal(Side.Red, r.Client.Side);
            Assert.Equal("sess-1", r.Client.SessionId);
            r.AssertInSync();
        }

        [Fact]
        public void Full_game_between_two_ais_stays_in_sync()
        {
            var r = new Rig("volcano_jungle", 5);
            var hostAi = new AiPlayer(TestContent.Db, AiLevel.Normal, 1);
            var clientAi = new AiPlayer(TestContent.Db, AiLevel.Normal, 2);
            int guard = 0;
            while (r.Host.State.Phase != Phase.GameOver && guard++ < 2000)
            {
                if (r.Host.State.Active == r.Host.HostSide) Assert.True(r.Host.SubmitLocal(hostAi.Choose(r.Host.HostView)).Ok);
                else r.Client.Submit(clientAi.Choose(r.Client.View));
                r.Pump();
                r.AssertInSync();
            }
            Assert.Equal(Phase.GameOver, r.Client.View.Phase);
            Assert.Equal(r.Host.State.Winner, r.Client.View.Winner);
            Assert.Empty(r.Rejections);
        }

        [Fact]
        public void Duplicate_intent_is_applied_once()
        {
            var r = new Rig(hostSide: Side.Red); // client is blue
            if (r.Host.State.Active != Side.Blue) { r.Host.SubmitLocal(Command.Draw(Side.Red)); r.Pump(); }
            long before = r.Host.State.Seq;
            var raw = Protocol.Msg(Protocol.Intent, new Dictionary<string, object> { ["aid"] = "x-1", ["cmd"] = Command.Draw(Side.Blue).ToJson() });
            r.HostEnd.Inject(raw);
            r.HostEnd.Inject(raw);
            r.Pump();
            Assert.Equal(before + 1, r.Host.State.Seq);
            Assert.Equal(1, r.Host.State.History.Count(c => c.ActionId == "x-1"));
            r.AssertInSync();
        }

        [Fact]
        public void Illegal_intents_are_rejected_without_changing_the_state()
        {
            var r = new Rig(hostSide: Side.Red);
            if (r.Host.State.Active != Side.Blue) { r.Host.SubmitLocal(Command.Draw(Side.Red)); r.Pump(); }
            var before = StateSerializer.Serialize(r.Host.State);
            r.Client.Submit(Command.Place(Side.Blue, 9999, "L1"));        // not on rack
            r.Client.Submit(Command.Place(Side.Blue, r.Client.View.MyRack[0], "HB")); // own HQ
            r.Client.Submit(Command.Draw(Side.Red));                       // acting for the host's side
            r.HostEnd.Inject("{not json");
            r.HostEnd.Inject(Protocol.Msg(Protocol.Intent, new Dictionary<string, object> { ["aid"] = "bad", ["cmd"] = new Dictionary<string, object> { ["t"] = "Explode" } }));
            r.Pump();
            Assert.Equal(before, StateSerializer.Serialize(r.Host.State));
            Assert.Equal(new[] { RuleError.TileNotInRack, RuleError.OwnHq, RuleError.NotYourTurn, RuleError.InvalidCommand }, r.Rejections);
            Assert.Equal(0, r.Client.PendingCount);
        }

        [Fact]
        public void Stale_and_out_of_order_updates_are_ignored_and_gaps_are_healed()
        {
            var r = new Rig();
            var captured = new List<string>();
            r.HostEnd.OutgoingFilter = m => { if (m.Contains("\"type\":\"update\"")) { captured.Add(m); return null; } return m; };
            // Three updates produced while the link drops them.
            for (int i = 0; i < 3; i++)
            {
                var s = r.Host.State;
                var cmd = s.Active == r.Host.HostSide ? Command.Draw(s.Active) : null;
                if (cmd != null) r.Host.SubmitLocal(cmd);
                else r.Client.Submit(Command.Draw(s.Active));
                r.Pump();
            }
            Assert.Equal(3, captured.Count);
            long seqBefore = r.Client.LastSeq;
            // Deliver the last one first (gap) then the older ones (stale): the client ends at the newest state.
            r.ClientEnd.Inject(captured[2]);
            r.ClientEnd.Inject(captured[0]);
            r.ClientEnd.Inject(captured[1]);
            r.Pump();
            Assert.Equal(seqBefore + 3, r.Client.LastSeq);
            Assert.Contains(r.Client.Log, l => l.StartsWith("gap"));
            Assert.Contains(r.Client.Log, l => l.StartsWith("stale"));
            r.HostEnd.OutgoingFilter = null;
            r.AssertInSync();
        }

        [Fact]
        public void Intent_lost_during_disconnection_is_resent_after_reconnection()
        {
            var r = new Rig(hostSide: Side.Red);
            if (r.Host.State.Active != Side.Blue) { r.Host.SubmitLocal(Command.Draw(Side.Red)); r.Pump(); }
            r.ClientEnd.OutgoingFilter = m => m.Contains("\"type\":\"intent\"") ? null : m; // the intent is lost
            r.Client.Submit(Command.Draw(Side.Blue));
            r.Pump();
            Assert.Equal(1, r.Client.PendingCount);
            // The link dies; both sides notice through heartbeat timeouts.
            r.ClientEnd.OutgoingFilter = _ => null;
            r.HostEnd.OutgoingFilter = _ => null;
            r.Clock.T += Protocol.Timeout + 1;
            r.Pump();
            Assert.Equal(PeerStatus.Disconnected, r.Host.Status);
            Assert.Equal(PeerStatus.Disconnected, r.Client.Status);
            // New connection, same session: the pending intent is resent and applied exactly once.
            r.Link();
            Assert.Equal(PeerStatus.Connected, r.Host.Status);
            Assert.Equal(0, r.Client.PendingCount);
            Assert.Equal(Side.Red, r.Host.State.Active);
            r.AssertInSync();
        }

        [Fact]
        public void Reconnection_with_another_session_id_is_refused()
        {
            var r = new Rig();
            var other = new HostSession(r.Engine, r.Engine.NewGame("castle_plain", 1), Side.Blue, "sess-2", "h2", r.Clock.Now);
            MemoryConnection.CreatePair(out var h, out var c);
            other.Accept(h);
            r.Client.Connect(c); // the client remembers sess-1
            for (int i = 0; i < 4; i++) { other.Poll(); r.Client.Poll(); }
            Assert.Equal("session", r.Client.RefusedReason);
        }

        [Fact]
        public void Protocol_version_mismatch_is_refused()
        {
            var r = new Rig();
            MemoryConnection.CreatePair(out var h, out var c);
            r.Host.Accept(h);
            c.Send(Protocol.Msg(Protocol.Hello, new Dictionary<string, object> { ["v"] = 999, ["name"] = "old" }));
            r.Host.Poll();
            Assert.True(c.TryReceive(out var msg));
            Assert.Contains("refused", msg);
        }

        [Fact]
        public void Host_can_resume_a_saved_game_after_being_closed()
        {
            var dir = Path.Combine(Path.GetTempPath(), "ptt-save-" + Guid.NewGuid().ToString("N"));
            var r = new Rig("cloud_city", 8);
            var ai = new AiPlayer(TestContent.Db, AiLevel.Easy, 3);
            for (int i = 0; i < 12 && r.Host.State.Phase != Phase.GameOver; i++)
            {
                if (r.Host.State.Active == r.Host.HostSide) r.Host.SubmitLocal(ai.Choose(r.Host.HostView));
                else r.Client.Submit(ai.Choose(r.Client.View));
                r.Pump();
            }
            var store = new SaveStore(dir);
            store.SaveGame("lan", r.Host.State, new Dictionary<string, object> { ["session"] = r.Host.SessionId, ["hostSide"] = "blue" });
            // The host app is killed; a new process loads the save and reopens the session.
            var loaded = store.LoadGame("lan", out var meta);
            var host2 = new HostSession(r.Engine, loaded, Side.Blue, meta.Str("session"), "host", r.Clock.Now);
            MemoryConnection.CreatePair(out var h, out var c);
            host2.Accept(h);
            r.Client.Connect(c);
            for (int i = 0; i < 4; i++) { host2.Poll(); r.Client.Poll(); }
            Assert.Equal(PeerStatus.Connected, r.Client.Status);
            Assert.Equal(Json.Write(PlayerView.Create(host2.State, Side.Red).ToJson()), Json.Write(r.Client.View.ToJson()));
            Directory.Delete(dir, true);
        }

        [Fact]
        public void Join_code_round_trips()
        {
            foreach (var ip in new[] { "192.168.1.23", "10.0.0.1", "172.20.10.2", "192.168.43.1" })
            {
                foreach (var port in new[] { Protocol.DefaultGamePort, 51234 })
                {
                    var code = JoinCode.Encode(IPAddress.Parse(ip), port);
                    Assert.True(JoinCode.TryDecode(code.ToLowerInvariant(), out var back, out var p));
                    Assert.Equal(ip, back.ToString());
                    Assert.Equal(port, p);
                    Assert.Equal(port == Protocol.DefaultGamePort ? 8 : 11, code.Length);
                }
            }
            Assert.False(JoinCode.TryDecode("ABC", out _, out _));
        }

        [Fact]
        public void Tcp_loopback_game_plays_to_the_end()
        {
            var engine = new RulesEngine(TestContent.Db);
            var sw = Stopwatch.StartNew();
            Func<double> now = () => sw.Elapsed.TotalSeconds;
            using var listener = new TcpHostListener(0);
            var host = new HostSession(engine, engine.NewGame("metalx_station", 21), Side.Blue, "tcp", "host", now);
            var client = new ClientSession("guest", now);
            client.Connect(TcpConnection.Connect("127.0.0.1", listener.Port));
            var a1 = new AiPlayer(TestContent.Db, AiLevel.Normal, 1);
            var a2 = new AiPlayer(TestContent.Db, AiLevel.Normal, 2);
            while (host.State.Phase != Phase.GameOver && sw.Elapsed.TotalSeconds < 60)
            {
                while (listener.TryAccept(out var conn)) host.Accept(conn);
                host.Poll();
                client.Poll();
                if (host.Status != PeerStatus.Connected || client.View == null) { Thread.Sleep(2); continue; }
                if (host.State.Phase == Phase.GameOver) break; // the client's last intent may have ended the game during Poll
                if (host.State.Active == Side.Blue) host.SubmitLocal(a1.Choose(host.HostView));
                else if (client.PendingCount == 0 && client.LastSeq == host.State.Seq && client.View.IsMyTurn) client.Submit(a2.Choose(client.View));
                Thread.Sleep(1);
            }
            for (int i = 0; i < 200 && client.LastSeq != host.State.Seq; i++) { host.Poll(); client.Poll(); Thread.Sleep(5); }
            Assert.Equal(Phase.GameOver, host.State.Phase);
            Assert.Equal(host.State.Winner, client.View.Winner);
            host.Close();
        }

        [Fact]
        public void Udp_beacon_is_discovered()
        {
            var sw = Stopwatch.StartNew();
            int port = 40000 + new Random().Next(20000);
            using var browser = new DiscoveryBrowser(() => sw.Elapsed.TotalSeconds, port);
            using var beacon = new DiscoveryBeacon("Table", "s-9", "battlefield", 47778, "ABC-DEFG", port,
                new List<IPEndPoint> { new IPEndPoint(IPAddress.Loopback, port) });
            List<DiscoveredHost> found = new List<DiscoveredHost>();
            while (sw.Elapsed.TotalSeconds < 5 && found.Count == 0) { found = browser.Poll(); Thread.Sleep(50); }
            Assert.Single(found);
            Assert.Equal("Table", found[0].Name);
            Assert.Equal("battlefield", found[0].TerrainId);
            Assert.Equal(47778, found[0].Port);
        }
    }

    public class SaveTests
    {
        [Fact]
        public void Settings_and_games_survive_a_restart()
        {
            var dir = Path.Combine(Path.GetTempPath(), "ptt-save-" + Guid.NewGuid().ToString("N"));
            var store = new SaveStore(dir);
            Assert.Equal("Joueur", store.LoadSettings().PlayerName);
            store.SaveSettings(new Settings { PlayerName = "Zoé", Muted = true, SfxVolume = 0.25, BatterySaver = true });
            var s2 = new SaveStore(dir).LoadSettings();
            Assert.Equal("Zoé", s2.PlayerName);
            Assert.True(s2.Muted && s2.BatterySaver);
            Assert.Equal(0.25, s2.SfxVolume);

            var engine = new RulesEngine(TestContent.Db);
            var game = engine.NewGame("pirate_sea", 4);
            var rnd = new Rng(4);
            for (int i = 0; i < 25 && game.Phase != Phase.GameOver; i++) { var l = engine.LegalCommands(game); engine.Apply(game, l[rnd.Next(l.Count)]); }
            store.SaveGame("solo", game);
            store.SaveGame("solo", game); // overwrite through atomic replace
            var back = new SaveStore(dir).LoadGame("solo", out _);
            Assert.Equal(StateSerializer.Serialize(game), StateSerializer.Serialize(back));
            Assert.False(File.Exists(Path.Combine(dir, "game-solo.json.tmp")));
            Directory.Delete(dir, true);
        }
    }
}
