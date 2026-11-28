# 03 — Multijoueur local hors ligne

Objectif : deux téléphones, sans Internet ni serveur, sur un même Wi-Fi, sur le point d'accès mobile de l'un des deux, ou en Bluetooth.

## Modèle : l'hôte fait autorité

```
 Téléphone A (hôte)                                   Téléphone B (client)
 ┌──────────────────────┐   intent {aid, cmd}        ┌──────────────────────┐
 │ GameState complet    │ ◄───────────────────────── │ PlayerView (filtrée) │
 │ RulesEngine.Validate │                            │ prévalidation locale │
 │ RulesEngine.Apply    │ ─────────────────────────► │ joue les GameEvent   │
 └──────────────────────┘   update {seq, aid,        └──────────────────────┘
                                    events, view}
```

* L'hôte possède le seul `GameState` complet. Le client envoie des **intentions** (`Command` + identifiant d'action unique `aid`), jamais des coordonnées ni un état.
* L'hôte valide avec le `RulesEngine`. Un coup illégal est refusé (`rejected {aid, error}`) sans modifier l'état. Un client qui tente de jouer pour l'autre camp est refusé (`NotYourTurn`).
* L'hôte renvoie, pour chaque coup appliqué : le numéro de séquence (`seq` = nombre de commandes appliquées), l'`aid` d'origine, les événements **filtrés pour le client** (tuiles piochées par l'hôte masquées…) et la **vue complète** du client (`PlayerView`).
* Contenu d'une vue : tour, joueur actif, phase et décision en cours, piles du plateau, défausse, régions prises, médailles, son propre support, et les **effectifs** des zones cachées (support et réserve adverses, tuiles retirées). Avec l'historique des événements, cela couvre toutes les informations demandées (tour, joueur actif, action, séquence, pioche, supports, plateau, défausses, médailles, historique).

## Fiabilité

