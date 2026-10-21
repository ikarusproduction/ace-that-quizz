# The House Knows

A mobile-first pixel-art trivia roguelite for 1–4 players. Five questions a round, stakes you choose, a bulb that goes out when you fail, bosses, a crossroads where you bank or push, and bonus cards (two slots per round) that each carry a drawback.

Zero dependencies, no build step. Everything is stored on the device (IndexedDB). The only server piece is the optional online relay (see below).

## Play
```
npm start          # http://localhost:5173 (use your LAN address on a phone)
```
Modes: **Boss Rush** (pick one of ten themed bosses and duel it: health bar, telegraphed moves, heat budget for stakes), **Map run** (a five-layer branching map: contestants, champion, boss, shops, rests, deals, then The House), **Versus** (2–4 players, one phone, pass-the-phone gates, attack cards), **Daily** (fixed seed, no cards).

## Themes, variety, languages
- **Theme picker:** before a game, fill 5 slots from 12 themes (science, music, cinema, pop culture, manga, cooking, finance, business, sports, F1, hockey, current affairs) or hit **Random**. Each round draws one question per slot.
- **Current affairs is live news only:** questions carry a `date`; only items from the last 14 days count, and the theme hides itself when fewer than 4 are fresh. Refresh `data/questions/news-live.json` weekly.
- **Variety:** the picker prefers the questions each player has seen least (counted from their saved history), so repeats only come back once the pool is exhausted.
- **Languages:** each player has their own question language (Profile). French ships as a bundled dictionary (machine-drafted by Claude, not yet proofread by a native speaker); other languages use the browser's Translator API or an online service and fall back to English. Answers and stats never depend on the translation.
- **Feel:** synthesized sound effects, vibration, confetti, slot-style reels. Sound and haptics can be switched off in Settings.

## Online (several phones)
GitHub Pages alone cannot link phones; run `node server/relay.js` somewhere (see `docs/ONLINE.md`). Create a room, share the 4-letter code or link.

## Level, XP and the wardrobe
Every finished game gives XP (more for correct answers, wins, bosses and streaks). Levels run to 50 and unlock titles (free) and wardrobe items. Dust buys portrait frames, backgrounds, colour dyes and costume pieces on the Style tab of the Inventory page. Logic in `src/engine/cosmetics.js`, tests in `tests/cosmetics.test.js`, `tests/e2e/style.py`.

## Adventure

Three adventures are open: **The Archive** (History, below), **The Atlas** (Geography, below) and **The Lab** (Science). The Lab has 100 steps in ten chapters, each with its own animated backdrop (bench, greenhouse, clinic, workshop, observatory, reactor, fear lab, the deep, high orbit, the paradox); the light and hue shift from step to step, and the floating props pop when touched. There are no lesson cards: a step is five questions (seven for a boss) with three hearts, picked by the learning engine (see below). A miss costs a heart and the concept returns once at the end in a different formulation. Hints (two per question, each removes a wrong answer) and a "how sure?" tap are optional and are recorded. Some steps fork into a safe and a risky road (one level harder, 1.5× XP). Every fifth step is a **lab accident** (a couple of hex cards are thrown at you) and every tenth is a **boss** that throws more and nastier hex cards as the fight goes on (slime, ink, blur, quake, and from chapter 3 a flipped table). Tap a card in the air to deflect it; if it lands, wipe the ink, tap the blur, or take the quake. Hexes only affect how the screen looks: they never change an answer, a score or the review schedule, and nothing is timed. First clears pay XP; boss clears also pay a Silver Pack (Gold for step 100). The other two adventures (The Cipher, The Wild) are defined in `src/engine/adventure.js` but closed.

Rules and level building: `src/engine/adventure.js`. The run state machine (hints, confidence, retry, hearts): `src/engine/practice.js`. Screens: `src/ui/screens/adventure.js`, `src/ui/practice.js` (question player and arena), `src/ui/scenes.js` (backdrops). Progress: `profile.adv`.

**The Archive** is the history adventure, built the same way (100 steps, ten chapters of three aspects, a boss every tenth step): The Cradles, The Eternal City, The Long Night, The Rebirth, The Upheaval, The Empires, The World at War, The Cold War, The Wider World, The Modern Age. It is about dates, durations, sequences and causes (which came first, how many years between, which century) and draws from the `history/*` sub-categories listed in `ADVENTURES.history.subs`. About 230 concepts (`arc-*`), unreviewed drafts with no sources; the facts flagged for checking are in the PR.

