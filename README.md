# The House Knows

A mobile-first pixel-art trivia roguelite for 1–4 players. Five questions a round, stakes you choose, a bulb that goes out when you fail, bosses, a crossroads where you bank or push, and bonus cards (two slots per round) that each carry a drawback.

Zero dependencies, no build step, no backend. Everything is stored on the device (IndexedDB).

## Play
```
npm start          # http://localhost:5173 (use your LAN address on a phone)
```
Modes: **Solo run** (3 acts), **Quick run** (1 act), **Versus** (2–4 players, one phone, pass-the-phone gates, attack cards), **Daily** (fixed seed, no cards).

## Test
```
npm test                    # 152 unit tests: engine, scoring, storage, migrations, stats
npm run validate:questions  # content checks
python3 tests/e2e/versus.py # browser smoke test (Python Playwright + Chromium)
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
