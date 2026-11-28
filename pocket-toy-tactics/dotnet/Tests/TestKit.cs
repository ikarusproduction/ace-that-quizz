using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PocketToyTactics.Core;
using Xunit;

namespace PocketToyTactics.Tests
{
    public static class TestContent
    {
        private static ContentDatabase _db;

        public static string ContentDir()
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !Directory.Exists(Path.Combine(dir, "Packages")))
                dir = Path.GetDirectoryName(dir);
            if (dir == null) throw new DirectoryNotFoundException("Packages folder not found");
            return Path.Combine(dir, "Packages", "com.pockettoytactics.core", "Content");
        }

        public static ContentDatabase Db
        {
            get
            {
                if (_db != null) return _db;
                var db = new ContentDatabase();
                var dir = ContentDir();
                db.LoadTroops(File.ReadAllText(Path.Combine(dir, "troops.json")));
                foreach (var f in Directory.GetFiles(Path.Combine(dir, "terrains"), "*.json").OrderBy(x => x))
                    db.LoadTerrain(File.ReadAllText(f));
                return _db = db;
            }
        }
    }

    /// <summary>Builds hand-made positions on top of a real terrain.</summary>
    public sealed class Sim
    {
        public readonly RulesEngine Engine = new RulesEngine(TestContent.Db);
        public GameState S;
        public readonly List<GameEvent> Events = new List<GameEvent>();
        private readonly Dictionary<(Side, string), int> _used = new Dictionary<(Side, string), int>();

        public Sim(string terrain, Side active = Side.Blue, bool specialBases = true)
        {
            S = Engine.NewGame(terrain, 42, new GameOptions { FirstPlayer = active, SpecialBasesEnabled = specialBases });
            foreach (var side in new[] { Side.Blue, Side.Red })
            {
                var p = S.P(side);
                p.Rack.Clear(); p.Removed.Clear(); p.Reserve.Clear();
                p.Reserve.AddRange(TestContent.Db.TilesOf(side));
            }
            S.Active = active;
        }

        /// <summary>Takes an unused tile of that troop from the side's reserve.</summary>
        public int Take(Side side, string troop)
        {
            var p = S.P(side);
            var t = p.Reserve.First(x => TestContent.Db.TileTroop(x).Id == troop);
            p.Reserve.Remove(t);
            return t;
        }

        public int Rack(Side side, string troop)
        {
            int t = Take(side, troop);
            S.P(side).Rack.Add(t);
            return t;
        }

        public int Board(string node, Side side, string troop)
        {
            int t = Take(side, troop);
            S.Stacks[node].Add(t);
            return t;
        }

        /// <summary>Leaves only <paramref name="n"/> tiles in the reserve of a side.</summary>
        public void ReserveSize(Side side, int n)
        {
            var p = S.P(side);
            while (p.Reserve.Count > n) { p.Removed.Add(p.Reserve[p.Reserve.Count - 1]); p.Reserve.RemoveAt(p.Reserve.Count - 1); }
        }

        public ApplyResult Do(Command c)
        {
            var r = Engine.Apply(S, c);
            Events.AddRange(r.Events);
            return r;
        }

        public void Ok(Command c)
        {
            var r = Do(c);
            Assert.True(r.Ok, "expected " + c + " to be legal, got " + r.Error);
        }

        public void Fails(Command c, RuleError expected)
        {
            var before = StateSerializer.Serialize(S);
            var r = Engine.Apply(S, c);
            Assert.Equal(expected, r.Error);
            Assert.Equal(before, StateSerializer.Serialize(S)); // a rejected command never changes the state
        }

        public void ExpectDecision(DecisionKind kind)
        {
            Assert.Equal(Phase.Decision, S.Phase);
            Assert.NotNull(S.Pending);
            Assert.Equal(kind, S.Pending.Kind);
        }

        public string TroopAt(string node)
        {
            int t = S.TopTile(node);
            return t < 0 ? null : TestContent.Db.TileTroop(t).Id;
        }
    }
}
