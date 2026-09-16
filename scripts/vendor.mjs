import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
for (const file of ['leaflet.js', 'leaflet.css']) await copyFile(`node_modules/leaflet/dist/${file}`, `public/vendor/${file}`);
await copyFile('node_modules/leaflet/LICENSE', 'public/vendor/Leaflet-LICENSE.txt');
