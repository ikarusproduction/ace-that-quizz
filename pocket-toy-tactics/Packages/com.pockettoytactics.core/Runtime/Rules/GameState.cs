using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    public enum Phase { TurnAction, Decision, GameOver }

    public enum WinReason
    {
        None,
        /// <summary>A troop was placed on an enemy HQ.</summary>
        HqCaptured,
        /// <summary>The medal goal of the terrain for that side was reached.</summary>
        MedalGoal,
        /// <summary>A player could neither draw nor place; the player with more medals wins.</summary>
        NoActionMoreMedals,
        /// <summary>A player could neither draw nor place with equal medals; the player who ended the game loses.</summary>
        NoActionTieBreak,
    }

    public enum DecisionKind
    {
        None,
        /// <summary>Cap'taine: place one extra troop (Place command) or Skip.</summary>
        ExtraPlacement,
        /// <summary>Skully / Star: accept (Choose) or Skip drawing Amount troops.</summary>
        TroopDraw,
        /// <summary>Mastok: choose an adjacent node whose visible troop is an enemy, or Skip.</summary>
        DiscardAdjacentTarget,
        /// <summary>XB-42: accept (Choose) or Skip discarding a random opponent rack troop.</summary>
        DiscardRandomConfirm,
        /// <summary>Plaine des châteaux: choose a node whose visible troop is yours (not the placed one), or Skip.</summary>
        RecallOwnTroop,
        /// <summary>Cité des nuages: accept (Choose) or Skip drawing 1 troop.</summary>
        TerrainDraw,
        /// <summary>Jungle volcanique, step 1: choose an enemy-occupied node adjacent to the special base, or Skip.</summary>
        MoveEnemySource,
        /// <summary>Jungle volcanique, step 2: choose a base adjacent to the source node (mandatory).</summary>
        MoveEnemyDestination,
        /// <summary>Cimetière maudit: choose one of your tiles in the discard (TileId), or Skip.</summary>
        RecoverFromDiscard,
        /// <summary>Champ de bataille: designate an opponent rack slot (Index). Mandatory.</summary>
        DesignateOpponentRack,
    }

    public sealed class PendingDecision
    {
        public DecisionKind Kind;
        public Side Player;
        /// <summary>Tile whose effect opened the decision (troop effects), or the tile placed on the special base.</summary>
        public int SourceTile = -1;
        /// <summary>Node where the source tile was placed.</summary>
        public string SourceNode;
        /// <summary>Number of troops for draw decisions.</summary>
        public int Amount;
        /// <summary>Second-step data (Jungle: chosen source node).</summary>
        public string SelectedNode;
        public bool Optional = true;

        public PendingDecision Clone() => (PendingDecision)MemberwiseClone();
    }

    public sealed class PlacementRecord
    {
        public int TileId;
        public string NodeId;
        public PlacementRecord Clone() => (PlacementRecord)MemberwiseClone();
    }

    public sealed class PlayerState
    {
        /// <summary>Hidden draw pile, index 0 is the next tile drawn.</summary>
        public List<int> Reserve = new List<int>();
        /// <summary>Tiles on the player's rack (support), in slot order.</summary>
        public List<int> Rack = new List<int>();
        /// <summary>Tiles removed face down at setup; unused this game.</summary>
        public List<int> Removed = new List<int>();
        /// <summary>Rack tiles laid down by the Champ de bataille effect (cannot be placed this turn).</summary>
        public List<int> LaidDown = new List<int>();
        /// <summary>Rack tiles whose identity the opponent knows (returned from board or discard).</summary>
        public List<int> KnownInRack = new List<int>();
        public int Medals;

        public PlayerState Clone() => new PlayerState
        {
            Reserve = new List<int>(Reserve),
            Rack = new List<int>(Rack),
            Removed = new List<int>(Removed),
            LaidDown = new List<int>(LaidDown),
            KnownInRack = new List<int>(KnownInRack),
            Medals = Medals,
        };
    }

    public sealed class GameOptions
    {
        /// <summary>When false, special bases behave as plain bases (beginner variant of the rulebook).
        /// HQ restrictions still apply: an HQ is not a base.</summary>
        public bool SpecialBasesEnabled = true;
        /// <summary>Null = random first player (drawn with the game seed).</summary>
        public Side? FirstPlayer;

        public GameOptions Clone() => (GameOptions)MemberwiseClone();
    }

    /// <summary>
    /// Complete, authoritative game state. Contains hidden information (reserves, racks): never send it
    /// as-is to the other device, use <see cref="PlayerView"/>.
    /// </summary>
    public sealed class GameState
    {
        public string TerrainId;
        public bool SpecialBasesEnabled = true;
        public ulong Seed;
        public int Turn;
        public Side Active;
        public Side FirstPlayer;
        public Phase Phase;
        /// <summary>Number of commands applied so far (network sequence number).</summary>
        public long Seq;

        public PlayerState[] Players = { new PlayerState(), new PlayerState() };
        /// <summary>Tiles on each node, bottom to top. Only the last one is visible and occupies the base.</summary>
        public Dictionary<string, List<int>> Stacks = new Dictionary<string, List<int>>();
        /// <summary>Shared face-up discard, oldest first.</summary>
        public List<int> Discard = new List<int>();
        /// <summary>Region id -> side that took its medals (absent = medals still there).</summary>
        public Dictionary<string, Side> RegionClaims = new Dictionary<string, Side>();

        public PendingDecision Pending;
        /// <summary>Troops placed during the current turn, in order (used for effect resolution).</summary>
        public List<PlacementRecord> Chain = new List<PlacementRecord>();
        /// <summary>Indices into Chain whose troop effect is still to resolve (last = next).</summary>
        public List<int> TroopEffectStack = new List<int>();
        /// <summary>Next Chain index whose special-base effect is to resolve.</summary>
        public int BaseEffectCursor;

        public Side? Winner;
        public WinReason WinReason;
        /// <summary>Player who could not act (end condition 3).</summary>
        public Side? EndedBy;

        public Rng Rng = new Rng(1);
        public List<Command> History = new List<Command>();

        public PlayerState P(Side s) => Players[(int)s];

        public int TopTile(string nodeId)
        {
            return Stacks.TryGetValue(nodeId, out var st) && st.Count > 0 ? st[st.Count - 1] : -1;
        }

        public GameState Clone(bool withHistory = true)
        {
            var c = new GameState
            {
                TerrainId = TerrainId,
                SpecialBasesEnabled = SpecialBasesEnabled,
                Seed = Seed,
                Turn = Turn,
                Active = Active,
                FirstPlayer = FirstPlayer,
                Phase = Phase,
                Seq = Seq,
                Players = new[] { Players[0].Clone(), Players[1].Clone() },
                Discard = new List<int>(Discard),
                RegionClaims = new Dictionary<string, Side>(RegionClaims),
                Pending = Pending?.Clone(),
                TroopEffectStack = new List<int>(TroopEffectStack),
                BaseEffectCursor = BaseEffectCursor,
                Winner = Winner,
                WinReason = WinReason,
                EndedBy = EndedBy,
                Rng = Rng.Clone(),
                History = withHistory ? new List<Command>(History) : new List<Command>(),
            };
            foreach (var kv in Stacks) c.Stacks[kv.Key] = new List<int>(kv.Value);
            foreach (var r in Chain) c.Chain.Add(r.Clone());
            return c;
        }
    }
}
