using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    /// <summary>
    /// All data-driven content: troop roster and terrains. Built from JSON text so that it works the same
    /// in Unity (TextAsset.text) and in plain .NET (File.ReadAllText).
    /// </summary>
    public sealed class ContentDatabase
    {
        public const int RackCapacity = 8;
        public const int RemovedPerPlayer = 4;
        public const int FirstPlayerStartingRack = 3;
        public const int SecondPlayerStartingRack = 4;
        public const int DrawActionCount = 2;

        public readonly List<TroopDefinition> Troops = new List<TroopDefinition>();
        public readonly Dictionary<string, TerrainDefinition> Terrains = new Dictionary<string, TerrainDefinition>();
        public readonly List<string> TerrainOrder = new List<string>();

        private readonly Dictionary<string, int> _troopIndex = new Dictionary<string, int>();

        public int TilesPerPlayer { get; private set; }

        public TroopDefinition Troop(string id) => Troops[_troopIndex[id]];
        public int TroopIndex(string id) => _troopIndex[id];

        public TerrainDefinition Terrain(string id)
        {
            if (!Terrains.TryGetValue(id, out var t)) throw new KeyNotFoundException("Unknown terrain " + id);
            return t;
        }

        // Tile ids are stable for a given roster: Blue tiles 0..N-1, Red tiles N..2N-1,
        // grouped by troop definition order then copy index. Knowing an id reveals the troop,
        // so ids of hidden tiles are never sent to the other player (see PlayerView).
        public Side TileOwner(int tileId) => tileId < TilesPerPlayer ? Side.Blue : Side.Red;

        public TroopDefinition TileTroop(int tileId)
        {
            int local = tileId % TilesPerPlayer;
            foreach (var t in Troops)
            {
                if (local < t.CopiesPerPlayer) return t;
                local -= t.CopiesPerPlayer;
            }
            throw new ArgumentOutOfRangeException(nameof(tileId));
        }

        public IEnumerable<int> TilesOf(Side side)
        {
            int start = side == Side.Blue ? 0 : TilesPerPlayer;
            for (int i = 0; i < TilesPerPlayer; i++) yield return start + i;
        }

        public void LoadTroops(string json)
        {
            Troops.Clear();
            _troopIndex.Clear();
            var root = Json.ParseObject(json);
            foreach (var o in root.Arr("troops"))
            {
                var d = (Dictionary<string, object>)o;
                var t = new TroopDefinition
                {
                    Id = d.Str("id"),
                    ReferenceName = d.Str("referenceName"),
                    Name = d.Str("name"),
                    Tagline = d.Str("tagline", ""),
                    EffectText = d.Str("effect", ""),
                    Strength = d.Int("strength"),
                    IsJoker = d.Bool("joker"),
                    Ability = ParseAbility(d.Str("ability", "none")),
                    Amount = d.Int("amount", 0),
                    CopiesPerPlayer = d.Int("copies", 3),
                    Color = d.Str("color", "#cccccc"),
                };
                if (string.IsNullOrEmpty(t.Id)) throw new FormatException("troop without id");
                if (!t.IsJoker && (t.Strength < 1)) throw new FormatException("troop " + t.Id + " needs strength >= 1 or joker");
                if (t.Ability == AbilityKind.Draw && t.Amount < 1) throw new FormatException("draw troop " + t.Id + " needs amount");
                _troopIndex[t.Id] = Troops.Count;
                Troops.Add(t);
            }
            int n = 0;
            foreach (var t in Troops) n += t.CopiesPerPlayer;
            TilesPerPlayer = n;
        }

        public static AbilityKind ParseAbility(string s)
        {
            switch (s)
            {
                case "none": return AbilityKind.None;
                case "draw": return AbilityKind.Draw;
                case "extra_placement": return AbilityKind.ExtraPlacement;
                case "discard_adjacent_enemy": return AbilityKind.DiscardAdjacentEnemy;
                case "ignore_connection": return AbilityKind.IgnoreConnection;
                case "discard_random_from_opponent_rack": return AbilityKind.DiscardRandomFromOpponentRack;
                default: throw new FormatException("Unknown ability " + s);
            }
        }

        public static TerrainEffect ParseEffect(string s)
        {
            switch (s)
            {
                case "none": return TerrainEffect.None;
                case "recall_own_troop": return TerrainEffect.RecallOwnTroop;
                case "strength_restriction": return TerrainEffect.StrengthRestriction;
                case "draw_one": return TerrainEffect.DrawOne;
                case "move_adjacent_enemy": return TerrainEffect.MoveAdjacentEnemy;
                case "recover_from_discard": return TerrainEffect.RecoverFromDiscard;
                case "effect_shield": return TerrainEffect.EffectShield;
                case "designate_opponent_rack": return TerrainEffect.DesignateOpponentRack;
                case "railway": return TerrainEffect.Railway;
                case "bounce": return TerrainEffect.Bounce;
                default: throw new FormatException("Unknown terrain effect " + s);
            }
        }

        public TerrainDefinition LoadTerrain(string json)
        {
            var d = Json.ParseObject(json);
            var t = new TerrainDefinition
            {
                Id = d.Str("id"),
                Name = d.Str("name"),
                ReferenceTerrain = d.Str("referenceTerrain", ""),
                LayoutSource = d.Str("layoutSource", "original-design"),
                Flavor = d.Str("flavor", ""),
                SpecialEffect = ParseEffect(d.Str("specialEffect", "none")),
            };
            var goal = d.Obj("medalGoal") ?? throw new FormatException(t.Id + ": medalGoal missing");
            t.MedalGoal[0] = goal.Int("blue");
            t.MedalGoal[1] = goal.Int("red");
            foreach (var o in d.Arr("nodes"))
            {
                var nd = (Dictionary<string, object>)o;
                var type = nd.Str("type");
                var n = new NodeDefinition
                {
                    Id = nd.Str("id"),
                    Type = type == "hq" ? NodeType.Hq : type == "special" ? NodeType.Special : NodeType.Base,
                    X = nd.Num("x"),
                    Y = nd.Num("y"),
                    AllowJoker = nd.Bool("allowJoker"),
                };
                if (n.IsHq) n.Owner = SideExt.ParseSide(nd.Str("owner"));
                if (nd.ContainsKey("allowedStrengths")) n.AllowedStrengths = nd.IntList("allowedStrengths");
                t.Nodes.Add(n);
            }
            foreach (var o in d.Arr("edges"))
            {
                var l = (List<object>)o;
                t.Edges.Add(new[] { (string)l[0], (string)l[1] });
            }
            foreach (var o in d.Arr("regions"))
            {
                var rd = (Dictionary<string, object>)o;
                t.Regions.Add(new RegionDefinition { Id = rd.Str("id"), Bases = rd.StrList("bases"), Medals = rd.Int("medals") });
            }
            t.Build();
            if (!Terrains.ContainsKey(t.Id)) TerrainOrder.Add(t.Id);
            Terrains[t.Id] = t;
            return t;
        }
    }
}
