# Higgsfield asset prompts (not yet integrated)

The sandbox this game was built in could not download generated files from Higgsfield, so **no Higgsfield assets are
in the game**: every sprite is still drawn in code (`src/ui/pixel.js`). These prompts keep the existing look so you can
generate the art yourself and swap it in.

Shared style line (append to every prompt):
`16-bit pixel art, limited 16-colour palette, chunky 1px black outline, dim bunker game-show set, warm amber bulb light with hard pixel-stepped shading, transparent background, no text, no logos, original design`

| Asset | Size | Prompt |
|---|---|---|
| Theme icons (12) | 32×32 | one icon per theme: clapperboard (cinema), popcorn + star (pop culture), manga speech bubble, chef hat, coin stack (finance), briefcase (business), basketball+trophy (sports), F1 helmet, hockey stick and puck, music note, newspaper (news), test tube (science) |
| Slot-machine reels | 48×48 | the same 12 icons on a brass slot-reel strip, motion-blur variant |
| Host mascot "The House" | 96×96 | a smug retro game-show host made of a bunker door with a single bulb eye, 4 expressions: neutral, delighted, sneering, shocked |
| Confetti / coin burst | 64×64 sheet | 8-frame sprite sheet of gold coins and paper confetti bursting outward |
| Backgrounds | 390×844 | bunker studio wall, spotlight cone, three variants: calm, tense, jackpot |

How to integrate: export PNGs to `assets/`, then replace the matching entries in `src/ui/pixel.js` with image loaders
(keep the sprite names in `CATEGORY_SPRITES`).
