import { VectorTile, PbfReader, classifyRings, unionPolygons } from './vector-tile.mjs';

export const TILEJSON_URL = new URL('../api/tiles/metadata', import.meta.url).href;
export const CACHE_VERSION = 'ofm-roads-v3';
export const MAX_TILES = 160;
const EXTENT = 4096;
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'raceway', 'busway', 'bus_guideway']);
const MAJOR_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export function worldPoint(lat, lon, zoom) {
  const n = 2 ** zoom * EXTENT;
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n];
}

export function latLng([x, y], zoom) {
  const n = 2 ** zoom * EXTENT;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, x / n * 360 - 180];
}

export function normalizeBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) throw new Error('Invalid map area.');
  let [south, west, north, east] = bounds;
  if (east < west) east += 360;
  south = Math.max(-85.05112878, south);
  north = Math.min(85.05112878, north);
  if (south >= north || east <= west || east - west > 360) throw new Error('Choose an area smaller than one world.');
  return [south, west, north, east];
}

export function zoomForBounds(bounds, maxZoom = 14, limit = MAX_TILES) {
  let zoom = Math.min(14, maxZoom);
  while (zoom > 0 && countTilesForBounds(bounds, zoom) > limit) zoom--;
  return zoom;
}

function tileCoverage(bounds, zoom) {
  const [south, west, north, east] = normalizeBounds(bounds);
  const [left, top] = worldPoint(north, west, zoom).map(v => v / EXTENT);
  const [right, bottom] = worldPoint(south, east, zoom).map(v => v / EXTENT);
  const minX = Math.floor(left), maxX = Math.ceil(right) - 1;
  const minY = Math.max(0, Math.floor(top)), maxY = Math.min(2 ** zoom - 1, Math.ceil(bottom) - 1);
  return { left, top, right, bottom, minX, maxX, minY, maxY, count: (maxX - minX + 1) * (maxY - minY + 1) };
}

export function countTilesForBounds(bounds, zoom = 14) {
  return tileCoverage(bounds, zoom).count;
}

export function tilesForBounds(bounds, zoom = 14, limit = MAX_TILES) {
  const { left, top, right, bottom, minX, maxX, minY, maxY, count } = tileCoverage(bounds, zoom);
  if (count > limit) throw new Error('This area needs too many tiles. Choose a smaller area.');
  const tiles = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) tiles.push({ x, y, z: zoom });
  // Start near the centre so the first streets appear where the user is looking.
  return tiles.sort((a, b) => (a.x - (left + right) / 2) ** 2 + (a.y - (top + bottom) / 2) ** 2 - (b.x - (left + right) / 2) ** 2 - (b.y - (top + bottom) / 2) ** 2);
}

// Liang–Barsky clipping removes the buffer around each tile without rounding intersections.
export function clipEdge(a, b, box) {
  const [xmin, ymin, xmax, ymax] = box;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let lo = 0, hi = 1;
  const p = [-dx, dx, -dy, dy], q = [a[0] - xmin, xmax - a[0], a[1] - ymin, ymax - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return null;
    }
  }
  if (lo === hi) return null;
  return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}

export function decodeRoadEdges(bytes, tile, bounds, mode = 'all') {
  return decodeLineEdges(bytes, tile, bounds, 'roads', mode);
}

export function decodeLineEdges(bytes, tile, bounds, kind = 'roads', mode = 'all') {
  if (kind === 'coast' || kind === 'forest') return decodePolygonOutlines(bytes, tile, bounds, kind);
  if (!['roads', 'rivers', 'rail'].includes(kind)) throw new Error(`Unsupported vector layer: ${kind}`);
  const layerName = kind === 'rivers' ? 'waterway' : 'transportation';
  const layer = new VectorTile(new PbfReader(new Uint8Array(bytes))).layers[layerName];
  if (!layer) return [];
  const nw = worldPoint(bounds[2], bounds[1], tile.z), se = worldPoint(bounds[0], bounds[3], tile.z);
  const ox = tile.x * EXTENT, oy = tile.y * EXTENT;
  const box = [Math.max(ox, nw[0]), Math.max(oy, nw[1]), Math.min(ox + EXTENT, se[0]), Math.min(oy + EXTENT, se[1])];
  const edges = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const roadClass = feature.properties.class;
    const included = kind === 'rivers'
      ? ['river', 'stream', 'canal'].includes(roadClass)
      : kind === 'rail' ? ['rail', 'transit'].includes(roadClass)
      : mode === 'major' ? MAJOR_CLASSES.has(roadClass) : ROAD_CLASSES.has(String(roadClass).replace(/_construction$/, ''));
    if (feature.type !== 2 || !included) continue;
    const scale = EXTENT / feature.extent;
    for (const line of feature.loadGeometry()) {
      for (let j = 1; j < line.length; j++) {
        const a = [ox + line[j - 1].x * scale, oy + line[j - 1].y * scale];
        const b = [ox + line[j].x * scale, oy + line[j].y * scale];
        const edge = clipEdge(a, b, box);
        if (edge) edges.push([...edge, { x: tile.x, y: tile.y, kind: ['class', 'subclass', 'brunnel', 'layer'].map(k => feature.properties[k] ?? '').join(':') }]);
      }
    }
  }
  return edges;
}

