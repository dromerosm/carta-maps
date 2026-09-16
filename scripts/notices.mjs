import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const packages = new Set(['leaflet']);
for (const entry of ['vector-tile', 'pdf-export', 'print-text']) {
  const result = await build({ entryPoints: [`src/${entry}-entry.mjs`], bundle: true, format: 'esm', write: false, metafile: true, external: ['html2canvas', 'canvg', 'dompurify'] });
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
    if (match) packages.add(match[1]);
  }
}
let text = 'Third-party components bundled with Carta Maps\n\nThe MIT licence for Carta does not replace the notices below. Font licences are stored alongside the font files.\n\n';
for (const name of [...packages].sort()) {
  const directory = path.join('node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  text += `${name} ${pkg.version} (${pkg.license || 'see notice'})\n\n`;
  const files = (await readdir(directory)).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file));
  if (!files.length && name === 'brotli') {
    text += 'The brotli.js npm package declares MIT in package.json and readme.md. Author: Devon Govett. Source: https://github.com/devongovett/brotli.js\nIts decoder source retains the following upstream notice:\n\n';
    text += (await readFile(path.join(directory, 'dec/decode.js'), 'utf8')).split('*/')[0] + '*/\n\n';
    text += await readFile('third-party/Apache-2.0.txt', 'utf8');
    text += '\n\nMIT terms (as declared by the package):\n\n' + (await readFile('LICENSE', 'utf8')).split('Permission is hereby granted')[1].replace(/^/, 'Permission is hereby granted');
    continue;
  }
  if (!files.length && ['fontkit', 'dfa'].includes(name)) {
    text += `${name} declares MIT in package.json and README.md. Author: Devon Govett. The published package does not include a separate copyright notice.\n\nMIT terms:\n\n`;
    text += (await readFile('LICENSE', 'utf8')).split('Permission is hereby granted')[1].replace(/^/, 'Permission is hereby granted') + '\n\n';
    continue;
  }
  if (!files.length) throw new Error(`Missing licence notice: ${name}`);
  for (const file of files) text += `${file}\n\n${await readFile(path.join(directory, file), 'utf8')}\n\n`;
}
await writeFile('public/city-roads/THIRD-PARTY-LICENSES.txt', text);
