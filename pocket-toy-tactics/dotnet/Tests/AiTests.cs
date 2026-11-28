using System.Linq;
using PocketToyTactics.Core;
using Xunit;

namespace PocketToyTactics.Tests
{
    public class AiTests
    {
        [Theory]
        [InlineData(AiLevel.Easy)]
        [InlineData(AiLevel.Normal)]
        [InlineData(AiLevel.Hard)]
        public void Ai_only_plays_legal_commands_on_every_terrain(AiLevel level)
        {
            var db = TestContent.Db;
            var engine = new RulesEngine(db);
            foreach (var terrain in db.TerrainOrder)
            {
                var s = engine.NewGame(terrain, 900);
                var blue = new AiPlayer(db, level, 1);
                var red = new AiPlayer(db, level, 2);
                int guard = 0;
                while (s.Phase != Phase.GameOver && guard++ < 1500)
                {
                    var ai = s.Active == Side.Blue ? blue : red;
                    var c = ai.Choose(PlayerView.Create(s, s.Active));
                    Assert.True(engine.Apply(s, c).Ok, terrain + ": " + c);
                }
                Assert.Equal(Phase.GameOver, s.Phase);
            }
        }

        [Theory]
        [InlineData(AiLevel.Easy)]
        [InlineData(AiLevel.Normal)]
        [InlineData(AiLevel.Hard)]
        public void Ai_takes_an_immediate_hq_capture(AiLevel level)
        {
            for (ulong seed = 0; seed < 5; seed++)
            {
                var x = new Sim("castle_plain", specialBases: false);
                string[] nodes = { "L3", "K1", "M", "K3", "R3" }, troops = { "kwak", "roxy", "star", "xb42", "mastok" };
                for (int i = 0; i < nodes.Length; i++) x.Board(nodes[i], Side.Blue, troops[i]);
                x.Rack(Side.Blue, "skully");
                x.Rack(Side.Blue, "captain");
                var c = new AiPlayer(TestContent.Db, level, seed).Choose(PlayerView.Create(x.S, Side.Blue));
                if (level == AiLevel.Easy && c.NodeId != "HR") continue; // easy may blunder on purpose
                Assert.Equal("HR", c.NodeId);
            }
        }

        [Theory]
        [InlineData(AiLevel.Normal)]
        [InlineData(AiLevel.Hard)]
        public void Ai_defuses_an_hq_threat(AiLevel level)
        {
            // Red has a connected chain HR-R3-K3-M-K1-L3 and L3 touches the blue HQ: red wins next turn
            // unless blue breaks the chain (covering L3, or discarding it with Mastok, etc.).
            var x = new Sim("castle_plain", specialBases: false);
            string[] nodes = { "R3", "K3", "M", "K1", "L3" }, troops = { "kwak", "roxy", "star", "xb42", "skully" };
            for (int i = 0; i < nodes.Length; i++) x.Board(nodes[i], Side.Red, troops[i]);
            x.Rack(Side.Red, "skully");
            x.Rack(Side.Blue, "roxy");
            x.Rack(Side.Blue, "mastok");
            var ai = new AiPlayer(TestContent.Db, level, 1);
            while (x.S.Active == Side.Blue && x.S.Phase != Phase.GameOver) x.Ok(ai.Choose(PlayerView.Create(x.S, Side.Blue)));
            Assert.DoesNotContain(x.Engine.LegalCommands(x.S), c => c.NodeId == "HB");
        }

        [Fact]
        public void Ai_decision_does_not_depend_on_hidden_opponent_tiles()
        {
            // Two games with the same public situation but different hidden red tiles:
            // the AI receives identical views and must therefore play identically.
            var db = TestContent.Db;
            var engine = new RulesEngine(db);
            var a = engine.NewGame("battlefield", 1, new GameOptions { FirstPlayer = Side.Blue });
            var b = a.Clone();
            var ra = a.P(Side.Red);
            var rb = b.P(Side.Red);
            var swapA = ra.Rack[0];
            var swapB = rb.Reserve.First(t => db.TileTroop(t).Id != db.TileTroop(swapA).Id);
            rb.Rack[0] = swapB;
            rb.Reserve[rb.Reserve.IndexOf(swapB)] = swapA;
            var va = Json.Write(PlayerView.Create(a, Side.Blue).ToJson());
            var vb = Json.Write(PlayerView.Create(b, Side.Blue).ToJson());
            Assert.Equal(va, vb);
            foreach (var level in new[] { AiLevel.Easy, AiLevel.Normal, AiLevel.Hard })
            {
                var ca = new AiPlayer(db, level, 77).Choose(PlayerView.Create(a, Side.Blue));
                var cb = new AiPlayer(db, level, 77).Choose(PlayerView.Create(b, Side.Blue));
                Assert.Equal(ca.ToString(), cb.ToString());
            }
        }
    }
}
