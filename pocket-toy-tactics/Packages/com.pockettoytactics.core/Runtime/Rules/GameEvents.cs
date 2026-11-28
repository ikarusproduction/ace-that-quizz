using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    public enum GameEventType
    {
        GameStarted,
        TurnStarted,
        TilesDrawn,
        TroopPlaced,
        AbilityActivated,
        /// <summary>A troop effect was not applied because the troop stands on an effect-shield special base.</summary>
        AbilityBlocked,
        BaseEffectActivated,
        DecisionOpened,
        EffectSkipped,
        TroopDiscarded,
        TroopReturnedToRack,
        TroopMoved,
        TroopRecovered,
        TroopLaidDown,
        TroopStoodUp,
        RegionCaptured,
        HqCaptured,
        GameOver,
    }

    /// <summary>
    /// Something that happened, emitted by the rules engine for animations, sound, history and logs.
    /// The presentation layer never infers game logic: it only plays these events.
    /// </summary>
    public sealed class GameEvent
    {
        public GameEventType Type;
        public Side Player;
        public int TileId = -1;
        /// <summary>Troop definition id of TileId, null when hidden from the viewer.</summary>
        public string TroopId;
        public string NodeId;
        public string ToNodeId;
        public string RegionId;
        public int Amount;
        public int CoveredTileId = -1;
        /// <summary>Drawn tile ids (TilesDrawn); empty when hidden from the viewer.</summary>
        public List<int> Tiles = new List<int>();
        public DecisionKind Decision;
        public WinReason WinReason;

        public GameEvent Clone()
        {
            var c = (GameEvent)MemberwiseClone();
            c.Tiles = new List<int>(Tiles);
            return c;
        }

        /// <summary>Copy of the event as seen by <paramref name="viewer"/> (hidden tiles removed).</summary>
        public GameEvent RedactFor(Side viewer)
        {
            var c = Clone();
            if (Type == GameEventType.TroopLaidDown)
            {
                // Player is the designator, who picks a slot without looking: only the owner sees the tile.
                if (viewer == Player) { c.TileId = -1; c.TroopId = null; }
                return c;
            }
            if (viewer == Player) return c;
            switch (Type)
            {
                case GameEventType.TilesDrawn:
                    c.Tiles.Clear();
                    break;
                case GameEventType.TroopStoodUp:
                    c.TileId = -1; c.TroopId = null;
                    break;
            }
            return c;
        }

        public Dictionary<string, object> ToJson()
        {
            var d = new Dictionary<string, object> { ["type"] = Type.ToString(), ["p"] = Player.Key() };
            if (TileId >= 0) d["tile"] = TileId;
            if (TroopId != null) d["troop"] = TroopId;
            if (NodeId != null) d["node"] = NodeId;
            if (ToNodeId != null) d["to"] = ToNodeId;
            if (RegionId != null) d["region"] = RegionId;
            if (Amount != 0) d["n"] = Amount;
            if (CoveredTileId >= 0) d["covered"] = CoveredTileId;
            if (Tiles.Count > 0) d["tiles"] = new List<object>(Tiles.ConvertAll(x => (object)x));
            if (Decision != DecisionKind.None) d["decision"] = Decision.ToString();
            if (WinReason != WinReason.None) d["win"] = WinReason.ToString();
            return d;
        }

        public static GameEvent FromJson(Dictionary<string, object> d)
        {
            var e = new GameEvent
            {
                Type = (GameEventType)System.Enum.Parse(typeof(GameEventType), d.Str("type")),
                Player = SideExt.ParseSide(d.Str("p")),
                TileId = d.Int("tile", -1),
                TroopId = d.Str("troop"),
                NodeId = d.Str("node"),
                ToNodeId = d.Str("to"),
                RegionId = d.Str("region"),
                Amount = d.Int("n"),
                CoveredTileId = d.Int("covered", -1),
                Tiles = d.IntList("tiles"),
            };
            var dec = d.Str("decision");
            if (dec != null) e.Decision = (DecisionKind)System.Enum.Parse(typeof(DecisionKind), dec);
            var win = d.Str("win");
            if (win != null) e.WinReason = (WinReason)System.Enum.Parse(typeof(WinReason), win);
            return e;
        }

        public override string ToString()
        {
            return Type + " " + Player + (TroopId != null ? " " + TroopId : "") + (TileId >= 0 ? " #" + TileId : "") +
                   (NodeId != null ? " @" + NodeId : "") + (ToNodeId != null ? "->" + ToNodeId : "") +
                   (RegionId != null ? " region " + RegionId : "") + (Amount != 0 ? " x" + Amount : "") +
                   (Decision != DecisionKind.None ? " " + Decision : "") + (WinReason != WinReason.None ? " " + WinReason : "");
        }
    }
}
