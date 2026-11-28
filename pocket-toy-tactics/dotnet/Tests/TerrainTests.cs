using System.Linq;
using PocketToyTactics.Core;
using Xunit;

namespace PocketToyTactics.Tests
{
    public class TerrainDataTests
    {
        [Fact]
        public void Eight_terrains_with_one_of_each_reference_effect()
        {
            var db = TestContent.Db;
            Assert.Equal(8, db.Terrains.Count);
            var refs = db.Terrains.Values.Select(t => t.ReferenceTerrain).OrderBy(x => x).ToArray();
            Assert.Equal(new[] { "champ_de_bataille", "cimetiere_maudit", "cite_des_nuages", "jungle_volcanique",
                "mer_des_caraibes", "piscine_des_tropiques", "plaine_des_chateaux", "station_metal_x" }, refs);
            Assert.All(db.Terrains.Values, t =>
            {
                Assert.InRange(t.TotalMedals, 1, 16);
                Assert.True(t.MedalGoal[0] > 0 && t.MedalGoal[0] <= t.TotalMedals);
                Assert.True(t.MedalGoal[1] > 0 && t.MedalGoal[1] <= t.TotalMedals);
                Assert.Equal("original-design", t.LayoutSource); // never claimed as official values
            });
        }

        [Fact]
        public void Caribbean_sea_has_two_blue_hqs_and_one_red()
        {
            var t = TestContent.Db.Terrain("pirate_sea");
            Assert.Equal(2, t.Hqs(Side.Blue).Count);
            Assert.Single(t.Hqs(Side.Red));
            Assert.DoesNotContain(t.Nodes, n => n.IsSpecial);
        }
    }