| Situation | Traitement | Test |
|---|---|---|
| Action envoyée deux fois | l'hôte garde les `aid` traités : la seconde n'est pas rejouée et le client reçoit l'état courant | `Duplicate_intent_is_applied_once` |
| Action illégale du client | `rejected` + état inchangé ; JSON invalide ignoré | `Illegal_intents_are_rejected_without_changing_the_state` |
| Messages dans le désordre | `seq ≤ dernier` ignoré ; trou (`seq > dernier + 1`) comblé par la vue complète, sans rejouer les animations manquées | `Stale_and_out_of_order_updates_are_ignored_and_gaps_are_healed` |
| Perte de connexion | ping toutes les 1 s, coupure déclarée après 6 s sans message, des deux côtés | `Intent_lost_during_disconnection_is_resent_after_reconnection` |
| Reconnexion | le client renvoie `hello` avec son `session` ; l'hôte renvoie `welcome` + vue courante ; les intentions non confirmées sont renvoyées (sans doublon grâce aux `aid`) | idem |
| Mauvaise session ou version | `refused {reason}` | `Reconnection_with_another_session_id_is_refused`, `Protocol_version_mismatch_is_refused` |
| Fermeture de l'application hôte | `SaveStore.SaveGame` (écriture atomique) après chaque coup ; au relancement, nouvelle `HostSession` avec le même `sessionId` ; le client se reconnecte | `Host_can_resume_a_saved_game_after_being_closed` |
| Désynchronisation | impossible par construction (le client n'a pas d'état propre), et le client peut demander `resync` | `Full_game_between_two_ais_stays_in_sync` (vue client = vue calculée par l'hôte, à chaque coup) |

## Mode A — Wi-Fi local / point d'accès : implémenté

* **Transport** : TCP, trames préfixées par leur longueur (4 octets), JSON UTF-8. Port de jeu 47778 (`Protocol.DefaultGamePort`), ou un port libre.
* **Découverte automatique** : l'hôte diffuse chaque seconde une balise UDP (port 47777) vers `255.255.255.255` et vers l'adresse de broadcast de chaque interface (utile sur un point d'accès, où le broadcast général est parfois filtré). Le client écoute et liste les parties vues depuis moins de 4 s.
* **Code de partie** : `JoinCode` encode l'IPv4 de l'hôte (et le port s'il n'est pas celui par défaut) en 7 caractères base32 Crockford, affichés `XXX-XXXX`. Il permet de rejoindre même quand la découverte échoue (réseau qui filtre le broadcast, isolation des clients).
* **Testé ici** : en mémoire (perte, doublons, désordre, coupure), en TCP sur boucle locale (partie complète), et par une partie complète entre **deux processus distincts** (`ptt host` / `ptt join`), découverte UDP comprise.
* **Pas encore testé** : sur deux téléphones physiques. Aucun appareil n'est disponible dans cet environnement de développement.

### Points spécifiques Android à faire dans le projet Unity

* Manifest : `INTERNET`, `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE`, `CHANGE_WIFI_MULTICAST_STATE`.
* Pour **recevoir** les broadcasts UDP, beaucoup d'appareils exigent un `WifiManager.MulticastLock` (appel via `AndroidJavaObject`), à acquérir pendant la recherche puis à relâcher.
* Point d'accès mobile : l'hôte peut être le téléphone qui partage la connexion (son IP est en général `192.168.43.1` ou `10.x`) ou un client. L'avion fonctionne si le point d'accès Wi-Fi est activé sans données mobiles.
* Garder l'écran allumé pendant la partie (`Screen.sleepTimeout = SleepTimeout.NeverSleep`) : Android coupe le Wi-Fi des applications en arrière-plan.

### Points spécifiques iOS

* `NSLocalNetworkUsageDescription` obligatoire (iOS 14+), sinon les broadcasts sont silencieusement bloqués. Le broadcast UDP demande en plus l'entitlement `com.apple.developer.networking.multicast`, délivré par Apple sur demande. En attendant, le **code de partie** (connexion TCP directe) fonctionne sans cet entitlement.

## Mode B — Bluetooth Low Energy : à faire, non implémenté

Rien n'est simulé : aucun bouton Bluetooth ne doit apparaître tant que le pont natif n'est pas écrit **et** testé sur appareil.

Conception prévue :

* Plugin Android (Kotlin) : l'hôte expose un service GATT avec deux caractéristiques (écriture client→hôte, notification hôte→client). Le MTU est négocié à 185–512 octets et les trames de `Framing` sont découpées en fragments numérotés. Permissions `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` (Android 12+), et localisation avant Android 12.
* Plugin iOS (Swift, CoreBluetooth) : `CBPeripheralManager` pour l'hôte, `CBCentralManager` pour le client.
* Côté C# : une classe `BleConnection : IConnection`. `HostSession` et `ClientSession` restent inchangées : c'est l'intérêt de l'interface.
* Limites à documenter après tests : débit BLE de quelques ko/s (une vue fait environ 2 à 4 ko, compression possible), appairage non nécessaire en GATT, publicité en arrière-plan limitée sur iOS.

## Mode C — Entraînement solo contre l'IA : implémenté

Voir `AiPlayer` (Facile, Normal, Difficile). Résultats de tournois automatiques dans `06-plan-et-etat.md`.

## Écran de diagnostic

`ptt discover` affiche les adresses locales, les cibles de broadcast, le nombre de balises reçues et les parties trouvées. L'écran de diagnostic Unity reprendra ces mêmes appels (`LocalNetwork`, `DiscoveryBrowser`), plus l'état Bluetooth quand il existera.

## Messages

| type | sens | contenu |
|---|---|---|
| `hello` | C→H | `v`, `name`, `session?`, `lastSeq` |
| `welcome` | H→C | `session`, `side`, `hostName`, `seq`, `view` |
| `refused` | H→C | `reason` (`version`, `session`) |
| `intent` | C→H | `aid`, `cmd` |
| `rejected` | H→C | `aid`, `error` (`RuleError`) |
| `update` | H→C | `seq`, `aid?`, `events[]`, `view` |
| `resync` | C→H | — (réponse : `welcome`) |
| `ping` / `pong` / `bye` | ↔ | — |
