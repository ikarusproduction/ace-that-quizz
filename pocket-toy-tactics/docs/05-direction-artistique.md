# 05 — Direction artistique, assets et son

> État : **conception seulement.** Aucun modèle 3D, texture, animation, son ou musique n'a encore été produit. Ce document fixe la cible et le pipeline. La phase 4 ne commencera qu'avec un poste Unity et Blender (ou un générateur 3D) disponible.

## Intention

Des jouets d'une chambre d'enfant qui ont pris vie et jouent à la guerre « pour de faux ». On vise des figurines en plastique des années 80–90 peintes à la main, posées sur des dioramas miniatures, avec la lumière chaude d'une fin d'après-midi. Le ton est familial, comique et tactile, jamais militaire ni sombre.

Palette (tokens) : jaune soleil `#F6C343`, orange corail `#F2845C`, rouge tomate `#E4572E`, bleu ciel `#7EC8E3`, bleu pétrole `#1F6F78`, vert menthe `#A8E6CF`, vert prairie `#6BBF59`, beige sable `#E9D8A6`, crème `#FBF3DF`, violet lavande `#B8A1E3`.
Camps : **Bleu** = bleu ciel et pétrole, socle rond ; **Rouge** = tomate et corail, socle hexagonal. La forme du socle double la couleur, comme le jeu de référence le fait pour les daltoniens.

## Les huit figurines (personnages originaux)

| Mécanique | Nom | Concept | Silhouette lisible à 32 px | Animation signature |
|---|---|---|---|---|
| Force 1, pioche 2 | **Bloup** | petite gelée extraterrestre dans une caisse à jouets trop grande | caisse carrée + antenne-ressort | ouvre la caisse, deux tuiles en jaillissent comme des confettis |
| Force 2, pose supplémentaire | **Sergent Ressort** | soldat de fer-blanc à clé dans le dos | clé géante, sifflet | tourne sa clé, siffle, une seconde tuile saute du support |
| Force 3, défausse adjacente | **Grizzbloc** | ours en peluche massif à gants de boxe | épaules énormes | câlin écrasant : la cible s'aplatit comme une crêpe et part en pirouette vers la défausse |
| Force 4, ignore la connexion | **Zip-Zap** | grenouille à ressort sous les pattes | ressort, yeux globuleux | grand bond en cloche, atterrissage « boing » au-delà des lignes |
| Force 5, défausse au hasard | **Pif-Pof** | robot pistolet à eau | réservoir dorsal, canon | jet d'eau en arc qui détrempe une tuile du support adverse |
| Force 6, pioche 1 | **Paillette** | diva fusée à paillettes | ailerons, lunettes en étoile | pose glamour, pluie de paillettes, une tuile suit comme un fan |
| Force 7, sans effet | **Mamie Brique** | grand-mère faite de briques de construction | silhouette carrée, chignon, sac à main | pose héroïque exagérée, le socle se fissure de fierté |
| Joker | **Caméléo** | caméléon farceur | queue spirale | change de couleur en clignotant, se « transforme » brièvement en la troupe qu'il recouvre |

## Pipeline graphique

1. **Concept** : planches de personnages et de terrains générées à partir des prompts du cahier des charges (6.1 à 6.6), puis retouchées. Ces images servent de **référence**, jamais de texture finale.
2. **Modélisation** (Blender) : modèles low-poly arrondis, 1,5 à 3 k triangles par figurine et 300 triangles par socle de tuile. Les générateurs image→3D ne servent qu'à des ébauches, toujours retopologisées.
3. **Textures** : peintes à la main, atlas 512² par figurine (1024² pour le décor d'un terrain). Les shaders URP « jouet » (Shader Graph) font le reste : léger spéculaire plastique, rim light de sélection et variations de teinte pour les imperfections. Un seul matériau par camp, teinté par la propriété du joueur, ce qui permet le batching.
4. **Rig et animation** : squelette simple de 12 à 20 os et blend shapes pour les expressions. Clips : apparition, placement, capacité, défausse, inactivité, victoire et défaite. Squash & stretch et anticipation dans les clips eux-mêmes, en exagérant les courbes.
5. **Tuiles 3D** : socle arrondi en relief, figurine en ronde-bosse, liseré du camp, ombre de contact (décalcomanie), flottement sinusoïdal sur le support, avancée et rotation à la sélection.
6. **Terrains** : chaque JSON fournit les positions des bases (`x`, `y`) ; un outil d'éditeur Unity (à écrire) génère les socles de bases, les chemins (spline) et les médailles, puis le décor est habillé à la main. Les éléments vivants (nuages, drapeaux, eau, fumée, petites créatures) sont purement décoratifs, désactivables en mode économie d'énergie.
7. **Effets** : Particle System avec pooling (confettis, paillettes, poussière d'impact, éclaboussures), plafonné à environ 200 particules à l'écran.

Budget cible : moins de 150 Mo d'APK (textures ASTC 6×6, audio Vorbis), 60 i/s sur un appareil de 2022 de milieu de gamme, 30 i/s minimum sur les modestes. Trois paliers de qualité URP.

## Interface

UI Toolkit, avec des panneaux crème aux coins très arrondis, de gros boutons à relief doux et une police ronde (par exemple Baloo 2 ou Fredoka, licence OFL). Les icônes (troupes, médailles, Q.G., actions, paramètres) suivent le prompt 6.5 et sont vérifiées à 32 px. Les raisons d'un placement impossible viennent du moteur (`RuleMessages.Fr`). Le surlignage des bases jouables vient de `RulesEngine.LegalTargets`.

## Son

Bruitages originaux à enregistrer ou synthétiser : clics de plastique, ressorts, rebonds, chocs mous, crécelles, pioche (froissement de carton), capture (petite fanfare de jouet), médaille (clochette), victoire et défaite. Musique instrumentale joyeuse : ukulélé, glockenspiel, percussions de bois, synthés chauds. Une boucle par famille de terrains, sans aucune sonorité militaire.
Audio Mixer à trois groupes (musique, effets, ambiance) branchés sur `Settings` (volumes séparés, sourdine).