    public class TerrainEffectTests
    {
        // castle_plain: specials P2 (L2,K2,P4), P3, M. HB-L1, HB-L2.
        [Fact]
        public void Castle_plain_returns_another_own_visible_troop_to_the_rack()
        {
            var x = new Sim("castle_plain");
            x.Board("L2", Side.Blue, "kwak");
            int back = x.Board("L1", Side.Blue, "star");
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "P2"));
            x.ExpectDecision(DecisionKind.RecallOwnTroop);
            Assert.DoesNotContain("P2", x.Engine.RecallTargets(x.S, Side.Blue, t)); // "another" troop
            x.Ok(Command.ChooseNode(Side.Blue, "L1"));
            Assert.Contains(back, x.S.P(Side.Blue).Rack);
            Assert.Contains(back, x.S.P(Side.Blue).KnownInRack);
            Assert.Empty(x.S.Stacks["L1"]);
        }

        [Fact]
        public void Castle_plain_effect_is_impossible_with_a_full_rack()
        {
            var x = new Sim("castle_plain");
            x.Board("L2", Side.Blue, "kwak");
            int t = x.Rack(Side.Blue, "roxy");
            foreach (var troop in new[] { "skully", "skully", "captain", "captain", "mastok", "mastok", "crochet", "crochet" }) x.Rack(Side.Blue, troop);
            x.Ok(Command.Place(Side.Blue, t, "P2"));
            x.Ok(Command.Draw(Side.Red)); // blue's turn ended without a decision
        }

        [Fact]
        public void Beginner_variant_disables_special_bases()
        {
            var x = new Sim("castle_plain", specialBases: false);
            x.Board("L2", Side.Blue, "kwak");
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "P2"));
            Assert.Equal(Side.Red, x.S.Active);
        }

        // tropical_pool: HB-T1, T1-T2, T2-T3, T3-T4, T4-HR. T2,B3 accept 2/4/6, T3,B2 accept 1/3/5/7, HQs accept 1/2/3.
        [Fact]
        public void Tropical_pool_restricts_strengths_on_special_bases()
        {
            var x = new Sim("tropical_pool");
            x.Board("T1", Side.Blue, "kwak");
            int roxy = x.Rack(Side.Blue, "roxy");
            int star = x.Rack(Side.Blue, "star");
            int kwak = x.Rack(Side.Blue, "kwak");
            x.Fails(Command.Place(Side.Blue, roxy, "T2"), RuleError.StrengthNotAllowed);
            x.Fails(Command.Place(Side.Blue, kwak, "T2"), RuleError.StrengthNotAllowed);
            x.Ok(Command.Place(Side.Blue, star, "T2"));
        }

        [Fact]
        public void Tropical_pool_restricts_strengths_on_hqs()
        {
            var x = new Sim("tropical_pool");
            string[] nodes = { "T1", "T2", "T3", "T4" }, troops = { "kwak", "star", "roxy", "kwak" };
            for (int i = 0; i < 4; i++) x.Board(nodes[i], Side.Blue, troops[i]);
            int roxy = x.Rack(Side.Blue, "roxy");
            int skully = x.Rack(Side.Blue, "skully");
            x.Fails(Command.Place(Side.Blue, roxy, "HR"), RuleError.StrengthNotAllowed);
            x.Ok(Command.Place(Side.Blue, skully, "HR"));
            Assert.Equal(WinReason.HqCaptured, x.S.WinReason);
        }

        [Fact]
        public void Tropical_pool_hq_restriction_still_applies_in_beginner_variant()
        {
            var x = new Sim("tropical_pool", specialBases: false);
            string[] nodes = { "T1", "T2", "T3", "T4" }, troops = { "kwak", "star", "roxy", "kwak" };
            for (int i = 0; i < 4; i++) x.Board(nodes[i], Side.Blue, troops[i]);
            int roxy = x.Rack(Side.Blue, "roxy");
            x.Fails(Command.Place(Side.Blue, roxy, "HR"), RuleError.StrengthNotAllowed);
            var y = new Sim("tropical_pool", specialBases: false);
            y.Board("T1", Side.Blue, "kwak");
            y.Ok(Command.Place(Side.Blue, y.Rack(Side.Blue, "roxy"), "T2")); // special base restriction off
        }

        // cloud_city: HB-W1, W1-R1, W1-R0, R1-R2 (special), R2-Z, R2-R3.
        [Fact]
        public void Cloud_city_draws_one_and_troop_effects_resolve_before_base_effects()
        {
            var x = new Sim("cloud_city");
            x.Board("W1", Side.Blue, "kwak");
            x.Board("R1", Side.Blue, "kwak");
            int cap = x.Rack(Side.Blue, "captain");
            int star = x.Rack(Side.Blue, "star");
            x.Ok(Command.Place(Side.Blue, cap, "R2"));       // Cap'taine on a special base
            x.ExpectDecision(DecisionKind.ExtraPlacement);
            x.Ok(Command.Place(Side.Blue, star, "R0"));
            x.ExpectDecision(DecisionKind.TroopDraw);         // Star's effect first...
            x.Ok(Command.Accept(Side.Blue));
            x.ExpectDecision(DecisionKind.TerrainDraw);       // ...then the special base of the Cap'taine
            x.Ok(Command.Accept(Side.Blue));
            Assert.Equal(2, x.S.P(Side.Blue).Rack.Count);
            Assert.Equal(Side.Red, x.S.Active);
        }

        // volcano_jungle: T (special) - V1, V2, L1, R1. V1 - V2, V6, T, L1. HB-L1.
        [Fact]
        public void Volcano_jungle_moves_an_adjacent_enemy_ignoring_placement_rules()
        {
            var x = new Sim("volcano_jungle");
            x.Board("L1", Side.Blue, "kwak");
            int victim = x.Board("V1", Side.Red, "skully");
            x.Board("V2", Side.Blue, "roxy");
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "T"));
            x.ExpectDecision(DecisionKind.MoveEnemySource);
            x.Fails(Command.ChooseNode(Side.Blue, "V2"), RuleError.InvalidTarget); // own troop
            x.Ok(Command.ChooseNode(Side.Blue, "V1"));
            x.ExpectDecision(DecisionKind.MoveEnemyDestination);
            x.Fails(Command.Skip(Side.Blue), RuleError.NotOptional);
            x.Fails(Command.ChooseNode(Side.Blue, "R1"), RuleError.InvalidTarget); // not adjacent to V1
            x.Ok(Command.ChooseNode(Side.Blue, "V2"));    // onto a 7: placement rules ignored
            Assert.Equal(victim, x.S.TopTile("V2"));
            Assert.Empty(x.S.Stacks["V1"]);
            Assert.Equal(Side.Red, x.S.Active);
        }

        // cursed_graveyard: HB-G2, G2-G5 (special).
        [Fact]
        public void Cursed_graveyard_recovers_an_own_troop_from_the_discard()
        {
            var x = new Sim("cursed_graveyard");
            x.Board("G2", Side.Blue, "kwak");
            int mine = x.Take(Side.Blue, "roxy");
            int theirs = x.Take(Side.Red, "roxy");
            x.S.Discard.Add(mine);
            x.S.Discard.Add(theirs);
            int t = x.Rack(Side.Blue, "kwak");
            x.Ok(Command.Place(Side.Blue, t, "G5"));
            x.ExpectDecision(DecisionKind.RecoverFromDiscard);
            x.Fails(Command.ChooseTile(Side.Blue, theirs), RuleError.InvalidTarget);
            x.Ok(Command.ChooseTile(Side.Blue, mine));
            Assert.Contains(mine, x.S.P(Side.Blue).Rack);
            Assert.Equal(new[] { theirs }, x.S.Discard);
        }

        // pirate_sea: HB1-I1, HB1-I3, HB2-I2, HB2-I3 | HR-I8, HR-I11 (no HR-I6) | I8-I5, I5-I3.
        [Fact]
        public void Pirate_sea_blue_connects_from_either_hq()
        {
            var x = new Sim("pirate_sea");
            int a = x.Rack(Side.Blue, "roxy");
            Assert.Equal(RuleError.None, x.Engine.CheckPlacement(x.S, Side.Blue, a, "I1"));
            Assert.Equal(RuleError.None, x.Engine.CheckPlacement(x.S, Side.Blue, a, "I2"));
            Assert.Equal(RuleError.NotConnected, x.Engine.CheckPlacement(x.S, Side.Blue, a, "I4"));
            Assert.Equal(RuleError.OwnHq, x.Engine.CheckPlacement(x.S, Side.Blue, a, "HB2"));
        }

        [Fact]
        public void Pirate_sea_capturing_one_of_two_hqs_is_enough()
        {
            var x = new Sim("pirate_sea", Side.Red);
            x.Board("I8", Side.Red, "kwak");
            x.Board("I5", Side.Red, "kwak");
            x.Board("I3", Side.Red, "kwak");
            int t = x.Rack(Side.Red, "skully");
            x.Ok(Command.Place(Side.Red, t, "HB2"));
            Assert.Equal(Side.Red, x.S.Winner);
            Assert.Equal(WinReason.HqCaptured, x.S.WinReason);
        }

        // metalx_station: specials F, G. HB-A, A-C, C-F, C-G, C-B, A-D, D-F, D-H.
        [Fact]
        public void Metalx_blocks_troop_effects_on_its_special_bases()
        {
            var x = new Sim("metalx_station");
            x.Board("A", Side.Blue, "kwak");
            x.Board("C", Side.Blue, "kwak");
            int cap = x.Rack(Side.Blue, "captain");
            x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, cap, "F"));
            Assert.Contains(x.Events, e => e.Type == GameEventType.AbilityBlocked);
            Assert.Equal(Side.Red, x.S.Active); // no extra placement
        }

        [Fact]
        public void Metalx_shields_troops_on_special_bases_from_effects()
        {
            var x = new Sim("metalx_station");
            x.Board("A", Side.Blue, "kwak");
            x.Board("F", Side.Red, "skully");
            x.Board("B", Side.Red, "skully");
            int m = x.Rack(Side.Blue, "mastok");
            x.Ok(Command.Place(Side.Blue, m, "C"));
            x.ExpectDecision(DecisionKind.DiscardAdjacentTarget);
            Assert.Equal(new[] { "B" }, x.Engine.DiscardAdjacentTargets(x.S, Side.Blue, "C"));
        }

        [Fact]
        public void Metalx_crochet_needs_connection_to_enter_a_shielded_base()
        {
            var x = new Sim("metalx_station");
            int c = x.Rack(Side.Blue, "crochet");
            Assert.Equal(RuleError.NotConnected, x.Engine.CheckPlacement(x.S, Side.Blue, c, "F"));
            Assert.Equal(RuleError.None, x.Engine.CheckPlacement(x.S, Side.Blue, c, "H"));
        }

        [Fact]
        public void Metalx_special_bases_are_plain_in_beginner_variant()
        {
            var x = new Sim("metalx_station", specialBases: false);
            x.Board("A", Side.Blue, "kwak");
            x.Board("C", Side.Blue, "kwak");
            int cap = x.Rack(Side.Blue, "captain");
            x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, cap, "F"));
            x.ExpectDecision(DecisionKind.ExtraPlacement);
        }

        // battlefield: specials S1, S4. HB-P1, P1-Q1, Q1-S1.
        [Fact]
        public void Battlefield_lays_down_an_opponent_troop_for_one_turn()
        {
            var x = new Sim("battlefield");
            x.Board("P1", Side.Blue, "kwak");
            x.Board("Q1", Side.Blue, "kwak");
            int r0 = x.Rack(Side.Red, "roxy");
            int r1 = x.Rack(Side.Red, "star");
            x.Rack(Side.Red, "kwak");
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "S1"));
            x.ExpectDecision(DecisionKind.DesignateOpponentRack);
            x.Fails(Command.Skip(Side.Blue), RuleError.NotOptional);
            x.Ok(Command.ChooseIndex(Side.Blue, 1));
            Assert.Equal(new[] { r1 }, x.S.P(Side.Red).LaidDown);
            // Red cannot place the laid-down troop this turn...
            x.Fails(Command.Place(Side.Red, r1, "P4"), RuleError.TileLaidDown);
            Assert.DoesNotContain(x.Engine.LegalCommands(x.S), c => c.TileId == r1);
            // ...it still counts on the rack, and it stands up at the end of red's turn.
            x.Ok(Command.Place(Side.Red, r0, "P4"));
            Assert.Empty(x.S.P(Side.Red).LaidDown);
            Assert.Contains(x.Events, e => e.Type == GameEventType.TroopStoodUp && e.TileId == r1);
        }

        [Fact]
        public void Battlefield_laid_down_troop_counts_toward_the_rack_limit()
        {
            var x = new Sim("battlefield", Side.Red);
            foreach (var troop in new[] { "skully", "skully", "captain", "captain", "mastok", "mastok", "crochet", "crochet" }) x.Rack(Side.Red, troop);
            x.S.P(Side.Red).LaidDown.Add(x.S.P(Side.Red).Rack[0]);
            x.Fails(Command.Draw(Side.Red), RuleError.RackFull);
        }

        [Fact]
        public void Battlefield_designation_hides_the_tile_from_the_designator()
        {
            var x = new Sim("battlefield");
            x.Board("P1", Side.Blue, "kwak");
            x.Board("Q1", Side.Blue, "kwak");
            x.Rack(Side.Red, "roxy");
            int t = x.Rack(Side.Blue, "roxy");
            x.Ok(Command.Place(Side.Blue, t, "S1"));
            x.Ok(Command.ChooseIndex(Side.Blue, 0));
            var ev = x.Events.Single(e => e.Type == GameEventType.TroopLaidDown);
            Assert.Null(ev.RedactFor(Side.Blue).TroopId);
            Assert.Equal("roxy", ev.RedactFor(Side.Red).TroopId);
            var view = PlayerView.Create(x.S, Side.Blue);
            Assert.Equal(new[] { 0 }, view.OppLaidDownSlots);
        }
    }
}
