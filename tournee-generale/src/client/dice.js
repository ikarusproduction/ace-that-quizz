// A CSS 3D die. spin() while waiting, show(n) to land on a face.
import { h } from './ui.js';

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACE_ROT = { 1: 'rotateX(0deg) rotateY(0deg)', 6: 'rotateY(180deg)', 2: 'rotateY(-90deg)', 5: 'rotateY(90deg)', 3: 'rotateX(-90deg)', 4: 'rotateX(90deg)' };
const TILT = 'rotateX(-18deg) rotateY(24deg)';

export function createDie() {
  const die = h('div', { class: 'die' });
  for (let n = 1; n <= 6; n++) {
    const f = h('div', { class: `face f${n}` });
    for (const p of PIPS[n]) f.append(h('i', { style: { gridRow: String(Math.ceil(p / 3)), gridColumn: String(((p - 1) % 3) + 1) } }));
    die.append(f);
  }
  const scene = h('div', { class: 'dice-scene' }, die);
  let turns = 0;
  return {
    el: scene,
    spin(fast = false) { die.classList.add('spin'); die.classList.toggle('shaking', fast); },
    show(n) {
      die.classList.remove('spin', 'shaking');
      turns += 2;
      die.style.transform = `${TILT} rotateX(${turns * 360}deg) ${FACE_ROT[n]}`;
    },
    idle() { die.classList.remove('spin', 'shaking'); die.style.transform = `${TILT}`; },
  };
}
