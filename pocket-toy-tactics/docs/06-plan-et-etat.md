# 06 — Plan de développement et état réel

Ce document dit ce qui **existe et a été vérifié**, et ce qui **reste à faire**. Rien n'est présenté comme fait s'il n'a pas été exécuté.

## Environnement de cette itération

Conteneur Linux sans éditeur Unity, sans SDK Android et sans téléphone. On y dispose de .NET 8, Python et Chromium. Conséquences :

* tout ce qui est indépendant du moteur graphique a été écrit, compilé et testé (règles, données, IA, protocole réseau, sauvegarde) ;
* tout ce qui demande Unity, des assets ou des appareils physiques n'a **pas** été commencé.

## Avancement par phase

| Phase | Contenu | État |
|---|---|---|
| 1. Analyse et conception | règles officielles lues, mécaniques, architecture, protocole réseau, format de terrain, pipeline graphique, plan | **fait** (`docs/01` à `05`) |
| 2. Prototype fonctionnel | 8 troupes, règles de pose, capacités, médailles, 3 victoires, deux joueurs sur un même appareil | **fait pour le moteur** (+ client texte `ptt play`, sur un même terminal) ; le prototype Unity minimal reste à faire |
| 3. Multijoueur local | Wi-Fi local puis Bluetooth, validé sur 2 appareils | **Wi-Fi/TCP fait et testé hors téléphone** (mémoire, boucle locale, 2 processus) ; **non validé sur téléphones** ; Bluetooth **non commencé** (conception dans `03-reseau.md`) |
| 4. Graphismes 3D | modèles, textures, animations, plateaux, effets | **non commencé** |
| 5. Interface et expérience | menus, écran de connexion, support animé, tutoriel | **non commencé** (textes d'erreur et paramètres prêts dans le cœur) |
| 6. Contenu complet | 8 terrains et leurs règles particulières | **fait pour les données et les règles** : 8 terrains originaux validés et testés ; habillage 3D à faire |
| 7. Optimisation et livraison | profilage, APK, guide de compilation | **non commencé** ; aucun APK n'est produit ici |

## Ce qui est livré et vérifié

* `Packages/com.pockettoytactics.core` : package Unity en C# pur (`noEngineReferences`). Il est compilé sans aucun avertissement en `netstandard2.1` et C# 9, comme Unity 6 :
  * `RulesEngine`, `GameState`, `PlayerView` (vue filtrée), `StateSerializer`, `Rng` déterministe ;
  * `ContentDatabase` + `troops.json` + 8 `terrains/*.json` ;
  * `AiPlayer` (Facile, Normal, Difficile) + `AiEvaluator` aux poids réglables ;
  * `Net` : `HostSession`, `ClientSession`, `TcpConnection`, `TcpHostListener`, `MemoryConnection`, `DiscoveryBeacon/Browser`, `JoinCode`, `LocalNetwork` ;
  * `SaveStore` (écritures atomiques), `Settings`.
* `dotnet/Tests` : **119 tests automatisés, tous verts** (stables sur 6 exécutions consécutives). Ils couvrent les 8 troupes, les 8 terrains, la connexion, les recouvrements, les capacités, les médailles, les 3 victoires, les actions impossibles, l'égalité, les chaînes de Cap'taine, la Station Métal-X, le terrain asymétrique, les parties aléatoires sur tous les terrains (conservation des 48 tuiles), le rejeu exact, l'aller-retour de sauvegarde, le masquage de l'information cachée, l'IA, le réseau (doublons, coups illégaux, désordre, coupure et reconnexion, mauvaise session ou version, reprise après fermeture de l'hôte, partie TCP complète, découverte UDP) et les paramètres.
* `dotnet/Cli` (`ptt`) : interface de test texte. Commandes : `play` (humain ou IA, sur un même terminal), `simulate` (tournois d'IA), `host`, `join` (Wi-Fi local), `discover` (diagnostic réseau), `terrains`.
* `tools/terrain_tool.py` : validation géométrique des terrains et rendu SVG (`docs/terrains/*.svg`).

### Mesures

| Confrontation (8 terrains, couleurs alternées) | Résultat |
|---|---|
| Facile contre aléatoire | 46 – 2 |
| Normal contre Facile | 29 – 3 |
| Difficile contre Normal | 57 – 39 (59 %) |
| Normal contre Normal, terrains symétriques | pas de biais de camp (≈ 50 %) |

Temps par décision sur PC : Facile 0,3 ms, Normal environ 1 ms, Difficile environ 6 ms.

## Prochaines étapes (dans l'ordre)

1. **Projet Unity 6 minimal** (poste avec Unity) : importer le package par chemin local, scène de plateau générée depuis le JSON (primitives temporaires autorisées à ce stade de prototype), lecture des `GameEvent`, sélection de tuile, surlignage des cibles légales, deux joueurs sur un téléphone.
2. **Réseau sur 2 téléphones Android** : MulticastLock, permissions, écran de connexion (liste découverte + code), écran de diagnostic, tests de coupure Wi-Fi et de mise en arrière-plan.
3. **Plugin BLE** Android (Kotlin) → `BleConnection : IConnection`, tests sur appareils, limites documentées. Ensuite iOS.
4. **Assets** : les 8 figurines, les tuiles, les 8 dioramas, l'interface, les effets, le son et la musique (voir `05`), avec des retours de lisibilité à chaque lot.
5. **Tutoriel interactif** en 13 étapes : des positions construites comme dans les tests (`Sim`), avec des objectifs imposés et une validation par `GameEvent`.
6. **Optimisation** (profilage sur appareil d'entrée de gamme, mode économie d'énergie), guide de compilation Android **vérifié**, APK signé de test.
7. **Transcription des plateaux officiels**, si vous en disposez (photos à plat), au format `transcribed-official`, en plus ou à la place des terrains originaux.
