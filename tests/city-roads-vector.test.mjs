import test from 'node:test';
import assert from 'node:assert/strict';
import { PbfWriter } from 'pbf';
import { tilesForBounds, normalizeBounds, zoomForBounds, countTilesForBounds, MAX_TILES, worldPoint, latLng, clipEdge, decodeRoadEdges, decodeLineEdges, joinRoadEdges, loadOpenFreeMapRoads } from '../public/city-roads/openfreemap.mjs';

function fixture(features, layerName = 'transportation') {
  const tile = new PbfWriter();
  tile.writeMessage(3, (_, layer) => {
    layer.writeVarintField(15, 2);
    layer.writeStringField(1, layerName);
    layer.writeVarintField(5, 4096);
    layer.writeStringField(3, 'class');
    features.forEach(f => layer.writeMessage(4, (_, value) => value.writeStringField(1, f.class), null));
    features.forEach((f, i) => layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, i]);
      feature.writeVarintField(3, f.type ?? 2);
      let x = 0, y = 0;
      const commands = [];
      const zigzag = n => (n << 1) ^ (n >> 31);
      for (const ring of f.rings ?? [f.points]) {
        ring.forEach((p, j) => {
          commands.push(j === 0 ? 9 : 10, zigzag(p[0] - x), zigzag(p[1] - y));
          [x, y] = p;
        });
        if (f.type === 3) commands.push(15);
      }
      feature.writePackedVarint(4, commands);
    }, null));
  }, null);
  return tile.finish();
}

test('tile coverage contains all corners and refuses excessive or invalid areas', () => {
  const bounds = [41.67, -0.94, 41.71, -0.88];
  const tiles = tilesForBounds(bounds);
  for (const lat of [bounds[0], bounds[2]]) for (const lon of [bounds[1], bounds[3]]) {
    const [x, y] = worldPoint(lat, lon, 14).map(v => Math.floor(v / 4096));
    assert.ok(tiles.some(t => t.x === x && t.y === y));
  }
  assert.throws(() => tilesForBounds([-80, -170, 80, 170]), /too many/);
  assert.deepEqual(normalizeBounds([0, 179, 2, -179]), [0, 179, 2, 181]);
  assert.throws(() => tilesForBounds([0, NaN, 2, 4]), /map area/);
});

test('clip crossing lines, drop outside and tangent lines, preserve points on borders', () => {
  assert.deepEqual(clipEdge([-1, 2], [5, 2], [0, 0, 4, 4]), [[0, 2], [4, 2]]);
  assert.equal(clipEdge([-1, 5], [5, 5], [0, 0, 4, 4]), null);
  assert.equal(clipEdge([-1, 1], [1, -1], [0, 0, 4, 4]), null);
  assert.deepEqual(clipEdge([0, 0], [0, 4], [0, 0, 4, 4]), [[0, 0], [0, 4]]);
});

test('decode road lines only, apply major filter and remove tile buffers', () => {
  const data = fixture([
    { class: 'primary', points: [[-32, 1000], [4128, 1000]] },
    { class: 'minor', points: [[200, 200], [400, 400]] },
    { class: 'rail', points: [[300, 300], [500, 500]] },
    { class: 'ferry', points: [[300, 300], [500, 500]] },
    { class: 'minor', type: 3, points: [[400, 400], [600, 600]] },
  ]);
  const tile = { x: 8151, y: 6101, z: 14 };
  const edges = decodeRoadEdges(data, tile, [40, -2, 43, 0]);
  assert.equal(edges.length, 2);
  assert.equal(edges[0][0][0], 8151 * 4096);
  assert.equal(edges[0][1][0], 8152 * 4096);
  assert.equal(decodeRoadEdges(data, tile, [40, -2, 43, 0], 'major').length, 1);
});

test('join tile seams with quantization differences, without joining parallel streets', () => {
  const edges = [
    [[4000, 900], [4096, 1000.2], { x: 0, y: 0, kind: 'minor' }],
    [[4096, 1000.7], [4200, 1100], { x: 1, y: 0, kind: 'minor' }],
    [[4000, 920], [4096, 1020], { x: 0, y: 0, kind: 'minor' }],
    [[4096, 1020], [4200, 1120], { x: 1, y: 0, kind: 'minor' }],
  ];
  const result = joinRoadEdges(edges, 14);
  assert.equal(result.segments.length, 2);
  assert.equal(result.joinedSeams, 2);
  assert.equal(result.seamEnds, 0);
  assert.ok(result.segments.every(s => s.length === 3));
});