// Dissolve upstream polygon subdivisions before extracting outlines. Keep island
// and clearing rings, and retain the tile buffer until individual edges are clipped.
export function decodePolygonOutlines(bytes, tile, bounds, kind) {
  if (!['coast', 'forest'].includes(kind)) throw new Error(`Unsupported polygon layer: ${kind}`);
  const layerName = kind === 'coast' ? 'water' : 'landcover';
  const layer = new VectorTile(new PbfReader(new Uint8Array(bytes))).layers[layerName];
  if (!layer) return [];
  const polygons = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    if (feature.type !== 3 || feature.properties.class !== (kind === 'coast' ? 'ocean' : 'wood')) continue;
    const scale = EXTENT / feature.extent;
    for (const polygon of classifyRings(feature.loadGeometry())) {
      const rings = polygon.filter(ring => ring.length >= 4).map(ring => ring.map(p => [p.x * scale, p.y * scale]));
      if (rings.length) polygons.push(rings);
    }
  }
  if (!polygons.length) return [];
  const dissolved = unionPolygons(polygons);
  const ox = tile.x * EXTENT, oy = tile.y * EXTENT;
  const nw = worldPoint(bounds[2], bounds[1], tile.z), se = worldPoint(bounds[0], bounds[3], tile.z);
  const box = [Math.max(ox, nw[0]), Math.max(oy, nw[1]), Math.min(ox + EXTENT, se[0]), Math.min(oy + EXTENT, se[1])];
  const edges = [];
  for (const polygon of dissolved) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    // Zero-buffer tile closures are clipping edges, not shorelines. Clipping
    // individual edges also avoids drawing a rectangle along the requested area.
    if ([0, 1].some(axis => [0, EXTENT].some(v => Math.abs(a[axis] - v) < 1e-7 && Math.abs(b[axis] - v) < 1e-7))) continue;
    const edge = clipEdge([ox + a[0], oy + a[1]], [ox + b[0], oy + b[1]], box);
    if (edge) edges.push([...edge, { x: tile.x, y: tile.y, kind }]);
  }
  return edges;
}

// Join degree-two nodes, including tile seams; keep branches as separate paths.
// A geometry key also removes duplicated buffered edges, irrespective of feature IDs.
export function weldTileSeams(edges) {
  const groups = new Map(), replacements = new Map();
  for (const [a, b, owner] of edges) {
    if (!owner) continue;
    for (const [point, other] of [[a, b], [b, a]]) for (let axis = 0; axis < 2; axis++) {
      const boundary = Math.round(point[axis] / EXTENT);
      if (Math.abs(point[axis] - boundary * EXTENT) > 1e-6) continue;
      const tileIndex = axis === 0 ? owner.x : owner.y;
      const side = tileIndex === boundary ? 1 : -1;
      const groupKey = `${axis}:${boundary}:${owner.kind}`;
      if (!groups.has(groupKey)) groups.set(groupKey, new Map());
      const id = `${side}:${point.join(',')}`;
      const group = groups.get(groupKey);
      if (!group.has(id)) group.set(id, { point, other, side, axis, refs: [] });
      group.get(id).refs.push(point);
    }
  }
  let joined = 0;
  for (const group of groups.values()) {
    const candidates = [...group.values()];
    function nearest(a) {
      let best = null, distance = 4; // At z14 this is under two metres at Zaragoza.
      for (const b of candidates) {
        if (a.side === b.side) continue;
        const d = Math.abs(a.point[1 - a.axis] - b.point[1 - a.axis]);
        if (d > distance) continue;
        const u = a.other.map((v, i) => v - a.point[i]), v = b.other.map((v, i) => v - b.point[i]);
        const cosine = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
        if (cosine > -0.8) continue;
        best = b; distance = d;
      }
      return best;
    }
    const used = new Set();
    for (const a of candidates) {
      if (used.has(a)) continue;
      const b = nearest(a);
      if (!b || used.has(b) || nearest(b) !== a) continue;
      const point = a.point.map((v, i) => (v + b.point[i]) / 2);
      for (const ref of [...a.refs, ...b.refs]) replacements.set(ref, point);
      used.add(a); used.add(b); joined++;
    }
  }
  return { edges: edges.map(([a, b]) => [replacements.get(a) || a, replacements.get(b) || b]), joined };
}

