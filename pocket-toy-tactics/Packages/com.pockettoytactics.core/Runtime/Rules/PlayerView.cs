using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    /// <summary>
    /// What one player is allowed to know: the whole board (stacks can be inspected), the discard, medals,
    /// own rack, and only counts for hidden zones. This is what the host sends to the client device and
    /// the only input the AI receives, so neither can ever read hidden tiles.
    /// </summary>
    public sealed class PlayerView
    {
        public Side Viewer;
        public string TerrainId;
        public bool SpecialBasesEnabled;
        public int Turn;
        public Side Active;
        public Side FirstPlayer;
        public Phase Phase;
        public long Seq;
        public Dictionary<string, List<int>> Stacks = new Dictionary<string, List<int>>();
        public List<int> Discard = new List<int>();
        public Dictionary<string, Side> RegionClaims = new Dictionary<string, Side>();
        public int[] Medals = new int[2];
        public PendingDecision Pending;
        public List<PlacementRecord> Chain = new List<PlacementRecord>();
        public List<int> TroopEffectStack = new List<int>();
        public int BaseEffectCursor;
        public Side? Winner;
        public WinReason WinReason;
        public Side? EndedBy;

        // Own hidden zones.
        public List<int> MyRack = new List<int>();
        public List<int> MyLaidDown = new List<int>();
        public List<int> MyKnownInRack = new List<int>();
        public int MyReserveCount;
        public int MyRemovedCount;

        // Opponent hidden zones (counts and public knowledge only).
        public int OppRackCount;
        public List<int> OppLaidDownSlots = new List<int>();
        public List<int> OppKnownInRack = new List<int>();
        public int OppReserveCount;
        public int OppRemovedCount;

        public bool IsMyTurn => Phase != Phase.GameOver && Active == Viewer;

        public static PlayerView Create(GameState s, Side viewer)
        {
            var me = s.P(viewer);
            var op = s.P(viewer.Other());
            var v = new PlayerView
            {
                Viewer = viewer,
                TerrainId = s.TerrainId,
                SpecialBasesEnabled = s.SpecialBasesEnabled,
                Turn = s.Turn,
                Active = s.Active,
                FirstPlayer = s.FirstPlayer,
                Phase = s.Phase,
                Seq = s.Seq,
                Discard = new List<int>(s.Discard),
                RegionClaims = new Dictionary<string, Side>(s.RegionClaims),
                Medals = new[] { s.Players[0].Medals, s.Players[1].Medals },
                Pending = s.Pending?.Clone(),
                TroopEffectStack = new List<int>(s.TroopEffectStack),
                BaseEffectCursor = s.BaseEffectCursor,
                Winner = s.Winner,
                WinReason = s.WinReason,
                EndedBy = s.EndedBy,
                MyRack = new List<int>(me.Rack),
                MyLaidDown = new List<int>(me.LaidDown),
                MyKnownInRack = new List<int>(me.KnownInRack),
                MyReserveCount = me.Reserve.Count,
                MyRemovedCount = me.Removed.Count,
                OppRackCount = op.Rack.Count,
                OppKnownInRack = new List<int>(op.KnownInRack),
                OppReserveCount = op.Reserve.Count,
                OppRemovedCount = op.Removed.Count,
            };
            foreach (var kv in s.Stacks) v.Stacks[kv.Key] = new List<int>(kv.Value);
            foreach (var r in s.Chain) v.Chain.Add(r.Clone());
            for (int i = 0; i < op.Rack.Count; i++) if (op.LaidDown.Contains(op.Rack[i])) v.OppLaidDownSlots.Add(i);
            return v;
        }

        /// <summary>
        /// Builds a complete GameState consistent with everything this player knows, filling hidden zones
        /// with a random arrangement of the tiles the player has not seen (determinization). Used by the AI
        /// and by the client device to run rule queries (legal targets, explanations) locally.
        /// </summary>
        public GameState Determinize(ContentDatabase content, Rng rng)
        {
            var s = new GameState
            {
                TerrainId = TerrainId,
                SpecialBasesEnabled = SpecialBasesEnabled,
                Turn = Turn,
                Active = Active,
                FirstPlayer = FirstPlayer,
                Phase = Phase,
                Seq = Seq,
                Discard = new List<int>(Discard),
                RegionClaims = new Dictionary<string, Side>(RegionClaims),
                Pending = Pending?.Clone(),
                TroopEffectStack = new List<int>(TroopEffectStack),
                BaseEffectCursor = BaseEffectCursor,
                Winner = Winner,
                WinReason = WinReason,
                EndedBy = EndedBy,
                Rng = new Rng(rng.NextULong()),
            };
            foreach (var kv in Stacks) s.Stacks[kv.Key] = new List<int>(kv.Value);
            foreach (var r in Chain) s.Chain.Add(r.Clone());
            s.Players[0].Medals = Medals[0];
            s.Players[1].Medals = Medals[1];

            var visible = new HashSet<int>(Discard);
            foreach (var st in Stacks.Values) foreach (var t in st) visible.Add(t);

            // Own side: rack known, reserve/removed split unknown (own reserve order is hidden too).
            var me = s.P(Viewer);
            me.Rack.AddRange(MyRack);
            me.LaidDown.AddRange(MyLaidDown);
            me.KnownInRack.AddRange(MyKnownInRack);
            var mine = new List<int>();
            foreach (var t in content.TilesOf(Viewer)) if (!visible.Contains(t) && !MyRack.Contains(t)) mine.Add(t);
            rng.Shuffle(mine);
            Fill(me.Reserve, mine, MyReserveCount);
            Fill(me.Removed, mine, MyRemovedCount);

            // Opponent: publicly known rack tiles stay, the rest is sampled from unseen tiles.
            var op = s.P(Viewer.Other());
            var theirs = new List<int>();
            foreach (var t in content.TilesOf(Viewer.Other())) if (!visible.Contains(t) && !OppKnownInRack.Contains(t)) theirs.Add(t);
            rng.Shuffle(theirs);
            var rack = new List<int>(OppKnownInRack);
            Fill(rack, theirs, OppRackCount - OppKnownInRack.Count);
            rng.Shuffle(rack);
            op.Rack.AddRange(rack);
            op.KnownInRack.AddRange(OppKnownInRack);
            foreach (var slot in OppLaidDownSlots) if (slot < op.Rack.Count) op.LaidDown.Add(op.Rack[slot]);
            Fill(op.Reserve, theirs, OppReserveCount);
            Fill(op.Removed, theirs, OppRemovedCount);
            if (theirs.Count != 0 || mine.Count != 0)
                throw new InvalidOperationException("Inconsistent view: tile counts do not add up");
            return s;
        }

        private static void Fill(List<int> target, List<int> pool, int count)
        {
            if (count > pool.Count) throw new InvalidOperationException("Inconsistent view: not enough unseen tiles");
            for (int i = 0; i < count; i++) target.Add(pool[pool.Count - 1 - i]);
            pool.RemoveRange(pool.Count - count, count);
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["viewer"] = Viewer.Key(),
                ["terrain"] = TerrainId,
                ["specialBases"] = SpecialBasesEnabled,
                ["turn"] = Turn,
                ["active"] = Active.Key(),
                ["first"] = FirstPlayer.Key(),
                ["phase"] = Phase.ToString(),
                ["seq"] = Seq,
                ["stacks"] = StateSerializer.StacksToJson(Stacks),
                ["discard"] = StateSerializer.Ints(Discard),
                ["claims"] = StateSerializer.ClaimsToJson(RegionClaims),
                ["medals"] = StateSerializer.Ints(Medals),
                ["pending"] = StateSerializer.PendingToJson(Pending),
                ["chain"] = StateSerializer.ChainToJson(Chain),
                ["troopStack"] = StateSerializer.Ints(TroopEffectStack),
                ["baseCursor"] = BaseEffectCursor,
                ["winner"] = Winner?.Key(),
                ["winReason"] = WinReason.ToString(),
                ["endedBy"] = EndedBy?.Key(),
                ["myRack"] = StateSerializer.Ints(MyRack),
                ["myLaid"] = StateSerializer.Ints(MyLaidDown),
                ["myKnown"] = StateSerializer.Ints(MyKnownInRack),
                ["myReserve"] = MyReserveCount,
                ["myRemoved"] = MyRemovedCount,
                ["oppRack"] = OppRackCount,
                ["oppLaidSlots"] = StateSerializer.Ints(OppLaidDownSlots),
                ["oppKnown"] = StateSerializer.Ints(OppKnownInRack),
                ["oppReserve"] = OppReserveCount,
                ["oppRemoved"] = OppRemovedCount,
            };
        }

        public static PlayerView FromJson(Dictionary<string, object> d)
        {
            var medals = d.IntList("medals");
            var v = new PlayerView
            {
                Viewer = SideExt.ParseSide(d.Str("viewer")),
                TerrainId = d.Str("terrain"),
                SpecialBasesEnabled = d.Bool("specialBases", true),
                Turn = d.Int("turn"),
                Active = SideExt.ParseSide(d.Str("active")),
                FirstPlayer = SideExt.ParseSide(d.Str("first")),
                Phase = (Phase)Enum.Parse(typeof(Phase), d.Str("phase")),
                Seq = d.Long("seq"),
                Stacks = StateSerializer.StacksFromJson(d.Obj("stacks")),
                Discard = d.IntList("discard"),
                RegionClaims = StateSerializer.ClaimsFromJson(d.Obj("claims")),
                Medals = new[] { medals[0], medals[1] },
                Pending = StateSerializer.PendingFromJson(d.Obj("pending")),
                Chain = StateSerializer.ChainFromJson(d.Arr("chain")),
                TroopEffectStack = d.IntList("troopStack"),
                BaseEffectCursor = d.Int("baseCursor"),
                WinReason = (WinReason)Enum.Parse(typeof(WinReason), d.Str("winReason", "None")),
                MyRack = d.IntList("myRack"),
                MyLaidDown = d.IntList("myLaid"),
                MyKnownInRack = d.IntList("myKnown"),
                MyReserveCount = d.Int("myReserve"),
                MyRemovedCount = d.Int("myRemoved"),
                OppRackCount = d.Int("oppRack"),
                OppLaidDownSlots = d.IntList("oppLaidSlots"),
                OppKnownInRack = d.IntList("oppKnown"),
                OppReserveCount = d.Int("oppReserve"),
                OppRemovedCount = d.Int("oppRemoved"),
            };
            var w = d.Str("winner");
            if (w != null) v.Winner = SideExt.ParseSide(w);
            var e = d.Str("endedBy");
            if (e != null) v.EndedBy = SideExt.ParseSide(e);
            return v;
        }
    }
}