test('deduplicate reversed geometry, retain junctions and closed rings', () => {
  const result = joinRoadEdges([[[10, 10], [20, 20]], [[20, 20], [10, 10]], [[20, 20], [30, 30]], [[20, 20], [30, 10]], [[50, 50], [60, 60]], [[60, 60], [70, 50]], [[70, 50], [50, 50]]], 14);
  assert.equal(result.duplicateEdges, 1);
  assert.equal(result.uniqueEdges, 6);
  assert.equal(result.segments.length, 4);
  assert.ok(result.segments.some(s => JSON.stringify(s[0]) === JSON.stringify(s.at(-1))));
});

const bounds = [41.690, -0.910, 41.695, -0.905];
const metadata = { tiles: ['https://example.test/{z}/{x}/{y}.pbf'], maxzoom: 14 };

test('loader reports progress and returns finite lat/lon geometry', async () => {
  const data = fixture([{ class: 'primary', points: [[0, 0], [4096, 4096]] }]);
  const progress = [];
  const result = await loadOpenFreeMapRoads({ bounds, metadata, onProgress: p => progress.push(p.completed), fetchImpl: async () => new Response(data) });
  assert.equal(progress.at(-1), result.stats.tiles);
  assert.ok(result.segments.length > 0);
  assert.ok(result.segments.flat(2).every(Number.isFinite));
  const point = [41.692, -0.907];
  latLng(worldPoint(...point, 14), 14).forEach((v, i) => assert.ok(Math.abs(v - point[i]) < 1e-9));
});

test('a failed tile rejects the entire load and aborts remaining workers', async () => {
  const signal = [];
  await assert.rejects(loadOpenFreeMapRoads({ bounds: [41.67, -0.94, 41.71, -0.88], metadata, fetchImpl: async (_, options) => { signal.push(options.signal); return new Response('', { status: 503 }); } }), /HTTP 503/);
  assert.ok(signal.length <= 4);
  assert.ok(signal.every(s => s.aborted));
});

test('rate-limited map loads explain the wait and do not automatically retry', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response('', { status: 429 }); };
  await assert.rejects(loadOpenFreeMapRoads({ bounds, fetchImpl }), /Wait a minute/);
  assert.equal(calls, 1, 'Metadata errors do not trigger another request');
  calls = 0;
  await assert.rejects(loadOpenFreeMapRoads({ bounds, metadata, fetchImpl }), /Wait a minute/);
  assert.ok(calls <= 4, 'Only the initial concurrent tile requests can run');
});

test('cancellation and global deadline reject and stop tile requests', async () => {
  const blocked = (_, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadOpenFreeMapRoads({ bounds, metadata, signal: controller.signal, fetchImpl: blocked }), { name: 'AbortError' });
  await assert.rejects(loadOpenFreeMapRoads({ bounds, metadata, timeoutMs: 20, fetchImpl: blocked }), { name: 'TimeoutError' });
});


test('rivers decode waterway lines and exclude polygons, drains and road features', () => {
  const tile = { x: 8151, y: 6101, z: 14 };
  const bounds = [40, -2, 43, 0];
  const data = fixture([
    { class: 'river', points: [[100, 100], [200, 200]] },
    { class: 'stream', points: [[100, 300], [200, 400]] },
    { class: 'canal', points: [[100, 500], [200, 600]] },
    { class: 'drain', points: [[100, 700], [200, 800]] },
    { class: 'river', type: 3, points: [[100, 900], [200, 1000]] },
  ], 'waterway');
  assert.equal(decodeLineEdges(data, tile, bounds, 'rivers').length, 3);
  assert.equal(decodeRoadEdges(data, tile, bounds).length, 0);
  assert.throws(() => decodeLineEdges(data, tile, bounds, 'unsupported'), /Unsupported vector layer/);
});


test('rail layer includes rail and transit lines without roads or ferry routes', () => {
  const data = fixture(['rail', 'transit', 'primary', 'ferry'].map((roadClass, i) => ({
    class: roadClass, points: [[100, 100 + i * 100], [1000, 100 + i * 100]],
  })));
  const tile = { x: 8151, y: 6101, z: 14 };
  const edges = decodeLineEdges(data, tile, [40, -2, 43, 0], 'rail');
  assert.equal(edges.length, 2);
  assert.deepEqual(edges.map(e => e[2].kind.split(':')[0]), ['rail', 'transit']);
  assert.equal(decodeRoadEdges(data, tile, [40, -2, 43, 0]).length, 1);
});


const polygonTile = { x: 8151, y: 6101, z: 14 };
const broadBounds = [40, -2, 43, 0];
const rectangle = (left, top, right, bottom) => [[left, top], [right, top], [right, bottom], [left, bottom]];

