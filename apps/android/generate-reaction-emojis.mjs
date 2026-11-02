// Run from the repository root after npm install. The checked-in asset works fully offline.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const data = require('@emoji-mart/data');
const categories = { people: 'People', nature: 'Nature', foods: 'Food', activity: 'Activity', places: 'Travel', objects: 'Objects', symbols: 'Symbols', flags: 'Flags' };
const tones = ['', 'light skin tone', 'medium-light skin tone', 'medium skin tone', 'medium-dark skin tone', 'dark skin tone'];
const output = [], seen = new Set();
for (const group of data.categories) for (const id of group.emojis) {
  const emoji = data.emojis[id];
  if (!emoji) continue;
  for (let index = 0; index < emoji.skins.length; index++) {
    const skin = emoji.skins[index];
    if (seen.has(skin.native)) continue;
    seen.add(skin.native);
    const name = emoji.name + (index > 0 ? `, ${tones[index] || 'skin tone variation'}` : '');
    output.push({ emoji: skin.native, name, search: [id.replaceAll('_', ' '), name, ...(emoji.keywords || []), ...(emoji.emoticons || [])].join(' ').toLowerCase(), category: categories[group.id] || group.id });
  }
}
const target = new URL('./app/src/main/assets/', import.meta.url);
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(new URL('reaction-emojis.json', target), JSON.stringify(output));
fs.writeFileSync(new URL('reaction-emojis-LICENSE.txt', target), 'Generated from @emoji-mart/data 1.2.1. Unicode emoji characters are rendered by the device.\n\n' + fs.readFileSync(new URL('../../node_modules/@emoji-mart/data/LICENSE', import.meta.url), 'utf8'));
console.log(`${output.length} searchable Unicode emoji variants generated.`);
