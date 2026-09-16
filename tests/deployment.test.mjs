import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareDeployment } from '../scripts/prepare-deployment.mjs';

test('deployment domains update links, exports and CSP without changing repository assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'carta-deployment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['public', 'worker', 'wrangler.jsonc']) await cp(resolve(path), join(root, path), { recursive: true });
  await mkdir(join(root, '.deployment'));
  const privateImage = await readFile('public/og-image.jpg');
  await writeFile(join(root, '.deployment/og-image.jpg'), privateImage);
  const source = await readFile(join(root, 'public/index.html'), 'utf8');
  const output = await prepareDeployment(root, { siteOrigin: 'https://maps.project.dev', authorOrigin: 'https://project.dev/' });
  assert.equal(await readFile(join(root, 'public/index.html'), 'utf8'), source);
  const config = JSON.parse(await readFile(join(output, 'wrangler.jsonc'), 'utf8'));
  const originalConfig = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  assert.equal(config.routes[0].pattern, 'maps.project.dev');
  assert.equal(config.vars.CONTACT_URL, 'https://maps.project.dev/');
  for (const key of ['ratelimits', 'durable_objects', 'migrations', 'assets']) assert.deepEqual(config[key], originalConfig[key]);
  const app = await readFile(join(output, 'public/app.js'), 'utf8');
  const csp = await readFile(join(output, 'worker/seo-csp.ts'), 'utf8');
  for (const file of ['index.html', 'privacy.html', 'app.js', 'city-roads/pdf-export.mjs', 'robots.txt', 'sitemap.xml']) {
    const text = await readFile(join(output, 'public', file), 'utf8');
    assert.ok(text.includes('maps.project.dev'), file);
    assert.ok(!text.includes('carta.example.com'), file);
    if (file.endsWith('.html')) {
      assert.ok(text.includes('https://project.dev/'));
      const json = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
      assert.ok(csp.includes(`sha256-${createHash('sha256').update(json).digest('base64')}`));
    }
  }
  const index = await readFile(join(output, 'public/index.html'), 'utf8');
  assert.ok(index.includes(`app.js?v=${createHash('sha256').update(app).digest('hex').slice(0, 16)}`));
  assert.ok(index.includes('https://github.com/dromerosm/carta-maps'));
  assert.ok(index.includes('https://www.openstreetmap.org/copyright'));
  assert.deepEqual(await readFile(join(output, 'public/og-image.jpg')), privateImage);
  await rm(join(root, '.deployment/og-image.jpg'));
  await prepareDeployment(root, { siteOrigin: 'https://maps.project.dev', authorOrigin: 'https://project.dev' });
  assert.deepEqual(await readFile(join(output, 'public/og-image.jpg')), await readFile('public/og-image.jpg'));
});

test('deployment rejects missing, placeholder and unsafe origins before writing output', async () => {
  for (const value of [undefined, '', 'https://carta.example.com', 'https://example.org', 'http://project.dev', 'https://project.dev/path', 'https://user:pass@project.dev', 'https://project.dev:8443', 'https://project.dev/?q=x', 'https://project.dev/#x', 'https://localhost', 'https://[::1]', 'https://foo.test']) {
    await assert.rejects(prepareDeployment('/unused', { siteOrigin: value, authorOrigin: 'https://project.dev' }), /siteOrigin/);
    await assert.rejects(prepareDeployment('/unused', { siteOrigin: 'https://project.dev', authorOrigin: value }), /authorOrigin/);
  }
});