test('coastline dissolves ocean subdivisions and excludes lake shores and tile closures', () => {
  const data = fixture([
    { class: 'ocean', type: 3, points: rectangle(-32, -32, 2000, 1000) },
    { class: 'ocean', type: 3, points: rectangle(2000, -32, 4128, 1000) },
    { class: 'lake', type: 3, points: rectangle(100, 2000, 400, 2200) },
  ], 'water');
  const edges = decodeLineEdges(data, polygonTile, broadBounds, 'coast');
  assert.equal(edges.length, 1, 'Only the shoreline remains, with no internal partition');
  assert.ok(edges[0].slice(0, 2).every(p => p[1] === polygonTile.y * 4096 + 1000));
  assert.equal(decodeLineEdges(fixture([{ class: 'ocean', type: 3, points: rectangle(0, 0, 4096, 4096) }], 'water'), polygonTile, broadBounds, 'coast').length, 0, 'A full ocean tile has no coastline');
});

test('coastline retains island rings and never closes paths along the requested area', () => {
  const data = fixture([{ class: 'ocean', type: 3, rings: [rectangle(-32, -32, 4128, 4128), rectangle(1000, 1000, 2000, 2000).reverse()] }], 'water');
  const edges = decodeLineEdges(data, polygonTile, broadBounds, 'coast');
  const joined = joinRoadEdges(edges, 14);
  assert.equal(joined.segments.length, 1);
  assert.deepEqual(joined.segments[0][0], joined.segments[0].at(-1), 'Island stays a closed outline');
  const [north, west] = latLng([polygonTile.x * 4096 + 1500, polygonTile.y * 4096 + 500], 14);
  const [south, east] = latLng([polygonTile.x * 4096 + 2500, polygonTile.y * 4096 + 2500], 14);
  const clipped = joinRoadEdges(decodeLineEdges(data, polygonTile, [south, west, north, east], 'coast'), 14);
  assert.equal(clipped.segments.length, 1);
  assert.notDeepEqual(clipped.segments[0][0], clipped.segments[0].at(-1), 'Clipped shoreline stays open');
});

test('forest outlines select woodland, dissolve overlaps, and preserve clearings', () => {
  const data = fixture([
    { class: 'wood', type: 3, rings: [rectangle(200, 200, 2000, 2000), rectangle(600, 600, 1000, 1000).reverse()] },
    { class: 'wood', type: 3, points: rectangle(1500, 200, 3000, 2000) },
    { class: 'grass', type: 3, points: rectangle(3200, 3000, 3500, 3200) },
  ], 'landcover');
  const result = joinRoadEdges(decodeLineEdges(data, polygonTile, broadBounds, 'forest'), 14);
  assert.equal(result.segments.length, 2, 'One wooded area and one clearing, without overlapping borders');
  assert.ok(result.segments.every(ring => JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1))));
  assert.ok(result.segments.flat(2).every(Number.isFinite));
});


test('tile preflight agrees with the loader and counts oversized areas without allocating tiles', () => {
  for (const area of [[41.67, -0.94, 41.71, -0.88], [41.56, -1.22, 41.82, -0.59]]) {
    const count = countTilesForBounds(area);
    assert.equal(count, tilesForBounds(area, 14, 10000).length);
    if (count > MAX_TILES) assert.throws(() => tilesForBounds(area), /too many tiles/);
  }
  assert.ok(countTilesForBounds([-80, -170, 80, 170]) > 1000000);
});


test('large areas preserve their extent by choosing bounded overview detail', async () => {
  const area = [-80, -170, 80, 170];
  const zoom = zoomForBounds(area);
  assert.ok(zoom < 14);
  assert.ok(countTilesForBounds(area, zoom) <= MAX_TILES);
  const result = await loadOpenFreeMapRoads({ bounds: area, metadata, fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(result.stats.zoom, zoom);
  assert.ok(result.stats.tiles <= MAX_TILES);
});

test('date-line tiles wrap their request coordinates while geometry stays in the visible world', async () => {
  const area = [0.001, 179.995, 0.01, -179.995];
  const urls = [];
  const result = await loadOpenFreeMapRoads({ bounds: area, metadata, fetchImpl: async url => {
    urls.push(url);
    return new Response(fixture([{ class: 'minor', points: [[0, 3500], [4096, 3500]] }]));
  } });
  assert.ok(urls.some(url => url.includes('/0/')));
  assert.ok(urls.some(url => url.includes('/16383/')));
  assert.ok(result.segments.flat().every(([lat, lon]) => lat >= area[0] && lat <= area[2] && lon >= area[1] - 1e-9 && lon <= 180.005 + 1e-9));
  assert.ok(result.segments.some(segment => segment.some(([, lon]) => lon > 180)));
});
