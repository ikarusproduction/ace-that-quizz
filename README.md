# The House Knows

A mobile-first pixel-art trivia roguelite for 1–4 players. Five questions a round, stakes you choose, a bulb that goes out when you fail, bosses, a crossroads where you bank or push, and bonus cards (two slots per round) that each carry a drawback.

Zero dependencies, no build step. Everything is stored on the device (IndexedDB). The only server piece is the optional online relay (see below).

## Play
```
npm start          # http://localhost:5173 (use your LAN address on a phone)
```
Modes: **Boss Rush** (pick one of eight themed bosses and duel it: health bar, telegraphed moves, heat budget for stakes), **Map run** (a five-layer branching map: contestants, champion, boss, shops, rests, deals, then The House), **Versus** (2–4 players, one phone, pass-the-phone gates, attack cards), **Daily** (fixed seed, no cards).

## Themes, variety, languages
- **Theme picker:** before a game, fill 5 slots from 12 themes (science, music, cinema, pop culture, manga, cooking, finance, business, sports, F1, hockey, current affairs) or hit **Random**. Each round draws one question per slot.
- **Current affairs is live news only:** questions carry a `date`; only items from the last 14 days count, and the theme hides itself when fewer than 4 are fresh. Refresh `data/questions/news-live.json` weekly.
- **Variety:** the picker prefers the questions each player has seen least (counted from their saved history), so repeats only come back once the pool is exhausted.
- **Languages:** each player has their own question language (Profile). French ships as a bundled dictionary (machine-drafted by Claude, not yet proofread by a native speaker); other languages use the browser's Translator API or an online service and fall back to English. Answers and stats never depend on the translation.
- **Feel:** synthesized sound effects, vibration, confetti, slot-style reels. Sound and haptics can be switched off in Settings.

## Online (several phones)
GitHub Pages alone cannot link phones; run `node server/relay.js` somewhere (see `docs/ONLINE.md`). Create a room, share the 4-letter code or link.

## Hexes, packs and the waiting game
- **Hexes are their own deck**, separate from the bonus cards (Hexes page: Deck, Collection, Packs, Forge). Pick up to 4 for your deck. In a game a streak of 2 earns a common hex drawn from your deck, 4 an uncommon, 6 a rare, 8 a legendary (then every extra even streak). Hold up to 3. Play one per question: before staking on yourself (a dare, +20% if you still answer right) or on a rival (−15% on their win), or steal chips (Pickpocket, Heist, The Kraken, Versus). Shields (Sponge, Wet Cloth, Mirror) catch the next hex played on you. No hexes in the Daily.
- **Starter hexes:** Ink Blast, Goo Splat, Pickpocket, Sponge. The rest unlock from packs, the daily pack, missions, or the Forge (dust from duplicates).
- **Packs:** every finished game earns a Bronze, plus a Silver (win or streak 5) and a Gold (streak 8). Each finished mission (3 per game) is one more Bronze. A free daily pack with a day streak (day 3 silver, day 7 gold). Opening a pack is a small ritual with sound and particles that grow with rarity.
- **While you wait (online):** a player who is not on turn solves puzzles for 2–5 bonus chips (max 10 per round, 40 per game). Every 3 right answers fill the prank meter and earn a hex to play live on the player who is answering. The host regenerates every puzzle from its seed and judges every hex, so a phone cannot award itself anything.
- Reduce motion turns off shaking and particles and shortens ink and goo; nothing flashes.

## Test
```
npm test                    # 170 unit tests: engine, scoring, storage, migrations, stats
npm run validate:questions  # content checks
python3 tests/e2e/versus.py # browser smoke test (Python Playwright + Chromium)
python3 tests/e2e/online.py # three phones through the relay
```

## Deploy (GitHub Pages)
Push to GitHub, enable Pages → "GitHub Actions". `.github/workflows/deploy.yml` validates, tests, and publishes the repo root.

## Layout
- `data/questions/*.json` — question bank, separate from code. Every question has an explanation and starts `unreviewed`.
- `src/engine` — pure, seeded, serialisable game state machine.
- `src/storage` — IndexedDB/memory adapters, migrations, profiles repo, export/import.
- `src/stats` — statistics and insights derived from the raw answer log.
- `src/ui` — screens, code-drawn pixel sprites, lighting layer, synthesised sound.

## Content notes
- Questions are unreviewed drafts; mark them `"review": "verified"` after a human check.
- **Name That Tune is empty.** Lyrics and recordings are copyrighted: add entries to `data/questions/tunes.json` (see its `_readme`) with licensed `audio` files. Until then that slot uses music questions.
- News questions are dated (`asOf`) and will age.
- Data does not sync across devices; use Settings → Export/Import.


## Solo duels, friends and puzzles (latest)
- Duel engine: `src/engine/duel.js` (bosses, intents, heat, map, deals) with tests in `tests/duel.test.js`; the animated stage is `src/ui/stage.js`, boss art `src/ui/art_bosses.js` (32x32 bodies plus separate moving parts), the part/eye rig is `src/ui/bossrig.js`. The last boss, The House, has three phases (house, roof gone, jester). Boss and House music are WebAudio step sequencers in `src/ui/audio.js`. The title bulb is `src/ui/bulb.js`, pack opening is `src/ui/bulbrite.js`, the Fog focus dial is `src/ui/focus.js`.
- Friends: a friend code per profile, a public stat card on the PHP relay (`/api/friend`, secret-protected), the list stored inside the profile (`friends`). Needs the PHP relay.
- Waiting-room puzzles now include sliding tiles, odd-one-out, shape counting, patterns, light memory and riddles (`src/engine/minigame.js`, `src/ui/waitgame.js`).
- E2E: `tests/e2e/duel.py`, `tests/e2e/friends.py` (plus the existing suites).
