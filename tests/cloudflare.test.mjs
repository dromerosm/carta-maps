import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, platform: 'neutral', format: 'esm', external: ['cloudflare:workers'], write: false });
let upstreamCalls = [];
let upstreamStatus = 200;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-09-15', compatibilityFlags: ['nodejs_compat'],
  bindings: { BASE_PATH: '', NOMINATIM_ENDPOINT: 'https://nominatim.openstreetmap.org/search', CONTACT_URL: 'https://carta.example.com/' },
  durableObjects: { SEARCH_CACHE: { className: 'SearchCache', useSQLite: true }, SEARCH_GATE: { className: 'SearchGate', useSQLite: true } },
  ratelimits: {
    SEARCH_LIMIT: { namespace_id: '9431827', simple: { limit: 30, period: 60 } },
    TILE_LIMIT: { namespace_id: '9431828', simple: { limit: 1200, period: 60 } },
    TILE_MISS_LIMIT: { namespace_id: '9431829', simple: { limit: 480, period: 60 } },
  },
  serviceBindings: { ASSETS: () => new Response('asset fixture', { headers: { 'Content-Type': 'text/html' } }) },
  outboundService: async request => {
    const url = new URL(request.url);
    upstreamCalls.push({ url, headers: request.headers, at: Date.now() });
    if (url.hostname === 'nominatim.openstreetmap.org') {
      if (upstreamStatus !== 200) return new Response('Busy', { status: upstreamStatus, headers: { 'Retry-After': '2' } });
      return Response.json([{ lat: '41.65', lon: '-0.89', display_name: url.searchParams.get('q'), class: 'place', type: 'city', address: { city: url.searchParams.get('q') } }]);
    }
    if (url.pathname === '/planet') return Response.json({ maxzoom: 14, tiles: ['https://tiles.openfreemap.org/planet/20260906_080001_pt/{z}/{x}/{y}.pbf'] });
    return new Response(new Uint8Array([1, 2, 3]));
  },
}));
after(() => mf.dispose());
const request = (path, options) => mf.dispatchFetch(`https://carta.example.com${path}`, { redirect: "manual", ...options });
const search = query => request('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://carta.example.com' }, body: JSON.stringify({ query, language: 'es' }) });

test('Cloudflare: security, shared search budget, cache, and fixed tile proxy', async () => {
  let response = await request('/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Location'), null, 'Root hosting must not redirect to itself');
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self' 'sha256-/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  for (const path of ['/robots.txt', '/sitemap.xml', '/og-image.jpg', '/favicon.svg']) assert.equal((await request(path)).status, 200);
  for (const path of ['/.git/config', '/package.json', '/worker/index.ts', '/tests/x', '/other/']) assert.equal((await request(path)).status, 404);
  response = await request('/carta');
  assert.equal(response.status, 404, 'The old subdirectory is not served on the dedicated hostname');
  assert.equal(response.headers.get('Location'), null);
  assert.equal((await request('/api/search')).status, 405);
  assert.equal((await request('/api/search', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await search('x'.repeat(3000))).status, 400);
  assert.equal((await search('<script>')).status, 400);
  assert.equal((await search('')).status, 400);
  const same = await Promise.all(Array.from({ length: 5 }, () => search('Zaragoza')));
  assert.ok(same.every(r => r.status === 200));
  assert.equal(upstreamCalls.length, 1, 'Concurrent identical queries share one provider request');
  assert.equal(upstreamCalls[0].url.searchParams.get('featureType'), 'city');
  assert.equal(upstreamCalls[0].headers.get('CF-Connecting-IP'), null);
  assert.match(upstreamCalls[0].headers.get('User-Agent'), /CartaMaps/);
  const other = await search('Madrid');
  assert.equal(other.status, 429, 'Different queries share the global quota');
  assert.ok(Number(other.headers.get('Retry-After')) >= 1);
  assert.equal((await search('zaragoza')).status, 200);
  assert.equal(upstreamCalls.length, 1, 'Case-normalized results are cached');
  await new Promise(resolve => setTimeout(resolve, 1150));
  const next = await search('Madrid');
  assert.equal(next.status, 200);
  assert.ok(upstreamCalls[1].at - upstreamCalls[0].at >= 1100);
  response = await request('/api/tiles/metadata');
  assert.equal(response.status, 200);
  assert.match((await response.json()).tiles[0], /^\/api\/tiles\//);
  const tilePath = '/api/tiles/20260906_080001_pt/14/8151/6101.pbf';
  response = await request(tilePath);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /immutable/);
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), [1, 2, 3]);
  const calls = upstreamCalls.length;
  await request(tilePath);
  assert.equal(upstreamCalls.length, calls, 'Dated tiles are cached');
  assert.equal((await request('/api/tiles/20260906_080001_pt/14/16384/0.pbf')).status, 400);
  assert.equal((await request('/api/tiles/https://example.org/file')).status, 404);
  await new Promise(resolve => setTimeout(resolve, 1150));
  upstreamStatus = 429;
  assert.equal((await search('Barcelona')).status, 429);
  const beforeBlocked = upstreamCalls.length;
  assert.equal((await search('Valencia')).status, 429);
  assert.equal(upstreamCalls.length, beforeBlocked, 'Provider Retry-After blocks subsequent misses');
});
