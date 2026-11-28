using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    public enum Side { Blue = 0, Red = 1 }

    public static class SideExt
    {
        public static Side Other(this Side s) => s == Side.Blue ? Side.Red : Side.Blue;
        public static string Key(this Side s) => s == Side.Blue ? "blue" : "red";
        public static Side ParseSide(string s)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "blue": case "bleu": return Side.Blue;
                case "red": case "rouge": return Side.Red;
                default: throw new FormatException("Unknown side '" + s + "'");
            }
        }
    }

    /// <summary>Troop ability kinds. The mapping troop -> ability lives in troops.json.</summary>
    public enum AbilityKind
    {
        None,
        /// <summary>May draw up to Amount troops from own reserve to own rack.</summary>
        Draw,
        /// <summary>May place one extra troop and resolve its effect.</summary>
        ExtraPlacement,
        /// <summary>May discard one visible enemy troop on a base adjacent to this troop.</summary>
        DiscardAdjacentEnemy,
        /// <summary>Passive: may be placed on any base, connected or not (never on an HQ without connection).</summary>
        IgnoreConnection,
        /// <summary>May discard, face up, one random troop from the opponent's rack.</summary>
        DiscardRandomFromOpponentRack,
    }

    public sealed class TroopDefinition
    {
        /// <summary>Stable mechanic id (e.g. "skully"), used in saves and network messages.</summary>
        public string Id;
        /// <summary>Name of the matching troop in the reference board game (documentation only).</summary>
        public string ReferenceName;
        /// <summary>Original display name used in the distributed game.</summary>
        public string Name;
        public string Tagline;
        public string EffectText;
        /// <summary>Strength 1..7; 0 for the joker.</summary>
        public int Strength;
        public bool IsJoker;
        public AbilityKind Ability;
        public int Amount;
        public int CopiesPerPlayer = 3;
        public string Color;

        public string StrengthLabel => IsJoker ? "★" : Strength.ToString();
    }

    public enum NodeType { Base, Special, Hq }

    public sealed class NodeDefinition
    {
        public string Id;
        public NodeType Type;
        /// <summary>Owner of an HQ; meaningless for bases.</summary>
        public Side Owner;
        public double X, Y;
        /// <summary>Strength restriction (tropical pool). Null = no restriction.</summary>
        public List<int> AllowedStrengths;
        public bool AllowJoker;

        public bool IsBase => Type != NodeType.Hq;
        public bool IsHq => Type == NodeType.Hq;
        public bool IsSpecial => Type == NodeType.Special;
    }

    public sealed class RegionDefinition
    {
        public string Id;
        public List<string> Bases = new List<string>();
        public int Medals;
    }

    /// <summary>Terrain-wide effect of special bases. One kind per terrain, as in the reference game.</summary>
    public enum TerrainEffect
    {
        None,
        /// <summary>Plaine des châteaux: may return another own visible troop from the board to the rack.</summary>
        RecallOwnTroop,
        /// <summary>Piscine des tropiques: only listed strengths may be placed on these special bases and HQs.</summary>
        StrengthRestriction,
        /// <summary>Cité des nuages: may draw 1 troop.</summary>
        DrawOne,
        /// <summary>Jungle volcanique: may move a visible enemy troop adjacent to the special base to a base adjacent to its start.</summary>
        MoveAdjacentEnemy,
        /// <summary>Cimetière maudit: may take one own troop from the discard back to the rack.</summary>
        RecoverFromDiscard,
        /// <summary>Station Métal-X: troop effects are not applied on these special bases.</summary>
        EffectShield,
        /// <summary>Champ de bataille: designate one opponent rack troop; it cannot be placed during the opponent's next turn.</summary>
        DesignateOpponentRack,
    }

    public sealed class TerrainDefinition
    {
        public string Id;
        public string Name;
        public string ReferenceTerrain;
        /// <summary>"original-design" or "transcribed-official". Only the latter may claim official values.</summary>
        public string LayoutSource;
        public string Flavor;
        public TerrainEffect SpecialEffect;
        public int[] MedalGoal = new int[2];
        public readonly List<NodeDefinition> Nodes = new List<NodeDefinition>();
        public readonly List<string[]> Edges = new List<string[]>();
        public readonly List<RegionDefinition> Regions = new List<RegionDefinition>();

        private readonly Dictionary<string, NodeDefinition> _byId = new Dictionary<string, NodeDefinition>();
        private readonly Dictionary<string, List<string>> _adj = new Dictionary<string, List<string>>();
        private readonly List<string>[] _hqs = { new List<string>(), new List<string>() };
        private readonly Dictionary<string, List<RegionDefinition>> _regionsByBase = new Dictionary<string, List<RegionDefinition>>();

        public NodeDefinition Node(string id)
        {
            if (id != null && _byId.TryGetValue(id, out var n)) return n;
            return null;
        }

        public IReadOnlyList<string> Neighbors(string id) => _adj.TryGetValue(id, out var l) ? l : (IReadOnlyList<string>)Array.Empty<string>();

        public IReadOnlyList<string> Hqs(Side side) => _hqs[(int)side];

        public IReadOnlyList<RegionDefinition> RegionsOfBase(string id)
            => _regionsByBase.TryGetValue(id, out var l) ? l : (IReadOnlyList<RegionDefinition>)Array.Empty<RegionDefinition>();

        public bool AreAdjacent(string a, string b) => _adj.TryGetValue(a, out var l) && l.Contains(b);

        public int TotalMedals
        {
            get { int t = 0; foreach (var r in Regions) t += r.Medals; return t; }
        }

        /// <summary>Builds lookup tables and checks structural consistency. Throws on invalid data.</summary>
        public void Build()
        {
            _byId.Clear(); _adj.Clear(); _hqs[0].Clear(); _hqs[1].Clear(); _regionsByBase.Clear();
            foreach (var n in Nodes)
            {
                if (_byId.ContainsKey(n.Id)) throw new FormatException(Id + ": duplicate node " + n.Id);
                _byId[n.Id] = n;
                _adj[n.Id] = new List<string>();
                if (n.IsHq) _hqs[(int)n.Owner].Add(n.Id);
            }
            foreach (var e in Edges)
            {
                if (e.Length != 2 || !_byId.ContainsKey(e[0]) || !_byId.ContainsKey(e[1]))
                    throw new FormatException(Id + ": bad edge " + string.Join("-", e));
                if (e[0] == e[1] || _adj[e[0]].Contains(e[1])) throw new FormatException(Id + ": duplicate/self edge " + string.Join("-", e));
                _adj[e[0]].Add(e[1]);
                _adj[e[1]].Add(e[0]);
            }
            if (_hqs[0].Count == 0 || _hqs[1].Count == 0) throw new FormatException(Id + ": each side needs an HQ");
            foreach (var r in Regions)
            {
                if (r.Bases.Count < 3) throw new FormatException(Id + ": region " + r.Id + " needs at least 3 bases");
                for (int i = 0; i < r.Bases.Count; i++)
                {
                    var b = Node(r.Bases[i]);
                    if (b == null || !b.IsBase) throw new FormatException(Id + ": region " + r.Id + " has invalid base " + r.Bases[i]);
                    if (!AreAdjacent(r.Bases[i], r.Bases[(i + 1) % r.Bases.Count]))
                        throw new FormatException(Id + ": region " + r.Id + " bases do not form a closed path");
                    if (!_regionsByBase.TryGetValue(b.Id, out var l)) _regionsByBase[b.Id] = l = new List<RegionDefinition>();
                    l.Add(r);
                }
            }
        }
    }
}
