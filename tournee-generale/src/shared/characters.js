// The eight playable characters. Art comes later (Higgsfield); for now a colour and an emoji.
export const CHARACTERS = [
  { id: 'gigi', name: 'Gigi Pression', emoji: '🤘', color: '#ff3d9a', ink: '#5c0b35' },
  { id: 'barbu', name: 'Le Barbu', emoji: '🧔', color: '#ff8a1f', ink: '#5a2a00' },
  { id: 'kevin', name: 'Kévin Néon', emoji: '⚡', color: '#c6f432', ink: '#3a4a00' },
  { id: 'mamie', name: 'Mamie Grenadine', emoji: '👵', color: '#ff4b4b', ink: '#5a0e0e' },
  { id: 'gerard', name: 'Gérard la Grenouille', emoji: '🐸', color: '#2fd38a', ink: '#0b4a2c' },
  { id: 'diva', name: 'Diva Mojito', emoji: '💃', color: '#a65bff', ink: '#2e0d5c' },
  { id: 'capitaine', name: 'Capitaine Rhum', emoji: '🦜', color: '#ffc93c', ink: '#5a4000' },
  { id: 'sushibot', name: 'Sushi Bot', emoji: '🤖', color: '#21d4e8', ink: '#05444d' },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
