import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8") + fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const sandbox = {};
vm.runInNewContext(
  [
    extractFunction("normalize"),
    extractFunction("isLocalityResult"),
    extractFunction("boundsFromNominatim"),
    extractFunction("limitBoundsAroundCenter"),
    extractFunction("cityFromNominatim"),
    extractFunction("nominatimResultsToCities"),
    "globalThis.nominatimResultsToCities = nominatimResultsToCities;",
  ].join("\n"),
  sandbox,
);

const cadizResults = [
  {
    category: "boundary",
    type: "administrative",
    addresstype: "village",
    name: "Cadiz",
    importance: 0.46154566722313745,
    lat: "36.8623097",
    lon: "-87.8373777",
    display_name: "Cadiz, Trigg County, Kentucky, Estados Unidos de América",
    address: { village: "Cadiz", country_code: "us" },
    boundingbox: ["36.8526290", "36.8835855", "-87.8425790", "-87.7334200"],
  },
  {
    category: "boundary",
    type: "administrative",
    addresstype: "city",
    name: "Cádiz",
    importance: 0.4562703992788498,
    lat: "10.9566520",
    lon: "123.3057034",
    display_name: "Cádiz, Negros Occidental, Negros Island Region, 6121, Filipinas",
    address: { city: "Cádiz", country_code: "ph" },
    boundingbox: ["10.6867349", "11.1378412", "123.1242860", "123.3748101"],
  },
  {
    category: "boundary",
    type: "administrative",
    addresstype: "village",
    name: "Cadiz",
    importance: 0.4295927056894503,
    lat: "40.2728452",
    lon: "-80.9967628",
    display_name: "Cadiz, Harrison County, Ohio, 43907, Estados Unidos de América",
    address: { village: "Cadiz", country_code: "us" },
    boundingbox: ["40.2336140", "40.2950520", "-81.0349780", "-80.9712680"],
  },
  {
    category: "boundary",
    type: "administrative",
    addresstype: "city",
    name: "Cádiz",
    importance: 0.6623123188691791,
    lat: "36.5297438",
    lon: "-6.2928976",
    display_name: "Cádiz, Bahía de Cádiz, Cádiz, Andalucía, España",
    address: { city: "Cádiz", province: "Cádiz", country_code: "es" },
    boundingbox: ["36.4439926", "36.5454594", "-6.3175626", "-6.2250607"],
  },
];

const cities = sandbox.nominatimResultsToCities(cadizResults);
assert.equal(cities.length, 4);
assert.equal(cities[0].name, "Cadiz");
assert.equal(cities[0].countryCode, "us");
assert.equal(cities[0].placeType, "village");
assert.equal(cities[3].name, "Cádiz");
assert.equal(cities[3].countryCode, "es");
assert.equal(cities[3].placeType, "city");

// Reject broad administrative areas even when their address contains a city name.
const nonCities = ['state', 'state_district', 'province', 'county', 'country', 'suburb'].map(addresstype => ({
  ...cadizResults[3], addresstype,
}));
nonCities.push({ ...cadizResults[3], addresstype: undefined });
nonCities.push({ ...cadizResults[3], category: 'amenity', type: 'university' });
assert.equal(sandbox.nominatimResultsToCities(nonCities).length, 0);
for (const type of ['city', 'town', 'village', 'hamlet']) {
  assert.equal(sandbox.nominatimResultsToCities([{ ...cadizResults[3], category: 'place', type, addresstype: type }]).length, 1);
}

// Request city-level matches and bypass search caches from before the filter existed.
let requestedUrl, requestedOptions, readCacheKey;
const searchSandbox = {
  nextNominatimRequestAt: 0, waitForSearchSlot: async () => {},
  normalize: text => text.toLowerCase(), URLSearchParams,
  localCache: { get: async key => { readCacheKey = key; return key.startsWith('places:') ? { cities: [{ placeType: 'county' }] } : null; }, set: async () => {} },
  setStatus() {}, nominatimSearchEndpoint: 'https://carta.example.com/api/search',
  navigator: { language: 'en' },
  fetch: async (url, options) => { requestedUrl = new URL(url); requestedOptions = options; return { ok: true, json: async () => [...nonCities, ...cadizResults] }; },
  nominatimResultsToCities: sandbox.nominatimResultsToCities,
};
vm.runInNewContext(`async ${extractFunction('searchWorldPlaces')}`, searchSandbox);
const filteredSearch = await searchSandbox.searchWorldPlaces('Cádiz');
assert.equal(requestedUrl.pathname, '/api/search');
assert.equal(requestedUrl.search, '');
assert.equal(requestedOptions.method, 'POST');
assert.deepEqual(JSON.parse(requestedOptions.body), { query: 'Cádiz', language: 'en' });
assert.ok(!readCacheKey.startsWith('places:'));
assert.equal(filteredSearch.length, 4);

