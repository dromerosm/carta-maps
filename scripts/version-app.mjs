import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// HTML is revalidated on each visit. Give it a fresh script URL when the app changes
// so a cached previous version cannot run against new controls.
const app = await readFile(new URL('../public/app.js', import.meta.url));
const version = createHash('sha256').update(app).digest('hex').slice(0, 16);
const path = new URL('../public/index.html', import.meta.url);
const html = await readFile(path, 'utf8');
const script = /src="\.\/app\.js(?:\?v=[a-f0-9]+)?"/g;
if ([...html.matchAll(script)].length !== 1) throw new Error('Expected one Carta app script in index.html');
await writeFile(path, html.replace(script, `src="./app.js?v=${version}"`));
