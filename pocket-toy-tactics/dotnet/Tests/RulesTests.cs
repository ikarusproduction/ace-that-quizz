using System.Linq;
using PocketToyTactics.Core;
using Xunit;

namespace PocketToyTactics.Tests
{
    // Terrain cheat-sheet used below (castle_plain, see docs/terrains/castle_plain.svg):
    //   HB-L1, HB-L2, HB-L3 | L1-L3, L1-P1 | L3-K1, L3-K2 | P1-K1, P1-P3 | K1-K2, K1-M, K2-M | M-K3, M-K4
    //   K3-R3, K3-P3 | R3-HR, R1-HR, R2-HR | regions r1 = L1,L3,K1,P1 (2)  r5 = K1,M,K2 (1)
    // Special bases are disabled in the pure rule tests so that no base effect interferes.

    public class SetupTests
    {
        [Fact]
        public void Setup_follows_the_rulebook()
        {
            var e = new RulesEngine(TestContent.Db);
            for (ulong seed = 1; seed < 30; seed++)
            {
                var s = e.NewGame("castle_plain", seed);
                foreach (var side in new[] { Side.Blue, Side.Red })
                {
                    var p = s.P(side);
                    Assert.Equal(24, p.Rack.Count + p.Reserve.Count + p.Removed.Count);
                    Assert.Equal(4, p.Removed.Count);
                    Assert.Equal(side == s.FirstPlayer ? 3 : 4, p.Rack.Count);
                    Assert.All(p.Rack.Concat(p.Reserve).Concat(p.Removed), t => Assert.Equal(side, TestContent.Db.TileOwner(t)));
                }
                Assert.Equal(s.FirstPlayer, s.Active);
                Assert.Equal(Phase.TurnAction, s.Phase);
            }
        }

        [Fact]
        public void First_player_is_random_but_seeded()
        {
            var e = new RulesEngine(TestContent.Db);
            var firsts = Enumerable.Range(1, 40).Select(i => e.NewGame("castle_plain", (ulong)i).FirstPlayer).ToList();
            Assert.Contains(Side.Blue, firsts);
            Assert.Contains(Side.Red, firsts);
            Assert.Equal(e.NewGame("castle_plain", 5).FirstPlayer, e.NewGame("castle_plain", 5).FirstPlayer);
        }

        [Fact]
        public void Roster_has_eight_troops_three_copies_each()
        {
            var db = TestContent.Db;
            Assert.Equal(8, db.Troops.Count);
            Assert.Equal(24, db.TilesPerPlayer);
            Assert.All(db.Troops, t => Assert.Equal(3, t.CopiesPerPlayer));
            Assert.Equal(new[] { 1, 2, 3, 4, 5, 6, 7 }, db.Troops.Where(t => !t.IsJoker).Select(t => t.Strength).OrderBy(x => x));
            Assert.Single(db.Troops, t => t.IsJoker);
        }
    }

    public class DrawTests
    {
        [Fact]
        public void Draw_takes_two_and_ends_turn()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Ok(Command.Draw(Side.Blue));
            Assert.Equal(2, x.S.P(Side.Blue).Rack.Count);
            Assert.Equal(Side.Red, x.S.Active);
            Assert.Equal(2, x.S.Turn);
        }

        [Fact]
        public void Draw_takes_one_when_one_slot_left()
        {
            var x = new Sim("castle_plain", specialBases: false);
            foreach (var troop in new[] { "skully", "captain", "mastok", "crochet", "xb42", "star", "roxy" }) x.Rack(Side.Blue, troop);
            x.Ok(Command.Draw(Side.Blue));
            Assert.Equal(8, x.S.P(Side.Blue).Rack.Count);
        }

