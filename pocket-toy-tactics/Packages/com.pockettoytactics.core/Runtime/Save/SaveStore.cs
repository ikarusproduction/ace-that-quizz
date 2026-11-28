using System;
using System.Collections.Generic;
using System.IO;

namespace PocketToyTactics.Core
{
    /// <summary>Player settings persisted locally (no account, no server).</summary>
    public sealed class Settings
    {
        public string PlayerName = "Joueur";
        public double MusicVolume = 0.8;
        public double SfxVolume = 1.0;
        public double AmbienceVolume = 0.7;
        public bool Muted;
        public double AnimationSpeed = 1.0;
        public bool SkipAnimations;
        public bool BatterySaver;
        public bool AutoAcceptDraws;
        public bool BeginnerSpecialBasesOff;
        public string Language = "fr";
        public bool TutorialDone;

        public Dictionary<string, object> ToJson() => new Dictionary<string, object>
        {
            ["playerName"] = PlayerName, ["music"] = MusicVolume, ["sfx"] = SfxVolume, ["ambience"] = AmbienceVolume,
            ["muted"] = Muted, ["animSpeed"] = AnimationSpeed, ["skipAnim"] = SkipAnimations, ["battery"] = BatterySaver,
            ["autoDraw"] = AutoAcceptDraws, ["beginner"] = BeginnerSpecialBasesOff, ["lang"] = Language, ["tutorialDone"] = TutorialDone,
        };

        public static Settings FromJson(Dictionary<string, object> d) => new Settings
        {
            PlayerName = d.Str("playerName", "Joueur"), MusicVolume = d.Num("music", 0.8), SfxVolume = d.Num("sfx", 1),
            AmbienceVolume = d.Num("ambience", 0.7), Muted = d.Bool("muted"), AnimationSpeed = d.Num("animSpeed", 1),
            SkipAnimations = d.Bool("skipAnim"), BatterySaver = d.Bool("battery"), AutoAcceptDraws = d.Bool("autoDraw"),
            BeginnerSpecialBasesOff = d.Bool("beginner"), Language = d.Str("lang", "fr"), TutorialDone = d.Bool("tutorialDone"),
        };
    }

    /// <summary>
    /// Local persistence in a directory (Unity: Application.persistentDataPath). Writes are atomic
    /// (temp file + replace) so that a crash or the app being killed never leaves a corrupted save.
    /// </summary>
    public sealed class SaveStore
    {
        private readonly string _dir;

        public SaveStore(string directory)
        {
            _dir = directory;
            Directory.CreateDirectory(_dir);
        }

        private string PathOf(string name) => Path.Combine(_dir, name + ".json");

        public void WriteAtomic(string name, string content)
        {
            var target = PathOf(name);
            var tmp = target + ".tmp";
            File.WriteAllText(tmp, content);
            if (File.Exists(target)) File.Replace(tmp, target, null);
            else File.Move(tmp, target);
        }

        public string Read(string name)
        {
            var p = PathOf(name);
            return File.Exists(p) ? File.ReadAllText(p) : null;
        }

        public bool Exists(string name) => File.Exists(PathOf(name));

        public void Delete(string name)
        {
            if (File.Exists(PathOf(name))) File.Delete(PathOf(name));
        }

        public void SaveSettings(Settings s) => WriteAtomic("settings", Json.Write(s.ToJson()));

        public Settings LoadSettings()
        {
            var txt = Read("settings");
            if (txt == null) return new Settings();
            try { return Settings.FromJson(Json.ParseObject(txt)); }
            catch (Exception) { return new Settings(); }
        }

        /// <summary>Saves a game in progress, with metadata needed to resume it (mode, sides, session id).</summary>
        public void SaveGame(string slot, GameState state, Dictionary<string, object> meta = null)
        {
            var d = new Dictionary<string, object> { ["state"] = StateSerializer.ToJson(state), ["meta"] = meta ?? new Dictionary<string, object>(), ["savedAt"] = DateTime.UtcNow.ToString("o") };
            WriteAtomic("game-" + slot, Json.Write(d));
        }

        public GameState LoadGame(string slot, out Dictionary<string, object> meta)
        {
            meta = null;
            var txt = Read("game-" + slot);
            if (txt == null) return null;
            var d = Json.ParseObject(txt);
            meta = d.Obj("meta");
            return StateSerializer.FromJson(d.Obj("state"));
        }
    }
}
