# 01 — Analyse des règles

## Sources lues

| Document | URL | Contenu exploité |
|---|---|---|
| Livret de règles FR (6 pages) | `cdn.svc.asmodee.net/…/toy-fr01-rules-1744030098Pk1fi.pdf` | matériel, mise en place, tour, règles de pose, connexion, régions, fin de partie |
| Aide de jeu FR (2 pages) | `cdn.svc.asmodee.net/…/toy-fr01-player-aid-mkt-1-1750679916GHYjK.pdf` | effets des 8 troupes, effets des 8 terrains, remarques de résolution |

Les deux documents ont été téléchargés et lus intégralement (texte extrait avec `pdftotext`, pages illustrées rendues en image).

## Ce que les documents officiels **ne contiennent pas**

Les **plans des 8 terrains** (bases, chemins, régions, nombre de médailles par région, objectif de médailles de chaque côté, valeurs de la piscine) sont imprimés sur les plateaux physiques. Ils ne figurent pas dans les PDF.
Seule la Plaine des châteaux apparaît, en photo de biais, page 2 du livret. Des étiquettes masquent une partie des chemins et les chiffres de l'objectif y sont illisibles.

Le cahier des charges interdit d'inventer des valeurs officielles. Nous avons donc :

1. créé **8 terrains originaux** (`layoutSource: "original-design"`). Chacun porte l'effet spécial officiel de son terrain de référence, mais sa disposition et ses valeurs sont une création propre, réglable après tests ;
2. prévu un format de données (voir `04-terrains.md`) qui permet de transcrire les plateaux physiques plus tard (`layoutSource: "transcribed-official"`) sans toucher au moteur.

## Règles implémentées (et où)

