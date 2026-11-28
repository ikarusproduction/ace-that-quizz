# 02 — Architecture technique

## Choix du moteur : Unity 6 (6000.0 LTS) + URP + C#

| Critère | Pourquoi Unity 6 / URP |
|---|---|
| Rendu 3D mobile | L'URP est le pipeline de Unity conçu pour le mobile : forward+, SRP Batcher et GPU Resident Drawer (instancing automatique). Shader Graph permet le plastique brillant et la peinture mate. Les ombres douces et le post-traitement (bloom léger, profondeur de champ pour le menu) restent réglables par palier de qualité. |
| Animations des figurines | Animator (Mecanim), Timeline pour les animations signatures, Animation Rigging. Les rigs « toon » à squash & stretch s'importent en FBX/glTF depuis Blender. DOTween ou Unity Splines servent aux trajectoires des tuiles. |
| Performances | IL2CPP + ARM64, Burst inutile ici (moteur de règles léger : < 1 ms par coup), Adaptive Performance (Samsung et autres) pour le mode économie d'énergie, LOD Groups, Addressables pour charger un terrain à la fois. |
| Multijoueur local | `System.Net.Sockets` fonctionne sous IL2CPP Android/iOS : le transport TCP/UDP de ce dépôt s'utilise tel quel. Le BLE passe par un plugin natif (Android Kotlin `.aar`, iOS Swift `.framework`) derrière l'interface `IConnection`. |
| Android puis iOS | Un même projet. Pour iOS, il faut ajouter `NSLocalNetworkUsageDescription`, `NSBonjourServices` et la permission Bluetooth au fichier `Info.plist`. |
| Création d'assets et effets | VFX Graph (ou Particle System, mieux supporté sur les GPU mobiles d'entrée de gamme), Shader Graph, import glTF (glTFast), Audio Mixer à groupes séparés (musique, effets, ambiance). |

Alternative écartée : **Godot 4**, très bon pour la 2D et léger, mais l'écosystème mobile 3D (profiling Android, Adaptive Performance, plugins BLE maintenus) et le pipeline d'animation sont moins matures pour la qualité visée. **Unreal** est trop lourd pour la taille d'application et l'autonomie visées sur un téléphone de milieu de gamme.

## Principe : un cœur sans moteur graphique

```
┌──────────────────────────── Unity (présentation) ────────────────────────────┐
│ UIManager  CardAnimationSystem  BoardView  AudioManager  TutorialManager     │
│      ▲ joue des GameEvent              │ envoie des Command                  │
└──────┼─────────────────────────────────┼─────────────────────────────────────┘
       │                                 ▼
┌──────┴───────────── Packages/com.pockettoytactics.core (C# pur) ─────────────┐
│ GameManager*  ── RulesEngine ── GameState / PlayerView ── ContentDatabase    │
│ (session)        (validation,     (état, vue filtrée)      (troops.json,     │
│                   effets, fin)                              terrains/*.json) │
│ AiPlayer ── AiEvaluator          Net: HostSession / ClientSession / TCP /    │
│ SaveStore / Settings                  Discovery / JoinCode / IConnection     │
└──────────────────────────────────────────────────────────────────────────────┘
```