assert.match(source, /renderNominatimOptions\(cities,\s*query\)/);
assert.doesNotMatch(source, /const city = await searchWorldPlace\(query\);\s*citySearch\.value = city\.name;\s*renderCityList\(\);\s*await renderCity\(city\);/s);
assert.match(source, /data-range-target="weightRange" data-range-step="-1"/);
assert.match(source, /data-range-target="opacityRange" data-range-step="1"/);
assert.match(source, /function stepRangeControl\(targetId,\s*direction\)/);
assert.doesNotMatch(source, /overpass|loadWorldRoads|createCityDataButton/i);
assert.match(source, /id="riverColor"/);
assert.match(source, /id="railColor"/);
assert.match(source, /loadVectorDetail\(city\)/);

// OSM is the only city selection path; selected places still use OpenFreeMap geometry.
assert.doesNotMatch(source, /city-catalog|cityList|cityCount|showAllButton|cityByName|renderCityList/);
let vectorCity;
const detailSandbox = { loadVectorDetail: async city => { vectorCity = city; return [[[1, 2], [3, 4]]]; } };
vm.runInNewContext(`async ${extractFunction("loadDetail")}`, detailSandbox);
const osmCity = cities[3];
const loadedSegments = await detailSandbox.loadDetail(osmCity);
assert.equal(vectorCity, osmCity);

// Composition guides must stay out of the exported artwork.
const exportSandbox = {
  printTitle: { value: "A & B" }, printSize: () => ({ widthMm: 300, heightMm: 168.75 }),
  artworkFontStyles: "@font-face { font-family: DM Sans; }",
  updateFrame() {},
  frameRect: { width: 800, height: 450 },
  document: { documentElement: {} },
  getComputedStyle: () => ({ getPropertyValue: () => "#f7f2e8" }),
  textColor: { value: "#1a1a1a" },
  selectedCity: { name: "A & B" },
  style: () => ({}),
  coastStyle: () => ({}),
  currentCoastSegments: [],
  currentDetailLineLayers: [],
  currentSegments: loadedSegments,
  currentMonument: null,
  pathsForSegments: (segments) => segments.length ? '<path d="M0 0L10 10"/>' : "",
  monumentSvg: () => "",
};
vm.runInNewContext(`${extractFunction("escapeXml")}\n${extractFunction("exportSvgMarkup")}`, exportSandbox);
const exportedSvg = exportSandbox.exportSvgMarkup();
assert.match(exportedSvg, /<path /, "Export retains the road artwork");
assert.match(exportedSvg, /<title>A &amp; B<\/title>/);
assert.match(exportedSvg, /OpenStreetMap contributors/);
assert.match(exportedSvg, /https:\/\/carta\.example\.com\//);
assert.match(exportedSvg, /font-size="8"/);
assert.match(exportedSvg, /<style>@font-face/);
assert.doesNotMatch(exportedSvg, /<line\s/, "Export excludes composition grid lines");

exportSandbox.selectedCity.roadProvider = "openfreemap";
const vectorSvg = exportSandbox.exportSvgMarkup();
assert.match(vectorSvg, /OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap/);
assert.doesNotMatch(vectorSvg, /roads via Overpass/);

// Export preserves the same foreground order as the interactive map.
exportSandbox.pathsForSegments = (_, style) => `<path data-layer="${style.id}"/>`;
exportSandbox.style = () => ({ id: 'roads' });
exportSandbox.coastStyle = () => ({ id: 'coast' });
exportSandbox.currentDetailLineLayers = ['rail', 'forest', 'rivers'].map(id => ({ id, segments: [], style: () => ({ id }) }));
const layeredSvg = exportSandbox.exportSvgMarkup();
assert.ok(layeredSvg.indexOf('data-layer="forest"') < layeredSvg.indexOf('data-layer="roads"'));
assert.ok(layeredSvg.indexOf('data-layer="rail"') > layeredSvg.indexOf('data-layer="roads"'));
assert.ok(layeredSvg.indexOf('data-layer="rivers"') > layeredSvg.indexOf('data-layer="roads"'));
