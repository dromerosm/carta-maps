import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('search metadata, social cards and structured data agree with public routes and CSP', async () => {
  const csp = await readFile('worker/seo-csp.ts', 'utf8');
  const sitemap = await readFile('public/sitemap.xml', 'utf8');
  for (const [file, canonical] of [['index.html', '/'], ['privacy.html', '/privacy']]) {
    const html = await readFile(`public/${file}`, 'utf8');
    assert.ok(html.indexOf('<meta charset="utf-8">') < 1024);
    assert.equal([...html.matchAll(/<title>/g)].length, 1);
    assert.ok(html.includes(`<link rel="canonical" href="https://carta.example.com${canonical}">`));
    assert.ok(sitemap.includes(`<loc>https://carta.example.com${canonical}</loc>`));
    for (const tag of ['description', 'robots', 'twitter:card', 'twitter:image', 'twitter:image:alt']) assert.equal([...html.matchAll(new RegExp(`name="${tag}"`, 'g'))].length, 1, tag);
    for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt']) assert.equal([...html.matchAll(new RegExp(`property="${tag}"`, 'g'))].length, 1, tag);
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(json)['@graph'][0].url, `https://carta.example.com${canonical}`);
    assert.ok(csp.includes(`sha256-${createHash('sha256').update(json).digest('base64')}`), 'CSP must allow the exact generated JSON-LD');
    assert.ok(html.includes('https://carta.example.com/og-image.jpg'));
  }
  const robots = await readFile('public/robots.txt', 'utf8');
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/carta\.example\.com\/sitemap.xml/);
  const image = await readFile('public/og-image.jpg');
  assert.equal(image.readUInt16BE(0), 0xffd8, 'Social card is a JPEG');
  assert.ok(image.length < 300000, 'Social card should remain small enough for previews');
});
