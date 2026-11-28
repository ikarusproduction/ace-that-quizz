using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using PocketToyTactics.Core;

namespace PocketToyTactics.Cli
{
    public static class ContentFiles
    {
        public static string FindContentDir()
        {
            var env = Environment.GetEnvironmentVariable("PTT_CONTENT");
            if (!string.IsNullOrEmpty(env)) return env;
            foreach (var start in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
            {
                var dir = start;
                while (dir != null)
                {
                    var c = Path.Combine(dir, "Packages", "com.pockettoytactics.core", "Content");
                    if (Directory.Exists(c)) return c;
                    dir = Path.GetDirectoryName(dir);
                }
            }
            throw new DirectoryNotFoundException("Content folder not found (set PTT_CONTENT)");
        }

        public static ContentDatabase Load()
        {
            var dir = FindContentDir();
            var db = new ContentDatabase();
            db.LoadTroops(File.ReadAllText(Path.Combine(dir, "troops.json")));
            foreach (var f in Directory.GetFiles(Path.Combine(dir, "terrains"), "*.json").OrderBy(x => x))
                db.LoadTerrain(File.ReadAllText(f));
            return db;
        }
    }

    /// <summary>Text rendering and input for the console test interface (no game logic here).</summary>
    public sealed class TextUi
    {
        private readonly ContentDatabase _db;
        private readonly RulesEngine _engine;

        public TextUi(ContentDatabase db) { _db = db; _engine = new RulesEngine(db); }

        public static string SideFr(Side s) => s == Side.Blue ? "BLEU" : "ROUGE";

        public string Tile(int t)
        {
            if (t < 0) return "?";
            var tr = _db.TileTroop(t);
            return (_db.TileOwner(t) == Side.Blue ? "b:" : "r:") + tr.Name + "(" + tr.StrengthLabel + ")";
        }

        public string Render(PlayerView v)
        {
            var t = _db.Terrain(v.TerrainId);
            var sb = new StringBuilder();
            sb.AppendLine();
            sb.AppendLine($"=== {t.Name} ({t.ReferenceTerrain}) — tour {v.Turn} — joue : {SideFr(v.Active)}{(v.Active == v.Viewer ? " (vous)" : "")} ===");
            sb.AppendLine($"Médailles  BLEU {v.Medals[0]}/{t.MedalGoal[0]}   ROUGE {v.Medals[1]}/{t.MedalGoal[1]}   bases spéciales : {(v.SpecialBasesEnabled ? "oui" : "non")}");
            foreach (var n in t.Nodes)
            {
                var st = v.Stacks[n.Id];
                string kind = n.IsHq ? "Q.G. " + SideFr(n.Owner) : n.IsSpecial ? "spéciale" : "base";
                string allowed = n.AllowedStrengths != null ? " [valeurs " + string.Join("/", n.AllowedStrengths) + "]" : "";
                string content = st.Count == 0 ? "—" : Tile(st[st.Count - 1]) + (st.Count > 1 ? $" (pile {st.Count}: {string.Join(" < ", st.Select(Tile))})" : "");
                sb.AppendLine($"  {n.Id,-4} {kind,-11}{allowed} {content}   -> {string.Join(" ", t.Neighbors(n.Id))}");
            }
            sb.Append("Régions : ");
            sb.AppendLine(string.Join("  ", t.Regions.Select(r => $"{r.Id}({string.Join(",", r.Bases)})★{r.Medals}" +
                (v.RegionClaims.TryGetValue(r.Id, out var who) ? "=" + SideFr(who) : ""))));
            sb.AppendLine("Défausse : " + (v.Discard.Count == 0 ? "—" : string.Join(" ", v.Discard.Select(Tile))));
            var rack = new List<string>();
            for (int i = 0; i < v.MyRack.Count; i++)
                rack.Add($"[{i}] {Tile(v.MyRack[i])}{(v.MyLaidDown.Contains(v.MyRack[i]) ? " (couchée)" : "")}");
            sb.AppendLine($"Votre support ({SideFr(v.Viewer)}) : {(rack.Count == 0 ? "vide" : string.Join("  ", rack))} | réserve {v.MyReserveCount}");
            sb.AppendLine($"Adversaire : support {v.OppRackCount}{(v.OppLaidDownSlots.Count > 0 ? " (couchée(s) : emplacement " + string.Join(",", v.OppLaidDownSlots) + ")" : "")}" +
                          $"{(v.OppKnownInRack.Count > 0 ? " dont connues " + string.Join(" ", v.OppKnownInRack.Select(Tile)) : "")} | réserve {v.OppReserveCount}");
            if (v.Pending != null) sb.AppendLine("Décision en cours : " + DescribeDecision(v.Pending));
            if (v.Phase == Phase.GameOver)
                sb.AppendLine($"*** FIN : victoire {SideFr(v.Winner.Value)} ({v.WinReason}){(v.EndedBy != null ? ", fin provoquée par " + SideFr(v.EndedBy.Value) : "")} ***");
            return sb.ToString();
        }

