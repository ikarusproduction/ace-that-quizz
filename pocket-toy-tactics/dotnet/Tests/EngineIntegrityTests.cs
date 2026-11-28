using System.Collections.Generic;
using System.Linq;
using PocketToyTactics.Core;
using Xunit;

namespace PocketToyTactics.Tests
{
    /// <summary>Property-style tests: thousands of random legal commands on every terrain.</summary>
    public class EngineIntegrityTests
    {
        public static IEnumerable<object[]> Terrains() => TestContent.Db.TerrainOrder.Select(t => new object[] { t });

        private static void AssertConservation(GameState s)
        {
            var db = TestContent.Db;
            var all = new List<int>();
            foreach (var p in s.Players) { all.AddRange(p.Reserve); all.AddRange(p.Rack); all.AddRange(p.Removed); }
            foreach (var st in s.Stacks.Values) all.AddRange(st);
            all.AddRange(s.Discard);
            Assert.Equal(2 * db.TilesPerPlayer, all.Count);
            Assert.Equal(all.Count, all.Distinct().Count());
            foreach (var side in new[] { Side.Blue, Side.Red })
            {
                var p = s.P(side);
                Assert.True(p.Rack.Count <= ContentDatabase.RackCapacity);
                Assert.All(p.Rack, t => Assert.Equal(side, db.TileOwner(t)));
                Assert.All(p.LaidDown, t => Assert.Contains(t, p.Rack));
                Assert.All(p.KnownInRack, t => Assert.Contains(t, p.Rack));
            }
            int claimed = s.RegionClaims.Keys.Sum(r => db.Terrain(s.TerrainId).Regions.First(x => x.Id == r).Medals);
            Assert.Equal(claimed, s.Players[0].Medals + s.Players[1].Medals);
        }

        [Theory]
        [MemberData(nameof(Terrains))]
        public void Random_games_always_terminate_and_stay_consistent(string terrain)
        {
            var engine = new RulesEngine(TestContent.Db);
            var pick = new Rng(99);
            var reasons = new HashSet<WinReason>();
            for (int game = 0; game < 40; game++)
            {
                var s = engine.NewGame(terrain, (ulong)(1000 + game), new GameOptions { SpecialBasesEnabled = game % 5 != 0 });
                int steps = 0;
                while (s.Phase != Phase.GameOver)
                {
                    var legal = engine.LegalCommands(s);
                    Assert.NotEmpty(legal);
                    var c = legal[pick.Next(legal.Count)];
                    var r = engine.Apply(s, c);
                    Assert.True(r.Ok, c + " -> " + r.Error);
                    Assert.True(++steps < 2000, "game did not terminate");
                    if (steps % 7 == 0) AssertConservation(s);
                }
                AssertConservation(s);
                Assert.NotNull(s.Winner);
                reasons.Add(s.WinReason);
            }
            Assert.NotEmpty(reasons);
        }

        [Theory]
        [MemberData(nameof(Terrains))]
        public void Replay_and_save_round_trip_are_exact(string terrain)
        {
            var engine = new RulesEngine(TestContent.Db);
            var pick = new Rng(7);
            var options = new GameOptions();
            var s = engine.NewGame(terrain, 31337, options);
            int i = 0;
            while (s.Phase != Phase.GameOver && i++ < 400)
            {
                var legal = engine.LegalCommands(s);
                engine.Apply(s, legal[pick.Next(legal.Count)]);
                if (i % 11 == 0)
                {
                    var json = StateSerializer.Serialize(s);
                    var back = StateSerializer.Deserialize(json);
                    Assert.Equal(json, StateSerializer.Serialize(back));
                }
            }
            var replayed = engine.Replay(terrain, 31337, options, s.History);
            Assert.Equal(StateSerializer.Serialize(s), StateSerializer.Serialize(replayed));
        }

        [Fact]
        public void Illegal_commands_never_change_the_state()
        {
            var engine = new RulesEngine(TestContent.Db);
            var s = engine.NewGame("battlefield", 5);
            var before = StateSerializer.Serialize(s);
            var bad = new[]
            {
                Command.Draw(s.Active.Other()),
                Command.Place(s.Active, 9999, "P1"),
                Command.Place(s.Active, s.P(s.Active).Rack[0], "HB"),
                Command.Skip(s.Active),
                Command.Accept(s.Active),
                Command.ChooseNode(s.Active, "Q1"),
                null,
            };
            foreach (var c in bad)
            {
                var r = engine.Apply(s, c);
                Assert.False(r.Ok);
                Assert.Equal(before, StateSerializer.Serialize(s));
            }
        }

        [Theory]
        [MemberData(nameof(Terrains))]
        public void Player_views_hide_hidden_tiles_and_determinize_consistently(string terrain)
        {
            var db = TestContent.Db;
            var engine = new RulesEngine(db);
            var pick = new Rng(3);
            var s = engine.NewGame(terrain, 77);
            for (int i = 0; i < 120 && s.Phase != Phase.GameOver; i++)
            {
                foreach (var viewer in new[] { Side.Blue, Side.Red })
                {
                    var view = PlayerView.FromJson(Json.ParseObject(Json.Write(PlayerView.Create(s, viewer).ToJson())));
                    var json = Json.Write(view.ToJson());
                    // No hidden tile id of the opponent (rack, reserve, removed) may appear in the view.
                    var opp = s.P(viewer.Other());
                    var hidden = opp.Rack.Except(opp.KnownInRack).Concat(opp.Reserve).Concat(opp.Removed)
                        .Concat(s.P(viewer).Reserve).Concat(s.P(viewer).Removed).ToHashSet();
                    var listed = new List<int>(view.MyRack);
                    listed.AddRange(view.Discard);
                    listed.AddRange(view.OppKnownInRack);
                    foreach (var st in view.Stacks.Values) listed.AddRange(st);
                    foreach (var c in view.Chain) listed.Add(c.TileId);
                    Assert.DoesNotContain(listed, t => hidden.Contains(t));
                    Assert.Equal(json, Json.Write(view.ToJson()));

                    var sample = view.Determinize(db, new Rng((ulong)i));
                    AssertConservation(sample);
                    Assert.Equal(s.P(viewer).Rack, sample.P(viewer).Rack);
                    Assert.Equal(opp.Rack.Count, sample.P(viewer.Other()).Rack.Count);
                    Assert.Equal(opp.Reserve.Count, sample.P(viewer.Other()).Reserve.Count);
                    // Legal commands of the active player do not depend on the opponent's hidden tiles.
                    if (viewer == s.Active)
                        Assert.Equal(engine.LegalCommands(s).Select(c => c.ToString()), engine.LegalCommands(sample).Select(c => c.ToString()));
                }
                var legal = engine.LegalCommands(s);
                engine.Apply(s, legal[pick.Next(legal.Count)]);
            }
        }
    }
}
