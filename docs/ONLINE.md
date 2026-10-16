# Playing on several phones (online mode)

**Short answer:** GitHub Pages alone can't do it, because it only serves static files and can't pass messages
between phones. You need one small always-on server, the **relay** (`server/relay.js`, plain Node 22, no
dependencies). The game itself can stay on GitHub Pages, or be served by the relay too.

## How it works

* One phone **creates a room** and gets a 4-letter code (and a join link). Up to 4 phones can join.
* The **host's phone runs the game**; the other phones send their taps to it and display what it sends back.
* The relay only forwards messages. It knows nothing about the rules, stores nothing on disk, and forgets a room
  3 hours after the last activity.
* Each phone saves **its own player's** answers in its own profile, so your stats keep working. Online games
  can't be resumed after leaving.
* Turns are taken **one player at a time** (like Versus on one phone); waiting phones don't see the question.
* Each player sees questions in **their own language**; the others' phones are unaffected.

**Honest limits.** The host's phone is the referee, and anyone who opens developer tools can read the answers out
of their copy of the question bank. This is for friends in a room, not tournaments. If the host leaves, the room
closes. If a guest goes quiet, the host's game moves on without them after a few seconds (their question counts as a timeout).

## Option A: one server for everything (simplest)

On any machine or host that can run Node 22+ (a small VPS, Render, Railway, Fly.io, your own server):

```bash
node server/relay.js          # http://localhost:8787  (PORT=... to change)
```

Open that address on every phone. The game files and the relay come from the same place, so nothing to configure.
Put it behind HTTPS (a reverse proxy such as Caddy/nginx, or the host's built-in HTTPS). Phones on a home Wi-Fi can
also use `http://<your-computer's-LAN-IP>:8787`.

A ready `Dockerfile` is included: `docker build -t house-knows . && docker run -p 8787:8787 house-knows`.

## Option B: game on GitHub Pages, relay elsewhere

1. Deploy the relay somewhere with HTTPS (see above) and, ideally, lock it to your site:
   `ALLOW_ORIGIN=https://<you>.github.io node server/relay.js`  (`STATIC=0` if you don't want it to serve the game too).
2. Open the game on GitHub Pages → **Online** → type the relay address once (e.g. `https://play.yoursite.com`).
   The address is remembered on that phone. The join link you share carries it, so friends don't have to type it.

> Pages is served over HTTPS, so the relay must be HTTPS too, or browsers will block the connection.

## Option C: your own website

Upload the project folder to your site as-is (it is plain static files), and run the relay next to it as in
Option B, or run Option A and point a subdomain at it.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface |
| `ALLOW_ORIGIN` | `*` | Allowed website origin for browsers |
| `STATIC` | on | `STATIC=0` turns off serving the game files |
| `ROOM_TTL_MIN` | `180` | Minutes an idle room is kept |

## Safety built in

Room codes are 4 letters (no I/O); only the room's members (holding a private token) can read or send; guests can't
send host-only messages; message size is capped; rooms and message rates are limited per address; server code, tests
and docs are never served as static files.
