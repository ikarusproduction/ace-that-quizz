// Motion sensors. iOS asks for permission, and only from a tap; Android just works (HTTPS needed).
let granted = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function';
let seenMotion = false;
let tilt = { x: 0, y: 0 };
const listeners = new Set();

export const motionSupported = () => typeof DeviceMotionEvent !== 'undefined';
export const motionNeedsPermission = () => typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function' && !granted;
export const motionSeen = () => seenMotion;
export const getTilt = () => tilt;

/** Call from a tap. Resolves to true when motion can be read. */
export async function requestMotion() {
  if (!motionSupported()) return false;
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      granted = (await DeviceMotionEvent.requestPermission()) === 'granted';
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission().catch(() => {});
      }
    } catch { granted = false; }
  } else granted = true;
  start();
  return granted;
}

const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let started = false;
function start() {
  if (started || !motionSupported()) return;
  started = true;
  window.addEventListener('devicemotion', (e) => {
    const a = e.acceleration;
    const g = e.accelerationIncludingGravity;
    let mag;
    if (a && a.x != null) mag = Math.hypot(a.x, a.y, a.z);
    else if (g && g.x != null) mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    else return;
    if (g && g.x != null) {
      // Tilt in screen terms (portrait): x = right, y = toward the user's feet. Range about -1..1.
      // iOS reports gravity with the opposite sign to Android.
      const k = (IOS ? -1 : 1) / 9.81;
      tilt = { x: clamp(-g.x * k), y: clamp(g.y * k) };
    }
    seenMotion = true;
    const dt = (e.interval && e.interval < 1 ? e.interval : (e.interval || 16) / 1000) || 0.016;
    for (const f of listeners) f({ mag, dt, tilt });
  });
}
start();

const clamp = (v) => Math.max(-1, Math.min(1, v));

/** Subscribe to motion samples { mag (m/s² without gravity), dt (s), tilt }. Returns unsubscribe. */
export function onMotion(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

let wakeLock = null;
export async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeLock) keepAwake(); });
