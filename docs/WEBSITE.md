# Putting the game on www.suraki-production.com (private, access code)

Two pieces:

1. **The game pages** live on your site at `https://www.suraki-production.com/play/` (static files, deployed by your
   existing OVH workflow). They are not linked from the site, are marked `noindex`, and ask for the access code.
2. **The game server (relay)** links the phones together. OVH shared hosting cannot run it (it needs Node), so it runs
   on a small separate host (Render free plan via `render.yaml`, or any Node 22 / Docker host).

## Steps
1. Render.com → New → **Blueprint** → choose `ikarusproduction/ace-that-quizz`. When asked, type your **ACCESS_CODE**.
   Note the address it gives you, e.g. `https://house-knows-relay.onrender.com`.
2. In the website repo, edit `public/play/config.json`:
   `{ "relay": "https://house-knows-relay.onrender.com", "gate": true }` and merge the pull request.
3. Give friends `https://www.suraki-production.com/play/` and the access code.

## Honest limits
* The code is checked by the server before anyone can create or join a room, with lock-out after 10 wrong tries.
  The game's own files are plain static files: someone who knows the exact address can still download them, but they
  cannot play online without the code.
* Render's free plan sleeps after ~15 minutes idle; the first visit then takes ~30 s to wake it. Rooms live in memory.
* To change the code: change `ACCESS_CODE` in Render.
