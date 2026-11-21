// Mini-game registry: id (from src/shared/minigames.js) -> play(stage, { seed }) -> { score, display }.
import { play as pression } from './pression.js';
import { play as concombre } from './concombre.js';
import { play as pilepoil } from './pilepoil.js';

export const GAMES = { pression, concombre, pilepoil };
