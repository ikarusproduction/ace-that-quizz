using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    public sealed class ApplyResult
    {
        public RuleError Error;
        public readonly List<GameEvent> Events = new List<GameEvent>();
        public bool Ok => Error == RuleError.None;
    }

    /// <summary>
    /// The rules of the game. Stateless apart from the content database: every method takes a GameState.
    /// Commands are validated completely before any mutation, so a rejected command never alters the state.
    /// See docs/01-analyse-regles.md for the rule sources and every interpretation made here.
    /// </summary>
    public sealed class RulesEngine
    {
        public readonly ContentDatabase Content;

        public RulesEngine(ContentDatabase content) { Content = content; }

        // =====================================================================================
        // Setup
        // =====================================================================================

        public GameState NewGame(string terrainId, ulong seed, GameOptions options = null, List<GameEvent> events = null)
        {
            options = options ?? new GameOptions();
            var terrain = Content.Terrain(terrainId);
            var s = new GameState
            {
                TerrainId = terrainId,
                SpecialBasesEnabled = options.SpecialBasesEnabled,
                Seed = seed,
                Rng = new Rng(seed),
                Turn = 1,
                Phase = Phase.TurnAction,
            };
            foreach (var n in terrain.Nodes) s.Stacks[n.Id] = new List<int>();
            foreach (Side side in new[] { Side.Blue, Side.Red })
            {
                var p = s.P(side);
                p.Reserve.AddRange(Content.TilesOf(side));
                s.Rng.Shuffle(p.Reserve);
                for (int i = 0; i < ContentDatabase.RemovedPerPlayer; i++) { p.Removed.Add(p.Reserve[0]); p.Reserve.RemoveAt(0); }
            }
            s.FirstPlayer = options.FirstPlayer ?? (s.Rng.Next(2) == 0 ? Side.Blue : Side.Red);
            s.Active = s.FirstPlayer;
            DrawInto(s, s.FirstPlayer, ContentDatabase.FirstPlayerStartingRack, null);
            DrawInto(s, s.FirstPlayer.Other(), ContentDatabase.SecondPlayerStartingRack, null);
            events?.Add(new GameEvent { Type = GameEventType.GameStarted, Player = s.FirstPlayer });
            events?.Add(new GameEvent { Type = GameEventType.TurnStarted, Player = s.Active, Amount = s.Turn });
            return s;
        }

        /// <summary>Rebuilds a game from its seed and command history (deterministic replay).</summary>
        public GameState Replay(string terrainId, ulong seed, GameOptions options, IEnumerable<Command> commands)
        {
            var s = NewGame(terrainId, seed, options);
            foreach (var c in commands)
            {
                var r = Apply(s, c);
                if (!r.Ok) throw new InvalidOperationException("Replay diverged at " + c + ": " + r.Error);
            }
            return s;
        }

        // =====================================================================================
        // Queries
        // =====================================================================================

        public TerrainDefinition Terrain(GameState s) => Content.Terrain(s.TerrainId);

        /// <summary>
        /// Nodes linked to <paramref name="nodeId"/> by one path segment. On a railway terrain (special bases
        /// enabled) every station is also linked to every other station.
        /// </summary>
        public IReadOnlyList<string> Adjacent(GameState s, string nodeId)
        {
            var terrain = Terrain(s);
            var direct = terrain.Neighbors(nodeId);
            if (!s.SpecialBasesEnabled || terrain.SpecialEffect != TerrainEffect.Railway) return direct;
            var node = terrain.Node(nodeId);
            if (node == null || !node.IsSpecial) return direct;
            var all = new List<string>(direct);
            foreach (var o in terrain.Nodes)
                if (o.IsSpecial && o.Id != nodeId && !all.Contains(o.Id)) all.Add(o.Id);
            return all;
        }

        public Side? TopOwner(GameState s, string nodeId)
        {
            int t = s.TopTile(nodeId);
            return t < 0 ? (Side?)null : Content.TileOwner(t);
        }

        public bool CanDraw(GameState s, Side side)
        {
            var p = s.P(side);
            return p.Rack.Count < ContentDatabase.RackCapacity && p.Reserve.Count > 0;
        }

        /// <summary>Bases occupied by <paramref name="side"/> that are linked to one of its HQs through bases it occupies.</summary>
        public HashSet<string> ConnectedBases(GameState s, Side side)
        {
            var terrain = Terrain(s);
            var seen = new HashSet<string>();
            var stack = new Stack<string>();
            foreach (var hq in terrain.Hqs(side)) stack.Push(hq);
            while (stack.Count > 0)
            {
                var v = stack.Pop();
                foreach (var w in Adjacent(s, v))
                {
                    var n = terrain.Node(w);
                    if (!n.IsBase || seen.Contains(w)) continue;
                    if (TopOwner(s, w) != side) continue;
                    seen.Add(w);
                    stack.Push(w);
                }
            }
            return seen;
        }

        /// <summary>True when a troop of <paramref name="side"/> placed on nodeId would be connected to its HQ.</summary>
        public bool IsConnectedTarget(GameState s, Side side, string nodeId, HashSet<string> connected = null)
        {
            var terrain = Terrain(s);
            connected = connected ?? ConnectedBases(s, side);
            foreach (var w in Adjacent(s, nodeId))
            {
                var n = terrain.Node(w);
                if (n.IsHq && n.Owner == side) return true;
                if (connected.Contains(w)) return true;
            }
            return false;
        }

        private bool IsShieldedSpecial(GameState s, NodeDefinition n)
            => s.SpecialBasesEnabled && n.IsSpecial && Terrain(s).SpecialEffect == TerrainEffect.EffectShield;

        private static bool StrengthAllowed(TroopDefinition troop, NodeDefinition n)
        {
            if (n.AllowedStrengths == null) return true;
            return troop.IsJoker ? n.AllowJoker : n.AllowedStrengths.Contains(troop.Strength);
        }

        /// <summary>Full placement check of a rack tile, with the reason when illegal (shown to the player).</summary>
        public RuleError CheckPlacement(GameState s, Side side, int tileId, string nodeId, HashSet<string> connected = null)
        {
            var p = s.P(side);
            if (!p.Rack.Contains(tileId)) return RuleError.TileNotInRack;
            if (p.LaidDown.Contains(tileId)) return RuleError.TileLaidDown;
            var terrain = Terrain(s);
            var node = terrain.Node(nodeId);
            if (node == null) return RuleError.UnknownNode;
            var troop = Content.TileTroop(tileId);

            if (node.IsHq)
            {
                if (node.Owner == side) return RuleError.OwnHq;
                // HQ restrictions (tropical pool) are HQ rules, not special-base effects: always active.
                if (!StrengthAllowed(troop, node)) return RuleError.StrengthNotAllowed;
                // Crochet's exception covers bases only: an enemy HQ must always be connected.
                return IsConnectedTarget(s, side, nodeId, connected) ? RuleError.None : RuleError.NotConnected;
            }

            if (node.IsSpecial && s.SpecialBasesEnabled && Terrain(s).SpecialEffect == TerrainEffect.StrengthRestriction
                && !StrengthAllowed(troop, node))
                return RuleError.StrengthNotAllowed;

            int top = s.TopTile(nodeId);
            if (top >= 0 && Content.TileOwner(top) != side)
            {
                var other = Content.TileTroop(top);
                bool canCover = troop.IsJoker || other.IsJoker || troop.Strength > other.Strength;
                if (!canCover) return RuleError.TooWeak;
            }

            bool ignoresConnection = troop.Ability == AbilityKind.IgnoreConnection && !IsShieldedSpecial(s, node);
            if (!ignoresConnection && !IsConnectedTarget(s, side, nodeId, connected)) return RuleError.NotConnected;
            return RuleError.None;
        }

        /// <summary>Nodes where the given tile can legally be placed now.</summary>
        public List<string> LegalTargets(GameState s, Side side, int tileId)
        {
            var result = new List<string>();
            var connected = ConnectedBases(s, side);
            foreach (var n in Terrain(s).Nodes)
                if (CheckPlacement(s, side, tileId, n.Id, connected) == RuleError.None) result.Add(n.Id);
            return result;
        }

        public bool AnyLegalPlacement(GameState s, Side side)
        {
            var connected = ConnectedBases(s, side);
            var terrain = Terrain(s);
            var p = s.P(side);
            var tried = new HashSet<string>();
            foreach (var tile in p.Rack)
            {
                if (p.LaidDown.Contains(tile)) continue;
                if (!tried.Add(Content.TileTroop(tile).Id)) continue;
                foreach (var n in terrain.Nodes)
                    if (CheckPlacement(s, side, tile, n.Id, connected) == RuleError.None) return true;
            }
            return false;
        }

        public bool HasAnyAction(GameState s, Side side) => CanDraw(s, side) || AnyLegalPlacement(s, side);

        // ---------------------------------------------------------------- effect targets

        public List<string> DiscardAdjacentTargets(GameState s, Side side, string fromNode)
        {
            var terrain = Terrain(s);
            var r = new List<string>();
            foreach (var w in Adjacent(s, fromNode))
            {
                var n = terrain.Node(w);
                if (!n.IsBase || IsShieldedSpecial(s, n)) continue;
                if (TopOwner(s, w) == side.Other()) r.Add(w);
            }
            return r;
        }

        public List<string> RecallTargets(GameState s, Side side, int placedTile)
        {
            var r = new List<string>();
            if (s.P(side).Rack.Count >= ContentDatabase.RackCapacity) return r;
            foreach (var n in Terrain(s).Nodes)
            {
                if (!n.IsBase) continue;
                int top = s.TopTile(n.Id);
                if (top >= 0 && top != placedTile && Content.TileOwner(top) == side) r.Add(n.Id);
            }
            return r;
        }

        public List<string> MoveSources(GameState s, Side side, string specialNode)
        {
            var terrain = Terrain(s);
            var r = new List<string>();
            foreach (var w in Adjacent(s, specialNode))
            {
                var n = terrain.Node(w);
                if (n.IsBase && TopOwner(s, w) == side.Other() && MoveDestinations(s, w).Count > 0) r.Add(w);
            }
            return r;
        }

        public List<string> MoveDestinations(GameState s, string sourceNode)
        {
            var terrain = Terrain(s);
            var r = new List<string>();
            foreach (var w in Adjacent(s, sourceNode))
                if (terrain.Node(w).IsBase) r.Add(w);
            return r;
        }

        /// <summary>Kermesse Rebondie: empty bases next to the special base, if the placed troop is still on top.</summary>
        public List<string> BounceTargets(GameState s, int placedTile, string specialNode)
        {
            var r = new List<string>();
            if (s.TopTile(specialNode) != placedTile) return r;
            foreach (var w in Adjacent(s, specialNode))
                if (Terrain(s).Node(w).IsBase && s.Stacks[w].Count == 0) r.Add(w);
            return r;
        }

        public List<int> RecoverableTiles(GameState s, Side side)
        {
            var r = new List<int>();
            if (s.P(side).Rack.Count >= ContentDatabase.RackCapacity) return r;
            foreach (var t in s.Discard)
                if (Content.TileOwner(t) == side) r.Add(t);
            return r;
        }

        public List<int> DesignatableSlots(GameState s, Side side)
        {
            var opp = s.P(side.Other());
            var r = new List<int>();
            for (int i = 0; i < opp.Rack.Count; i++)
                if (!opp.LaidDown.Contains(opp.Rack[i])) r.Add(i);
            return r;
        }

        private int DrawableCount(GameState s, Side side, int wanted)
        {
            var p = s.P(side);
            return Math.Max(0, Math.Min(wanted, Math.Min(ContentDatabase.RackCapacity - p.Rack.Count, p.Reserve.Count)));
        }

        // =====================================================================================
        // Legal command enumeration (UI hints, AI, tests)
        // =====================================================================================

        /// <param name="distinctTroops">When true, only one tile per troop type is offered for placements
        /// (tiles of the same type are interchangeable for the rules).</param>
        public List<Command> LegalCommands(GameState s, bool distinctTroops = false)
        {
            var r = new List<Command>();
            if (s.Phase == Phase.GameOver) return r;
            var side = s.Active;
            if (s.Phase == Phase.TurnAction)
            {
                if (CanDraw(s, side)) r.Add(Command.Draw(side));
                AddPlacements(s, side, r, distinctTroops);
                return r;
            }
            var d = s.Pending;
            switch (d.Kind)
            {
                case DecisionKind.ExtraPlacement:
                    AddPlacements(s, side, r, distinctTroops);
                    break;
                case DecisionKind.TroopDraw:
                case DecisionKind.DiscardRandomConfirm:
                case DecisionKind.TerrainDraw:
                    r.Add(Command.Accept(side));
                    break;
                case DecisionKind.DiscardAdjacentTarget:
                    foreach (var n in DiscardAdjacentTargets(s, side, d.SourceNode)) r.Add(Command.ChooseNode(side, n));
                    break;
                case DecisionKind.RecallOwnTroop:
                    foreach (var n in RecallTargets(s, side, d.SourceTile)) r.Add(Command.ChooseNode(side, n));
                    break;
                case DecisionKind.MoveEnemySource:
                    foreach (var n in MoveSources(s, side, d.SourceNode)) r.Add(Command.ChooseNode(side, n));
                    break;
                case DecisionKind.MoveEnemyDestination:
                    foreach (var n in MoveDestinations(s, d.SelectedNode)) r.Add(Command.ChooseNode(side, n));
                    break;
                case DecisionKind.RecoverFromDiscard:
                    foreach (var t in RecoverableTiles(s, side)) r.Add(Command.ChooseTile(side, t));
                    break;
                case DecisionKind.DesignateOpponentRack:
                    foreach (var i in DesignatableSlots(s, side)) r.Add(Command.ChooseIndex(side, i));
                    break;
                case DecisionKind.Bounce:
                    foreach (var n in BounceTargets(s, d.SourceTile, d.SourceNode)) r.Add(Command.ChooseNode(side, n));
                    break;
            }
            if (d.Optional) r.Add(Command.Skip(side));
            return r;
        }

        private void AddPlacements(GameState s, Side side, List<Command> r, bool distinct)
        {
            var connected = ConnectedBases(s, side);
            var seen = new HashSet<string>();
            var p = s.P(side);
            foreach (var tile in p.Rack)
            {
                if (distinct && !seen.Add(Content.TileTroop(tile).Id)) continue;
                foreach (var n in Terrain(s).Nodes)
                    if (CheckPlacement(s, side, tile, n.Id, connected) == RuleError.None) r.Add(Command.Place(side, tile, n.Id));
            }
        }

        // =====================================================================================
        // Validation and application
        // =====================================================================================

        public RuleError Validate(GameState s, Command c)
        {
            if (c == null) return RuleError.InvalidCommand;
            if (s.Phase == Phase.GameOver) return RuleError.GameOver;
            if (c.Player != s.Active) return RuleError.NotYourTurn;

            if (s.Phase == Phase.TurnAction)
            {
                switch (c.Type)
                {
                    case CommandType.Draw:
                        if (s.P(c.Player).Rack.Count >= ContentDatabase.RackCapacity) return RuleError.RackFull;
                        if (s.P(c.Player).Reserve.Count == 0) return RuleError.ReserveEmpty;
                        return RuleError.None;
                    case CommandType.Place:
                        return CheckPlacement(s, c.Player, c.TileId, c.NodeId);
                    default:
                        return RuleError.WrongPhase;
                }
            }

            var d = s.Pending;
            if (c.Type == CommandType.Skip) return d.Optional ? RuleError.None : RuleError.NotOptional;
            if (d.Kind == DecisionKind.ExtraPlacement)
                return c.Type == CommandType.Place ? CheckPlacement(s, c.Player, c.TileId, c.NodeId) : RuleError.WrongPhase;
            if (c.Type != CommandType.Choose) return RuleError.WrongPhase;
            switch (d.Kind)
            {
                case DecisionKind.TroopDraw:
                case DecisionKind.DiscardRandomConfirm:
                case DecisionKind.TerrainDraw:
                    return RuleError.None;
                case DecisionKind.DiscardAdjacentTarget:
                    return DiscardAdjacentTargets(s, c.Player, d.SourceNode).Contains(c.NodeId) ? RuleError.None : RuleError.InvalidTarget;
                case DecisionKind.RecallOwnTroop:
                    return RecallTargets(s, c.Player, d.SourceTile).Contains(c.NodeId) ? RuleError.None : RuleError.InvalidTarget;
                case DecisionKind.MoveEnemySource:
                    return MoveSources(s, c.Player, d.SourceNode).Contains(c.NodeId) ? RuleError.None : RuleError.InvalidTarget;
                case DecisionKind.MoveEnemyDestination:
                    return MoveDestinations(s, d.SelectedNode).Contains(c.NodeId) ? RuleError.None : RuleError.InvalidTarget;
                case DecisionKind.RecoverFromDiscard:
                    return RecoverableTiles(s, c.Player).Contains(c.TileId) ? RuleError.None : RuleError.InvalidTarget;
                case DecisionKind.DesignateOpponentRack:
                    return DesignatableSlots(s, c.Player).Contains(c.Index) ? RuleError.None : RuleError.InvalidTarget;
                case DecisionKind.Bounce:
                    return BounceTargets(s, d.SourceTile, d.SourceNode).Contains(c.NodeId) ? RuleError.None : RuleError.InvalidTarget;
                default:
                    return RuleError.WrongPhase;
            }
        }

        /// <summary>Validates then applies a command. On error the state is untouched.</summary>
        public ApplyResult Apply(GameState s, Command c)
        {
            var result = new ApplyResult { Error = Validate(s, c) };
            if (!result.Ok) return result;
            var ev = result.Events;
            s.History.Add(c.Clone());
            s.Seq++;

            if (s.Phase == Phase.TurnAction)
            {
                s.Chain.Clear();
                s.TroopEffectStack.Clear();
                s.BaseEffectCursor = 0;
                if (c.Type == CommandType.Draw)
                {
                    DrawInto(s, c.Player, ContentDatabase.DrawActionCount, ev);
                    EndTurn(s, ev);
                    return result;
                }
                s.Phase = Phase.Decision; // resolving
                ExecutePlace(s, c.Player, c.TileId, c.NodeId, ev);
                Continue(s, ev);
                return result;
            }

            var d = s.Pending;
            s.Pending = null;
            if (c.Type == CommandType.Skip)
            {
                ev.Add(new GameEvent { Type = GameEventType.EffectSkipped, Player = c.Player, Decision = d.Kind, TileId = d.SourceTile, NodeId = d.SourceNode });
                Continue(s, ev);
                return result;
            }

            var side = c.Player;
            var opp = side.Other();
            switch (d.Kind)
            {
                case DecisionKind.ExtraPlacement:
                    ExecutePlace(s, side, c.TileId, c.NodeId, ev);
                    break;
                case DecisionKind.TroopDraw:
                case DecisionKind.TerrainDraw:
                    DrawInto(s, side, d.Amount, ev);
                    break;
                case DecisionKind.DiscardAdjacentTarget:
                {
                    int t = PopTop(s, c.NodeId);
                    s.Discard.Add(t);
                    ev.Add(new GameEvent { Type = GameEventType.TroopDiscarded, Player = side, TileId = t, TroopId = Content.TileTroop(t).Id, NodeId = c.NodeId });
                    CheckRegions(s, ev);
                    break;
                }
                case DecisionKind.DiscardRandomConfirm:
                {
                    var op = s.P(opp);
                    if (op.Rack.Count > 0)
                    {
                        int idx = s.Rng.Next(op.Rack.Count);
                        int t = op.Rack[idx];
                        RemoveFromRack(op, t);
                        s.Discard.Add(t);
                        ev.Add(new GameEvent { Type = GameEventType.TroopDiscarded, Player = side, TileId = t, TroopId = Content.TileTroop(t).Id, Amount = idx });
                    }
                    break;
                }
                case DecisionKind.RecallOwnTroop:
                {
                    int t = PopTop(s, c.NodeId);
                    var me = s.P(side);
                    me.Rack.Add(t);
                    me.KnownInRack.Add(t);
                    ev.Add(new GameEvent { Type = GameEventType.TroopReturnedToRack, Player = side, TileId = t, TroopId = Content.TileTroop(t).Id, NodeId = c.NodeId });
                    CheckRegions(s, ev);
                    break;
                }
                case DecisionKind.MoveEnemySource:
                    s.Pending = new PendingDecision
                    {
                        Kind = DecisionKind.MoveEnemyDestination, Player = side, SourceTile = d.SourceTile,
                        SourceNode = d.SourceNode, SelectedNode = c.NodeId, Optional = false,
                    };
                    ev.Add(new GameEvent { Type = GameEventType.DecisionOpened, Player = side, Decision = s.Pending.Kind, NodeId = c.NodeId });
                    return result; // wait for the destination
                case DecisionKind.MoveEnemyDestination:
                {
                    int t = PopTop(s, d.SelectedNode);
                    s.Stacks[c.NodeId].Add(t);
                    ev.Add(new GameEvent { Type = GameEventType.TroopMoved, Player = side, TileId = t, TroopId = Content.TileTroop(t).Id, NodeId = d.SelectedNode, ToNodeId = c.NodeId });
                    CheckRegions(s, ev);
                    break;
                }
                case DecisionKind.Bounce:
                {
                    int t = PopTop(s, d.SourceNode);
                    s.Stacks[c.NodeId].Add(t);
                    ev.Add(new GameEvent { Type = GameEventType.TroopMoved, Player = side, TileId = t, TroopId = Content.TileTroop(t).Id, NodeId = d.SourceNode, ToNodeId = c.NodeId });
                    CheckRegions(s, ev);
                    break;
                }
                case DecisionKind.RecoverFromDiscard:
                {
                    s.Discard.Remove(c.TileId);
                    var me = s.P(side);
                    me.Rack.Add(c.TileId);
                    me.KnownInRack.Add(c.TileId);
                    ev.Add(new GameEvent { Type = GameEventType.TroopRecovered, Player = side, TileId = c.TileId, TroopId = Content.TileTroop(c.TileId).Id });
                    break;
                }
                case DecisionKind.DesignateOpponentRack:
                {
                    var op = s.P(opp);
                    int t = op.Rack[c.Index];
                    op.LaidDown.Add(t);
                    ev.Add(new GameEvent { Type = GameEventType.TroopLaidDown, Player = side, TileId = t, TroopId = Content.TileTroop(t).Id, Amount = c.Index });
                    break;
                }
            }
            Continue(s, ev);
            return result;
        }

        // =====================================================================================
        // Internals
        // =====================================================================================

        private void DrawInto(GameState s, Side side, int wanted, List<GameEvent> ev)
        {
            int n = DrawableCount(s, side, wanted);
            var p = s.P(side);
            var e = new GameEvent { Type = GameEventType.TilesDrawn, Player = side, Amount = n };
            for (int i = 0; i < n; i++)
            {
                int t = p.Reserve[0];
                p.Reserve.RemoveAt(0);
                p.Rack.Add(t);
                e.Tiles.Add(t);
            }
            ev?.Add(e);
        }

        private static void RemoveFromRack(PlayerState p, int tile)
        {
            p.Rack.Remove(tile);
            p.LaidDown.Remove(tile);
            p.KnownInRack.Remove(tile);
        }

        private static int PopTop(GameState s, string node)
        {
            var st = s.Stacks[node];
            int t = st[st.Count - 1];
            st.RemoveAt(st.Count - 1);
            return t;
        }

        private void ExecutePlace(GameState s, Side side, int tile, string nodeId, List<GameEvent> ev)
        {
            RemoveFromRack(s.P(side), tile);
            int covered = s.TopTile(nodeId);
            s.Stacks[nodeId].Add(tile);
            ev.Add(new GameEvent
            {
                Type = GameEventType.TroopPlaced, Player = side, TileId = tile, TroopId = Content.TileTroop(tile).Id,
                NodeId = nodeId, CoveredTileId = covered,
            });
            var node = Terrain(s).Node(nodeId);
            if (node.IsHq)
            {
                ev.Add(new GameEvent { Type = GameEventType.HqCaptured, Player = side, TileId = tile, NodeId = nodeId });
                EndGame(s, side, WinReason.HqCaptured, ev);
                return;
            }
            CheckRegions(s, ev);
            if (s.Phase == Phase.GameOver) return;
            s.Chain.Add(new PlacementRecord { TileId = tile, NodeId = nodeId });
            s.TroopEffectStack.Add(s.Chain.Count - 1);
        }

        /// <summary>"À tout moment": regions are checked after every change of the board, for both players.</summary>
        private void CheckRegions(GameState s, List<GameEvent> ev)
        {
            var terrain = Terrain(s);
            foreach (var r in terrain.Regions)
            {
                if (r.Medals <= 0 || s.RegionClaims.ContainsKey(r.Id)) continue;
                Side? owner = TopOwner(s, r.Bases[0]);
                if (owner == null) continue;
                bool all = true;
                for (int i = 1; i < r.Bases.Count && all; i++) all = TopOwner(s, r.Bases[i]) == owner;
                if (!all) continue;
                var side = owner.Value;
                s.RegionClaims[r.Id] = side;
                s.P(side).Medals += r.Medals;
                ev.Add(new GameEvent { Type = GameEventType.RegionCaptured, Player = side, RegionId = r.Id, Amount = r.Medals });
                if (s.P(side).Medals >= terrain.MedalGoal[(int)side])
                {
                    EndGame(s, side, WinReason.MedalGoal, ev);
                    return;
                }
            }
        }

        private void EndGame(GameState s, Side winner, WinReason reason, List<GameEvent> ev)
        {
            s.Phase = Phase.GameOver;
            s.Pending = null;
            s.Winner = winner;
            s.WinReason = reason;
            ev.Add(new GameEvent { Type = GameEventType.GameOver, Player = winner, WinReason = reason });
        }

        /// <summary>
        /// Resolves the effects of the current turn until a player decision is needed or the turn ends.
        /// Order (player aid, Cap'taine): all troop effects first, depth-first (an extra troop resolves
        /// before anything else), then the special-base effects of every placed troop in placement order.
        /// </summary>
        private void Continue(GameState s, List<GameEvent> ev)
        {
            while (s.Phase != Phase.GameOver && s.Pending == null)
            {
                if (s.TroopEffectStack.Count > 0)
                {
                    int idx = s.TroopEffectStack[s.TroopEffectStack.Count - 1];
                    s.TroopEffectStack.RemoveAt(s.TroopEffectStack.Count - 1);
                    OpenTroopEffect(s, s.Chain[idx], ev);
                    continue;
                }
                if (s.BaseEffectCursor < s.Chain.Count)
                {
                    OpenBaseEffect(s, s.Chain[s.BaseEffectCursor++], ev);
                    continue;
                }
                EndTurn(s, ev);
                return;
            }
            if (s.Pending != null)
                ev.Add(new GameEvent { Type = GameEventType.DecisionOpened, Player = s.Pending.Player, Decision = s.Pending.Kind, TileId = s.Pending.SourceTile, NodeId = s.Pending.SourceNode, Amount = s.Pending.Amount });
        }

        private void Open(GameState s, DecisionKind kind, Side side, PlacementRecord rec, int amount = 0, bool optional = true)
        {
            s.Pending = new PendingDecision { Kind = kind, Player = side, SourceTile = rec.TileId, SourceNode = rec.NodeId, Amount = amount, Optional = optional };
        }

        private void OpenTroopEffect(GameState s, PlacementRecord rec, List<GameEvent> ev)
        {
            var troop = Content.TileTroop(rec.TileId);
            var side = Content.TileOwner(rec.TileId);
            if (troop.Ability == AbilityKind.None || troop.Ability == AbilityKind.IgnoreConnection) return;
            var node = Terrain(s).Node(rec.NodeId);
            if (IsShieldedSpecial(s, node))
            {
                ev.Add(new GameEvent { Type = GameEventType.AbilityBlocked, Player = side, TileId = rec.TileId, TroopId = troop.Id, NodeId = rec.NodeId });
                return;
            }
            switch (troop.Ability)
            {
                case AbilityKind.Draw:
                {
                    int n = DrawableCount(s, side, troop.Amount);
                    if (n > 0) Open(s, DecisionKind.TroopDraw, side, rec, n);
                    break;
                }
                case AbilityKind.ExtraPlacement:
                    if (AnyLegalPlacement(s, side)) Open(s, DecisionKind.ExtraPlacement, side, rec);
                    break;
                case AbilityKind.DiscardAdjacentEnemy:
                    if (DiscardAdjacentTargets(s, side, rec.NodeId).Count > 0) Open(s, DecisionKind.DiscardAdjacentTarget, side, rec);
                    break;
                case AbilityKind.DiscardRandomFromOpponentRack:
                    if (s.P(side.Other()).Rack.Count > 0) Open(s, DecisionKind.DiscardRandomConfirm, side, rec);
                    break;
            }
            if (s.Pending != null)
                ev.Add(new GameEvent { Type = GameEventType.AbilityActivated, Player = side, TileId = rec.TileId, TroopId = troop.Id, NodeId = rec.NodeId });
        }

        private void OpenBaseEffect(GameState s, PlacementRecord rec, List<GameEvent> ev)
        {
            if (!s.SpecialBasesEnabled) return;
            var terrain = Terrain(s);
            var node = terrain.Node(rec.NodeId);
            if (!node.IsSpecial) return;
            var side = Content.TileOwner(rec.TileId);
            switch (terrain.SpecialEffect)
            {
                case TerrainEffect.RecallOwnTroop:
                    if (RecallTargets(s, side, rec.TileId).Count > 0) Open(s, DecisionKind.RecallOwnTroop, side, rec);
                    break;
                case TerrainEffect.DrawOne:
                    if (DrawableCount(s, side, 1) > 0) Open(s, DecisionKind.TerrainDraw, side, rec, 1);
                    break;
                case TerrainEffect.MoveAdjacentEnemy:
                    if (MoveSources(s, side, rec.NodeId).Count > 0) Open(s, DecisionKind.MoveEnemySource, side, rec);
                    break;
                case TerrainEffect.RecoverFromDiscard:
                    if (RecoverableTiles(s, side).Count > 0) Open(s, DecisionKind.RecoverFromDiscard, side, rec);
                    break;
                case TerrainEffect.DesignateOpponentRack:
                    if (DesignatableSlots(s, side).Count > 0) Open(s, DecisionKind.DesignateOpponentRack, side, rec, 0, optional: false);
                    break;
                case TerrainEffect.Bounce:
                    if (BounceTargets(s, rec.TileId, rec.NodeId).Count > 0) Open(s, DecisionKind.Bounce, side, rec);
                    break;
            }
            if (s.Pending != null)
                ev.Add(new GameEvent { Type = GameEventType.BaseEffectActivated, Player = side, TileId = rec.TileId, NodeId = rec.NodeId });
        }

        private void EndTurn(GameState s, List<GameEvent> ev)
        {
            var ending = s.P(s.Active);
            // Champ de bataille: a laid-down troop stands up again at the end of its owner's turn.
            foreach (var t in ending.LaidDown)
                ev.Add(new GameEvent { Type = GameEventType.TroopStoodUp, Player = s.Active, TileId = t, TroopId = Content.TileTroop(t).Id });
            ending.LaidDown.Clear();
            s.Chain.Clear();
            s.TroopEffectStack.Clear();
            s.BaseEffectCursor = 0;
            s.Pending = null;

            s.Active = s.Active.Other();
            s.Turn++;
            s.Phase = Phase.TurnAction;
            ev.Add(new GameEvent { Type = GameEventType.TurnStarted, Player = s.Active, Amount = s.Turn });

            if (!HasAnyAction(s, s.Active))
            {
                // End condition 3: the player who cannot act ends the game. More medals wins;
                // on a tie, the player who ended the game loses.
                var stuck = s.Active;
                s.EndedBy = stuck;
                int mine = s.P(stuck).Medals, theirs = s.P(stuck.Other()).Medals;
                if (mine > theirs) EndGame(s, stuck, WinReason.NoActionMoreMedals, ev);
                else if (theirs > mine) EndGame(s, stuck.Other(), WinReason.NoActionMoreMedals, ev);
                else EndGame(s, stuck.Other(), WinReason.NoActionTieBreak, ev);
            }
        }
    }
}
