# TOURNÉE GÉNÉRALE — Document de conception (v0.1, à valider)

> Jeu de plateau à boire, façon party game, sur téléphone. Chaque joueur joue sur son propre téléphone.
> Mini-jeux de 30 secondes maximum, plateau avec dés, magasin, casino et un Conseil tous les 5 tours.
> Inspirations : party games de plateau (dés, étoiles, mini-jeux), *Je n'ai jamais*, *Piccolo* (cartes défi, règles temporaires), *Galèrapagos* (ressource commune, votes, trahisons).
> Statut : **phase de réflexion**. Rien n'est codé. Chaque section se termine par les points à trancher.

Nom de travail : **Tournée Générale**. Autres pistes : *Gueule de Bois Island*, *Pinte Party*, *Cul Sec Royale*, *L'Île aux Shots*.

---

## 1. Le pitch en 30 secondes

Entre 3 et 8 potes, chacun son téléphone. On lance le dé en **secouant** son téléphone, on avance sur une île de fête peinte à l'aquarelle, on tombe sur des cases bonus, malus ou chelou. Ensuite, tout le monde joue **en même temps** un mini-jeu de 10 à 30 secondes : secouer un fût jusqu'à ce qu'il explose, découper des concombres au doigt, porter un plateau de pintes en penchant le téléphone… Le podium a le droit de **faire boire** les autres. Tous les 5 tours, le **Conseil** : on vote pour maudire quelqu'un.

Le but : finir avec le plus de **Couronnes**. Le moyen : ne pas trop boire, piéger ses potes, flamber au casino.

---

## 2. Les ressources du joueur

| Ressource | Icône | Rôle | Valeur de départ |
|---|---|---|---|
| **Points de vie (PV)** | ❤️ | Ta « sobriété ». **1 PV perdu = 1 gorgée.** | 10 (max 10) |
| **Capsules** | 🪙 | La monnaie : magasin, casino, Couronnes. | 10 |
| **Couronnes** | 👑 | Les points de victoire. Le plus de Couronnes à la fin gagne. | 0 |
| **Objets** | 🎒 | 3 emplacements max. | 0 |

