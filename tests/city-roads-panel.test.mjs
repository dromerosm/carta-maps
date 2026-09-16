import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}
function element(extra = {}) {
  return { attributes: {}, hidden: false, disabled: false, textContent: '',
    setAttribute(key, value) { this.attributes[key] = value; },
    focus() { this.focused = true; }, ...extra };
}
function context(functions, state) {
  const sandbox = vm.createContext(state);
  for (const name of functions) vm.runInContext(extract(name), sandbox);
  return sandbox;
}

test('PDF and SVG filenames disclose low resolution while social PNG keeps its name', () => {
  const app = context(['exportFileBaseName'], { selectedCity: { name: 'London' }, frameRatio: [16, 9], normalize: value => value.toLowerCase() });
  assert.equal(app.exportFileBaseName('pdf'), 'london-16x9-low-resolution.pdf');
  assert.equal(app.exportFileBaseName('svg'), 'london-16x9-low-resolution.svg');
  assert.equal(app.exportFileBaseName('png'), 'london-16x9.png');
});

test('layer caches distinguish the area, layer and vector tileset', () => {
  const app = context(['lineDetailCacheKey'], {
    cityCacheKey: c => c.name, boundsCacheKey: b => b.join(','),
  });
  const city = { name: 'Zaragoza', bounds: [1, 2, 3, 4], roadProvider: 'openfreemap', tileSource: 'release-a' };
  const definition = { id: 'rivers' };
  const key = app.lineDetailCacheKey(city, definition);
  assert.notEqual(app.lineDetailCacheKey(city, { id: 'rail' }), key);
  for (const changed of [{ bounds: [1, 2, 4, 5] }, { tileSource: 'release-b' }]) {
    assert.notEqual(app.lineDetailCacheKey({ ...city, ...changed }, definition), key);
  }
});

test('one failed layer is reported without hiding a successful river layer', async () => {
  const labels = {}, renders = [];
  const definitions = [{ id: 'rivers', type: 'line' }, { id: 'rail', type: 'line' }];
  const state = {
    streetLoad: null, selectedCity: { name: 'Zaragoza', roadProvider: 'openfreemap' }, currentSegments: [[[1, 2], [3, 4]]],
    detailLoadController: null, detailRenderToken: 0, currentCoastSegments: [], currentDetailLineLayers: [], currentMonument: null,
    detailLayerInputs: definitions.map(d => ({ checked: true, dataset: { detailLayer: d.id } })),
    AbortController, DOMException, performance, window: { setTimeout, clearTimeout },
    activeDetailDefinitions: () => definitions, renderSegments() {},
    setLayerStatus: (id, text) => labels[id] = text, setStatus(text) { state.status = text; }, updateRendererStatus() {}, updateExportControls() {},
    async loadLineDetail(city, d) { if (d.id === 'rail') throw new Error('HTTP 503'); return [[[1, 2], [3, 4]]]; },
    applyLoadedDetails(city, roads, lines) { renders.push(lines.map(l => l.definition.id)); },
  };
  const app = vm.createContext(state);
  vm.runInContext(`async ${extract('refreshSelectedDetails')}`, app);
  await app.refreshSelectedDetails();
  assert.match(labels.rivers, /1 paths · OpenFreeMap/);
  assert.match(labels.rail, /Could not load/);
  assert.match(state.status, /1 layer could not load/);
  assert.deepEqual(Array.from(renders.at(-1)), ['rivers']);
  assert.equal(app.detailLoadController, null);
});

test('cancelled layer results cannot redraw an obsolete selection', async () => {
  let finish;
  let renders = 0;
  const state = {
    streetLoad: null, selectedCity: {}, currentSegments: [[[1, 2], [3, 4]]], detailLoadController: null,
    detailRenderToken: 0, currentCoastSegments: [], currentDetailLineLayers: [], currentMonument: null,
    detailLayerInputs: [{ checked: true, dataset: { detailLayer: 'rivers' } }],
    AbortController, DOMException, performance, window: { setTimeout, clearTimeout },
    activeDetailDefinitions: () => [{ id: 'rivers', type: 'line' }],
    renderSegments() {}, setLayerStatus() {}, setStatus() {}, updateRendererStatus() {}, updateExportControls() {},
    loadLineDetail: () => new Promise(resolve => { finish = resolve; }),
    applyLoadedDetails() { renders++; },
  };
  const app = vm.createContext(state);
  vm.runInContext(`async ${extract('refreshSelectedDetails')}`, app);
  const pending = app.refreshSelectedDetails();
  app.detailRenderToken++;
  app.detailLoadController.abort();
  finish([[[1, 2], [3, 4]]]);
  await pending;
  assert.equal(renders, 0);
});

