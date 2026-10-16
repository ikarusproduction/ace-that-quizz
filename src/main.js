import { app, boot, register, startRouter, go } from './ui/app.js';
import { menuScreen } from './ui/screens/menu.js';
import { profilesScreen } from './ui/screens/profiles.js';
import { setupScreen } from './ui/screens/setup.js';
import { themesScreen } from './ui/screens/themes.js';
import { onlineScreen } from './ui/screens/online.js';
import { gameScreen } from './ui/screens/game.js';
import { cardsScreen } from './ui/screens/cards.js';
import { rewardsScreen } from './ui/screens/rewards.js';
import { statsScreen } from './ui/screens/stats.js';
import { settingsScreen } from './ui/screens/settings.js';
import { loadConfig, ensureAccess } from './ui/gate.js';

register('menu', menuScreen);
register('profiles', profilesScreen);
register('setup', setupScreen);
register('themes', themesScreen);
register('online', onlineScreen);
register('game', gameScreen);
register('cards', cardsScreen);
register('rewards', rewardsScreen);
register('stats', statsScreen);
register('settings', settingsScreen);

const config = await loadConfig();
app.config = config;
await ensureAccess(document.getElementById('app'), config);
const ok = await boot(document.getElementById('app'));
if (ok) {
  await startRouter('menu');
  // Invite link: ?room=ABCD[&relay=https://server]
  const q = new URLSearchParams(location.search);
  if (/^[A-Za-z]{4}$/.test(q.get('room') ?? '')) go('online', { joinCode: q.get('room').toUpperCase(), relay: q.get('relay') ?? undefined });
  window.__app = app; // handy for debugging and end-to-end tests
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
