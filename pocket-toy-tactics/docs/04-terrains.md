# 04 — Terrains : format de données et contenu

## Statut des valeurs

Les 8 terrains livrés sont des **créations originales** (`"layoutSource": "original-design"`). Leur disposition, leurs régions, leurs médailles et leurs objectifs ne prétendent pas reproduire les plateaux physiques : ceux-ci ne figurent pas dans les documents officiels (voir `01-analyse-regles.md`). Chacun porte l'**effet officiel** du terrain de référence. Les valeurs (objectifs, médailles) sont des valeurs de départ à ajuster après des parties réelles.

Pour transcrire un plateau physique : copier un fichier, mettre `"layoutSource": "transcribed-official"`, relever bases, chemins, régions, médailles, objectifs et restrictions, puis lancer l'outil de validation.

## Format (`Packages/com.pockettoytactics.core/Content/terrains/<id>.json`)

```json
{
  "id": "castle_plain",
  "name": "Plaine des Remparts",
  "referenceTerrain": "plaine_des_chateaux",
  "layoutSource": "original-design",
  "flavor": "Les tambours sonnent la retraite.",
  "specialEffect": "recall_own_troop",
  "medalGoal": { "blue": 7, "red": 7 },
  "nodes": [
    { "id": "HB", "type": "hq", "owner": "blue", "x": 0, "y": 3 },
    { "id": "P2", "type": "special", "x": 3.5, "y": 5.5 },
    { "id": "T2", "type": "special", "x": 4, "y": 1, "allowedStrengths": [2, 4, 6], "allowJoker": false }
  ],
  "edges": [["HB", "L1"], ["L1", "L3"]],
  "regions": [{ "id": "r1", "bases": ["L1", "L3", "K1", "P1"], "medals": 2 }]
}
```

| Champ | Rôle |
|---|---|
| `nodes[].type` | `base`, `special` (base spéciale, c'est toujours une base) ou `hq` (pas une base) |
| `owner` | camp d'un Q.G. ; plusieurs Q.G. par camp autorisés (Mer des Caraïbes) |
| `x`, `y` | position sur le plan (unités arbitraires) : sert au rendu 3D et aux aperçus, **jamais aux règles** |
| `edges` | chemins : seule source de l'adjacence (connexion, Mastok, Jungle) |
| `regions[].bases` | bases entourant la région, **dans l'ordre du contour** |
| `medals` | médailles posées au centre de la région |
| `medalGoal` | objectif de médailles par camp (peut différer) |
| `specialEffect` | `none`, `recall_own_troop`, `strength_restriction`, `draw_one`, `move_adjacent_enemy`, `recover_from_discard`, `effect_shield`, `designate_opponent_rack` |
| `allowedStrengths` / `allowJoker` | restrictions de valeurs (bases spéciales de la piscine et Q.G.) |

Contrôles au chargement (`TerrainDefinition.Build`) : identifiants uniques, chemins valides, au moins un Q.G. par camp, régions dont les bases se suivent par des chemins.

## Outil de validation et d'aperçu

```
python3 tools/terrain_tool.py validate          # tous les terrains
python3 tools/terrain_tool.py render docs/terrains
```

L'outil vérifie que le tracé est **planaire** (aucun chemin ne se croise, aucune base posée sur un chemin) et que le graphe est connexe. Il vérifie aussi que chaque région est exactement une **face fermée** du plateau, que le total ne dépasse pas les 16 pions Médaille et que chaque camp a un objectif. Il indique enfin si le plateau est symétrique par rotation de 180° (équité). Le rendu SVG sert de plan de travail aux graphistes.

## Les 8 terrains originaux

| Fichier | Nom | Référence | Bases (spéciales) | Régions | Médailles | Objectif B/R | Particularité de tracé | Aperçu |
|---|---|---|---|---|---|---|---|---|
| `castle_plain` | Plaine des Remparts | Plaine des châteaux | 15 (3) | 8 | 16 | 7/7 | donjon central, deux flancs | [svg](terrains/castle_plain.svg) |
| `tropical_pool` | Lagon des Bouées | Piscine des tropiques | 12 (4) | 6 | 14 | 6/6 | trois couloirs de nage ; bouées 2/4/6 et 1/3/5/7, Q.G. 1–3 | [svg](terrains/tropical_pool.svg) |
| `cloud_city` | Archipel des Nuées | Cité des nuages | 13 (3) | 8 | 16 | 7/7 | anneau à moyeu central | [svg](terrains/cloud_city.svg) |
| `volcano_jungle` | Jungle Glouglou | Jungle volcanique | 12 (2) | 11 | 16 | 7/7 | grand cratère hexagonal à 4 médailles | [svg](terrains/volcano_jungle.svg) |
| `cursed_graveyard` | Cimetière Farceur | Cimetière maudit | 12 (2) | 8 | 16 | 7/7 | allées de cryptes, chemins longs | [svg](terrains/cursed_graveyard.svg) |
| `pirate_sea` | Mer des Flibustiers | Mer des Caraïbes | 11 (0) | 8 | 14 | 8/7 | **asymétrique** : 2 Q.G. bleus, 1 rouge (accessible par 2 chemins seulement) | [svg](terrains/pirate_sea.svg) |
| `metalx_station` | Station Boulon-X | Station Métal-X | 12 (2) | 10 | 16 | 7/7 | noyau central blindé | [svg](terrains/metalx_station.svg) |
| `battlefield` | Champ des Escarmouches | Champ de bataille | 16 (2) | 10 | 16 | 7/7 | tranchées en zigzag, 3 sorties par Q.G. | [svg](terrains/battlefield.svg) |

## Équilibrage mesuré par auto-jeu de l'IA (`ptt simulate`)

Sur les terrains symétriques, il n'y a pas de biais de camp : 203-197 en jeu aléatoire et 144-156 en IA Normale contre Normale (Plaine des Remparts, 300 parties), 155-145 sur le Champ des Escarmouches. Les parties durent 20 à 30 tours et se terminent par l'objectif de médailles ou par la capture de Q.G.

La **Mer des Flibustiers** a été réglée par itérations, uniquement en modifiant ses données :

| Variante | Normal contre Normal (bleu-rouge) | Difficile contre Difficile |
|---|---|---|
| 1er jet (Q.G. rouge relié à I6, I8, I11 ; objectif 7/6) | 22-8 | 21-9 |
| Q.G. rouge relié à I11 seulement, 7/7 | 63-87 | 15-25 |
| idem, objectif 6/7 | 152-48 | 35-25 |
| **retenue : Q.G. rouge relié à I8 et I11, objectif bleu 8 / rouge 7** | **126-74** | **55-45** |

Ce sont des valeurs de départ. Des parties entre humains restent nécessaires pour les confirmer, de même que les objectifs à 7 des autres terrains.
