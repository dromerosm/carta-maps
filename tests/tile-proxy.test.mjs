import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, platform: 'neutral', format: 'esm', external: ['cloudflare:workers'], write: false });
const tile = (x = 0, release = '20260906_080001_pt') => `/api/tiles/${release}/14/${x}/6101.pbf`;

function fixture(t, { limits = {}, upstream = () => new Response(new Uint8Array([1, 2, 3])) } = {}) {
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: config.vars,
    durableObjects: { SEARCH_CACHE: { className: 'SearchCache', useSQLite: true }, SEARCH_GATE: { className: 'SearchGate', useSQLite: true } },
    ratelimits: Object.fromEntries(config.ratelimits.map(({ name, namespace_id, simple }) => [name, { namespace_id, simple: { ...simple, limit: limits[name] ?? simple.limit } }])),
    serviceBindings: { ASSETS: () => new Response('asset fixture') },
    outboundService: async request => {
      calls.push(request);
      if (new URL(request.url).pathname === '/planet') return Response.json({ maxzoom: 14, tiles: ['https://tiles.openfreemap.org/planet/20260906_080001_pt/{z}/{x}/{y}.pbf'] });
      return upstream(request);
    },
  }));
  t.after(() => mf.dispose());
  const get = (path, options = {}) => mf.dispatchFetch(`https://carta.example.com${path}`, {
    ...options, redirect: 'manual',
    headers: { 'CF-Connecting-IP': '198.51.100.1', ...options.headers },
  });
  return { get, calls };
}

test('tile aliases and query strings reuse one canonical cache entry', async t => {
  const { get, calls } = fixture(t);
  const aliases = [
    '/api/tiles/20260906_080001_pt/00/00000/00000.pbf?cache-bust=1',
    '/api/tiles/20260906_080001_pt/0/0/0.pbf',
    '/api/tiles/20260906_080001_pt/0/000/00.pbf?cache-bust=2',
  ];
  for (const path of aliases) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://tiles.openfreemap.org/planet/20260906_080001_pt/0/0/0.pbf');
  assert.equal(calls[0].headers.get('CF-Connecting-IP'), null);
  assert.equal(calls[0].headers.get('Cookie'), null);
});

test('unsupported methods, cross-origin browsers and malformed tiles never reach the provider', async t => {
  const { get, calls } = fixture(t);
  for (const path of [tile(), '/api/tiles/metadata']) {
    for (const method of ['HEAD', 'POST', 'OPTIONS']) {
      const response = await get(path, { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('Allow'), 'GET');
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await get(path, { headers })).status, 403);
  }
  for (const path of ['/api/tiles/https://evil.example/map', tile(16384), tile(-1), '/api/tiles/20260906_080001_pt/99/0/0.pbf']) assert.ok([400, 404].includes((await get(path)).status));
  assert.equal(calls.length, 0);
  assert.equal((await get(tile(), { headers: { Origin: 'https://carta.example.com', 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('nonexistent tiles are briefly cached at the edge, while transient failures can recover', async t => {
  let status = 404;
  const { get, calls } = fixture(t, { upstream: () => new Response('provider detail', { status }) });
  for (const path of [tile(0), tile(0) + '?retry=1', '/api/tiles/20260906_080001_pt/14/00000/06101.pbf']) {
    const response = await get(path);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.doesNotMatch(await response.text(), /provider detail/);
  }
  assert.equal(calls.length, 1);
  status = 410;
  assert.equal((await get(tile(1))).status, 404);
  assert.equal((await get(tile(1))).status, 404);
  assert.equal(calls.length, 2);
  status = 503;
  assert.equal((await get(tile(2))).status, 502);
  status = 200;
  assert.equal((await get(tile(2))).status, 200);
  assert.equal(calls.length, 4, 'A transient provider failure is not a negative tile entry');
});

test('cache misses share a network budget across releases and metadata; cached maps remain available', async t => {
  const { get, calls } = fixture(t, { limits: { TILE_MISS_LIMIT: 3 } });
  for (const path of [tile(0), tile(0, '20250101_000000_pt'), '/api/tiles/metadata']) assert.equal((await get(path)).status, 200);
  const blocked = await get(tile(1, '20200101_000000_pt'));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls.length, 3);
  assert.equal((await get(tile(0) + '?retry=2')).status, 200);
  assert.equal((await get('/api/tiles/metadata')).status, 200);
  assert.equal(calls.length, 3);
  assert.equal((await get(tile(1), { headers: { 'CF-Connecting-IP': '198.51.100.2' } })).status, 200, 'A different network has its own budget');
});

test('the total request budget also stops floods against cached tiles', async t => {
  const { get, calls } = fixture(t, { limits: { TILE_LIMIT: 3 } });
  for (let i = 0; i < 3; i++) assert.equal((await get(tile(0) + `?n=${i}`)).status, 200);
  const response = await get(tile(0));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(calls.length, 1);
});

test('configured budgets allow a maximum-size map and all five layers to reuse its tiles', async t => {
  const { get, calls } = fixture(t);
  assert.equal((await get('/api/tiles/metadata')).status, 200);
  for (let layer = 0; layer < 5; layer++) {
    for (let offset = 0; offset < 160; offset += 4) {
      // Consume each response as it arrives, as the browser loader does.
      // Do not retain live Miniflare response streams across the batch.
      await Promise.all(Array.from({ length: 4 }, async (_, i) => {
        const response = await get(tile(offset + i));
        assert.equal(response.status, 200);
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
      }));
    }
  }
  assert.equal(calls.length, 161, 'Layers reuse geometry without spending another upstream budget');
});

test('redirects and oversized tile bodies are rejected and never cached', async t => {
  let mode = 'redirect';
  const { get, calls } = fixture(t, { upstream: () => mode === 'redirect'
    ? new Response(null, { status: 302, headers: { Location: 'https://evil.example/tile' } })
    : mode === 'oversized'
      ? new Response(new Uint8Array(8 * 1024 * 1024 + 1))
      : new Response(new Uint8Array([1, 2, 3])) });
  assert.equal((await get(tile())).status, 502);
  assert.equal(calls.length, 1, 'Provider redirects are not followed');
  mode = 'oversized';
  assert.equal((await get(tile())).status, 502);
  mode = 'ok';
  assert.equal((await get(tile())).status, 200);
  assert.equal(calls.length, 3);
});