test('panel selectors and ARIA references point to existing, unique controls', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of source.matchAll(/document\.(?:querySelector\("#|getElementById\(")([\w-]+)"/g)) {
    assert.ok(ids.includes(id), `Missing control ${id}`);
  }
  for (const [, references] of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) {
    for (const id of references.split(' ')) assert.ok(ids.includes(id), `Missing ARIA target ${id}`);
  }
  for (const [, script] of source.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
});

test('tool tabs expose one panel, move keyboard focus and reset the scroll position', () => {
  const toolTabs = ['map', 'style', 'layers'].map(name => element({ dataset: { toolTab: name } }));
  const toolPanels = ['Map', 'Style', 'Layers'].map(name => element({ id: `tools${name}` }));
  const scroll = { scrollTop: 140 };
  const app = context(['selectToolTab'], { toolTabs, toolPanels, document: { querySelector: () => scroll } });
  app.selectToolTab('style', true);
  assert.deepEqual(toolPanels.map(panel => panel.hidden), [true, false, true]);
  assert.deepEqual(toolTabs.map(tab => tab.tabIndex), [-1, 0, -1]);
  assert.equal(toolTabs[1].attributes['aria-selected'], 'true');
  assert.equal(toolTabs[1].focused, true);
  assert.equal(scroll.scrollTop, 0);
});

test('palette selection applies colors and recognizes a later custom edit', () => {
  const palettes = { ink: { name: 'Ink', paper: '#ffffff', line: '#181c20', text: '#181c20' } };
  const paperColor = element({ value: '' }), lineColor = element({ value: '' }), textColor = element({ value: '' });
  const label = element();
  const presetButtons = [element({ dataset: { preset: 'ink' } })];
  let redraws = 0;
  const app = context(['applyPalette', 'syncPaletteSelection'], {
    palettes, paperColor, lineColor, textColor, presetButtons,
    setPaperColor(value) { paperColor.value = value; }, setTextColor(value) { textColor.value = value; },
    updateCurrentStyle() { redraws++; }, document: { querySelector: () => label },
  });
  app.applyPalette('ink');
  assert.equal(lineColor.value, '#181c20');
  assert.equal(paperColor.value, '#ffffff');
  assert.equal(textColor.value, '#181c20');
  assert.equal(label.textContent, 'Ink');
  assert.equal(redraws, 1);
  lineColor.value = '#ff0000';
  app.syncPaletteSelection();
  assert.equal(label.textContent, 'Custom');
  assert.equal(presetButtons[0].attributes['aria-pressed'], 'false');
});

function layerControls(value = '3.25') {
  return {
    color: element({ value: '#123456', defaultValue: '#2f7188' }),
    weight: element({ value, defaultValue: '2' }), opacity: element({ value: '0', defaultValue: '0.9' }),
    group: element({ hidden: true }), weightValue: element(), opacityValue: element(),
    colorValue: element(), summary: element(), sample: element(), hint: element(), editButton: element(),
  };
}

test('editing and visibility stay separate and retain each layer’s settings', () => {
  const count = element();
  const ids = ['streets', 'coast', 'forest', 'rivers', 'rail'];
  const state = { allLayerControls: Object.fromEntries(ids.map(id => [id, layerControls()])) };
  state.detailLayerInputs = ids.slice(1).map(name => element({ dataset: { detailLayer: name }, checked: name === 'rivers' }));
  for (const input of state.detailLayerInputs) state.allLayerControls[input.dataset.detailLayer].visibility = input;
  state.document = { querySelector: () => count };
  const app = context(['syncLayerControls', 'updateLayerValues', 'openLayerEditor'], state);
  app.syncLayerControls();
  assert.equal(count.textContent, '2 shown');
  app.openLayerEditor('rail');
  assert.equal(state.allLayerControls.rail.group.hidden, false);
  assert.equal(state.allLayerControls.rail.group.disabled, false, 'Hidden layers can be styled before showing them');
  assert.equal(state.allLayerControls.rail.visibility.checked, false, 'Editing must not turn the layer on');
  assert.match(state.allLayerControls.rail.hint.textContent, /Hidden on the map/);
  app.openLayerEditor('rivers');
  assert.equal(state.allLayerControls.rail.group.hidden, true);
  assert.equal(state.allLayerControls.rivers.editButton.attributes['aria-expanded'], 'true');
  const rivers = state.allLayerControls.rivers;
  rivers.visibility.checked = false;
  app.syncLayerControls();
  assert.equal(rivers.group.hidden, false, 'Hiding the layer must not close its editor');
  rivers.visibility.checked = true;
  app.syncLayerControls();
  assert.equal(rivers.weight.value, '3.25');
  assert.equal(rivers.opacity.value, '0');
  assert.equal(rivers.color.value, '#123456');
  assert.equal(rivers.opacityValue.textContent, '0%');
  assert.equal(rivers.sample.attributes['stroke-opacity'], '0');
  assert.match(rivers.hint.textContent, /Invisible at 0%/);
  app.openLayerEditor('rivers');
  assert.equal(rivers.group.hidden, true);
  assert.equal(rivers.visibility.checked, true, 'Closing an editor must not hide the layer');
});

test('reset affects only its own layer, including streets', () => {
  const ids = ['streets', 'coast', 'forest', 'rivers', 'rail'];
  for (const target of ids) {
    const allLayerControls = Object.fromEntries(ids.map(id => [id, layerControls()]));
    let streetDraws = 0, detailDraws = 0;
    const app = context(['resetLayerStyle', 'updateLayerValues'], {
      allLayerControls, updateCurrentStyle() { streetDraws++; }, updateTextStyle() { detailDraws++; }, syncPaletteSelection() {},
    });
    app.resetLayerStyle(target);
    for (const id of ids) {
      const c = allLayerControls[id];
      assert.equal(c.color.value, id === target ? '#2f7188' : '#123456');
      assert.equal(c.weight.value, id === target ? '2' : '3.25');
      assert.equal(c.opacity.value, id === target ? '0.9' : '0');
    }
    assert.equal(streetDraws, target === 'streets' ? 1 : 0);
    assert.equal(detailDraws, target === 'streets' ? 0 : 1);
  }
});

test('independent layer styles reach Canvas, GPU redraw and vector export including zero opacity', () => {
  const definitions = [['coast', 'coastStyle'], ['forest', 'forestStyle'], ['rivers', 'riverStyle'], ['rail', 'railStyle']];
  let redraws = 0;
  const drawn = [];
  const detailStyleControls = Object.fromEntries(definitions.map(([id], i) => [id, {
    color: { value: ['#102030', '#405060', '#708090', '#abcdef'][i] },
    weight: { value: String(0.1 + i) }, opacity: { value: String(i / 4) },
  }]));
  const app = context(['detailStyle', ...definitions.map(([, fn]) => fn), 'updateTextStyle', 'pathsForSegments'], {
    detailStyleControls, roadRenderer: {}, coastLayers: [],
    setMonumentColor() {}, monumentColor: { value: '#000000' },
    webgpuRoadRenderer: { requestDraw() { redraws++; } },
    escapeXml: s => s, formatSvgNumber: String, pathDataForSegment: () => 'M0 0 L10 10',
  });
  app.coastLayers = definitions.map(([, fn]) => ({ styleFn: app[fn], layer: { setStyle(s) { drawn.push(s); } } }));
  app.updateTextStyle();
  assert.equal(redraws, 1);
  definitions.forEach(([id, fn], i) => {
    const style = app[fn]();
    assert.equal(drawn[i].color, detailStyleControls[id].color.value);
    assert.equal(drawn[i].weight, 0.1 + i);
    assert.equal(drawn[i].opacity, i / 4);
    const svg = app.pathsForSegments([[[0, 0], [10, 10]]], style);
    assert.ok(svg.includes(`stroke="${style.color}"`));
    assert.ok(svg.includes(`stroke-width="${style.weight}"`));
    assert.ok(svg.includes(`stroke-opacity="${style.opacity}"`));
  });
  detailStyleControls.rivers.weight.value = '8';
  assert.equal(app.riverStyle().weight, 8);
  assert.equal(app.railStyle().weight, 3.1);
});

test('external loading is unavailable for searches without an external city selection', () => {
  const state = { streetLoad: null, selectedCity: null, externalLoadControls: element(), sourceLocalBadge: { classList: { toggle() {} } }, sourceOsmBadge: { classList: { toggle() {} } }, dataStateText: element(), cacheStateText: element(), loadExternalAreaButton: element() };
  const app = context(['setDataState'], state);
  app.setDataState({ source: 'osm' });
  assert.equal(state.externalLoadControls.hidden, true);
  assert.equal(state.loadExternalAreaButton.disabled, true);
  app.selectedCity = { external: true };
  app.setDataState({ source: 'osm' });
  assert.equal(state.externalLoadControls.hidden, false);
  assert.equal(state.loadExternalAreaButton.disabled, false);
  app.setDataState({ source: 'local' });
  assert.equal(state.externalLoadControls.hidden, true);
});

test('export requires loaded streets and shows the vector frame ratio', () => {
  const dimensions = element();
  const app = context(['updateExportControls'], { areaDirty: false, detailLoadController: null, detailRefreshTimer: null, printSize: () => ({ widthMm: 300, heightMm: 168.75 }), streetLoad: null, selectedCity: null, currentSegments: [], exportInProgress: false, frameRect: { width: 500.3, height: 300.8 }, frameRatio: [16, 9], downloadPdfButton: element(), downloadSvgButton: element(), downloadPngButton: element(), document: { querySelector: () => dimensions } });
  app.updateExportControls();
  assert.equal(app.downloadPdfButton.disabled, true);
  app.currentSegments = [[[0, 0], [1, 1]]];
  app.updateExportControls();
  assert.equal(app.downloadPdfButton.disabled, false);
  assert.equal(app.downloadPngButton.disabled, false);
  assert.equal(dimensions.textContent, '30.0 × 16.9 cm');
  app.streetLoad = {};
  app.updateExportControls();
  assert.equal(app.downloadSvgButton.disabled, true, 'Partial previews cannot be exported');
  assert.equal(app.downloadPngButton.disabled, true);
  app.streetLoad = null;
  app.exportInProgress = true;
  app.updateExportControls();
  assert.equal(app.downloadSvgButton.disabled, true);
});

test('PDF failure releases the export controls and presents a usable fallback', async () => {
  const note = element();
  const app = vm.createContext({ areaDirty: false, detailLoadController: null, detailRefreshTimer: null, streetLoad: null, currentSegments: [[0]], exportInProgress: false, downloadPdfButton: element(), updateExportControls() {}, exportSvgMarkup() { throw new Error('encoding unavailable'); }, document: { querySelector: () => note } });
  vm.runInContext(`async ${extract('downloadPdf')}`, app);
  await app.downloadPdf();
  assert.equal(app.exportInProgress, false);
  assert.equal(app.downloadPdfButton.textContent, 'PDF');
  assert.match(note.textContent, /Try again, or download SVG/);
});

test('PNG failure releases its lock and controls; incomplete maps cannot start an export', async () => {
  const note = element();
  let snapshots = 0;
  const app = vm.createContext({ areaDirty: false, detailLoadController: null, detailRefreshTimer: null, streetLoad: null, currentSegments: [[0]], exportInProgress: false, downloadPngButton: element(), updateExportControls() {}, exportSvgMarkup() { snapshots++; throw new Error('encoding unavailable'); }, document: { querySelector: () => note } });
  vm.runInContext(`async ${extract('downloadPng')}`, app);
  for (const key of ['areaDirty', 'detailLoadController', 'detailRefreshTimer', 'streetLoad', 'exportInProgress']) {
    app[key] = true;
    await app.downloadPng();
    assert.equal(snapshots, 0, key);
    app[key] = null;
  }
  await app.downloadPng();
  assert.equal(snapshots, 1);
  assert.equal(app.exportInProgress, false);
  assert.equal(app.downloadPngButton.textContent, 'PNG');
  assert.match(note.textContent, /Could not export PNG/);
});

test('closed mobile panel is inert, while desktop controls remain accessible', () => {
  const app = context(['setPanelOpen'], { mobileViewport: { matches: true }, editorPanel: element(), panelToggleButton: element(), document: { body: { classList: { toggle() {} } } } });
  app.setPanelOpen(false);
  assert.equal(app.editorPanel.inert, true);
  app.setPanelOpen(true);
  assert.equal(app.editorPanel.inert, false);
  assert.equal(app.panelToggleButton.attributes['aria-expanded'], 'true');
  app.mobileViewport.matches = false;
  app.setPanelOpen(false);
  assert.equal(app.editorPanel.inert, false);
});

test('Canvas draws rail and rivers above streets, keeping forest behind them', () => {
  const order = [];
  const app = context(['renderSegments'], {
    currentSegments: [], currentCoastSegments: [], currentDetailLineLayers: [], currentMonument: null,
    updateExportControls() {}, clearMonumentMarkers() {}, addMonumentMarker() {},
    coastLayer: { clearLayers() {} }, roadLayer: { clearLayers() {} }, coastLayers: [], roadLayers: [],
    webgpuRoadRenderer: { isActive: () => false, setSegments() {}, setCoastSegments() {}, setDetailLineLayers() {} },
    coastStyle: () => 'coast', addCanvasDetailSegments: (_, style) => order.push(style()), addCanvasRoadSegments: () => order.push('roads'),
  });
  app.renderSegments([], [], ['rail', 'forest', 'rivers'].map(id => ({ id, segments: [], style: () => id })));
  assert.deepEqual(order, ['coast', 'forest', 'roads', 'rail', 'rivers']);
});


test('new city framing uses a local radius instead of the municipal extent', () => {
  const state = { externalAreaSelect: { value: 'frame' }, boundsForRadius: (city, km) => ({ name: city.name, km }) };
  const app = context(['initialCityBounds'], state);
  const city = { name: 'Jaca', bounds: [42.38, -0.78, 42.83, -0.39] };
  assert.deepEqual(app.initialCityBounds(city), { name: 'Jaca', km: 5 });
  state.externalAreaSelect.value = '10';
  assert.deepEqual(app.initialCityBounds(city), { name: 'Jaca', km: 10 });
});

test('frame changes debounce loading and immediately invalidate exports', () => {
  const timers = new Map();
  let id = 0, loads = 0, updates = 0;
  const app = context(['scheduleAreaRefresh'], {
    autoLoadEnabled: true, selectedCity: { external: true }, areaRefreshTimer: null, areaDirty: false,
    externalAreaSelect: { value: 'frame' },
    clearTimeout: key => timers.delete(key), setTimeout: callback => { timers.set(++id, callback); return id; },
    updateExportControls: () => updates++, loadSelectedExternalArea: () => loads++,
  });
  app.scheduleAreaRefresh(); app.scheduleAreaRefresh();
  assert.equal(timers.size, 1);
  assert.equal(app.areaDirty, true);
  assert.equal(updates, 2);
  [...timers.values()][0]();
  assert.equal(loads, 1);
  app.autoLoadEnabled = false;
  app.scheduleAreaRefresh();
  assert.equal(updates, 2);
});

test('physical dimensions follow the frame ratio and reject oversized prints', () => {
  const app = context(['printSize'], { printWidth: { value: '30' }, frameRatio: [3, 4] });
  assert.equal(app.printSize().heightMm, 400);
  app.printWidth.value = '120';
  assert.throws(() => app.printSize(), /height/);
  app.printWidth.value = '';
  assert.throws(() => app.printSize(), /width/);
});

test('OSM names and detail labels remain text in map metadata', () => {
  const cityMeta = element();
  const app = context(['escapeHtml', 'updateCityMeta'], { cityMeta, detailLayerDefinitions: {} });
  app.updateCityMeta({ name: '<img src=x onerror=alert(1)>', external: true }, [[1]], [], [], { name: '<svg onload=alert(2)>' });
  assert.doesNotMatch(cityMeta.innerHTML, /<img|<svg/);
  assert.match(cityMeta.innerHTML, /&lt;img/);
  assert.match(cityMeta.innerHTML, /&lt;svg/);
});

test('an obsolete search can cancel its wait before contacting the provider', async () => {
  const app = context(['waitForSearchSlot'], { setTimeout, clearTimeout });
  const controller = new AbortController();
  const pending = app.waitForSearchSlot(5000, controller.signal);
  controller.abort(new Error('query changed'));
  await assert.rejects(pending, /query changed/);
  await app.waitForSearchSlot(0);
});


test('panning does not grow the geometry memory cache without bound', () => {
  const app = context(['createMemoryCache'], {});
  const cache = app.createMemoryCache(2);
  const a = [[[1, 2], [3, 4]]];
  cache.set('a', a); cache.set('b', a); cache.get('a'); cache.set('c', a);
  assert.equal(cache.has('b'), false, 'Least recently used geometry is released');
  assert.equal(cache.get('a'), a);
  cache.set('huge', [Array(500001)]);
  assert.equal(cache.has('huge'), false, 'Very large maps are rendered without a second retained copy');
  cache.clear();
  assert.equal(cache.has('a'), false);
});