        [Fact]
        public void Draw_takes_one_when_one_tile_left_in_reserve()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.ReserveSize(Side.Blue, 1);
            x.Ok(Command.Draw(Side.Blue));
            Assert.Single(x.S.P(Side.Blue).Rack);
        }

        [Fact]
        public void Draw_is_illegal_with_full_rack_or_empty_reserve()
        {
            var x = new Sim("castle_plain", specialBases: false);
            foreach (var t in new[] { "skully", "captain", "mastok", "crochet", "xb42", "star", "roxy", "kwak" }) x.Rack(Side.Blue, t);
            x.Fails(Command.Draw(Side.Blue), RuleError.RackFull);
            var y = new Sim("castle_plain", specialBases: false);
            y.ReserveSize(Side.Blue, 0);
            y.Fails(Command.Draw(Side.Blue), RuleError.ReserveEmpty);
        }

        [Fact]
        public void Only_active_player_may_act()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Fails(Command.Draw(Side.Red), RuleError.NotYourTurn);
        }
    }

    public class PlacementTests
    {
        [Fact]
        public void Empty_base_next_to_hq_is_connected()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            Assert.Equal("roxy", x.TroopAt("L1"));
            Assert.Equal(Side.Red, x.S.Active);
        }

        [Fact]
        public void Base_far_from_hq_is_not_connected()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "roxy");
            x.Fails(Command.Place(Side.Blue, t, "K1"), RuleError.NotConnected);
        }

        [Fact]
        public void Connection_follows_a_chain_of_own_bases()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L3", Side.Blue, "skully");
            x.Board("K1", Side.Blue, "skully");
            int t = x.Rack(Side.Blue, "roxy");
            Assert.Equal(RuleError.None, x.Engine.CheckPlacement(x.S, Side.Blue, t, "M"));
        }

        [Fact]
        public void Enemy_or_empty_base_breaks_the_connection()
        {
            // Rulebook example: a path interrupted by an enemy-occupied base is not connected.
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L3", Side.Blue, "skully");
            x.Board("K1", Side.Red, "skully");
            int t = x.Rack(Side.Blue, "roxy");
            Assert.Equal(RuleError.NotConnected, x.Engine.CheckPlacement(x.S, Side.Blue, t, "M"));
            // ...but the enemy base itself is adjacent to a connected base, so it can be attacked.
            Assert.Equal(RuleError.None, x.Engine.CheckPlacement(x.S, Side.Blue, t, "K1"));
        }

        [Fact]
        public void Own_troops_can_always_be_covered()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L1", Side.Blue, "roxy");
            int t = x.Rack(Side.Blue, "skully");
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            Assert.Equal(2, x.S.Stacks["L1"].Count);
            Assert.Equal("skully", x.TroopAt("L1"));
        }

        [Theory]
        [InlineData("star", "mastok", true)]   // 6 > 3
        [InlineData("mastok", "mastok", false)] // equal is not enough
        [InlineData("skully", "mastok", false)]
        [InlineData("roxy", "star", true)]
        [InlineData("star", "roxy", false)]     // nothing but the joker beats 7
        [InlineData("kwak", "roxy", true)]      // joker covers anything
        [InlineData("skully", "kwak", true)]    // anything covers the joker
        [InlineData("kwak", "kwak", true)]
        public void Enemy_troops_need_strictly_greater_strength(string mine, string theirs, bool legal)
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L1", Side.Red, theirs);
            int t = x.Rack(Side.Blue, mine);
            var expected = legal ? RuleError.None : RuleError.TooWeak;
            Assert.Equal(expected, x.Engine.CheckPlacement(x.S, Side.Blue, t, "L1"));
        }

        [Fact]
        public void Own_hq_is_forbidden()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "roxy");
            x.Fails(Command.Place(Side.Blue, t, "HB"), RuleError.OwnHq);
        }

        [Fact]
        public void Placing_on_connected_enemy_hq_wins_immediately()
        {
            var x = new Sim("castle_plain", specialBases: false);
            string[] nodes = { "L3", "K1", "M", "K3", "R3" }, troops = { "kwak", "roxy", "star", "xb42", "mastok" };
            for (int i = 0; i < nodes.Length; i++) x.Board(nodes[i], Side.Blue, troops[i]);
            int t = x.Rack(Side.Blue, "skully");
            x.Ok(Command.Place(Side.Blue, t, "HR"));
            Assert.Equal(Phase.GameOver, x.S.Phase);
            Assert.Equal(Side.Blue, x.S.Winner);
            Assert.Equal(WinReason.HqCaptured, x.S.WinReason);
            Assert.Contains(x.Events, e => e.Type == GameEventType.HqCaptured);
        }

        [Fact]
        public void Unconnected_enemy_hq_is_forbidden_even_for_crochet()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "crochet");
            x.Fails(Command.Place(Side.Blue, t, "HR"), RuleError.NotConnected);
            // Crochet may still jump to any base.
            x.Ok(Command.Place(Side.Blue, t, "R3"));
        }

        [Fact]
        public void Crochet_still_needs_strength_to_cover_enemies()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("R3", Side.Red, "xb42");
            int t = x.Rack(Side.Blue, "crochet");
            x.Fails(Command.Place(Side.Blue, t, "R3"), RuleError.TooWeak);
        }

        [Fact]
        public void Stacks_are_unlimited_and_only_the_top_occupies()
        {
            var x = new Sim("castle_plain", specialBases: false);
            var order = new[] { "skully", "captain", "mastok", "crochet", "xb42" };
            foreach (var troop in order) x.Board("L1", Side.Blue, troop);
            x.Board("L1", Side.Red, "roxy");
            Assert.Equal(6, x.S.Stacks["L1"].Count);
            Assert.Equal(Side.Red, x.Engine.TopOwner(x.S, "L1"));
            Assert.Equal(order, x.S.Stacks["L1"].Take(5).Select(t => TestContent.Db.TileTroop(t).Id));
        }

        [Fact]
        public void Tile_must_be_on_the_rack()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Take(Side.Blue, "roxy");
            x.Fails(Command.Place(Side.Blue, t, "L1"), RuleError.TileNotInRack);
            int r = x.Take(Side.Red, "roxy");
            x.Fails(Command.Place(Side.Blue, r, "L1"), RuleError.TileNotInRack);
        }

        [Fact]
        public void Unknown_node_is_rejected()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "roxy");
            x.Fails(Command.Place(Side.Blue, t, "NOPE"), RuleError.UnknownNode);
        }
    }

    public class AbilityTests
    {
        [Fact]
        public void Skully_draws_two()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "skully");
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            x.ExpectDecision(DecisionKind.TroopDraw);
            Assert.Equal(2, x.S.Pending.Amount);
            x.Ok(Command.Accept(Side.Blue));
            Assert.Equal(2, x.S.P(Side.Blue).Rack.Count);
            Assert.Equal(Side.Red, x.S.Active);
        }

        [Fact]
        public void Skully_draws_one_with_seven_on_rack()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "skully");
            foreach (var troop in new[] { "captain", "mastok", "crochet", "xb42", "star", "roxy", "kwak" }) x.Rack(Side.Blue, troop);
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            x.ExpectDecision(DecisionKind.TroopDraw);
            Assert.Equal(1, x.S.Pending.Amount);
            x.Ok(Command.Accept(Side.Blue));
            Assert.Equal(8, x.S.P(Side.Blue).Rack.Count);
        }

        [Fact]
        public void Effects_are_optional()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "skully");
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            x.Ok(Command.Skip(Side.Blue));
            Assert.Empty(x.S.P(Side.Blue).Rack);
            Assert.Equal(Side.Red, x.S.Active);
        }

        [Fact]
        public void Star_draws_one()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, "star");
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            x.ExpectDecision(DecisionKind.TroopDraw);
            Assert.Equal(1, x.S.Pending.Amount);
            x.Ok(Command.Accept(Side.Blue));
            Assert.Single(x.S.P(Side.Blue).Rack);
        }

        [Theory]
        [InlineData("roxy")]
        [InlineData("kwak")]
        [InlineData("crochet")]
        public void Troops_without_triggered_effect_end_the_turn(string troop)
        {
            var x = new Sim("castle_plain", specialBases: false);
            int t = x.Rack(Side.Blue, troop);
            x.Ok(Command.Place(Side.Blue, t, "L1"));
            Assert.Equal(Phase.TurnAction, x.S.Phase);
            Assert.Equal(Side.Red, x.S.Active);
        }

        [Fact]
        public void Captain_chains_extra_placements_and_resolves_each_effect()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int c1 = x.Rack(Side.Blue, "captain");
            int c2 = x.Rack(Side.Blue, "captain");
            int st = x.Rack(Side.Blue, "star");
            x.Ok(Command.Place(Side.Blue, c1, "L1"));
            x.ExpectDecision(DecisionKind.ExtraPlacement);
            x.Ok(Command.Place(Side.Blue, c2, "L3"));
            x.ExpectDecision(DecisionKind.ExtraPlacement);
            x.Ok(Command.Place(Side.Blue, st, "K1")); // connected through L3 placed this turn
            x.ExpectDecision(DecisionKind.TroopDraw);
            x.Ok(Command.Accept(Side.Blue));
            Assert.Equal(Side.Red, x.S.Active);
            Assert.Single(x.S.P(Side.Blue).Rack);
            Assert.Equal(3, x.S.History.Count(c => c.Type == CommandType.Place));
        }

        [Fact]
        public void Captain_extra_placement_follows_placement_rules()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int c1 = x.Rack(Side.Blue, "captain");
            int r = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, c1, "L1"));
            x.Fails(Command.Place(Side.Blue, r, "M"), RuleError.NotConnected);
            x.Fails(Command.Draw(Side.Blue), RuleError.WrongPhase);
            x.Ok(Command.Place(Side.Blue, r, "P1"));
        }

        [Fact]
        public void Captain_without_any_legal_extra_placement_opens_no_decision()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int c1 = x.Rack(Side.Blue, "captain");
            x.Ok(Command.Place(Side.Blue, c1, "L1"));
            Assert.Equal(Side.Red, x.S.Active);
        }

        [Fact]
        public void Mastok_discards_an_adjacent_visible_enemy()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int victim = x.Board("P1", Side.Red, "roxy");
            x.Board("K1", Side.Red, "skully"); // not adjacent to L1
            int m = x.Rack(Side.Blue, "mastok");
            x.Ok(Command.Place(Side.Blue, m, "L1"));
            x.ExpectDecision(DecisionKind.DiscardAdjacentTarget);
            Assert.Equal(new[] { "P1" }, x.Engine.DiscardAdjacentTargets(x.S, Side.Blue, "L1"));
            x.Fails(Command.ChooseNode(Side.Blue, "K1"), RuleError.InvalidTarget);
            x.Ok(Command.ChooseNode(Side.Blue, "P1"));
            Assert.Empty(x.S.Stacks["P1"]);
            Assert.Contains(victim, x.S.Discard);
        }

        [Fact]
        public void Mastok_only_sees_the_visible_troop_and_reveals_the_one_below()
        {
            // Removing the enemy on top reveals a blue troop and completes region r1 (L1,L3,K1,P1).
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L3", Side.Blue, "kwak");
            x.Board("K1", Side.Blue, "kwak");
            x.Board("P1", Side.Blue, "skully");
            x.Board("P1", Side.Red, "roxy");
            int m = x.Rack(Side.Blue, "mastok");
            x.Ok(Command.Place(Side.Blue, m, "L1"));
            Assert.Equal(0, x.S.P(Side.Blue).Medals);
            x.Ok(Command.ChooseNode(Side.Blue, "P1"));
            Assert.Equal(2, x.S.P(Side.Blue).Medals);
            Assert.Equal(Side.Blue, x.S.RegionClaims["r1"]);
        }

        [Fact]
        public void Mastok_cannot_target_own_troops()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("P1", Side.Blue, "skully");
            int m = x.Rack(Side.Blue, "mastok");
            x.Ok(Command.Place(Side.Blue, m, "L1"));
            Assert.Equal(Side.Red, x.S.Active); // no target, no decision
        }

        [Fact]
        public void Xb42_discards_a_random_opponent_rack_troop_face_up()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Rack(Side.Red, "roxy"); x.Rack(Side.Red, "star"); x.Rack(Side.Red, "kwak");
            int xb = x.Rack(Side.Blue, "xb42");
            x.Ok(Command.Place(Side.Blue, xb, "L1"));
            x.ExpectDecision(DecisionKind.DiscardRandomConfirm);
            x.Ok(Command.Accept(Side.Blue));
            Assert.Equal(2, x.S.P(Side.Red).Rack.Count);
            Assert.Single(x.S.Discard);
            var ev = x.Events.Single(e => e.Type == GameEventType.TroopDiscarded);
            Assert.NotNull(ev.RedactFor(Side.Red).TroopId); // face up: both players see it
            Assert.NotNull(ev.RedactFor(Side.Blue).TroopId);
        }

        [Fact]
        public void Xb42_against_empty_rack_opens_no_decision()
        {
            var x = new Sim("castle_plain", specialBases: false);
            int xb = x.Rack(Side.Blue, "xb42");
            x.Ok(Command.Place(Side.Blue, xb, "L1"));
            Assert.Equal(Side.Red, x.S.Active);
        }
    }

    public class RegionAndVictoryTests
    {
        [Fact]
        public void Occupying_every_base_of_a_region_takes_its_medals()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L3", Side.Blue, "kwak");
            x.Board("K1", Side.Blue, "kwak");
            x.Board("K2", Side.Blue, "kwak");
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "M"));
            Assert.Equal(1, x.S.P(Side.Blue).Medals);
            Assert.Contains(x.Events, e => e.Type == GameEventType.RegionCaptured && e.RegionId == "r5");
        }

        [Fact]
        public void Several_regions_in_one_placement()
        {
            var x = new Sim("castle_plain", specialBases: false);
            string[] nodes = { "L1", "L3", "P1", "K2", "M" }, troops = { "skully", "captain", "mastok", "crochet", "roxy" };
            for (int i = 0; i < nodes.Length; i++) x.Board(nodes[i], Side.Blue, troops[i]);
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "K1"));
            Assert.Equal(3, x.S.P(Side.Blue).Medals); // r1 (2) + r5 (1)
        }

        [Fact]
        public void Medals_are_kept_after_losing_the_region_and_never_paid_twice()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L3", Side.Blue, "kwak");
            x.Board("K1", Side.Blue, "skully");
            x.Board("K2", Side.Blue, "kwak");
            int t = x.Rack(Side.Blue, "skully");
            x.Ok(Command.Place(Side.Blue, t, "M"));
            x.Ok(Command.Skip(Side.Blue));
            Assert.Equal(1, x.S.P(Side.Blue).Medals);
            // Red now takes all three bases of r5: blue keeps its medal, red gets nothing.
            x.S.Stacks["K1"].Add(x.Take(Side.Red, "roxy"));
            x.S.Stacks["K2"].Add(x.Take(Side.Red, "roxy"));
            x.S.Stacks["M"].Add(x.Take(Side.Red, "roxy"));
            x.S.P(Side.Red).Rack.Add(x.Take(Side.Red, "kwak"));
            x.Ok(Command.Draw(Side.Red));
            Assert.Equal(1, x.S.P(Side.Blue).Medals);
            Assert.Equal(0, x.S.P(Side.Red).Medals);
        }

        [Fact]
        public void Reaching_the_medal_goal_wins_immediately()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.S.P(Side.Blue).Medals = 6; // goal is 7 on this terrain
            x.Board("L3", Side.Blue, "kwak");
            x.Board("K1", Side.Blue, "kwak");
            x.Board("K2", Side.Blue, "kwak");
            int t = x.Rack(Side.Blue, "skully");
            x.Ok(Command.Place(Side.Blue, t, "M"));
            Assert.Equal(Phase.GameOver, x.S.Phase);
            Assert.Equal(WinReason.MedalGoal, x.S.WinReason);
            Assert.Null(x.S.Pending); // the Skully effect is not resolved after the win
        }

        [Fact]
        public void Medal_goal_is_per_terrain_and_per_side()
        {
            var sea = TestContent.Db.Terrain("pirate_sea");
            Assert.Equal(8, sea.MedalGoal[(int)Side.Blue]);
            Assert.Equal(7, sea.MedalGoal[(int)Side.Red]);
        }

        [Fact]
        public void Player_who_cannot_act_ends_the_game_and_loses_a_tie()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.ReserveSize(Side.Red, 0);
            x.Ok(Command.Draw(Side.Blue));
            Assert.Equal(Phase.GameOver, x.S.Phase);
            Assert.Equal(Side.Red, x.S.EndedBy);
            Assert.Equal(Side.Blue, x.S.Winner);
            Assert.Equal(WinReason.NoActionTieBreak, x.S.WinReason);
        }

        [Fact]
        public void Player_who_cannot_act_wins_with_more_medals()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.ReserveSize(Side.Red, 0);
            x.S.P(Side.Red).Medals = 2;
            x.Ok(Command.Draw(Side.Blue));
            Assert.Equal(Side.Red, x.S.Winner);
            Assert.Equal(WinReason.NoActionMoreMedals, x.S.WinReason);
        }

        [Fact]
        public void Full_rack_with_no_legal_placement_ends_the_game()
        {
            var x = new Sim("castle_plain", specialBases: false);
            // Blue walls the red HQ with its three 7s; red holds 8 tiles that cannot beat a 7.
            x.Board("R1", Side.Blue, "roxy"); x.Board("R2", Side.Blue, "roxy"); x.Board("R3", Side.Blue, "roxy");
            foreach (var t in new[] { "skully", "skully", "skully", "captain", "captain", "captain", "mastok", "mastok" }) x.Rack(Side.Red, t);
            x.S.P(Side.Blue).Medals = 1;
            x.Ok(Command.Draw(Side.Blue));
            Assert.Equal(Phase.GameOver, x.S.Phase);
            Assert.Equal(Side.Red, x.S.EndedBy);
            Assert.Equal(Side.Blue, x.S.Winner);
            Assert.Equal(WinReason.NoActionMoreMedals, x.S.WinReason);
        }

        [Fact]
        public void Nothing_is_accepted_after_game_over()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.ReserveSize(Side.Red, 0);
            x.Ok(Command.Draw(Side.Blue));
            x.Fails(Command.Draw(Side.Red), RuleError.GameOver);
        }
    }
}
