import { DurableObject } from 'cloudflare:workers';
import { seoScriptHashes } from './seo-csp';

const DAY = 86400000;
const SEARCH_TTL = 7 * DAY;
type Place = { lat: string; lon: string; display_name: string; name?: string; osm_type?: string; osm_id?: number; class?: string; category?: string; type?: string; addresstype?: string; boundingbox?: string[]; address?: Record<string, string> };
type SearchResult = { status: number; results?: Place[]; retryAfter?: number; error?: string };
const json = (value: unknown, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function boundedBytes(message: Request | Response, limit: number): Promise<Uint8Array> {
  if (Number(message.headers.get('Content-Length')) > limit) {
    await message.body?.cancel();
    throw new Error('Body too large');
  }
  const reader = message.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Body too large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
const readJson = async (message: Request | Response, limit: number) => JSON.parse(new TextDecoder().decode(await boundedBytes(message, limit)));
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

// Only cache misses reach this object. Synchronous SQL reserves the next slot
// before any I/O, including after a restart; no two upstream calls overlap.
export class SearchGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS gate (id INTEGER PRIMARY KEY, until_ms INTEGER NOT NULL)');
  }
  async search(query: string, language: string): Promise<SearchResult> {
    const now = Date.now();
    const until = this.ctx.storage.sql.exec<{ until_ms: number }>('SELECT until_ms FROM gate WHERE id = 1').toArray()[0]?.until_ms ?? 0;
    if (until > now) return { status: 429, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)), error: 'Search is busy. Please retry shortly.' };
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO gate VALUES (1, ?)', now + 12000);
    let next = now + 1100;
    try {
      const url = new URL(this.env.NOMINATIM_ENDPOINT);
      if (url.protocol !== 'https:') throw new Error('Invalid search endpoint');
      url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', featureType: 'city', limit: '5', 'accept-language': language }).toString();
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': `CartaMaps/0.2 (+${this.env.CONTACT_URL})`, Accept: 'application/json' } });
      if (response.status === 429 || response.status === 503) {
        const delay = response.headers.get('Retry-After');
        const seconds = Number(delay) || Math.ceil((Date.parse(delay ?? '') - Date.now()) / 1000) || 60;
        const retryAfter = Math.min(3600, Math.max(1, seconds));
        next = Date.now() + retryAfter * 1000;
        await response.body?.cancel();
        return { status: 429, retryAfter, error: 'The city provider is busy. Please retry later.' };
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('Search unavailable'); }
      const results = await readJson(response, 256 * 1024);
      if (!Array.isArray(results)) throw new Error('Invalid search results');
      const places: Place[] = results.slice(0, 5).filter(p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && typeof p.display_name === 'string').map(p => ({
        lat: String(p.lat), lon: String(p.lon), display_name: p.display_name.slice(0, 500),
        ...Object.fromEntries(['name', 'osm_type', 'class', 'category', 'type', 'addresstype'].filter(k => typeof p[k] === 'string').map(k => [k, p[k].slice(0, 500)])),
        osm_id: Number(p.osm_id) || 0,
        boundingbox: Array.isArray(p.boundingbox) ? p.boundingbox.slice(0, 4).map(String) : undefined,
        address: Object.fromEntries(Object.entries(p.address ?? {}).filter(([, v]) => typeof v === 'string').slice(0, 20).map(([k, v]) => [k, String(v).slice(0, 500)])),
      }));
      return { status: 200, results: places };
    } catch { return { status: 502, error: 'City search is temporarily unavailable. Please retry.' }; }
    finally { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO gate VALUES (1, ?)', Math.max(next, Date.now() + 1100)); }
  }
}