**The Atlas** is the geography adventure, built like The Lab (100 steps, ten chapters of three aspects, boss every tenth step) but made of numbers: river lengths and the countries they cross, peak heights, lake and ocean depths, landlocked and enclaved countries, city sizes, the highest and lowest points of the US states, deserts, climate records, time zones, continents, the poles and Earth in numbers. Countries, capitals and flags are left to the "while you wait" geography game, so the adventure draws only from the numeric sub-categories listed in `ADVENTURES.geography.subs` (a test fails if a country, capital or flag question slips in).

**The Atlas** (geography adventure) is made of numbers only: river lengths and basins, peaks, depths, borders and enclaves, city sizes, US high and low points, deserts, climate records. Countries, capitals and flags are left to the minigames and never drawn here.

**No quick repeats.** A concept answered right is left alone for 48 hours (`COOLDOWN_MS` in `learning.js`; `recentlySeenIds` in `stats.js` does the same for the classic game and the online lobby). A concept that was missed, or is being relearned, is never held back, so reinforcement can bring it straight back. If a pool is too thin to fill a session without the resting concepts, the least recently asked of them fill the gap instead of leaving the session short.

## Learning engine and Train

`src/engine/learning.js` is a pure, tested module (no storage, no UI, no clock reads). A **concept** is a question family; its three difficulty versions are its formulations.

- **Scheduler** (simplified SM-2 with learning steps): states New, Learning, Relearning, Review, Provisionally mastered. Per concept it keeps last review, due date (UTC epoch ms), interval, ease, successful recalls, streak, lapses, hint-assisted successes, recent errors, per-formulation counts and the wrong answers picked again and again. Credit: independent recall 1, "guess" 0.7, one hint 0.55, two hints 0.3 (no schedule progress), wrong 0. A wrong answer is a lapse that collapses the interval and returns the concept within minutes and again the next day. A success sooner than 4 hours after the last review does not count, so repeating a question cannot build mastery; a late recall earns more growth than an early one. Provisional mastery needs three delayed recalls, a 21-day interval and two formulations; one lapse removes it. It is never a certificate. Every number is in `LEARNING` and can be tuned. **Speed is never used.**
- **Selection** (`selectSession`): overdue and relearning items first, then fragile ones, new concepts at a configurable ratio, occasional maintenance of mastered ones; one appearance per concept per session, category spread, deterministic per seed, graceful with small pools. The formulation rotates (not the one just asked, not one already answered right twice).
- **Train** (menu): Daily Training, Focused Training (subject and subcategory), Weakness Hunter, Mastery Challenge (hardest formulations, no hints, kept in its own history, never certifies), Review Expedition (review, new, contrast and a boss with shared hearts). Feedback shows the answer, the explanation, a note when you keep picking the same wrong answer or were sure and wrong, and "same idea, another angle" from another formulation.
- **Persistence**: `profile.learn` (versioned, cleaned on every read, merged by most recent review when two copies meet). Local to this device and profile; nothing is synced to a cloud. Existing profiles get an empty record and nothing else changes. News questions only count while fresh and any question can carry an `expires` date.
- **Not covered yet**: free-recall (typed) questions, curated misconception data per question (only repeated wrong picks are detected), prerequisite links between concepts, and deeper "learn more" text. Variants are hand-written and unreviewed. A theme with few concepts will repeat; more questions are the real fix.

## Champion's Academy

