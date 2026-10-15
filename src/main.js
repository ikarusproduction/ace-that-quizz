import { app, boot, register, startRouter } from './ui/app.js';
import { menuScreen } from './ui/screens/menu.js';
import { profilesScreen } from './ui/screens/profiles.js';
import { setupScreen } from './ui/screens/setup.js';
import { gameScreen } from './ui/screens/game.js';
import { cardsScreen } from './ui/screens/cards.js';
import { rewardsScreen } from './ui/screens/rewards.js';
import { statsScreen } from './ui/screens/stats.js';
import { settingsScreen } from './ui/screens/settings.js';

register('menu', menuScreen);
register('profiles', profilesScreen);
register('setup', setupScreen);
register('game', gameScreen);
register('cards', cardsScreen);
register('rewards', rewardsScreen);
register('stats', statsScreen);
register('settings', settingsScreen);

const ok = await boot(document.getElementById('app'));
if (ok) {
  await startRouter('menu');
  window.__app = app; // handy for debugging and end-to-end tests
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
