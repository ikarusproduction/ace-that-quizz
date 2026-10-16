# The House Knows

A mobile-first pixel-art trivia roguelite for 1–4 players. Five questions a round, stakes you choose, a bulb that goes out when you fail, bosses, a crossroads where you bank or push, and bonus cards (two slots per round) that each carry a drawback.

Zero dependencies, no build step. Everything is stored on the device (IndexedDB). The only server piece is the optional online relay (see below).

## Play
```
npm start          # http://localhost:5173 (use your LAN address on a phone)
```
Modes: **Solo run** (3 acts), **Quick run** (1 act), **Versus** (2–4 players, one phone, pass-the-phone gates, attack cards), **Daily** (fixed seed, no cards).

## Themes, variety, languages
- **Theme picker:** before a game, fill 5 slots from 12 themes (science, music, cinema, pop culture, manga, cooking, finance, business, sports, F1, hockey, current affairs) or hit **Random**. Each round draws one question per slot.
- **Current affairs is live news only:** questions carry a `date`; only items from the last 14 days count, and the theme hides itself when fewer than 4 are fresh. Refresh `data/questions/news-live.json` weekly.
- **Variety:** the picker prefers the questions each player has seen least (counted from their saved history), so repeats only come back once the pool is exhausted.
- **Languages:** each player has their own question language (Profile). French ships as a bundled dictionary (machine-drafted by Claude, not yet proofread by a native speaker); other languages use the browser's Translator API or an online service and fall back to English. Answers and stats never depend on the translation.
- **Feel:** synthesized sound effects, vibration, confetti, slot-style reels. Sound and haptics can be switched off in Settings.

## Online (several phones)
GitHub Pages alone cannot link phones; run `node server/relay.js` somewhere (see `docs/ONLINE.md`). Create a room, share the 4-letter code or link.

## Hexes and the waiting game
- **Hex cards** (Ink Blast, Goo Splat, Quake, Blur Out, Flip the Table, Pickpocket, Heist, The Kraken) are played while choosing a stake. Visual hexes can hit a rival's next question (−15% on their win) or yourself (a dare: +20% if you still get it right). Pickpocket, Heist and the Kraken steal chips from a rival (Versus). They use the normal card rarity and reward draft. Reduce motion turns off shaking and shortens ink and goo; nothing flashes.
- **While you wait** (online): a player who is not on turn can solve number sequences, equations, hex/binary hacks, logic puzzles and true-or-fib facts for 2–5 bonus chips (max 10 per round, 40 per game). The host regenerates every puzzle from its seed to judge it, so a phone cannot award itself chips.

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
