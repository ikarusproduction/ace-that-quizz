// Optional access gate. When config.json says {"gate": true, "relay": "https://..."}, the game asks for the
// shared access code and checks it with the game server before anything else loads. The code is remembered on
// this device. (Honest limit: the same server enforces the code for rooms; the static files themselves are not secret.)
import { h, mount } from './dom.js';
import { OnlineSession } from '../net/session.js';

export const ACCESS_KEY = 'thk-access-code';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export async function loadConfig(url = 'config.json') {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return {};
    const j = await res.json();
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

/** Resolves once the visitor is allowed in (or immediately when no gate is configured). */
export async function ensureAccess(root, config) {
  if (!config?.gate || !config.relay) return true;
  const saved = lsGet(ACCESS_KEY);
  if (saved != null) {
    const r = await OnlineSession.checkAccess(config.relay, saved);
    if (r.ok) return true;
    if (r.error !== 'wrong access code') return askCode(root, config, r.error); // server down: say so, don't forget the code
    lsDel(ACCESS_KEY);
  }
  return askCode(root, config, '');
}

function askCode(root, config, firstError) {
  return new Promise((resolve) => {
    let err = firstError;
    let busy = false;
    const input = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', placeholder: 'Access code', 'aria-label': 'Access code', style: { textAlign: 'center' } });
    const msg = h('p.small.red', { role: 'alert' }, err);
    const btn = h('button.btn.primary.block', { type: 'submit' }, 'Enter');
    const submit = async (e) => {
      e.preventDefault();
      if (busy || !input.value.trim()) return;
      busy = true; btn.disabled = true; btn.textContent = 'Checking…';
      const code = input.value.trim();
      const r = await OnlineSession.checkAccess(config.relay, code);
      if (r.ok) { lsSet(ACCESS_KEY, code); resolve(true); return; }
      msg.textContent = r.error === 'wrong access code' ? 'That code is not right.' : r.error;
      busy = false; btn.disabled = false; btn.textContent = 'Enter'; input.select();
    };
    mount(root, h('div.screen', {}, h('div.gate', {},
      h('h1', {}, 'THE HOUSE KNOWS'),
      h('p.small.dim', {}, 'Private game. Enter the access code you were given.'),
      h('form', { onsubmit: submit, class: 'col gap-s' }, input, btn, msg))));
    input.focus?.();
  });
}
