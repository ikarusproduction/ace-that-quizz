// Talking to the server: a few POSTs up, one Server-Sent Events stream down.
const KEY = 'tg.session';
const base = (() => {
  const meta = new URLSearchParams(location.search).get('server');
  return (meta || '').replace(/\/$/, '');
})();

export function savedSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function saveSession(s) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Pas de connexion au serveur');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const createRoom = (name, character) => post('/api/rooms', { name, character });
export const joinRoom = (code, name, character) => post(`/api/rooms/${encodeURIComponent(code)}/join`, { name, character });

/** Live connection to a room. onState(state, serverNow) on every update. */
export function connect(session, { onState, onStatus, onExpired }) {
  let es = null;
  let closed = false;
  let retry = null;
  const open = () => {
    if (closed) return;
    const url = `${base}/api/rooms/${session.code}/stream?pid=${encodeURIComponent(session.pid)}&token=${encodeURIComponent(session.token)}`;
    es = new EventSource(url);
    es.addEventListener('state', (e) => {
      onStatus?.(true);
      const { now, state } = JSON.parse(e.data);
      onState(state, now);
    });
    es.onerror = async () => {
      onStatus?.(false);
      if (es.readyState === EventSource.CLOSED) {
        // Find out whether the room is gone or it is just the network.
        try {
          const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
          if (r.status === 403 || r.status === 404) { closed = true; onExpired?.(); return; }
        } catch { /* offline */ }
        clearTimeout(retry);
        retry = setTimeout(open, 1500);
      }
    };
  };
  open();
  const send = (action) => post(`/api/rooms/${session.code}/action`, { pid: session.pid, token: session.token, action });
  return {
    send,
    close() { closed = true; clearTimeout(retry); es?.close(); },
    reopen() { if (!closed && (!es || es.readyState === EventSource.CLOSED)) open(); },
  };
}
