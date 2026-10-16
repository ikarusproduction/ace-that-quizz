# Putting the game on your own website (no dedicated server)

The game and its multiplayer relay both run on ordinary PHP web hosting such as OVH.

* The game: `https://<your site>/play/` (static files).
* The relay: `play/api/index.php` (source: `server/php/index.php`). Phones ask it for news about once a second;
  it keeps each room as a small JSON file in `play/api/data/` (blocked from the web, swept after 3 hours).
* The access code: `play/api/config.php` holds only a SHA-256 hash of the code. To change the code, replace the hash
  (`printf '%s' 'new-code' | sha256sum`). An empty hash makes the game open to everyone.
* `play/config.json`: `{ "relay": "/play/api/index.php", "gate": true }` shows the access-code screen first.

Requirements: PHP 7.4+ with `mbstring`, and a web folder PHP can write to. Nothing else.

Honest limits: the code is checked by the relay before any room can be created or joined (10 wrong tries lock an
address out for 10 minutes). The game's files themselves are plain static files, so someone who knows the address could
download them, but they cannot play online without the code. The host's phone is the referee: friends only, not tournaments.
The Node relay (`server/relay.js`, `render.yaml`) is still there if you ever want live connections on a separate host.