export class SearchCache extends DurableObject<Env> {
  private pending?: Promise<SearchResult>;
  async search(query: string, language: string): Promise<SearchResult> {
    // Assign synchronously to deduplicate concurrent identical queries.
    if (!this.pending) this.pending = this.resolve(query, language).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async resolve(query: string, language: string): Promise<SearchResult> {
    const cached = await this.ctx.storage.get<{ expires: number; result: SearchResult }>('result');
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = await this.env.SEARCH_GATE.getByName('nominatim-global-v1').search(query, language);
    if (result.status === 200) {
      const expires = Date.now() + SEARCH_TTL;
      await this.ctx.storage.put('result', { expires, result });
      await this.ctx.storage.setAlarm(expires);
    }
    return result;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

async function search(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Same-origin requests only.' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'Use JSON.' }, 415);
  // An anonymous service has no account identifier. This generous per-network
  // limit is abuse mitigation only; the Durable Object enforces the global quota.
  const key = await hash(`carta:${request.headers.get('CF-Connecting-IP') ?? 'local'}:${Math.floor(Date.now() / DAY)}`);
  if (!(await env.SEARCH_LIMIT.limit({ key })).success) return json({ error: 'Too many searches. Please wait a minute.' }, 429, { 'Retry-After': '60' });
  let body;
  try { body = await readJson(request, 2048); } catch { return json({ error: 'Invalid search request.' }, 400); }
  const query = typeof body?.query === 'string' ? body.query.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
  if (query.length < 2 || query.length > 100 || /[\p{Cc}\p{Cf}<>]/u.test(query)) return json({ error: 'Enter a city name between 2 and 100 characters.' }, 400);
  const language = typeof body.language === 'string' && /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/.test(body.language) ? body.language : 'en';
  const id = await hash(`${env.NOMINATIM_ENDPOINT}:${language}:${query.toLocaleLowerCase('en')}`);
  const result = await env.SEARCH_CACHE.getByName(id).search(query, language);
  return json(result.results ?? { error: result.error }, result.status, result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {});
}

async function tiles(path: string, request: Request, env: Env): Promise<Response> {
  // The editor only uses GET. In particular, HEAD must not download a tile
  // from the provider just to discard its body.
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405, { Allow: 'GET' });
  const cacheUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== cacheUrl.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Same-origin requests only.' }, 403);
  let upstream: string;
  const metadata = path === '/api/tiles/metadata';
  if (metadata) upstream = 'https://tiles.openfreemap.org/planet';
  else {
    const match = /^\/api\/tiles\/(\d{8}_\d{6}_pt)\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.pbf$/.exec(path);
    if (!match) return json({ error: 'Unknown tile.' }, 404);
    const [, release, z, x, y] = match;
    if (+z > 14 || +x >= 2 ** +z || +y >= 2 ** +z) return json({ error: 'Invalid tile coordinates.' }, 400);
    upstream = `https://tiles.openfreemap.org/planet/${release}/${+z}/${+x}/${+y}.pbf`;
    // Coordinate aliases and query strings must share the same cache entry.
    cacheUrl.pathname = `${env.BASE_PATH}/api/tiles/${release}/${+z}/${+x}/${+y}.pbf`;
  }
  cacheUrl.search = '';
  if (metadata) cacheUrl.search = '?schema=2';
  // Separate budgets preserve cached map access after the upstream budget is
  // spent. These are per-location abuse controls, not a global billing cap.
  const networkKey = await hash(`carta-tiles:${request.headers.get('CF-Connecting-IP') ?? 'local'}:${Math.floor(Date.now() / DAY)}`);
  const limited = () => json({ error: 'Too many map requests. Wait a minute, then reload the area.' }, 429, { 'Retry-After': '60' });
  if (!(await env.TILE_LIMIT.limit({ key: networkKey })).success) return limited();
  const key = new Request(cacheUrl, { method: 'GET' });
  const cache = caches.default;
  const saved = await cache.match(key);
  // Negative entries stay at the edge; the browser must be free to retry.
  if (saved) return saved.status === 404 ? json({ error: 'Map tile not found.' }, 404) : saved;
  if (!(await env.TILE_MISS_LIMIT.limit({ key: networkKey })).success) return limited();
  try {
    const response = await fetch(upstream, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!metadata && [404, 410].includes(response.status)) {
      await response.body?.cancel();
      const missing = json({ error: 'Map tile not found.' }, 404);
      const cachedMissing = new Response(missing.clone().body, missing);
      cachedMissing.headers.set('Cache-Control', 'public, max-age=30');
      // Finish the write before returning, so an immediate retry can reuse it.
      // Cache availability must not determine whether the map API works.
      await cache.put(key, cachedMissing).catch(() => {});
      return missing;
    }
    if (!response.ok) { await response.body?.cancel(); return json({ error: 'Map tiles are temporarily unavailable.' }, 502); }
    let result: Response;
    if (metadata) {
      const data = await readJson(response, 256 * 1024);
      const template = data.tiles?.[0];
      const release = typeof template === 'string' && /^https:\/\/tiles\.openfreemap\.org\/planet\/(\d{8}_\d{6}_pt)\/\{z\}\/\{x\}\/\{y\}\.pbf$/.exec(template)?.[1];
      if (!release || !Number.isInteger(data.maxzoom) || data.maxzoom < 0 || data.maxzoom > 14) throw new Error('Unexpected tileset');
      result = Response.json({ maxzoom: data.maxzoom, tiles: [`${env.BASE_PATH}/api/tiles/${release}/{z}/{x}/{y}.pbf`] }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    } else {
      result = new Response(await boundedBytes(response, 8 * 1024 * 1024), { headers: { 'Content-Type': 'application/vnd.mapbox-vector-tile', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    await cache.put(key, result.clone()).catch(() => {});
    return result;
  } catch { return json({ error: 'Map tiles are temporarily unavailable. Please retry.' }, 502); }
}

function secure(response: Response, request: Request): Response {
  const result = new Response(request.method === 'HEAD' ? null : response.body, response);
  const headers = result.headers;
  headers.set('Content-Security-Policy', `default-src 'none'; script-src 'self' ${seoScriptHashes.map(hash => `'${hash}'`).join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  return result;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    try {
      if (env.BASE_PATH && (url.pathname === env.BASE_PATH || url.pathname === '/')) response = Response.redirect(`${url.origin}${env.BASE_PATH}/`, 308);
      else if (!url.pathname.startsWith(`${env.BASE_PATH}/`)) response = json({ error: 'Not found.' }, 404);
      else {
        const path = url.pathname.slice(env.BASE_PATH.length);
        if (path === '/api/search') response = await search(request, env);
        else if (path.startsWith('/api/tiles/')) response = await tiles(path, request, env);
        else if (!['GET', 'HEAD'].includes(request.method)) response = json({ error: 'Use GET.' }, 405);
        else if (path.includes('/.') || path.startsWith('/api/') || !/^\/(?:$|index\.html$|privacy(?:\.html)?\/?$|LICENSE$|robots\.txt$|sitemap\.xml$|og-image\.jpg$|favicon\.svg$|app\.js$|city-roads\/[^.][\w./-]+$|vendor\/[\w./-]+$)/.test(path)) response = json({ error: 'Not found.' }, 404);
        else {
          url.pathname = path;
          url.search = '';
          const asset = await env.ASSETS.fetch(new Request(url, request));
          response = new Response(asset.body, asset);
          const location = response.headers.get('Location');
          if (location) {
            const redirect = new URL(location, url);
            redirect.pathname = env.BASE_PATH + redirect.pathname;
            response.headers.set('Location', redirect.toString());
          }
          response.headers.set('Cache-Control', /\.html$|\/$|^\/privacy$/.test(path) ? 'no-cache, no-transform' : 'public, max-age=3600, must-revalidate');
        }
      }
    } catch { console.error('carta_request_failed'); response = json({ error: 'The service is temporarily unavailable.' }, 503); }
    return secure(response, request);
  },
} satisfies ExportedHandler<Env>;
