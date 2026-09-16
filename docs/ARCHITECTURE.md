# Carta architecture

## Request flow

The browser loads the editor, Leaflet, local fonts and export bundles from the root of `carta.example.com`. The Cloudflare Worker reads the static asset binding without a path prefix. It does not serve the repository, tests, configuration or development files. A strict script policy permits only same-origin scripts; inline CSS remains allowed because the editor and Leaflet set element styles.

City search is a same-origin JSON POST to `/api/search`. The Worker checks origin, content type, payload size, city-name length and a generous anonymous network rate limit. It hashes the normalized query, language and configured endpoint to select a `SearchCache` Durable Object. Identical concurrent searches share one request. Results expire after seven days and an alarm deletes the object's cache.

Only cache misses reach the global `SearchGate`. A synchronous SQLite update reserves the upstream slot before network I/O. The persisted reservation survives object restarts. The gate allows one in-flight request, a ten-second upstream deadline and at least 1.1 seconds after completion before another request. Upstream Retry-After responses extend the cooldown. The gate sends an identifying User-Agent, city-only parameters and language to Nominatim; it does not forward browser identifiers or IP addresses. It rejects redirects and unbounded payloads. Errors are not cached.

The per-network rate counter is abuse mitigation, not the global Nominatim limiter. Cloudflare rate-limit bindings are local to a point of presence and eventually consistent; the Durable Object provides the shared upstream gate. There is no network autocomplete, scheduled harvesting or automatic retry loop.

## Tiles and geometry

`/api/tiles/metadata` fetches a fixed OpenFreeMap TileJSON URL. The Worker validates the provider's dated release template and returns a same-origin template. Metadata is cached for one hour. Tile requests accept only the release, zoom and coordinate format needed by that template, with zoom 0–14 and valid x/y indices. No client-supplied hostname is fetched. Tile bodies are limited to 8 MiB and upstream requests to 15 seconds.

The map API accepts GET only. HEAD requests return 405 without fetching a tile. Browser requests from another origin are rejected; these headers are not authentication, so non-browser clients still need rate limits. A daily hash of the network IP selects two separate counters: `TILE_LIMIT` allows 1,200 requests per minute, and `TILE_MISS_LIMIT` allows 480 upstream attempts per minute. Metadata and all releases share these budgets. Cached tiles remain available after the upstream budget is spent, until the total request limit is reached. A blocked request returns 429 with `Retry-After: 60`; the editor explains the wait and does not retry automatically.

These initial limits leave room for a 160-tile map, repeated layer reads and some panning. Visitors behind the same network share the allowance. Cloudflare's [rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) are permissive, eventually consistent and local to each Cloudflare location. They reduce abuse but do not provide a global traffic or billing cap. Concurrent cache misses can still cause separate provider requests. Review real traffic and account limits before changing the budgets; distributed abuse may need additional edge controls.

Tiles use a one-year immutable cache header because their URL includes a dated release. Cache API entries are local to Cloudflare locations and can be evicted sooner. The application never uploads generated prints to this cache. HTML revalidates; other static resources revalidate after one hour. The build adds a content hash to the application script URL so a cached script cannot run against new HTML. Public map endpoints contain public map data only. Search HTTP responses are `no-store`; the shared result cache lives behind the API.

The tile cache normalizes numeric coordinates and removes query strings, so leading zeros and extra parameters cannot create copies of one tile. Older dated releases remain accessible for open sessions. Provider 404/410 responses produce a generic 404, cached at the edge for 30 seconds to absorb repeated misses. That error is sent to browsers with `no-store`. Transient provider failures, redirects and oversized responses are not cached. Cache writes finish before the response returns, so an immediate sequential retry can reuse the entry; a failed cache write does not discard valid map data.

The browser decodes vector tiles using `@mapbox/vector-tile` and `pbf`. It clips tile buffers, removes duplicate edges and joins degree-two nodes. Direction-aware seam welding avoids joining nearby parallel streets. Forest and ocean polygons are dissolved with `polygon-clipping` before their outlines are extracted, retaining islands and clearings without drawing tile rectangles. Rivers use waterway features; railways use rail/transit transportation features. All geometry comes from OpenFreeMap.

Loads use at most 160 tiles. When a frame would exceed that count, the loader reduces the tile zoom and reports overview detail. The frame stays fixed. Longitudes can cross the date line: request x coordinates wrap, while decoded geometry keeps its unwrapped world coordinates. Latitude is limited to Web Mercator's range; an area larger than one world is rejected.

## Editor state

A city selection prepares a local initial area. The first street load remains explicit. After that, frame changes debounce a reload, cancel obsolete requests and invalidate export until current data is ready. Fixed-radius modes retain their selected city radius. Optional layers have independent cancellation and failure reporting. A layer failure does not discard successful layers.

Memory caches also limit retained geometry by entry and point counts, so repeated panning does not retain every previous frame. A bounded browser cache holds recent city results and geometry for reuse up to seven days. Expired entries are pruned on later reads and writes. Clear saved data clears that cache and the theme preference. Browser HTTP caches and downloaded files are controlled separately by the browser.

WebGPU draws streets when available. Transient buffers are released after submission. Device loss or draw failure switches to Leaflet Canvas while preserving current streets and selected layers. Rivers and railways render above streets; woodland renders behind them.

## Exports

The internal SVG follows the frame. Fontkit shapes and positions text with Noto fallbacks, and bidi-js resolves mixed-direction runs. Text is outlined before rasterization so downloads use the same fonts without requiring them on the recipient's device. Long titles shrink to fit; unsupported characters produce an actionable message.

PDF and SVG downloads contain a raster preview with a maximum 1024-pixel long edge. Their filenames include `low-resolution`. SVG wraps one embedded PNG and keeps the selected physical dimensions; jsPDF embeds that same image in the PDF. The decorative frame and attribution are part of the image. Optional PDF crop marks remain vector lines in a 12 mm outer margin, and the TrimBox records the finished size. The PDF is not a tagged accessible document.

PNG exports use a 2048-pixel long edge and the selected frame ratio, without crop marks. All formats are generated in the browser and retain map credits. Resolution limits reduce print detail, not access to the underlying public map data. The client has the geometry needed to render the map; these limits are not DRM or a security boundary.

## Security and operations

Responses carry CSP, nosniff, anti-framing, referrer and feature policies; HTTPS responses carry HSTS without changing subdomain policy. Leaflet is served locally. Outbound providers are fixed or operator-configured and request bodies are bounded. Errors sent to browsers use `no-store`; only generic missing-tile errors receive the short edge cache described above. Automatic invocation logs and tracing are disabled. Unexpected Worker failures log a generic code only. Cloudflare's infrastructure may still process operational and security data under its own terms.

Deploy only the configured `carta.example.com` custom domain. No application accounts, secrets or paid API keys are required. Provider service capacity and Cloudflare account quotas still apply. A real deployment needs verification of routes, HTTPS, headers, search and downloads on the public hostname; local dry-run checks cannot prove those account-level settings.

Sources: [Cloudflare Workers](https://developers.cloudflare.com/workers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [OpenFreeMap terms](https://openfreemap.org/tos/), [OpenMapTiles schema](https://openmaptiles.org/schema/), [fontkit](https://github.com/foliojs/fontkit), [bidi-js](https://github.com/lojjic/bidi-js).
