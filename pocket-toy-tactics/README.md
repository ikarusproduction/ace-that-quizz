# Pocket Toy Tactics

Jeu mobile de placement tactique au tour par tour pour 2 joueurs (un téléphone chacun, sans Internet), inspiré des mécaniques de *Toy Battle* (Repos Production). L'univers est original : personnages, noms et terrains sont propres au projet.

> **État actuel : phases 1 et 2 (moteur) et cœur réseau Wi-Fi.** Le moteur de règles, les 8 troupes, 8 terrains originaux, l'IA à 3 niveaux, le protocole réseau local (TCP + découverte UDP + code de partie + reconnexion) et la sauvegarde sont écrits et couverts par 119 tests automatisés. **Il n'y a pas encore de projet Unity, de 3D, d'audio, de Bluetooth ni d'APK.** Le détail est dans [`docs/06-plan-et-etat.md`](docs/06-plan-et-etat.md).

## Démarrage rapide (sans Unity)

Prérequis : .NET SDK 8.

```bash
cd dotnet/Tests && dotnet test                       # 119 tests
cd ../Cli && dotnet build -c Release
dotnet bin/Release/net8.0/ptt.dll terrains           # liste des terrains
dotnet bin/Release/net8.0/ptt.dll play --terrain castle_plain --red normal
dotnet bin/Release/net8.0/ptt.dll simulate --blue hard --red normal --games 10
```

Partie en réseau local, dans deux terminaux ou sur deux machines du même Wi-Fi :

```bash
ptt host --terrain volcano_jungle --name Table     # affiche un code, ex. 300-00G2
ptt join                                           # découverte automatique
ptt join 300-00G2                                  # ou par code
ptt discover                                       # diagnostic réseau
```

## Organisation

```
Packages/com.pockettoytactics.core/   package Unity (C# pur, aucune dépendance UnityEngine)
  Runtime/Rules    règles, état, vue filtrée par joueur, sérialisation
  Runtime/Content  définitions et chargement des données
  Runtime/AI       IA (déterminisation de l'information cachée)
  Runtime/Net      sessions hôte/client, TCP, découverte UDP, code de partie
  Runtime/Save     sauvegarde locale et paramètres
  Content/         troops.json, terrains/*.json   ← modifiables sans recompiler
dotnet/Core        compile le package en bibliothèque .NET (C# 9, comme Unity 6)
dotnet/Tests       tests xUnit
dotnet/Cli         client texte « ptt »
tools/             validation et rendu des terrains
docs/              analyse des règles, architecture, réseau, terrains, DA, plan
```

Dans Unity 6 : *Package Manager → Add package from disk…* → `Packages/com.pockettoytactics.core/package.json`.

## Modifier le contenu

* **Renommer un personnage ou changer un effet** : `Content/troops.json` (nom, réplique, couleur, force, capacité parmi celles du moteur).
* **Ajouter un terrain** : copier un fichier de `Content/terrains/`, puis lancer `python3 tools/terrain_tool.py validate` et `render docs/terrains`.
* **Régler l'IA** : poids publics de `AiEvaluator`, puis mesurer avec `ptt simulate`.

## Documentation

1. [Analyse des règles et interprétations](docs/01-analyse-regles.md)
2. [Architecture et choix d'Unity 6](docs/02-architecture.md)
3. [Multijoueur local hors ligne](docs/03-reseau.md)
4. [Format et contenu des terrains](docs/04-terrains.md)
5. [Direction artistique, assets, son](docs/05-direction-artistique.md)
6. [Plan et état réel](docs/06-plan-et-etat.md)
