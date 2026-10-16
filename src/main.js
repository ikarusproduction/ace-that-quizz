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
import { loadConfig, ensureAccess, ACCESS_KEY } from './ui/gate.js';
import { createCloud, cloudAvailable } from './storage/cloud.js';
import { toast } from './ui/components.js';
import { OnlineSession } from './net/session.js';

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
  try { navigator.storage?.persist?.(); } catch { /* ignore */ }
  if (cloudAvailable(config)) {
    const getAccess = () => { try { return localStorage.getItem(ACCESS_KEY) ?? ''; } catch { return ''; } };
    app.cloud = createCloud({ repo: app.repo, base: config.relay, getAccess });
    // A wiped device that still remembers its save code gets its players back automatically.
    const key = app.cloud.key();
    if (key && !(await app.repo.listProfiles()).length) {
      try {
        const sum = await app.cloud.restore(key);
        toast(`Restored ${sum.profilesAdded} players from your save on the site`);
      } catch { /* no save yet, or offline: carry on */ }
    }
    app.cloud.ensureKey();
    app.cloud.start();
  }
  await startRouter('menu');
  // Came back after a reload or a killed tab while in an online room: rejoin it with the same identity.
  const q0 = new URLSearchParams(location.search);
  const saved = /^[A-Za-z]{4}$/.test(q0.get('room') ?? '') ? null : OnlineSession.loadSaved();
  if (saved) {
    try {
      const net = OnlineSession.fromSaved(saved);
      app.online = net;
      net.open();
      await net.ready(9000);
      if (net.latest || net.startInfo) { toast('Back in your game'); go('game', { online: true, resumed: true }); }
      else go('online', {});
    } catch {
      app.online = null;
      OnlineSession.clearSaved();
    }
  }
  // Invite link: ?room=ABCD[&relay=https://server]
  const q = new URLSearchParams(location.search);
  if (/^[A-Za-z]{4}$/.test(q.get('room') ?? '')) go('online', { joinCode: q.get('room').toUpperCase(), relay: q.get('relay') ?? undefined });
  window.__app = app; // handy for debugging and end-to-end tests
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
