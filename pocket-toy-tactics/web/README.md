# Version web jouable (prototype mobile)

Une seule page HTML autonome (≈ 345 Ko, images comprises) qui se joue au doigt sur téléphone.

* **Moteur** : `src/engine.js`, portage JavaScript fidèle du moteur C# (`Runtime/Rules`). Même générateur aléatoire, même format d'état. `tools/crosscheck.mjs` rejoue 300 parties produites par le C# (`ptt dump`) et compare les états finaux : **0 écart**. Il fait aussi jouer 120 parties aléatoires ou IA contre IA.
* **IA** : `Ai` (Facile, Normal, Difficile), portage d'`AiPlayer.cs`, qui raisonne sur des tirages aléatoires de l'information cachée.
* **Interface** : `src/index.html` + `src/app.js`. Plateau SVG en portrait, retourné pour le joueur rouge. Support tactile, cibles légales en surbrillance, raison affichée quand un placement est impossible. Inspection des piles, effets et décisions guidés, animations (chute, rebond, défausse, médailles, confettis), sons synthétisés, historique.
* **Modes** :
  * contre l'ordinateur ;
  * à deux sur un même téléphone, avec un écran de passage qui cache le support de l'autre joueur ;
  * **deux téléphones** : quand la page est ouverte dans Claude, la partie est un document partagé `games/<CODE>`. Le joueur actif applique son coup avec le moteur local et publie l'état ; l'autre le reçoit en direct.
* **Contenu** : lu depuis `Packages/com.pockettoytactics.core/Content` (les mêmes JSON que le C#). Les illustrations des personnages (`assets/`) ont été générées pour le projet.

## Construire

```bash
python3 web/build.py                       # -> web/dist/index.html
node web/tools/crosscheck.mjs dump.jsonl   # après: dotnet ptt.dll dump --games 30 > dump.jsonl
```

## Limites connues (prototype)

* Le mode deux téléphones passe par Internet (stockage partagé de la page Claude). Ce n'est pas encore le mode hors ligne Wi-Fi ou Bluetooth de l'application native.
* Dans ce mode, l'état complet est stocké dans le document partagé. Le support adverse n'est pas affiché, mais un joueur qui inspecterait le code de la page pourrait le lire : c'est acceptable pour jouer entre amis, pas en compétition.
* Le second joueur doit pouvoir modifier la page : partage avec un accès Éditeur (ou Contributeur dans une organisation).
* Pas de tutoriel interactif ni de musique : seulement des règles illustrées et des bruitages.
