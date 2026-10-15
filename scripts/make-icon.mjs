// Writes icon.svg: the bulb sprite on a charcoal tile (run: node scripts/make-icon.mjs).
import { writeFileSync } from 'node:fs';
import { spriteSvg } from '../src/ui/pixel.js';
const inner = spriteSvg('bulb_on').replace(/^<svg[^>]*>/, '').replace('</svg>', '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges"><rect width="24" height="24" fill="#121314"/><circle cx="12" cy="10" r="9" fill="#e8a33d" opacity="0.18"/><g transform="translate(6 4)">${inner}</g></svg>`;
writeFileSync(new URL('../icon.svg', import.meta.url), svg);
