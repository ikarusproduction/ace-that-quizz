// Mini-game catalogue shared by the server (which picks one) and the phones (which play it).
// `score` is always "higher is better"; each phone computes it and sends it at the end.
export const MINIGAMES = [
  {
    id: 'pression',
    name: 'Pression Max',
    icon: '🍺',
    sensor: 'Secoue',
    durationMs: 15_000,
    rule: 'Secoue ton téléphone comme un malade pour faire exploser le fût. Le premier qui explose gagne.',
    tip: 'Tiens bien ton téléphone !',
  },
  {
    id: 'concombre',
    name: 'Concombre Ninja',
    icon: '🥒',
    sensor: 'Tranche',
    durationMs: 20_000,
    rule: 'Tranche les fruits d\'un trait de doigt. Plusieurs d\'un coup = combo. Ne touche pas les bouteilles !',
    tip: 'Bouteille tranchée = −5',
  },
  {
    id: 'pilepoil',
    name: 'Pile Poil',
    icon: '🎯',
    sensor: 'Maintiens',
    durationMs: 10_000,
    rule: 'Maintiens le doigt pour tirer la bière, relâche pile sur le trait. Attention, la mousse continue de monter !',
    tip: 'Un seul essai.',
  },
];

export const minigameById = (id) => MINIGAMES.find((m) => m.id === id);
