using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core
{
    public enum AiLevel { Easy, Normal, Hard }

    /// <summary>
    /// Computer opponent. It only ever receives a <see cref="PlayerView"/>, so it cannot read hidden tiles.
    /// Hidden information is handled by determinization: several complete states consistent with the view are
    /// sampled, each candidate command is evaluated on every sample, and scores are averaged.
    ///   Easy   - 1 sample, greedy, frequently plays a random legal move on purpose.
    ///   Normal - 4 samples, plays its whole turn greedily and evaluates the result.
    ///   Hard   - 8 samples, depth-2 search: its turn, then the opponent's best reply (minimax over turns)
    ///            on the most promising candidates.
    /// </summary>
    public sealed class AiPlayer
    {
        private readonly RulesEngine _engine;
        private readonly Rng _rng;
        public readonly AiLevel Level;
        public readonly AiEvaluator Evaluator;

        public AiPlayer(ContentDatabase content, AiLevel level, ulong seed)
        {
            _engine = new RulesEngine(content);
            _rng = new Rng(seed);
            Level = level;
            Evaluator = new AiEvaluator(_engine);
        }

        public Command Choose(PlayerView view)
        {
            if (!view.IsMyTurn) throw new InvalidOperationException("AI asked to play outside its turn");
            var me = view.Viewer;
            int samples = Level == AiLevel.Easy ? 1 : Level == AiLevel.Normal ? 4 : 8;
            var states = new List<GameState>();
            for (int i = 0; i < samples; i++) states.Add(view.Determinize(_engine.Content, _rng));

            var candidates = _engine.LegalCommands(states[0], distinctTroops: true);
            if (candidates.Count == 0) throw new InvalidOperationException("No legal command");
            if (candidates.Count == 1) return candidates[0];

            if (Level == AiLevel.Easy && _rng.NextDouble() < 0.35)
                return candidates[_rng.Next(candidates.Count)];

            var scores = new double[candidates.Count];
            for (int c = 0; c < candidates.Count; c++)
            {
                double total = 0;
                foreach (var st in states)
                {
                    var s = st.Clone(withHistory: false);
                    _engine.Apply(s, candidates[c]);
                    FinishTurnGreedy(s, me);
                    total += Evaluator.Evaluate(s, me);
                }
                scores[c] = total / states.Count;
                if (Level == AiLevel.Easy) scores[c] += _rng.NextDouble() * 60; // sloppy on purpose
            }

            if (Level == AiLevel.Hard)
            {
                // Depth 2 on the best candidates: assume the opponent answers with its best greedy turn.
                var order = new List<int>();
                for (int i = 0; i < candidates.Count; i++) order.Add(i);
                order.Sort((a, b) => scores[b].CompareTo(scores[a]));
                int keep = Math.Min(8, order.Count);
                var deep = new double[candidates.Count];
                for (int i = 0; i < candidates.Count; i++) deep[i] = double.NegativeInfinity;
                for (int k = 0; k < keep; k++)
                {
                    int c = order[k];
                    double total = 0;
                    foreach (var st in states)
                    {
                        var s = st.Clone(withHistory: false);
                        _engine.Apply(s, candidates[c]);
                        FinishTurnGreedy(s, me);
                        total += OpponentBestReply(s, me);
                    }
                    deep[c] = total / states.Count;
                }
                return candidates[ArgMax(deep)];
            }
            return candidates[ArgMax(scores)];
        }

        private static int ArgMax(double[] v)
        {
            int best = 0;
            for (int i = 1; i < v.Length; i++) if (v[i] > v[best]) best = i;
            return best;
        }

        /// <summary>Score for <paramref name="me"/> after the opponent plays its best greedy turn.</summary>
        private double OpponentBestReply(GameState s, Side me)
        {
            if (s.Phase == Phase.GameOver || s.Active == me) return Evaluator.Evaluate(s, me);
            var opp = me.Other();
            var replies = _engine.LegalCommands(s, distinctTroops: true);
            double worst = double.PositiveInfinity;
            foreach (var r in replies)
            {
                var t = s.Clone(withHistory: false);
                _engine.Apply(t, r);
                FinishTurnGreedy(t, opp);
                double v = Evaluator.Evaluate(t, me);
                if (v < worst) worst = v;
                if (worst <= -AiEvaluator.Win / 2) break;
            }
            return worst;
        }

        /// <summary>Resolves the rest of <paramref name="side"/>'s turn, picking each decision by 1-step lookahead.</summary>
        public void FinishTurnGreedy(GameState s, Side side)
        {
            int guard = 0;
            while (s.Phase == Phase.Decision && s.Active == side && guard++ < 32)
            {
                var options = _engine.LegalCommands(s, distinctTroops: true);
                Command best = null;
                double bestScore = double.NegativeInfinity;
                foreach (var o in options)
                {
                    var t = s.Clone(withHistory: false);
                    _engine.Apply(t, o);
                    double v = Evaluator.Evaluate(t, side);
                    if (v > bestScore) { bestScore = v; best = o; }
                }
                _engine.Apply(s, best);
            }
        }
    }

    /// <summary>Static position evaluation, from the point of view of one side. Weights are data, tune freely.</summary>
    public sealed class AiEvaluator
    {
        public const double Win = 1_000_000;
        public double MedalWeight = 140;
        public double GoalProximityWeight = 400;
        public double RegionProgressWeight = 30;
        public double HqThreatAgainstMe = 6000;
        public double HqThreatByMe = 350;
        public double ConnectedBaseWeight = 10;
        public double TopStrengthWeight = 4;
        public double RackTileWeight = 14;
        public double ReachableTargetWeight = 2;

        private readonly RulesEngine _engine;

        public AiEvaluator(RulesEngine engine) { _engine = engine; }

        public double Evaluate(GameState s, Side me)
        {
            if (s.Phase == Phase.GameOver) return s.Winner == me ? Win - s.Turn : -Win + s.Turn;
            var terrain = _engine.Terrain(s);
            var opp = me.Other();
            double v = 0;

            int myM = s.P(me).Medals, opM = s.P(opp).Medals;
            int myGoal = terrain.MedalGoal[(int)me], opGoal = terrain.MedalGoal[(int)opp];
            v += MedalWeight * (myM - opM);
            v += GoalProximityWeight * (Sq((double)myM / myGoal) - Sq((double)opM / opGoal));

            foreach (var r in terrain.Regions)
            {
                if (r.Medals <= 0 || s.RegionClaims.ContainsKey(r.Id)) continue;
                int mine = 0, theirs = 0;
                foreach (var b in r.Bases)
                {
                    var o = _engine.TopOwner(s, b);
                    if (o == me) mine++; else if (o == opp) theirs++;
                }
                double n = r.Bases.Count;
                if (theirs == 0) v += RegionProgressWeight * r.Medals * Sq(mine / n) * (myM + r.Medals >= myGoal ? 3 : 1);
                if (mine == 0) v -= RegionProgressWeight * r.Medals * Sq(theirs / n) * (opM + r.Medals >= opGoal ? 3 : 1);
            }

            var myConn = _engine.ConnectedBases(s, me);
            var opConn = _engine.ConnectedBases(s, opp);
            v += ConnectedBaseWeight * (myConn.Count - opConn.Count);

            // Immediate HQ danger: the opponent moves next and touches one of my HQs.
            bool oppToMove = s.Active == opp;
            if (Threatens(s, opp, opConn) && PlayableTiles(s, opp) > 0) v -= oppToMove ? HqThreatAgainstMe : HqThreatAgainstMe / 4;
            if (Threatens(s, me, myConn) && PlayableTiles(s, me) > 0) v += oppToMove ? HqThreatByMe : HqThreatAgainstMe / 2;

            foreach (var n in terrain.Nodes)
            {
                if (!n.IsBase) continue;
                int top = s.TopTile(n.Id);
                if (top < 0) continue;
                var troop = _engine.Content.TileTroop(top);
                double str = troop.IsJoker ? 1 : troop.Strength;
                v += (_engine.Content.TileOwner(top) == me ? 1 : -1) * TopStrengthWeight * str;
            }

            v += RackTileWeight * (Math.Min(s.P(me).Rack.Count, 6) - Math.Min(s.P(opp).Rack.Count, 6));
            if (s.P(me).Rack.Count == 0 && s.P(me).Reserve.Count == 0) v -= 200;
            return v;
        }

        private static double Sq(double x) => x * x;

        private int PlayableTiles(GameState s, Side side) => s.P(side).Rack.Count - s.P(side).LaidDown.Count;

        private bool Threatens(GameState s, Side attacker, HashSet<string> connected)
        {
            var terrain = _engine.Terrain(s);
            foreach (var hq in terrain.Hqs(attacker.Other()))
                foreach (var w in terrain.Neighbors(hq))
                {
                    var n = terrain.Node(w);
                    if (connected.Contains(w) || (n.IsHq && n.Owner == attacker)) return true;
                }
            return false;
        }
    }
}