export function joinRoadEdges(sourceEdges, zoom) {
  const { edges, joined } = weldTileSeams(sourceEdges);
  const nodes = new Map(), unique = new Set();
  let duplicateEdges = 0;
  const key = p => p.map(v => Math.round(v * 1024) / 1024).join(',');
  for (const [a, b] of edges) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (unique.has(ek)) { duplicateEdges++; continue; }
    unique.add(ek);
    for (const [k, point, other] of [[ka, a, kb], [kb, b, ka]]) {
      if (!nodes.has(k)) nodes.set(k, { point, neighbours: new Set() });
      nodes.get(k).neighbours.add(other);
    }
  }
  const segments = [];
  function walk(start, next) {
    const path = [nodes.get(start).point];
    let previous = start, current = next;
    while (true) {
      nodes.get(previous).neighbours.delete(current);
      const node = nodes.get(current);
      node.neighbours.delete(previous);
      path.push(node.point);
      if (node.degree !== 2 || !node.neighbours.size) break;
      previous = current;
      current = node.neighbours.values().next().value;
    }
    segments.push(path.map(p => latLng(p, zoom)));
  }
  for (const node of nodes.values()) node.degree = node.neighbours.size;
  for (const [k, node] of nodes) if (node.degree !== 2) for (const other of [...node.neighbours]) if (node.neighbours.has(other)) walk(k, other);
  for (const [k, node] of nodes) if (node.neighbours.size) walk(k, node.neighbours.values().next().value);
  const seamEnds = [...nodes.values()].filter(n => n.degree === 1 && n.point.some(v => Math.abs(v / EXTENT - Math.round(v / EXTENT)) < 1e-8)).length;
  return { segments, duplicateEdges, seamEnds, joinedSeams: joined, uniqueEdges: unique.size };
}

export async function getTileMetadata({ signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(TILEJSON_URL, { signal });
  if (response.status === 429) throw new Error('Too many map requests. Wait a minute, then reload the area.');
  if (!response.ok) throw new Error(`OpenFreeMap metadata: HTTP ${response.status}`);
  const metadata = await response.json();
  if (!metadata.tiles?.[0] || !Number.isInteger(metadata.maxzoom)) throw new Error('OpenFreeMap returned invalid tile metadata.');
  return metadata;
}

export function loadOpenFreeMapRoads(options) {
  return loadOpenFreeMapLines({ ...options, layer: 'roads' });
}

export async function loadOpenFreeMapLines({ bounds, layer = 'roads', mode = 'all', metadata, signal, onProgress = () => {}, fetchImpl = fetch, concurrency = 4, timeoutMs = 45000 }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => controller.abort(new DOMException('Street loading timed out. Please retry.', 'TimeoutError')), timeoutMs);
  const start = performance.now();
  const edges = [];
  let next = 0, completed = 0, bytes = 0, firstDataMs = null;
  try {
    metadata ??= await getTileMetadata({ signal: controller.signal, fetchImpl });
    bounds = normalizeBounds(bounds);
    const zoom = zoomForBounds(bounds, metadata.maxzoom);
    const tiles = tilesForBounds(bounds, zoom);
    const jobs = Array.from({ length: Math.min(concurrency, tiles.length) }, async () => {
      while (next < tiles.length) {
        controller.signal.throwIfAborted();
        const tile = tiles[next++];
        const url = metadata.tiles[0].replace('{z}', tile.z).replace('{x}', ((tile.x % 2 ** tile.z) + 2 ** tile.z) % 2 ** tile.z).replace('{y}', tile.y);
        const response = await fetchImpl(url, { signal: controller.signal });
        if (response.status === 429) throw new Error('Too many map requests. Wait a minute, then reload the area.');
        if (!response.ok && response.status !== 204) throw new Error(`OpenFreeMap tile: HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        controller.signal.throwIfAborted();
        bytes += data.byteLength;
        if (data.byteLength) {
          const tileEdges = decodeLineEdges(data, tile, bounds, layer, mode);
          // Avoid spread argument limits on densely mapped tiles.
          for (const edge of tileEdges) edges.push(edge);
          if (tileEdges.length && firstDataMs === null) firstDataMs = performance.now() - start;
        }
        completed++;
        onProgress({ completed, total: tiles.length, edges, zoom, firstDataMs });
      }
    });
    try { await Promise.all(jobs); }
    catch (error) { controller.abort(error); await Promise.allSettled(jobs); throw error; }
    controller.signal.throwIfAborted();
    const finalizeStart = performance.now();
    const result = joinRoadEdges(edges, zoom);
    return { ...result, stats: { provider: 'openfreemap', tiles: tiles.length, bytes, firstDataMs, totalMs: performance.now() - start, finalizeMs: performance.now() - finalizeStart, zoom, source: metadata.tiles[0], seamEnds: result.seamEnds, joinedSeams: result.joinedSeams, duplicateEdges: result.duplicateEdges } };
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
  }
}
