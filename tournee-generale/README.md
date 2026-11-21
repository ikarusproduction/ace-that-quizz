# Tournée Générale 🍺

Jeu de plateau à boire, façon party game, qui se joue **sur les téléphones** : chacun le sien, 2 à 8 joueurs
(3 ou plus, c'est mieux). On lance le dé en secouant son téléphone, on avance sur l'île, puis tout le monde joue
**en même temps** un mini-jeu de 10 à 20 secondes. Le podium fait boire les autres.

Le document de conception complet (toutes les idées validées, dont celles pas encore codées) est dans
[`docs/GDD.md`](docs/GDD.md).

## Ce que contient ce socle jouable

- **Salon** : une partie = un code de 4 lettres (ou un lien d'invitation). 8 personnages, réglages par l'hôte
  (5, 10, 15 ou 20 tours ; intensité Sans alcool / Soft / Normal / Hardcore).
- **Plateau** : l'île de la Gueule de Bois, 32 cases en boucle. Cases bleues (+3 🪙), rouges (−1 ❤️ ou −3 🪙,
  au hasard) et le **Bar Doré** 👑 : on y achète une Couronne pour 20 🪙 rien qu'en passant dessus, puis il déménage.
- **Dé** : on secoue le téléphone (ou on touche le dé). Tout le monde lance en même temps, puis les pions avancent
  l'un après l'autre, en animation identique sur tous les écrans.
- **3 mini-jeux** :
  - **Pression Max** 🍺 : secouer le téléphone jusqu'à faire exploser le fût. Le premier qui explose gagne.
  - **Concombre Ninja** 🥒 : trancher les fruits au doigt, avec des combos, et surtout pas les bouteilles (−5).
  - **Pile Poil** 🎯 : maintenir pour tirer la bière, relâcher pile sur le trait (la mousse continue de monter).
- **Podium** : 1er = 3 ❤️ à faire perdre à quelqu'un, 2e = 2, 3e = 1 (3/1 à 3–4 joueurs, 3 seul à 2 joueurs).
  Le 3e choisit sa victime d'abord, le vainqueur en dernier. Une même personne ne perd pas plus de 5 ❤️ par
  mini-jeu. Capsules : +6 / +4 / +2, +1 pour les autres.
- **1 ❤️ perdu = 1 gorgée** : le téléphone de la victime affiche « BOIS ! » en plein écran et vibre (Android).
- **K.O.** à 0 ❤️ : le gage K.O. du niveau choisi (shot, cul sec…), moitié des capsules perdue, retour à 10 ❤️,
  et +10 🪙 de prime pour celui qui a porté le coup.
- **Fin** : classement aux Couronnes puis aux capsules, podium et récompenses (L'Éponge, Le Bourreau, Roi des
  mini-jeux, Abonné au K.O.).
- **Robuste en soirée** : si un téléphone se verrouille ou recharge la page, il reprend la partie où elle en est.
  Un joueur absent ne bloque personne (lancer automatique, score absent, choix automatique de la cible : le leader).

Pas encore codé (prévu au GDD) : embranchements, magasin et objets, événements, cartes Piccolo, « Je n'ai
jamais », duels, casino, Conseil, 12 autres mini-jeux, Dernière Tournée, assets Higgsfield.

## Lancer en local

Node 22 ou plus, aucune dépendance.

```bash
npm start            # http://localhost:8787
npm test             # moteur de règles + serveur
```

Sur le même Wi-Fi, les téléphones peuvent ouvrir `http://<IP-de-l-ordi>:8787`. **Attention** : les capteurs de
mouvement (secouer) ne marchent qu'en **HTTPS**. En HTTP local, Pression Max passe en mode « tape comme un fou ».
Pour tester les capteurs, déployez (ci-dessous) ou utilisez un tunnel HTTPS.

## Mettre en ligne

Le serveur sert à la fois le jeu et les parties (un seul processus Node).

- **Render.com** (gratuit) : New + → Blueprint → choisir ce dépôt (`render.yaml`). L'adresse fournie est en HTTPS.
  Le plan gratuit s'endort après 15 min sans visite : la première ouverture prend alors environ une minute.
- **N'importe quel hébergeur Docker** : `docker build -t tournee . && docker run -p 8787:8787 tournee`.
- Variables : `PORT` (8787), `HOST` (0.0.0.0), `ALLOW_ORIGIN` (`*`), `ROOM_TTL_MIN` (240).

Sur iPhone, le jeu demande l'accès aux mouvements au moment où l'on crée ou rejoint une partie (et un bouton
« Activer les capteurs » reste disponible dans le salon et avant Pression Max). L'iPhone ne vibre pas depuis un site web.

## Architecture

```
src/shared/   règles pures, partagées serveur / téléphones (testées)
  game.js       machine à états : lobby → roll → move → intro → play → results → pick ⇄ hit → recap → … → end
  rules.js      tous les chiffres réglables (PV, prix, durées, dégâts par place)
  board.js      l'île : 32 cases, positions, types
  minigames.js  catalogue des mini-jeux (nom, durée, règle)
  characters.js les 8 personnages
server/server.js  arbitre : salles, actions, horloge, flux SSE vers les téléphones
src/client/   le téléphone
  main.js       écrans et déroulé
  board-view.js plateau sur canvas (animations calculées depuis l'horloge du serveur)
  games/        un fichier par mini-jeu : play(stage, { seed }) → { score, display }
  paint.js      aide au rendu « aquarelle » (lavis, bords, grain de papier)
  sensors.js    accéléromètre, permission iOS, écran toujours allumé
  audio.js      sons synthétisés, vibrations
```

Le serveur décide de tout (dés, cases, classement, dégâts). Les mini-jeux tournent sur chaque téléphone avec la
même graine aléatoire (mêmes fruits pour tout le monde) et n'envoient que leur score final : la latence réseau
ne joue pas. Pour ajouter un mini-jeu : une entrée dans `src/shared/minigames.js`, un fichier dans
`src/client/games/`, une ligne dans `src/client/games/index.js`.

## Visuels

Les graphismes actuels sont dessinés en code (lavis aquarelle, contours encrés, grain papier, emojis) en
attendant les assets Higgsfield. L'environnement de développement n'a pas pu télécharger les images générées
(CDN bloqué) ; elles seront intégrées à l'étape « Habillage ».

## Jouer responsable

Réservé aux majeurs. Le mode **Sans alcool** remplace les gorgées par des gages. Buvez de l'eau, et personne ne
prend le volant.
