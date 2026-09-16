import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function deploymentOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin.`); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
      || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)
      || /(?:^|\.)(?:example\.(?:com|net|org)|localhost|invalid|test)$/.test(host)) {
    throw new Error(`${name} must be a real HTTPS domain without a path, credentials or port.`);
  }
  return url.origin;
}

// Work on an ignored copy so production domains never enter tracked build outputs.
export async function prepareDeployment(root, settings) {
  const site = deploymentOrigin(settings.siteOrigin, 'siteOrigin');
  const author = deploymentOrigin(settings.authorOrigin, 'authorOrigin');
  const output = resolve(root, 'dist/deploy');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(resolve(root, 'public'), resolve(output, 'public'), { recursive: true });
  await cp(resolve(root, 'worker'), resolve(output, 'worker'), { recursive: true });
  const replace = text => text.replace(/carta\.example\.com|example\.com/g, domain => new URL(domain === 'carta.example.com' ? site : author).hostname);
  for (const file of ['public/index.html', 'public/privacy.html', 'public/app.js', 'public/city-roads/pdf-export.mjs', 'public/robots.txt', 'public/sitemap.xml']) {
    const path = resolve(output, file);
    await writeFile(path, replace(await readFile(path, 'utf8')));
  }
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  delete config.$schema;
  config.routes = [{ pattern: new URL(site).hostname, custom_domain: true }];
  config.vars.CONTACT_URL = `${site}/`;
  await writeFile(resolve(output, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');

  // Domain replacement changes both the app bytes and the inline JSON-LD hashes.
  const version = createHash('sha256').update(await readFile(resolve(output, 'public/app.js'))).digest('hex').slice(0, 16);
  const indexPath = resolve(output, 'public/index.html');
  const index = await readFile(indexPath, 'utf8');
  if ([...index.matchAll(/src="\.\/app\.js\?v=[a-f0-9]+"/g)].length !== 1) throw new Error('Expected one versioned app script.');
  await writeFile(indexPath, index.replace(/src="\.\/app\.js\?v=[a-f0-9]+"/, `src="./app.js?v=${version}"`));
  const hashes = [];
  for (const file of ['index.html', 'privacy.html']) {
    const html = await readFile(resolve(output, 'public', file), 'utf8');
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    if (scripts.length !== 1) throw new Error(`Expected one JSON-LD script in ${file}.`);
    JSON.parse(scripts[0][1]);
    hashes.push(`sha256-${createHash('sha256').update(scripts[0][1]).digest('base64')}`);
  }
  await writeFile(resolve(output, 'worker/seo-csp.ts'), `// Generated for this deployment.\nexport const seoScriptHashes = ${JSON.stringify(hashes)} as const;\n`);
  try {
    await cp(resolve(root, '.deployment/og-image.jpg'), resolve(output, 'public/og-image.jpg'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  const settings = process.env.CARTA_SITE_ORIGIN || process.env.CARTA_AUTHOR_ORIGIN
    ? { siteOrigin: process.env.CARTA_SITE_ORIGIN, authorOrigin: process.env.CARTA_AUTHOR_ORIGIN }
    : await readFile(resolve(root, '.deployment/config.json'), 'utf8').then(JSON.parse).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      throw new Error('Copy deployment.example.json to .deployment/config.json and set your domains, or set CARTA_SITE_ORIGIN and CARTA_AUTHOR_ORIGIN.');
    });
  await prepareDeployment(root, settings);
  console.log('Deployment prepared in dist/deploy. Tracked files are unchanged.');
}
