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

## Level, XP and the wardrobe
Every finished game gives XP (more for correct answers, wins, bosses and streaks). Levels run to 50 and unlock titles (free) and wardrobe items. Dust buys portrait frames, backgrounds, colour dyes and costume pieces on the Style tab of the Hexes page. Logic in `src/engine/cosmetics.js`, tests in `tests/cosmetics.test.js`, `tests/e2e/style.py`.

## Adventure

One adventure is open for now: **The Lab** (Science), 100 steps in ten chapters, each with its own animated backdrop (bench, greenhouse, clinic, workshop, observatory, reactor, fear lab, the deep, high orbit, the paradox); the light and hue shift from step to step, and the floating props pop when touched. There are no lesson cards: a step is five questions (seven for a boss) with three hearts, picked by the learning engine (see below). A miss costs a heart and the concept returns once at the end in a different formulation. Hints (two per question, each removes a wrong answer) and a "how sure?" tap are optional and are recorded. Some steps fork into a safe and a risky road (one level harder, 1.5× XP). Every fifth step is a **lab accident** (a couple of hex cards are thrown at you) and every tenth is a **boss** that throws more and nastier hex cards as the fight goes on (slime, ink, blur, quake, and from chapter 3 a flipped table). Tap a card in the air to deflect it; if it lands, wipe the ink, tap the blur, or take the quake. Hexes only affect how the screen looks: they never change an answer, a score or the review schedule, and nothing is timed. First clears pay XP; boss clears also pay a Silver Pack (Gold for step 100). The other four adventures (The Archive, The Cipher, The Atlas, The Wild) are defined in `src/engine/adventure.js` but closed.

Rules and level building: `src/engine/adventure.js`. The run state machine (hints, confidence, retry, hearts): `src/engine/practice.js`. Screens: `src/ui/screens/adventure.js`, `src/ui/practice.js` (question player and arena), `src/ui/scenes.js` (backdrops). Progress: `profile.adv`.

## Learning engine and Train

`src/engine/learning.js` is a pure, tested module (no storage, no UI, no clock reads). A **concept** is a question family; its three difficulty versions are its formulations.

- **Scheduler** (simplified SM-2 with learning steps): states New, Learning, Relearning, Review, Provisionally mastered. Per concept it keeps last review, due date (UTC epoch ms), interval, ease, successful recalls, streak, lapses, hint-assisted successes, recent errors, per-formulation counts and the wrong answers picked again and again. Credit: independent recall 1, "guess" 0.7, one hint 0.55, two hints 0.3 (no schedule progress), wrong 0. A wrong answer is a lapse that collapses the interval and returns the concept within minutes and again the next day. A success sooner than 4 hours after the last review does not count, so repeating a question cannot build mastery; a late recall earns more growth than an early one. Provisional mastery needs three delayed recalls, a 21-day interval and two formulations; one lapse removes it. It is never a certificate. Every number is in `LEARNING` and can be tuned. **Speed is never used.**
- **Selection** (`selectSession`): overdue and relearning items first, then fragile ones, new concepts at a configurable ratio, occasional maintenance of mastered ones; one appearance per concept per session, category spread, deterministic per seed, graceful with small pools. The formulation rotates (not the one just asked, not one already answered right twice).
- **Train** (menu): Daily Training, Focused Training (subject and subcategory), Weakness Hunter, Mastery Challenge (hardest formulations, no hints, kept in its own history, never certifies), Review Expedition (review, new, contrast and a boss with shared hearts). Feedback shows the answer, the explanation, a note when you keep picking the same wrong answer or were sure and wrong, and "same idea, another angle" from another formulation.
- **Persistence**: `profile.learn` (versioned, cleaned on every read, merged by most recent review when two copies meet). Local to this device and profile; nothing is synced to a cloud. Existing profiles get an empty record and nothing else changes. News questions only count while fresh and any question can carry an `expires` date.
- **Not covered yet**: free-recall (typed) questions, curated misconception data per question (only repeated wrong picks are detected), prerequisite links between concepts, and deeper "learn more" text. Variants are hand-written and unreviewed. A theme with few concepts will repeat; more questions are the real fix.

## Stakes and difficulty ladders

Every question that is not live news or a tune has three versions: level 1 (coarser or easier, e.g. the year), level 2, and level 3 (precise or harder, e.g. the exact date). The stake you choose picks the level (1× → level 1, 2× → level 2, 3× → level 3) and each stake button shows what it will ask. A boss of tier 3 or more adds one level, and in solo a question you have already answered adds one level the next time (capped at 3).

Ladders live in `data/questions/variants/<category>.json` and are listed under `variantFiles` in `data/questions/index.json`. Each file is a list of families `{ id, ask: {1,2,3}, variants: [{ level, question, choices, answer, explanation }] }`; the original question keeps its own level and the other two are generated as `<id>~<level>`. Only the originals are drawn into rounds. Check a file with `node scripts/check-variants.mjs data/questions/variants/<category>.json`. All variants are hand-written and marked `unreviewed`.

## Hexes, packs and the waiting game
- **Hexes are their own deck**, separate from the bonus cards (Hexes page: Deck, Collection, Packs, Forge). Pick up to 4 for your deck. In a game a streak of 2 earns a common hex drawn from your deck, 4 an uncommon, 6 a rare, 8 a legendary (then every extra even streak). Hold up to 3. Play one per question: before staking on yourself (a dare, +20% if you still answer right) or on a rival (−15% on their win), or steal chips (Pickpocket, Heist, The Kraken, Versus). Shields (Sponge, Wet Cloth, Mirror) catch the next hex played on you. No hexes in the Daily.
- **Starter hexes:** Ink Blast, Goo Splat, Pickpocket, Sponge. The rest unlock from packs, the daily pack, missions, or the Forge (dust from duplicates).
- **Packs:** every finished game earns a Bronze, plus a Silver (win or streak 5) and a Gold (streak 8). Each finished mission (3 per game) is one more Bronze. A free daily pack with a day streak (day 3 silver, day 7 gold). Opening a pack is one page: press and hold the bulb while the phone buzzes harder and harder until it blows, then the cards are dealt side by side (Next turns one, OK leaves). "Open instantly" skips the show, and "Open all" opens every waiting pack on one page. Online, every guest has to tap Ready before the host can start.
- **While you wait (online):** a player who is not on turn solves puzzles for 2–5 bonus chips (max 10 per round, 40 per game). Every 3 right answers fill the prank meter and earn a hex to play live on the player who is answering. The host regenerates every puzzle from its seed and judges every hex, so a phone cannot award itself anything.
- Reduce motion turns off shaking and particles and shortens ink and goo; nothing flashes.

## Test
```
npm test                    # unit tests: engine, learning, scoring, storage, migrations, stats
npm run validate:questions  # content checks
python3 tests/e2e/versus.py # browser smoke test (Python Playwright + Chromium)
python3 tests/e2e/adventure.py && python3 tests/e2e/train.py
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