| Règle (source) | Implémentation | Tests |
|---|---|---|
| 24 tuiles par joueur, 8 types × 3 (livret p.1, 3) | `troops.json`, `ContentDatabase.TilesOf` | `Roster_has_eight_troops_three_copies_each` |
| Mise en place : 4 tuiles retirées, 1er joueur 3 tuiles, 2e joueur 4, premier joueur tiré au hasard (p.2) | `RulesEngine.NewGame` | `Setup_follows_the_rulebook`, `First_player_is_random_but_seeded` |
| Piocher 2 ; 1 seule s'il ne reste qu'une tuile ou une place ; interdit à 8 (p.3) | `Validate`/`DrawInto` | `DrawTests.*` |
| Placer : base vide, sa propre troupe, troupe adverse de force **strictement** inférieure, Q.G. adverse ; jamais son Q.G. (p.4) | `CheckPlacement` | `PlacementTests.*` |
| Piles illimitées, seule la troupe visible occupe, ordre immuable (p.4) | `GameState.Stacks` | `Stacks_are_unlimited_and_only_the_top_occupies` |
| Connexion : chemin continu depuis son Q.G. par des bases occupées ; base vide ou adverse = coupure (p.4) | `ConnectedBases`, `IsConnectedTarget` | `Connection_*`, `Enemy_or_empty_base_breaks_the_connection` |
| Le Q.G. n'est pas une base (p.3) | `NodeType.Hq` exclu des régions et des cibles d'effets | `terrain_tool.py`, `TerrainDefinition.Build` |
| Région : dès que toutes les bases qui l'entourent sont occupées → médailles, conservées même en cas de perte, plusieurs régions par tour possibles, déjà prises = rien (p.5) | `CheckRegions`, appelé après **chaque** changement du plateau, pour les deux joueurs | `RegionAndVictoryTests.*` |
| Victoire : Q.G. adverse capturé (un seul suffit s'il y en a plusieurs) ; objectif de médailles atteint ; joueur incapable de piocher et de placer → comparaison des médailles, égalité perdue par celui qui a mis fin à la partie (p.6) | `ExecutePlace`, `CheckRegions`, `EndTurn` | `Placing_on_connected_enemy_hq_wins_immediately`, `Reaching_the_medal_goal_wins_immediately`, `Player_who_cannot_act_*`, `Full_rack_with_no_legal_placement_ends_the_game`, `Pirate_sea_capturing_one_of_two_hqs_is_enough` |
| Effets : d'abord l'effet de la troupe, ensuite celui de la base spéciale (p.3) ; avec Cap'taine, tous les effets de troupes avant ceux des bases (aide) | `Continue` : pile d'effets de troupes (profondeur d'abord) puis curseur des bases dans l'ordre de pose | `Captain_chains_*`, `Cloud_city_draws_one_and_troop_effects_resolve_before_base_effects` |
| Variante débutant : bases spéciales sans effet (p.3) | `GameOptions.SpecialBasesEnabled` | `Beginner_variant_disables_special_bases` |

### Les huit troupes (aide de jeu)

| Réf. | Nom original | Force | Effet implémenté | Capacité moteur |
|---|---|---|---|---|
| Skully | Bloup | 1 | piocher 2 (1 seule avec 7 tuiles sur le support) | `Draw`, `amount: 2` |
| Cap'taine | Sergent Ressort | 2 | placer 1 troupe supplémentaire et appliquer son effet | `ExtraPlacement` |
| Mastok | Grizzbloc | 3 | défausser 1 troupe adverse **visible** adjacente (1 tronçon de chemin) | `DiscardAdjacentEnemy` |
| Crochet | Zip-Zap | 4 | ignorer la connexion pour une **base** ; le Q.G. adverse doit rester connecté | `IgnoreConnection` |
| XB-42 | Pif-Pof | 5 | défausser face visible 1 troupe tirée au hasard dans le support adverse | `DiscardRandomFromOpponentRack` |
| Star | Paillette | 6 | piocher 1 | `Draw`, `amount: 1` |
| Roxy | Mamie Brique | 7 | aucun | `None` |
| Kwak | Caméléo | joker | aucun effet ; recouvre n'importe quelle troupe adverse et peut être recouvert par n'importe laquelle | `joker: true` |

### Les huit terrains (aide de jeu)

| Terrain de référence | Effet officiel | `specialEffect` |
|---|---|---|
| Plaine des châteaux | reprendre 1 **autre** de ses troupes (visible), n'importe où, sur son support | `recall_own_troop` |
| Piscine des tropiques | seules les valeurs indiquées peuvent être placées sur ces bases spéciales **et ces Q.G.** ; vérifié avant la pose | `strength_restriction` + `allowedStrengths` |
| Cité des nuages | piocher 1 | `draw_one` |
| Jungle volcanique | déplacer 1 troupe adverse adjacente à la base spéciale vers une base adjacente à sa base de départ, en ignorant les règles de pose | `move_adjacent_enemy` |
| Cimetière maudit | reprendre 1 de ses troupes dans la défausse | `recover_from_discard` |
| Mer des Caraïbes | pas de base spéciale ; asymétrique : 2 Q.G. bleus, 1 Q.G. rouge | `none` + 2 nœuds `hq` bleus |
| Station Métal-X | les effets des troupes ne sont pas appliqués sur ces bases spéciales ; vérifié avant la pose | `effect_shield` |
| Champ de bataille | désigner sans regarder 1 troupe du support adverse : couchée, elle ne peut pas être placée pendant le tour adverse et se relève à la fin de ce tour ; elle compte dans la limite de 8 | `designate_opponent_rack` |

Règles générales de l'aide appliquées à tous les terrains : on n'interagit qu'avec les troupes **visibles**, et un effet qui ferait dépasser 8 tuiles sur le support ne s'applique pas (`RecallTargets`, `RecoverableTiles` et `DrawableCount` renvoient alors 0 cible).

## Interprétations (points non tranchés par les documents)

Chaque point ci-dessous est un choix explicite, isolé dans le code et couvert par un test. Il se modifie à un seul endroit si une FAQ officielle tranche autrement.

1. **Effets facultatifs.** Les textes disent « Vous pouvez… » : chaque effet propose *Passer* (`Skip`). Seule la désignation du Champ de bataille (« Désignez ») est obligatoire. Le second temps de la Jungle (choisir la destination) l'est aussi, une fois la troupe choisie. Un effet sans cible possible est sauté automatiquement.
2. **« À tout moment » pour les régions.** La vérification a lieu après chaque modification du plateau (pose, défausse, retrait, déplacement), pour les deux joueurs. Un effet peut donc offrir une région, voire la victoire, à l'adversaire (par exemple en révélant sa troupe sous la pile).
3. **Objectif atteint en cours de tour.** La victoire est immédiate et les effets restants ne sont pas résolus.
4. **Fin par blocage.** Le test a lieu au début du tour du joueur qui doit jouer. Ce joueur « met fin à la partie » et perd en cas d'égalité.
5. **Cap'taine.** Le placement supplémentaire suit toutes les règles de pose : il peut capturer un Q.G. Les effets des bases spéciales s'appliquent ensuite dans l'ordre des poses, un par troupe posée.
6. **Station Métal-X.** Les mots « Bouclier anti-effet » et « pas appliqués sur ces bases » sont pris dans les deux sens. (a) Une troupe posée sur une base bouclier ne déclenche pas son effet ; cela vaut aussi pour Crochet, qui doit donc être connecté pour y entrer. (b) Les effets de troupes ne peuvent pas viser une troupe posée sur une base bouclier (Mastok). Les effets de bases d'autres terrains ne sont pas concernés.
7. **XB-42 et Champ de bataille.** Une troupe couchée reste sur le support : XB-42 peut la tirer au hasard.
8. **Plaine des châteaux.** La troupe reprise devient une information publique (`KnownInRack`). L'adversaire, et l'IA adverse, savent qu'elle est sur le support. Idem pour la troupe récupérée au Cimetière.
9. **Variante débutant.** Les bases spéciales deviennent des bases ordinaires. Les restrictions des Q.G. de la piscine restent actives (« le Q.G. n'est pas une base »).
10. **Joker et Piscine.** Le joker n'a pas de valeur. Il n'est accepté sur une base ou un Q.G. à valeurs restreintes que si `allowJoker: true`.
11. **Ordre du support.** Désigner « sans regarder » se fait par numéro d'emplacement. L'emplacement couché est visible des deux joueurs, la troupe uniquement de son propriétaire.

## Information cachée

- Contenu des réserves, tuiles retirées, support adverse : jamais transmis. L'hôte n'envoie au client qu'une `PlayerView`. Le test `Player_views_hide_hidden_tiles_and_determinize_consistently` vérifie qu'aucun identifiant de tuile cachée n'y apparaît, à chaque coup, sur les 8 terrains.
- L'IA ne reçoit qu'une `PlayerView`. Le test `Ai_decision_does_not_depend_on_hidden_opponent_tiles` construit deux parties qui ne diffèrent que par des tuiles cachées et vérifie que l'IA joue le même coup.