Elite general-knowledge training, built on the learning engine above (menu: Champion's Academy). Engine: `src/engine/academy.js` (pure, tested). Screen: `src/ui/screens/academy.js`. Facts: `data/academy/` (clues, relations, events). Generator: `node scripts/build-academy.mjs`.

- **Modules**: Daily Knowledge Workout (5, 8 or 10 questions: due reviews, weak spots, something new, one hard question), Rapid Fire (ten questions that get harder, optional timer), Associations (author-work, scientist-discovery, composer-work, artist-work, invention-inventor, figure-period, landmark-country, concept-discipline, both directions), Precision Training (36 questions on frequent confusions, each with its common misconception), Dates and Chronology (event to year, year to event, century, ordering), Progressive Clues (four clues, 4/3/2/1 points), Champion Examination (20 mixed questions, no subject shown, no hints, unseen formulations preferred, report afterwards), and a boss, **The Reigning Champion**, in Boss Rush.
- **Taxonomy**: 15 subjects (`SUBJECTS`) mapped from the bank's categories and subcategories. Selection (`pickBalanced`) takes the learning engine's ranking (due, fragile, new, maintenance), then enforces a per-subject quota from the plan's weights and a minimum number of subjects per session, so large categories cannot crowd out small ones.
- **Plans**: balanced, history and geography, science and nature, arts and culture, language and literature, championship. A plan is only a set of subject weights from 0 to 3; every weight can be changed and is stored with the player.
- **Memory schedule**: Academy answers go through the same scheduler as Train (`learning.js`). Hinted answers earn less credit, and since this release a hinted recall never counts as a delayed recall, so mastery needs unaided recalls on different days and two formulations. A question re-asked straight after a miss is not recorded as a new answer (it teaches, it does not measure).
- **Analytics** (`academyStats`) come only from the stored answers (`profile.acad.answers`, capped at 800, plus the last 80 sessions). Four measures are kept apart: game results (everything), independent recall (no hints), delayed retention (unaided recall at least a day after the concept was last asked), and transfer (a formulation the player had not seen for a concept already known). Below 5 answers a figure is shown as "not enough data". There is no single mastery percentage. Also shown: accuracy by subject, speed with and without the timer, confidence calibration, hint dependence, weakest subcategories, most improved subjects, often-confused answers, due reviews, provisionally mastered concepts and recent activity.
- **Rewards**: XP for the first three Academy sessions of a day, one Bronze Pack per day for a full workout, one Silver Pack per week for a passed examination, and ten achievements (`ACHIEVEMENTS`) for breadth, independent recall, retention across days, transfer and improvement. Competitive scores (Rapid Fire score, clue points) are separate from mastery and never change the schedule.
- **Persistence**: `profile.acad` (versioned, cleaned on read, merged by key when two copies meet), stored beside `profile.learn`; local to this device and profile. Nothing is sent anywhere.
- **Content model**: questions may carry `format` (`trick`, `assoc`, `chrono`), `relation`, `misconception`, `mnemonic`, `hints`, `related`, `source`, `verified` and `expires`. `npm run validate:questions` checks duplicates (near-duplicates as warnings), ambiguous choices, missing explanations, expired content, tricks without a misconception, "verified" without a source, and subject balance. **All new content is an unreviewed draft: no question has a source or a verification date, and none is marked verified.**
- **Not covered yet**: concept maps, drag-to-order timelines, knowledge relics, verified sources and visual questions, free-text answers, per-concept relation links beyond the generated pairs, French for clue puzzles beyond what is in `clues.json`, and a current-affairs pipeline (the few news questions keep their own freshness rule). Subjects with fewer than 30 concepts are listed by the validator.
- **The Reigning Champion** is an original character inspired by the general idea of a quiz-show champion. It is not based on any real person's name or face; the name is one string (`champion` in `src/engine/duel.js`).

## Stakes and difficulty ladders

Every question that is not live news or a tune has three versions: level 1 (coarser or easier, e.g. the year), level 2, and level 3 (precise or harder, e.g. the exact date). The stake you choose picks the level (1× → level 1, 2× → level 2, 3× → level 3) and each stake button shows what it will ask. A boss of tier 3 or more adds one level, and in solo a question you have already answered adds one level the next time (capped at 3).

Ladders live in `data/questions/variants/<category>.json` and are listed under `variantFiles` in `data/questions/index.json`. Each file is a list of families `{ id, ask: {1,2,3}, variants: [{ level, question, choices, answer, explanation }] }`; the original question keeps its own level and the other two are generated as `<id>~<level>`. Only the originals are drawn into rounds. Check a file with `node scripts/check-variants.mjs data/questions/variants/<category>.json`. All variants are hand-written and marked `unreviewed`.

## Hexes, packs and the waiting game
- **Hexes are their own deck**, separate from the bonus cards (Inventory page: Deck, Collection, Packs, Forge). Pick up to 4 for your deck. In a game a streak of 2 earns a common hex drawn from your deck, 4 an uncommon, 6 a rare, 8 a legendary (then every extra even streak). Hold up to 3. Play one per question: before staking on yourself (a dare, +20% if you still answer right) or on a rival (−15% on their win), or steal chips (Pickpocket, Heist, The Kraken, Versus). Shields (Sponge, Wet Cloth, Mirror) catch the next hex played on you. No hexes in the Daily.
- **Starter hexes:** Ink Blast, Goo Splat, Pickpocket, Sponge. The rest unlock from packs, the daily pack, missions, or the Forge (dust from duplicates).
- **Packs:** every finished game earns a Bronze, plus a Silver (win or streak 5) and a Gold (streak 8). Each finished mission (3 per game) is one more Bronze. A free daily pack with a day streak (day 3 silver, day 7 gold). Opening a pack is one page: press and hold the bulb while the phone buzzes harder and harder until it blows, then the cards are dealt side by side (Next turns one, OK leaves). "Open instantly" skips the show, and "Open all" opens every waiting pack on one page. Online, every guest has to tap Ready before the host can start.
- **While you wait (online):** a player who is not on turn solves puzzles for 2–5 bonus chips (max 10 per round, 40 per game). Every 3 right answers fill the prank meter and earn a hex to play live on the player who is answering. The host regenerates every puzzle from its seed and judges every hex, so a phone cannot award itself anything.
- Reduce motion turns off shaking and particles and shortens ink and goo; nothing flashes.

## Test
```
npm test                    # unit tests: engine, learning, scoring, storage, migrations, stats
npm run validate:questions  # content checks
python3 tests/e2e/versus.py # browser smoke test (Python Playwright + Chromium)
python3 tests/e2e/adventure.py && python3 tests/e2e/train.py && python3 tests/e2e/academy.py
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
- Waiting-room mini-game (Versus, online): geography only. A flag is shown and you type the country, or a country is shown and you type its capital. English or French, case, accents, articles and small typos are forgiven (`src/engine/geo.js`, 172 countries; flags are `assets/flags/*.svg` from flag-icons, MIT, see `assets/flags/LICENSE`, about 1.7 MB). Chips: 3, 4 or 6 per right answer by level, capped at 10 per round and 40 per game; the prank meter is unchanged. Engine `src/engine/minigame.js`, UI `src/ui/waitgame.js`.
- **Boss evolution** (solo Boss Rush and Map run): every time you beat a boss it evolves, up to rank IV (Evolved, Ascended, Mythic, Apex). Each rank adds 20% HP, one tier of harder questions (hardest formulations by rank), stronger attacks (plain strikes become surges, guards and twins) and a bigger reward (+25% chips per rank, extra XP and dust). Ranks are saved per profile (`bosses` in the profile meta, merged by max). The House never evolves. Engine `evolveBoss` in `src/engine/duel.js`, persistence in `src/storage/meta.js` and `repo.addXp`.
- **The Plague Doctor** is the medicine boss (anatomy, disease, medicines, medical technology, history of medicine, 36 concepts with three levels each in `data/questions/medicine.json`). It is a normal Medicine & Health category, so it can also be picked as a Versus or Daily theme.
- **The Whispering Hat** is the Harry Potter boss: a talking wizard hat (original art, not any film's design) that asks only about the eight films (cast, crew and music, scenes as shown on screen, spells and creatures, sets and filming locations, the making of), never the books. Its questions live in their own category, `hpfilms` (`data/questions/hpfilms.json`, about 110 concepts with three levels and French), declared private in `BOSS_ROSTER` (`private: true`): no other boss, contestant, champion, theme, Versus or Daily game can draw them, and the Hat draws nothing else (tests in `tests/hat.test.js`). Unreviewed drafts.
- **Bonus slots in a solo run.** Both slots start empty. After every boss you are offered four cards and take up to two: they fill the two slots and stay for the rest of the run (you can still swap among them before any fight). The picks are run-scoped and are not added to your permanent collection.
- **Science Adventure redo**: ten chapters, each a subject with three aspects (matter, life, body and brain, forces and machines, space, electricity-waves-nucleus, mind and method, Earth, frontier technology, the edge of knowledge). Steps 1 to 3 of a chapter draw their new concepts from the first aspect, 4 to 6 from the second, 7 to 9 from the third, and the boss mixes all of them. Difficulty rises twice: the ladder level (steps 1 to 30 easy, 31 to 70 medium, 71 and up hard, risky roads and bosses one more) and the content itself. 90 new concepts (`sci-101` to `sci-190`), each with three formulations.
- **Stakes in the Adventure**: before answering you can stake Safe (an easier formulation of the same concept, 1 point), Standard (2 points) or Bold (a harder one, no hints, 3 points). Points above the standard 2 per question pay bonus XP on the first clear of a step (capped at 8); a safe stake never costs XP. A hint locks the stake. Engine `setStake` in `src/engine/practice.js`.
- E2E: `tests/e2e/duel.py`, `tests/e2e/friends.py` (plus the existing suites).

## Style, prestige and pack-only pieces

Dust prices are steep on purpose (a frame costs 120 to 2,400 dust). A few of the best pieces also need prestige: a level (House Seal 35, Little Crown 20, Ghost 15, The House room 30) or the Science Adventure (Wisps at step 50; The Void and the Orbit room when it is finished). Other pieces cannot be bought at all: Hexed, Hex Field, Hex Dust, Hologram, Gilded and the Hex Field room only drop from hex packs (a bonus card rolled from its own seed, so a pack's hex cards never change; a duplicate turns into dust).

The new **Menu rooms** slot is an animated backdrop for the main menu (pure CSS, honours reduce-motion). The menu also plays a short music-box lullaby (`startMusic('menu')`) once the browser allows sound; it stops when you leave the menu. Boss hexes in the Adventure fly at you as effect emblems (ink blob, goo, quake, blur, flip) that you tap to deflect. A lost bulb is the cracked one, and the one that just broke throws sparks.