**K.O. (0 PV)** : le joueur « tombe dans les pommes ». Il boit un **gage K.O.** (selon le niveau d'intensité : cul sec, shot, ou 5 gorgées), perd **la moitié de ses capsules**, puis revient à **10 PV**. Le K.O. donne **+10 capsules à celui qui a porté le coup** (prime de chasse).

> Pourquoi des PV et pas juste des gorgées : ça donne un état visible (barre de vie qui descend), du suspense (« il est à 2 PV, on le finit ! ») et une vraie conséquence au K.O. sans éliminer personne de la soirée.

**À trancher :** PV max à 10 ? Gage K.O. ? On garde le vol de la moitié des capsules au K.O. ?

---

## 3. Déroulé d'une partie

- **Durée** : 10, 15 (par défaut) ou 20 tours. Environ 2,5 min par tour, soit **~45 min** pour 15 tours, Conseils compris.
- **Joueurs** : 3 à 8. Un téléphone « hôte » fait l'arbitre ; les autres rejoignent avec un code à 4 lettres ou un QR code.
- **Écran partagé optionnel** : une tablette ou une télé peut afficher le plateau en grand (mode spectateur). Pas obligatoire.

### Un tour

1. **Lancer de dé** (tous en même temps, ~10 s) : on **secoue** le téléphone pour lancer (ou on appuie). On peut d'abord utiliser un objet (dé double, etc.).
2. **Déplacement** (~30 s) : les pions avancent l'un après l'autre en animation rapide, sur tous les écrans. Aux embranchements, le joueur concerné choisit sur son téléphone (5 s, sinon au hasard).
3. **Effet de case** : bonus, malus, événement, magasin, casino… (voir §5).
4. **Mini-jeu** (~45 s avec l'intro) : roue de sélection façon machine à sous, 3 s d'explication animée, compte à rebours, jeu de 10 à 30 s.
5. **Podium et dégâts** (~20 s) : voir §4.
6. **Tous les 5 tours : le Conseil** (voir §7).

### Fin de partie

- **Dernière Tournée** (les 3 derniers tours) : tous les gains et dégâts sont **×2**, les cases rouges deviennent « double malus », musique qui s'accélère.
- **Les Prix Bonus** révélés un par un avec roulement de tambour (+1 Couronne chacun) : *Le Bourreau* (le plus de dégâts infligés), *L'Éponge* (le plus de gorgées bues), *Le Flambeur* (le plus de capsules jouées au casino), *Le Roi des Mini-jeux* (le plus de victoires).
- Classement : Couronnes, puis capsules en cas d'égalité.

**À trancher :** 15 tours par défaut ? On veut un écran partagé TV/tablette dès la première version ?

---

## 4. Récompenses des mini-jeux (le cœur du jeu)

Comme demandé, la récompense est dégressive :

| Place | Dégâts à infliger | Capsules |
|---|---|---|
| 🥇 1er | **3 PV** à un joueur de son choix | +6 |
| 🥈 2e | **2 PV** | +4 |
| 🥉 3e | **1 PV** | +2 |
| Les autres | — | +1 (lot de consolation) |

**Ajustement selon le nombre de joueurs** (sinon à 3 joueurs tout le monde gagne) :
- 3–4 joueurs : seuls le 1er (3 PV) et le 2e (1 PV) frappent.
- 5–8 joueurs : 3 / 2 / 1 comme ci-dessus.

**Ordre des choix : le 3e choisit d'abord, puis le 2e, puis le 1er.** Le vainqueur a le dernier mot et peut finir quelqu'un d'affaibli. Chaque choix prend 8 s max, avec la photo/avatar des cibles et leurs PV.

**Garde-fous anti-acharnement** (règle par défaut, désactivable) :
- Un joueur ne peut pas perdre plus de **5 PV par mini-jeu**. Au-delà, la cible est grisée.
- **Rancune** : si tu as été frappé par quelqu'un, tu infliges **+1 PV** quand tu le frappes en retour au tour suivant.

**Quitte ou Double** (mécanique casino) : après le podium, le 1er peut miser ses 3 dégâts sur un pile-ou-face animé : **6 dégâts ou 0**. Le 2e peut faire de même sur « Plus ou moins » avec une carte.

Égalités : les ex-aequo prennent la même récompense.

**À trancher :** les valeurs de capsules, l'ordre des choix (3e → 1er), la limite de 5 PV, le Quitte ou Double.

---

## 5. Le plateau

### La carte de lancement : « L'Île de la Gueule de Bois »

Une île de fête flottante, la nuit, en aquarelle. Une boucle principale d'environ **48 cases**, avec 3 embranchements et 2 raccourcis. Quatre zones :

1. **Le Port des Soûlards** (départ) : quais, bateaux-bars, mouettes qui volent des capsules.
2. **La Fête Foraine** : le **Casino** et le **Magasin du Raton**.
3. **La Jungle du Conseil** : l'arène du Conseil, des lianes-tyroliennes (raccourcis payants).
4. **Le Volcan à Cocktails** : zone à risque ; il entre en éruption tous les 4 tours et renvoie les pions proches en arrière (ou les propulse en avant, 50/50).

**Le Bar Doré** (où l'on achète une Couronne pour 20 capsules) **change de place** à chaque achat, comme l'étoile des party games. Les joueurs le voient de loin et doivent faire un choix de route.

### Les cases

| Case | Couleur | Fréquence | Effet |
|---|---|---|---|
| **Bonus** | 🔵 bleu | ~35 % | +3 capsules (×2 en Dernière Tournée) |
| **Malus** | 🔴 rouge | ~20 % | −1 PV **ou** −3 capsules, au choix de la roulette |
| **Événement** | 🟢 vert | ~12 % | Tirage d'un événement (liste ci-dessous) |
| **Carte Piccolo** | 🟣 violet | ~8 % | Carte défi ou règle temporaire (voir §6) |
| **Je n'ai jamais** | 🟡 jaune | ~5 % | Mini-tour « Je n'ai jamais » pour tous |
| **Duel** | ⚔️ | ~5 % | Tu défies un joueur en 1 contre 1 sur un micro-jeu de 10 s. Mise : 2 PV ou 5 capsules. |
| **Casino** | 🎰 | 2 cases | Machine à sous, roulette, gratte-gratte (voir §8) |
| **Magasin** | 🛒 | 2 cases (tu peux aussi y entrer en passant) | Le Raton vend 4 objets au hasard |
| **Gueule de Bois** | ☠️ | 2 cases | La case du méchant : grande roue des catastrophes (tout le monde boit 2, tu donnes 10 capsules au dernier, échange de places au hasard…) |
| **Bar Doré** | 👑 | 1 (mobile) | Acheter une Couronne (20 🪙). Tu peux l'acheter **en passant**, sans t'arrêter. |

### Événements (case verte), exemples
- **Happy Hour** : pendant 1 tour, toutes les cases bleues donnent ×3.
- **Tempête** : tous les pions reculent de 3 cases.
- **Le Pickpocket** : tu voles 5 capsules au joueur de ton choix.
- **Échangisme** : tu échanges ta place avec un joueur tiré au hasard.
- **Tournée du Patron** : tout le monde sauf toi perd 1 PV.
- **La Mouette** : une mouette te vole un objet et le donne au dernier du classement.
- **Le Toast** : tout le monde lève son téléphone en même temps (accéléromètre) ; le dernier à le faire perd 1 PV.

### Le dé
- Dé normal : 1 à 6. On **secoue le téléphone** pour le lancer : plus on secoue longtemps, plus le dé tourne à l'écran (c'est purement visuel, le résultat reste aléatoire).
- Dés spéciaux (objets) : double (2d6), triple (3d6), doré (tu choisis de 1 à 10), maudit (1 à 3), « Tout ou Rien » (0 ou 12).

**À trancher :** nom et thème de l'île, nombre de cases, Bar Doré mobile, la case Duel.

---

## 6. Les emprunts aux jeux d'ambiance

### *Piccolo* → cartes violettes et règles temporaires
Quand on tombe sur une case violette, on tire une carte. Deux types :
- **Défi immédiat** : « Imite l'accent du joueur à ta gauche jusqu'au prochain mini-jeu ou perds 2 PV », « Les deux joueurs qui ont le moins de capsules trinquent : 1 gorgée chacun ».
- **Règle temporaire (jusqu'au prochain Conseil)** : « Interdit de dire *boire* », « Interdit de montrer du doigt », « Le joueur X est le Roi des Pouces : le dernier à poser son pouce sur la table quand il le fait boit ».
  - Bouton **« BALANCE ! »** sur chaque téléphone : tu dénonces un joueur qui enfreint la règle. Si au moins la moitié des joueurs confirme dans les 10 s, il perd 1 PV ; sinon c'est le dénonciateur qui le perd.
- Banque de départ : **~150 cartes**, filtrées selon le niveau choisi (soft / normal / hardcore / sans alcool).

### *Je n'ai jamais* → case jaune et ouverture du Conseil
Une phrase s'affiche : « Je n'ai jamais dormi dans une baignoire. » Chacun répond **secrètement** sur son téléphone *Jamais* ou *Déjà*. On révèle d'un coup : ceux qui ont **déjà** perdent 1 PV, et on voit qui. Variante **« Menteur ? »** : les autres peuvent parier 3 capsules qu'un joueur a menti ; il doit raconter, et le groupe vote.
- Banque de départ : **~200 phrases** par niveau.

### *Galèrapagos* → le Conseil (voir §7)
Ressource commune, contributions secrètes, soupçons, vote.

---

## 7. Le Conseil (tous les 5 tours)

Le moment où le groupe se retourne contre quelqu'un. Il dure ~3 minutes, en trois temps.

### 7.1 La Cagnotte du Tonneau (façon *Galèrapagos*)
Le Tonneau commun a soif : il réclame **4 capsules × nombre de joueurs**. Chacun donne **en secret** ce qu'il veut (0 compris), en 15 s.
- **Tonneau rempli** : tout le monde récupère +2 PV, et une **caisse mystère** est tirée au sort entre les contributeurs (plus tu as donné, plus tu as de tickets).
- **Tonneau vide** : tout le monde perd 2 PV, et le vote qui suit est **doublé**.
- Seul le **total** est révélé. On ne sait pas qui a radiné, d'où le débat avant le vote. C'est là que naissent les soupçons.

### 7.2 Le Vote
- 45 s de débat à voix haute, un minuteur sablier à l'écran.
- Vote secret sur son téléphone. Révélation des bulletins un par un, avec suspense.
- Égalité : **duel** de 10 s entre les ex-aequo, le perdant est désigné.
- Objet **Immunité** : on le joue avant la révélation, les votes contre soi sont annulés.

### 7.3 La Sentence
Le désigné fait tourner la **Roue des Sentences** :
- **La Malédiction** : pendant 5 tours, dé maudit (1–3) et −1 PV au début de chaque tour.
- **L'Exil** : téléporté sur l'**Île des Bannis** pendant 2 tours (voir plus bas).
- **Le Cul Sec** (ou gage équivalent selon le niveau).
- **La Taxe** : il donne la moitié de ses capsules au Tonneau du prochain Conseil.
- **Le Bouffon** : pendant 5 tours, les autres peuvent lui donner un ordre chacun par tour.
- **Clémence** (case rare) : il s'en sort et **choisit lui-même** la sentence d'un autre.

### L'Île des Bannis (l'élimination qui n'exclut personne)
Les exilés ne lancent plus le dé mais **jouent toujours les mini-jeux** dans un classement à part. Le meilleur exilé gagne un **sabotage** : il peut piéger une case ou brouiller l'écran d'un joueur au prochain mini-jeu. Revenir de l'exil sur une case au hasard.

### Mode « Survie » (option)
Pour ceux qui veulent une vraie élimination : au Conseil, le désigné est **éliminé** et devient **Fantôme** (il peut encore saboter). Le dernier survivant gagne, quelles que soient les Couronnes.

**À trancher :** les 3 temps du Conseil (Cagnotte, Vote, Sentence) ? L'exil plutôt que l'élimination par défaut ? Le mode Survie en option ?

---

## 8. Le casino et les mécaniques qui rendent accro

**Monnaie virtuelle uniquement.** Aucun argent réel, aucun achat dans l'application.

| Mécanique | Où | Comment ça accroche |
|---|---|---|
| **Machine à sous** (3 rouleaux) | Case casino, 3 🪙 la partie | Effet presque-gagné (le 3e rouleau ralentit sur le jackpot puis le rate), animations, lumières, son |
| **Jackpot progressif** | Visible en permanence en haut de l'écran | +1 🪙 à chaque case rouge de n'importe qui. Il grossit à vue d'œil et tout le monde le surveille. |
| **Roulette** | Case casino | Rouge/Noir (×2), numéro (×10), ou miser des **PV** : « je mise 2 gorgées » |
| **Gratte-gratte** | Magasin, 2 🪙 | On gratte au doigt. Gains instantanés, parfois un objet rare. |
| **Caisses mystère** | Conseil, événements | Rareté Commun / Rare / Épique / Légendaire, avec ouverture en plusieurs étapes et éclat de couleur |
| **Quitte ou Double** | Après chaque podium | Pile ou face sur ses dégâts (voir §4) |
| **Série de victoires** | Mini-jeux | 2 victoires d'affilée : capsules ×1,5 ; 3 d'affilée : objet gratuit. Flamme visible sur l'avatar. |
| **Prime sur le leader** | Plateau | Le 1er au classement porte une prime : qui lui inflige des dégâts gagne +2 🪙 par PV |
| **Happy Hour** | Aléatoire | Multiplicateurs temporaires annoncés avec sirène |
| **Roue de sélection des mini-jeux** | Avant chaque mini-jeu | Rouleau façon machine à sous avec ralenti final |
| **Rattrapage** | Invisible | Le dernier au classement a un peu plus de chances aux caisses mystère et au casino, pour que personne ne décroche |
| **Prix Bonus révélés à la fin** | Fin de partie | Le classement peut basculer jusqu'à la dernière seconde |

Effets « jus » partout : vibration (Android), confettis, pièces qui volent vers le compteur, chiffres qui défilent, ralenti sur les moments décisifs, sons synthétisés.

**À trancher :** on garde le pari en PV à la roulette ? Le rattrapage caché ?

---

## 9. Le Magasin du Raton

Le Raton Fourgueur, un raton laveur louche en gilet de velours. Il propose **4 objets tirés au hasard** (selon leur rareté). Relancer le tirage coûte 2 🪙. Une **promo flash** (−50 %) sur un objet de temps en temps. Inventaire limité à **3 objets**.

### Objets pour soi
| Objet | Prix | Effet |
|---|---|---|
| Double Dé | 5 | Lance 2 dés |
| Triple Dé | 10 | Lance 3 dés |
| Dé Doré | 14 | Tu choisis ton score (1–10) |
| Verre d'Eau | 5 | +3 PV |
| Bouclier Mousse | 8 | Bloque les prochains dégâts reçus |
| Miroir | 12 | Renvoie les prochains dégâts à l'envoyeur |
| Immunité | 15 | Annule les votes contre toi au Conseil |
| Tyrolienne | 10 | Téléporte à 5 cases du Bar Doré |
| Gratte-gratte | 2 | Ticket à gratter immédiat |

### Objets contre les autres
| Objet | Prix | Effet |
|---|---|---|
| Dé Pipé | 6 | Le prochain lancer de la cible sera de 1 à 3 |
| Shot Piégé | 6 | La cible perd 2 PV au début de son prochain tour |
| Mains Baladeuses | 8 | Vole 3 à 10 capsules à la cible |
| Échange | 10 | Échange ta place avec la cible |
| Menottes | 8 | Lie deux joueurs pendant 3 tours : chaque gorgée de l'un est aussi bue par l'autre |
| Sabotage | 7 | Au prochain mini-jeu, l'écran de la cible est éclaboussé d'encre / ses commandes sont inversées 5 s |
| Piège à Case | 5 | Pose un piège invisible sur une case : le prochain qui s'y arrête perd 3 PV |
| Vol de Couronne | 40 | Vole une Couronne (rare, 1 seul exemplaire en jeu à la fois) |

### Objets légendaires (casino et caisses mystère uniquement)
- **Tournée Générale** : tout le monde sauf toi perd 2 PV.
- **Le Grand Chamboule** : toutes les capsules sont redistribuées au hasard.
- **Super Étoile** : invincible pendant 2 tours.

**À trancher :** la liste, les prix, les 3 emplacements d'inventaire.

---

## 10. Les mini-jeux (22 proposés, 15 au lancement)

Règles communes :
- **30 s maximum**, la plupart entre 10 et 20 s.
- **Une seule action à comprendre**, expliquée par une animation de 3 s et une icône (secouer / incliner / glisser / taper / souffler).
- **Tout le monde joue en même temps** sur son téléphone. La même partie est générée pour tous (même graine aléatoire), donc la même chance pour chacun.
- Le score est calculé sur le téléphone et envoyé à l'hôte à la fin : aucun souci de latence réseau.
- Calibration des capteurs au début de la partie (« secoue », « pose le téléphone à plat »), pour que deux téléphones différents restent comparables.

Légende des capteurs : 📳 accéléromètre (secouer) · 🧭 gyroscope (incliner) · 👆 tactile · 🎤 micro

| # | Nom | Capteur | Durée | Comment on joue | Gagnant | Priorité |
|---|---|---|---|---|---|---|
| 1 | **Pression Max** | 📳 | ≤ 15 s | Secoue le téléphone comme un fou : la jauge de pression du fût monte, il se fissure puis **explose** en geyser de mousse. | Le premier à faire exploser son fût | ⭐ lancement |
| 2 | **Concombre Ninja** | 👆 glisser | 20 s | Concombres, citrons, pastèques et olives volent : tranche-les d'un trait. **Ne tranche pas la bouteille** (−5). Combo si plusieurs fruits d'un seul trait. | Meilleur score | ⭐ |
| 3 | **Le Serveur Bourré** | 🧭 | 25 s | Tu portes un plateau de pintes sur un parquet qui tangue : incline le téléphone pour garder l'équilibre. Chaque pinte renversée tombe du plateau. | Le plus de pintes à l'arrivée | ⭐ |
| 4 | **Le Niveau à Bulle** | 🧭 | ≤ 20 s | Garde la bulle au centre du cercle. Le cercle rétrécit et du « vent » la pousse. | Celui qui tient le plus longtemps | ⭐ |
| 5 | **Pile Poil** | 👆 maintenir | 10 s | Maintiens le doigt pour tirer la bière à la pompe et relâche **pile sur le trait** du verre. La mousse continue de monter après le relâchement. | Le plus proche du trait | ⭐ |
| 6 | **Glisse la Mousse** | 👆 lancer | 3 essais | Lance d'une pichenette une chope le long du comptoir : elle doit s'arrêter le plus près possible du bord **sans tomber**. | Meilleure distance | ⭐ |
| 7 | **Santé !** | 📳 réflexe | 3 manches | Téléphone posé. Au signal **« SANTÉ ! »** (après un délai aléatoire), lève-le comme pour trinquer. Faux départ = manche perdue. | Meilleur temps de réaction moyen | ⭐ |
| 8 | **Tire-Bouchon** | 👆 cercles | ≤ 15 s | Fais des cercles avec le doigt le plus vite possible pour déboucher la bouteille. **POP**. | Le premier débouché | ⭐ |
| 9 | **Le Shaker** | 👆 mémoire | 30 s | Le barman montre une suite d'ingrédients (citron, menthe, glaçon…). Refais-la. Elle s'allonge à chaque réussite. | La plus longue suite | ⭐ |
| 10 | **Attrape-Glaçons** | 🧭 | 25 s | Incline pour déplacer ton verre et attraper glaçons et olives. Évite les mouches et les piments. | Meilleur score | ⭐ |
| 11 | **La Statue** | 🧭 immobilité | 20 s | Tiens le téléphone à bout de bras, **parfaitement immobile**, comme une chope pleine à ras bord. Chaque tremblement fait déborder la mousse. Plus dur après quelques verres. | Le moins de mousse renversée | ⭐ |
| 12 | **Le Videur** | 📳 + 🧭 | 25 s | « 1, 2, 3, soleil » en boîte de nuit : secoue pour avancer dans la file pendant que le videur regarde ailleurs, **fige-toi** quand il se retourne. Bougé = retour en arrière. | Le plus avancé | ⭐ |
| 13 | **La Tour de Shots** | 👆 timing | 30 s | Une grue balance un verre à shot : tape pour le lâcher et empile la plus haute tour possible. | La plus haute tour | ⭐ |
| 14 | **Le Sprint du Pochard** | 👆 alterné | 10 s | Tape gauche-droite en alternance le plus vite possible pour courir jusqu'au bar avant la fermeture. | Le premier arrivé | ⭐ |
| 15 | **Dernier Debout** | 👆 maintenir, stop ou encore | ≤ 20 s | Tout le monde maintient le doigt pendant que la cagnotte grossit. Relâche pour **encaisser** ta part. Une bombe explose à un moment aléatoire : ceux encore accrochés perdent tout. | La plus grosse somme encaissée | ⭐ (casino) |
| 16 | **Souffle la Mousse** | 🎤 | 10 s | Souffle dans le micro pour chasser la mousse de ta pinte (ou éteindre des shots enflammés). Variante tactile si le micro est refusé. | Le premier à vider sa mousse | bonus |
| 17 | **Fléchettes Bourrées** | 👆 timing | 3 lancers | Le viseur tangue (tu as trop bu) : tape au bon moment pour lancer. | Meilleur total | bonus |
| 18 | **Cacahuète !** | 👆 lancer | 20 s | D'une pichenette, lance des cacahuètes dans la bouche d'un client qui se balance sur son tabouret. | Le plus de cacahuètes avalées | bonus |
| 19 | **Compte les Chopes** | 👆 perception | 15 s | Une foule de verres défile 3 s. « Combien de mojitos ? » Réponds vite. | Le plus juste et le plus rapide | bonus |
| 20 | **Gratte & Gagne** | 👆 gratter | ≤ 15 s | Gratte ton ticket géant pour trouver les 3 symboles identiques cachés. | Le premier à les trouver | bonus |
| 21 | **DJ Bourré** | 👆 rythme | 20 s | Tape sur les notes au rythme de la musique, qui accélère. | Meilleure précision | bonus |
| 22 | **Dessine-moi un Bretzel** | 👆 tracé | 10 s | Repasse sur la forme (bretzel, verre à pied, capsule) le plus vite et le plus précisément possible. | Score vitesse × précision | bonus |

**Micro-jeux de Duel (case ⚔️, 1 contre 1, 10 s)** : Santé ! (1 manche), Pile Poil, Le Sprint du Pochard, Tire-Bouchon, et **Bras de Fer** (les deux joueurs tapent le plus vite possible, une corde se tire d'un côté ou de l'autre, visible sur les deux écrans).

**Sécurité des téléphones** : aucun jeu ne demande de lancer, retourner ou lâcher le téléphone. Les jeux « secouer » affichent « TIENS BIEN TON TÉLÉPHONE » et coupent au-delà d'une force excessive. Les jeux qui exigent la précision (Statue, Niveau à Bulle) restent courts.

**À trancher :** les 15 du lancement (ceux marqués ⭐), noms, durées. Un jeu à retirer ou une idée à ajouter ?

---

## 11. Niveaux d'intensité et boire responsable

Réglé par l'hôte en début de partie :

| Niveau | 1 PV perdu = | Gage K.O. | Cartes |
|---|---|---|---|
| **Sans alcool** | 1 gage léger (ou juste des points) | Un gage | Soft |
| **Soft** | ½ gorgée | 3 gorgées | Soft |
| **Normal** (défaut) | 1 gorgée | 1 shot | Normal |
| **Hardcore** | 1 gorgée | Cul sec | + cartes osées |

- Écran d'accueil **18+** et rappel de ne pas conduire.
- **Plafond** : un joueur ne peut pas perdre plus de ~8 PV par tour, tous effets confondus.
- **Joker Eau** : une fois par partie, chacun peut convertir un gage en verre d'eau sans pénalité.
- Rappel « Pause eau 💧 » discret à chaque Conseil.

**À trancher :** les correspondances par niveau.

---

## 12. Direction artistique

Ce qu'on vise : **aquarelle peinte à la main posée sur des volumes 3D stylisés** (rendu 2,5D), contours à l'encre au pinceau, grain de papier, coulures de peinture. Esprit série animée peinte, en version festive et colorée.

- **Palette** : magenta chaud, turquoise électrique, or, orange brûlé, sur fond indigo nuit. Les couleurs des cases (bleu, rouge, vert, violet, jaune) restent lisibles d'un coup d'œil.
- **Lumière** : contre-jours néon magenta et turquoise, lanternes chaudes.
- **Interface** : boutons en forme de tickets de fête foraine et d'étiquettes de bouteille, chiffres très gros, typo « peinte au pinceau » (pistes : *Luckiest Guy*, *Bangers* ou *Lilita One* pour les titres, *Nunito* pour le texte).
- **2,5D en pratique** : décors en couches peintes avec parallaxe quand on incline le téléphone (gyroscope), personnages en sprites peints découpés et animés par morceaux (squash & stretch), particules (mousse, confettis, éclaboussures) dessinées en code.

### Personnages jouables (8, originaux)
1. **Gigi Pression** : punk aux cheveux roses, piercing en capsule.
2. **Le Barbu** : barman tatoué, torchon sur l'épaule.
3. **Kévin Néon** : grand dégingandé en survêtement fluo.
4. **Mamie Grenadine** : petite mamie à lunettes de soleil, sac à main plein de flasques.
5. **Gérard la Grenouille** : mascotte grenouille en sweat à capuche.
6. **Diva Mojito** : drag queen glamour, éventail en feuilles de menthe.
7. **Capitaine Rhum** : pirate avec un perroquet qui répète les règles.
8. **Sushi Bot** : petit robot-shaker qui fait des cocktails avec son ventre.

### Personnages non jouables
- **Maître Tonneau** : le présentateur, un tonneau vivant en nœud papillon.
- **Le Raton Fourgueur** : le marchand.
- **La Gueule de Bois** : le méchant, un nuage gris migraineux qui crache des orages.

### Planches de style déjà générées (Higgsfield, `gpt_image_2_6`, 9:16)
Six images test, visibles dans ta galerie Higgsfield : **key art** avec les personnages, **plateau** de l'île, **Pression Max**, **Concombre Ninja**, **Magasin**, **Conseil**. Elles servent à valider l'ambiance, pas à entrer telles quelles dans le jeu.

Ligne de style commune aux prompts :
`Painterly hand-painted watercolor textures over stylized 3D forms, bold ink brush outlines, visible paper grain and paint bleeds, rim lighting in hot magenta and electric teal, saturated punchy colors, 2.5D stylized animation look. No text, no logos.`

**À trancher :** l'ambiance des planches te convient-elle ? Plus sombre ou plus cartoon ? Les 8 personnages ?

---

## 13. Technique (pour la production)

- **Web app (PWA)**, sans installation : on ouvre un lien, on rejoint la salle. Pas d'App Store. Marche sur iPhone et Android.
- **Multijoueur** : réutiliser le relais existant de ce dépôt (`server/relay.js` : salles à code de 4 lettres, téléphone hôte arbitre). Il faudra passer de 4 à **8 joueurs** et ajouter la reconnexion si un téléphone se met en veille.
- **Capteurs** : `DeviceMotionEvent` / `DeviceOrientationEvent`. Sur iPhone, l'autorisation doit être demandée par un bouton (« Activer les capteurs ») dans le salon, et le site doit être en **HTTPS**.
- **Limites connues** : pas de vibration sur iPhone (Safari ne la permet pas). Le micro demande une autorisation, d'où la variante tactile pour Souffle la Mousse. Il faut empêcher la mise en veille de l'écran (Wake Lock).
- **Rendu** : Canvas 2D + images WebP peintes, 60 images/s visées sur un téléphone moyen.
- **Assets Higgsfield** : ce conteneur n'a pas pu télécharger les images (le CDN de Higgsfield est bloqué par le réseau de l'environnement). Pour intégrer les assets en production, il faudra **autoriser l'hôte `d8j0ntlcm91z4.cloudfront.net`** dans les réglages réseau de l'environnement, ou que tu déposes les images dans le dépôt.

**À trancher :** même dépôt que le quiz (`ace-that-quizz`) ou un nouveau dépôt dédié ?

---

## 14. Plan de production proposé (après validation)

1. **Socle jouable** : salon multi-téléphones, plateau simple, dé, cases bleues/rouges, PV et capsules, 3 mini-jeux (Pression Max, Concombre Ninja, Pile Poil), podium et dégâts. On peut tester en soirée dès cette étape.
2. **Plateau complet** : île à 48 cases, embranchements, Bar Doré, magasin, objets, événements, cartes Piccolo, Je n'ai jamais.
3. **15 mini-jeux** du lancement et duels.
4. **Conseil** (Cagnotte, Vote, Sentence, Île des Bannis) et casino (machine à sous, jackpot, roulette, caisses mystère).
5. **Habillage** : assets Higgsfield, animations, sons, Dernière Tournée, Prix Bonus, niveaux d'intensité.
6. **Équilibrage** : parties test, ajustement des prix et des dégâts.

---

## 15. Récapitulatif des décisions à prendre

1. Nom du jeu.
2. PV = 10, 1 PV = 1 gorgée, gage K.O. et perte de la moitié des capsules.
3. Récompenses 3/2/1 (3/1 à 3–4 joueurs), ordre de choix 3e → 1er, limite de 5 PV par mini-jeu, Quitte ou Double.
4. 15 tours par défaut, Dernière Tournée ×2.
5. Le Conseil en trois temps, l'Exil par défaut, le mode Survie en option.
6. Les 15 mini-jeux du lancement.
7. La liste et les prix des objets.
8. Les mécaniques casino retenues (pari en PV, rattrapage caché).
9. La direction artistique d'après les planches.
10. Même dépôt ou nouveau dépôt.