* Le cœur est un package Unity (`package.json` et `asmdef` avec `noEngineReferences: true`). Il est **aussi** compilé en bibliothèque .NET (`dotnet/Core`, `netstandard2.1`, C# 9 comme Unity 6, avertissements traités comme erreurs). Les tests et le client console tournent donc sans Unity.
* **Une action validée par le RulesEngine produit des `GameEvent`.** Une animation 3D, une interface console (`dotnet/Cli`) ou un test les consomment de la même façon. La présentation ne déduit jamais une règle.
* **Données d'abord.** Troupes (`troops.json` : force, capacité, quantité, noms) et terrains (`terrains/*.json` : graphe, régions, médailles, effet, restrictions) se modifient sans recompiler. Les capacités et effets de terrain sont des types énumérés implémentés une fois dans le moteur : une nouvelle troupe reprend une capacité existante avec d'autres paramètres.

## Correspondance avec les 13 modules demandés

| Module | Où | État |
|---|---|---|
| GameManager (état de partie) | `GameState`, `HostSession` (partie réseau), `RulesEngine.NewGame/Replay` ; le MonoBehaviour qui orchestre les scènes reste à écrire | cœur fait |
| RulesEngine | `Runtime/Rules/RulesEngine.cs` | fait, testé |
| BoardManager (terrains, connexions) | `TerrainDefinition` (graphe, adjacence par chemins, Q.G., régions), `ConnectedBases` | fait, testé |
| TroopManager (unités, capacités) | `TroopDefinition`, `AbilityKind`, `troops.json` | fait, testé |
| TurnManager | `Phase`, `PendingDecision`, `Continue`, `EndTurn` dans le RulesEngine | fait, testé |
| ObjectiveManager (médailles, victoire) | `CheckRegions`, `EndGame`, objectifs par terrain et par côté | fait, testé |
| CardAnimationSystem | Unity : file de `GameEvent` → séquences d'animation | **à faire (Unity)** |
| LocalNetworkManager | `Runtime/Net` : `HostSession`, `ClientSession`, `TcpConnection`, `TcpHostListener`, `DiscoveryBeacon/Browser`, `JoinCode` | fait, testé en local (boucle locale, 2 processus) ; **non testé sur 2 téléphones** |
| BluetoothManager | interface `IConnection` prête ; plugin natif BLE | **à faire (natif)** |
| AudioManager | Unity (Audio Mixer) ; volumes et sourdine dans `Settings` | réglages faits, **audio à faire** |
| UIManager | Unity (UI Toolkit) ; textes d'erreur FR dans `RuleMessages` | **à faire (Unity)** |
| SaveManager | `SaveStore` (écriture atomique), `Settings`, `StateSerializer` | fait, testé |
| TutorialManager | Unity ; scénarios en données à construire avec les mêmes outils que les tests (`Sim`) | **à faire** |

## Déroulé d'un coup

1. L'interface envoie une `Command` (`Draw`, `Place`, `Choose`, `Skip`).
2. `RulesEngine.Validate` renvoie `RuleError.None` ou une raison (affichable via `RuleMessages.Fr`). L'état n'est jamais modifié en cas de refus.
3. `Apply` modifie l'état et renvoie la liste ordonnée des `GameEvent` (`TroopPlaced`, `AbilityActivated`, `TroopDiscarded`, `RegionCaptured`, `HqCaptured`, `DecisionOpened`, `TurnStarted`, `GameOver`…).
4. Si un effet demande un choix, l'état passe en `Phase.Decision` avec une `PendingDecision`. `LegalCommands` liste les réponses possibles, ce qui permet de surligner les cibles dans l'interface.
5. L'animation joue les événements à son rythme, accélérable ou désactivable (`Settings.AnimationSpeed`, `SkipAnimations`). L'état logique est déjà à jour : une animation ne bloque jamais la règle.

## Déterminisme

* PRNG propre (`Rng`, SplitMix64) au lieu de `System.Random`, dont la séquence diffère entre Mono, IL2CPP et CoreCLR. Son état est sérialisé.
* `Replay(seed, commandes)` reconstruit une partie à l'octet près (`Replay_and_save_round_trip_are_exact`, 8 terrains).
* Seul l'hôte tire au sort (mélanges, XB-42). Le client ne fait que recevoir des vues.

## Performances mesurées (PC, .NET 8, Release)

* Moteur : une partie aléatoire complète en moins de 2 ms.
* IA : Facile 0,3 ms, Normal environ 1 ms, Difficile environ 6 ms par décision. Sur un téléphone de milieu de gamme, prévoir un facteur 5 à 15, donc moins de 100 ms en Difficile. Il faudra le mesurer sur l'appareil.