        public string DescribeDecision(PendingDecision d)
        {
            switch (d.Kind)
            {
                case DecisionKind.ExtraPlacement: return "placement supplémentaire (Sergent Ressort) : p <emplacement-support> <base>, ou s pour passer";
                case DecisionKind.TroopDraw: return $"piocher {d.Amount} troupe(s) ? a = oui, s = non";
                case DecisionKind.DiscardRandomConfirm: return "défausser une troupe au hasard du support adverse ? a = oui, s = non";
                case DecisionKind.TerrainDraw: return "base spéciale : piocher 1 troupe ? a = oui, s = non";
                case DecisionKind.DiscardAdjacentTarget: return "choisissez la troupe adverse adjacente à défausser : c <base>, ou s";
                case DecisionKind.RecallOwnTroop: return "base spéciale : reprendre une autre de vos troupes visibles : c <base>, ou s";
                case DecisionKind.MoveEnemySource: return "base spéciale : troupe adverse adjacente à déplacer : c <base>, ou s";
                case DecisionKind.MoveEnemyDestination: return $"déplacer la troupe de {d.SelectedNode} vers : c <base>";
                case DecisionKind.RecoverFromDiscard: return "base spéciale : reprendre une de vos troupes défaussées : c #<tuile>, ou s";
                case DecisionKind.Bounce: return "château gonflable : faire rebondir la troupe posée vers une base vide : c <base>, ou s";
                case DecisionKind.DesignateOpponentRack: return "base spéciale : désignez un emplacement du support adverse : c <numéro> (obligatoire)";
                default: return d.Kind.ToString();
            }
        }

        public string Describe(GameEvent e)
        {
            string who = SideFr(e.Player);
            switch (e.Type)
            {
                case GameEventType.TurnStarted: return $"— Tour {e.Amount} : {who} —";
                case GameEventType.TilesDrawn: return $"{who} pioche {e.Amount} troupe(s){(e.Tiles.Count > 0 ? " : " + string.Join(" ", e.Tiles.Select(Tile)) : "")}";
                case GameEventType.TroopPlaced: return $"{who} place {Tile(e.TileId)} sur {e.NodeId}{(e.CoveredTileId >= 0 ? " en recouvrant " + Tile(e.CoveredTileId) : "")}";
                case GameEventType.AbilityActivated: return $"Effet de {Tile(e.TileId)}";
                case GameEventType.AbilityBlocked: return $"Bouclier : l'effet de {Tile(e.TileId)} n'est pas appliqué sur {e.NodeId}";
                case GameEventType.BaseEffectActivated: return $"Effet de la base spéciale {e.NodeId}";
                case GameEventType.EffectSkipped: return $"{who} renonce à l'effet";
                case GameEventType.TroopDiscarded: return $"{Tile(e.TileId)} est défaussée{(e.NodeId != null ? " depuis " + e.NodeId : " depuis le support")}";
                case GameEventType.TroopReturnedToRack: return $"{Tile(e.TileId)} retourne sur le support de {who}";
                case GameEventType.TroopMoved: return $"{Tile(e.TileId)} est déplacée de {e.NodeId} vers {e.ToNodeId}";
                case GameEventType.TroopRecovered: return $"{who} récupère {Tile(e.TileId)} dans la défausse";
                case GameEventType.TroopLaidDown: return $"{who} couche l'emplacement {e.Amount} du support adverse{(e.TileId >= 0 ? " (" + Tile(e.TileId) + ")" : "")}";
                case GameEventType.TroopStoodUp: return $"La troupe couchée de {who} se relève";
                case GameEventType.RegionCaptured: return $"{who} prend la région {e.RegionId} : +{e.Amount} médaille(s) !";
                case GameEventType.HqCaptured: return $"{who} capture le Q.G. {e.NodeId} !";
                case GameEventType.GameOver: return $"Victoire {who} ({e.WinReason})";
                case GameEventType.DecisionOpened: return null;
                default: return e.ToString();
            }
        }

        /// <summary>Lists what the viewer can do, grouped for readability.</summary>
        public string Options(PlayerView v)
        {
            var s = v.Determinize(_db, new Rng(1));
            var legal = _engine.LegalCommands(s);
            var sb = new StringBuilder();
            if (legal.Any(c => c.Type == CommandType.Draw)) sb.AppendLine("  d                 piocher");
            foreach (var g in legal.Where(c => c.Type == CommandType.Place).GroupBy(c => c.TileId))
                sb.AppendLine($"  p {v.MyRack.IndexOf(g.Key)} <base>         {Tile(g.Key)} -> {string.Join(" ", g.Select(c => c.NodeId))}");
            foreach (var c in legal.Where(c => c.Type == CommandType.Choose))
                sb.AppendLine("  " + (c.NodeId != null ? "c " + c.NodeId : c.TileId >= 0 ? "c #" + c.TileId + "   " + Tile(c.TileId) : c.Index >= 0 ? "c " + c.Index : "a"));
            if (legal.Any(c => c.Type == CommandType.Skip)) sb.AppendLine("  s                 passer l'effet");
            sb.AppendLine("  why <emplacement> <base>   pourquoi ce placement est (im)possible ;  q  quitter");
            return sb.ToString();
        }

        /// <summary>Parses a typed line into a command (null + message when invalid or informational).</summary>
        public Command Parse(PlayerView v, string line, out string message)
        {
            message = null;
            var parts = (line ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return null;
            var me = v.Viewer;
            try
            {
                switch (parts[0].ToLowerInvariant())
                {
                    case "d": return Command.Draw(me);
                    case "s": return Command.Skip(me);
                    case "a": return Command.Accept(me);
                    case "p": return Command.Place(me, v.MyRack[int.Parse(parts[1])], parts[2]);
                    case "c":
                        if (parts[1].StartsWith("#")) return Command.ChooseTile(me, int.Parse(parts[1].Substring(1)));
                        if (int.TryParse(parts[1], out int idx)) return Command.ChooseIndex(me, idx);
                        return Command.ChooseNode(me, parts[1]);
                    case "why":
                    {
                        var s = v.Determinize(_db, new Rng(1));
                        var err = _engine.CheckPlacement(s, me, v.MyRack[int.Parse(parts[1])], parts[2]);
                        message = RuleMessages.Fr(err);
                        return null;
                    }
                }
            }
            catch (Exception)
            {
                message = "Commande incomplète ou invalide.";
                return null;
            }
            message = "Commande inconnue.";
            return null;
        }
    }
}
