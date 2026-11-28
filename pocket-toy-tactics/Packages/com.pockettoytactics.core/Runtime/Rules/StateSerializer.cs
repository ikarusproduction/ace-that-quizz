using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    /// <summary>JSON (de)serialization of the full authoritative state (save games, host snapshots).</summary>
    public static class StateSerializer
    {
        public const int FormatVersion = 1;

        internal static List<object> Ints(IEnumerable<int> l)
        {
            var r = new List<object>();
            foreach (var x in l) r.Add(x);
            return r;
        }

        internal static Dictionary<string, object> StacksToJson(Dictionary<string, List<int>> stacks)
        {
            var d = new Dictionary<string, object>();
            foreach (var kv in stacks) d[kv.Key] = Ints(kv.Value);
            return d;
        }

        internal static Dictionary<string, List<int>> StacksFromJson(Dictionary<string, object> d)
        {
            var r = new Dictionary<string, List<int>>();
            foreach (var kv in d) r[kv.Key] = ((List<object>)kv.Value).ConvertAll(x => Convert.ToInt32(x));
            return r;
        }

        internal static Dictionary<string, object> PendingToJson(PendingDecision p)
        {
            if (p == null) return null;
            return new Dictionary<string, object>
            {
                ["kind"] = p.Kind.ToString(), ["p"] = p.Player.Key(), ["src"] = p.SourceTile, ["node"] = p.SourceNode,
                ["n"] = p.Amount, ["sel"] = p.SelectedNode, ["opt"] = p.Optional,
            };
        }

        internal static PendingDecision PendingFromJson(Dictionary<string, object> d)
        {
            if (d == null) return null;
            return new PendingDecision
            {
                Kind = (DecisionKind)Enum.Parse(typeof(DecisionKind), d.Str("kind")),
                Player = SideExt.ParseSide(d.Str("p")),
                SourceTile = d.Int("src", -1),
                SourceNode = d.Str("node"),
                Amount = d.Int("n"),
                SelectedNode = d.Str("sel"),
                Optional = d.Bool("opt", true),
            };
        }

        internal static List<object> ChainToJson(List<PlacementRecord> chain)
        {
            var l = new List<object>();
            foreach (var r in chain) l.Add(new Dictionary<string, object> { ["tile"] = r.TileId, ["node"] = r.NodeId });
            return l;
        }

        internal static List<PlacementRecord> ChainFromJson(List<object> l)
        {
            var r = new List<PlacementRecord>();
            if (l == null) return r;
            foreach (Dictionary<string, object> d in l) r.Add(new PlacementRecord { TileId = d.Int("tile"), NodeId = d.Str("node") });
            return r;
        }

        internal static Dictionary<string, object> ClaimsToJson(Dictionary<string, Side> claims)
        {
            var d = new Dictionary<string, object>();
            foreach (var kv in claims) d[kv.Key] = kv.Value.Key();
            return d;
        }

        internal static Dictionary<string, Side> ClaimsFromJson(Dictionary<string, object> d)
        {
            var r = new Dictionary<string, Side>();
            if (d != null) foreach (var kv in d) r[kv.Key] = SideExt.ParseSide((string)kv.Value);
            return r;
        }

        public static Dictionary<string, object> ToJson(GameState s)
        {
            var players = new List<object>();
            foreach (var p in s.Players)
            {
                players.Add(new Dictionary<string, object>
                {
                    ["reserve"] = Ints(p.Reserve), ["rack"] = Ints(p.Rack), ["removed"] = Ints(p.Removed),
                    ["laid"] = Ints(p.LaidDown), ["known"] = Ints(p.KnownInRack), ["medals"] = p.Medals,
                });
            }
            var history = new List<object>();
            foreach (var c in s.History) history.Add(c.ToJson());
            return new Dictionary<string, object>
            {
                ["format"] = FormatVersion,
                ["terrain"] = s.TerrainId,
                ["specialBases"] = s.SpecialBasesEnabled,
                ["seed"] = s.Seed.ToString(),
                ["turn"] = s.Turn,
                ["active"] = s.Active.Key(),
                ["first"] = s.FirstPlayer.Key(),
                ["phase"] = s.Phase.ToString(),
                ["seq"] = s.Seq,
                ["players"] = players,
                ["stacks"] = StacksToJson(s.Stacks),
                ["discard"] = Ints(s.Discard),
                ["claims"] = ClaimsToJson(s.RegionClaims),
                ["pending"] = PendingToJson(s.Pending),
                ["chain"] = ChainToJson(s.Chain),
                ["troopStack"] = Ints(s.TroopEffectStack),
                ["baseCursor"] = s.BaseEffectCursor,
                ["winner"] = s.Winner?.Key(),
                ["winReason"] = s.WinReason.ToString(),
                ["endedBy"] = s.EndedBy?.Key(),
                ["rng"] = s.Rng.Serialize(),
                ["history"] = history,
            };
        }

        public static GameState FromJson(Dictionary<string, object> d)
        {
            int format = d.Int("format");
            if (format != FormatVersion) throw new FormatException("Unsupported save format " + format);
            var s = new GameState
            {
                TerrainId = d.Str("terrain"),
                SpecialBasesEnabled = d.Bool("specialBases", true),
                Seed = ulong.Parse(d.Str("seed")),
                Turn = d.Int("turn"),
                Active = SideExt.ParseSide(d.Str("active")),
                FirstPlayer = SideExt.ParseSide(d.Str("first")),
                Phase = (Phase)Enum.Parse(typeof(Phase), d.Str("phase")),
                Seq = d.Long("seq"),
                Stacks = StacksFromJson(d.Obj("stacks")),
                Discard = d.IntList("discard"),
                RegionClaims = ClaimsFromJson(d.Obj("claims")),
                Pending = PendingFromJson(d.Obj("pending")),
                Chain = ChainFromJson(d.Arr("chain")),
                TroopEffectStack = d.IntList("troopStack"),
                BaseEffectCursor = d.Int("baseCursor"),
                WinReason = (WinReason)Enum.Parse(typeof(WinReason), d.Str("winReason", "None")),
                Rng = Rng.Deserialize(d.Str("rng")),
            };
            var w = d.Str("winner");
            if (w != null) s.Winner = SideExt.ParseSide(w);
            var e = d.Str("endedBy");
            if (e != null) s.EndedBy = SideExt.ParseSide(e);
            var players = d.Arr("players");
            for (int i = 0; i < 2; i++)
            {
                var pd = (Dictionary<string, object>)players[i];
                s.Players[i] = new PlayerState
                {
                    Reserve = pd.IntList("reserve"), Rack = pd.IntList("rack"), Removed = pd.IntList("removed"),
                    LaidDown = pd.IntList("laid"), KnownInRack = pd.IntList("known"), Medals = pd.Int("medals"),
                };
            }
            foreach (Dictionary<string, object> c in d.Arr("history") ?? new List<object>()) s.History.Add(Command.FromJson(c));
            return s;
        }

        public static string Serialize(GameState s) => Json.Write(ToJson(s));
        public static GameState Deserialize(string json) => FromJson(Json.ParseObject(json));
    }
}
