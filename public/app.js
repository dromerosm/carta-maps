
      const artworkFontStyles = document.querySelector("#artworkFonts").textContent;
      const roadRenderer = L.canvas({ padding: 0.35 });
      const coastLayer = L.layerGroup();
      const monumentLayer = L.layerGroup();
      const roadLayer = L.layerGroup();
      const labelLayer = L.layerGroup();
      const coastLayers = [];
      const monumentMarkers = [];
      const roadLayers = [];
      const detailCache = createMemoryCache(3);
      const coastCache = new Map();
      const detailLineCache = createMemoryCache(8);
      const monumentCache = new Map();
      const webgpuRoadStatus = {
        supported: Boolean(navigator.gpu),
        active: false,
        reason: "pending",
        renderedSegments: 0,
        renderedCoastSegments: 0,
        renderedVertices: 0,
        sampleCount: 4,
        pixelRatio: webGpuPixelRatio(),
      };
      const nominatimSearchEndpoint = "./api/search";
      const localCache = createLocalCache();
      let areaRefreshTimer = null;
      let areaDirty = false;
      let autoLoadEnabled = false;

      let selectedCity = null;
      let currentMode = "empty";
      let currentSegments = [];
      let currentCoastSegments = [];
      let currentDetailLineLayers = [];
      let currentMonument = null;
      let renderToken = 0;
      let exportInProgress = false;
      let detailRenderToken = 0;
      let nominatimSearchToken = 0;
      let nominatimSearchController = null;
      let nextNominatimRequestAt = 0;
      let detailRefreshTimer = null;
      let detailLoadController = null;

      const map = L.map("map", {
        preferCanvas: true,
        zoomControl: false,
        minZoom: 5,
        maxZoom: 18,
        zoomSnap: 0,
        zoomDelta: 0.25,
        attributionControl: false,
      });

      L.control.zoom({ position: "bottomleft" }).addTo(map);
      map.createPane("cityDetails");
      map.getPane("cityDetails").classList.add("detail-marker-pane");
      map.getPane("cityDetails").style.zIndex = "660";
      map.getPane("cityDetails").style.width = "100%";
      map.getPane("cityDetails").style.height = "100%";

      coastLayer.addTo(map);
      monumentLayer.addTo(map);
      roadLayer.addTo(map);
      labelLayer.addTo(map);

      const citySearch = document.querySelector("#citySearch");
      const toolTabs = Array.from(document.querySelectorAll("[data-tool-tab]"));
      const toolPanels = Array.from(document.querySelectorAll(".tool-content"));
      const presetButtons = Array.from(document.querySelectorAll("[data-preset]"));
      const palettes = {
        classic: { name: "Classic", paper: "#f5f4ec", line: "#20251c", text: "#20251c" },
        blueprint: { name: "Blueprint", paper: "#102d46", line: "#b8dff0", text: "#ffffff" },
        ink: { name: "Ink", paper: "#ffffff", line: "#181c20", text: "#181c20" },
        forest: { name: "Forest", paper: "#edf1ea", line: "#32574a", text: "#203d32" },
      };
      const panelToggleButton = document.querySelector("#panelToggleButton");
      const editorPanel = document.querySelector("#editorPanel");
      const mobileViewport = window.matchMedia("(max-width: 760px)");
      const printWidth = document.querySelector("#printWidth");
      const printTitle = document.querySelector("#printTitle");
      const pdfCropMarksToggle = document.querySelector("#pdfCropMarksToggle");
      const gridToggle = document.querySelector("#gridToggle");
      const compositionGrid = document.querySelector("#compositionGrid");
      const externalLoadControls = document.querySelector("#externalLoadControls");
      const osmResultList = document.querySelector("#osmResultList");
      const fitCityButton = document.querySelector("#fitCityButton");
      const downloadPdfButton = document.querySelector("#downloadPdfButton");
      const downloadSvgButton = document.querySelector("#downloadSvgButton");
      const downloadPngButton = document.querySelector("#downloadPngButton");
      const cityMeta = document.querySelector("#cityMeta");
      const statusText = document.querySelector("#statusText");
      const fineZoomRange = document.querySelector("#fineZoomRange");
      const fineZoomValue = document.querySelector("#fineZoomValue");
      const weightRange = document.querySelector("#weightRange");
      const opacityRange = document.querySelector("#opacityRange");
      const weightValue = document.querySelector("#weightValue");
      const opacityValue = document.querySelector("#opacityValue");
      const cancelStreetLoadButton = document.querySelector("#cancelStreetLoadButton");
      let streetLoad = null;
      let lastStreetLoad = null;
      const vectorModule = () => import("./city-roads/openfreemap.mjs");
      const externalAreaSelect = document.querySelector("#externalAreaSelect");
      const externalRoadModeSelect = document.querySelector("#externalRoadModeSelect");
      const loadExternalAreaButton = document.querySelector("#loadExternalAreaButton");
      const sourceOsmBadge = document.querySelector("#sourceOsmBadge");
      const dataStateText = document.querySelector("#dataStateText");
      const cacheStateText = document.querySelector("#cacheStateText");
      const themeToggleButton = document.querySelector("#themeToggleButton");
      const lineColor = document.querySelector("#lineColor");
      const paperColor = document.querySelector("#paperColor");
      const textColor = document.querySelector("#textColor");
      const coastColor = document.querySelector("#coastColor");
      const forestColor = document.querySelector("#forestColor");
      const riverColor = document.querySelector("#riverColor");
      const railColor = document.querySelector("#railColor");
      const parkColor = { value: "#2b8e68" };
      const monumentColor = { value: "#d02020" };
      const framePaper = document.querySelector("#framePaper");
      const compositionFrame = document.querySelector("#compositionFrame");
      const frameButtons = Array.from(document.querySelectorAll("[data-frame-ratio]"));
      const rangeStepButtons = Array.from(document.querySelectorAll("[data-range-target]"));
      const detailLayerInputs = Array.from(document.querySelectorAll("[data-detail-layer]"));
      const detailStyleControls = Object.fromEntries([
        ["coast", "coast", coastColor], ["forest", "forest", forestColor],
        ["rivers", "river", riverColor], ["rail", "rail", railColor],
      ].map(([id, prefix, color]) => [id, {
        color, weight: document.getElementById(`${prefix}WeightRange`),
        opacity: document.getElementById(`${prefix}OpacityRange`),
        weightValue: document.getElementById(`${prefix}WeightValue`),
        opacityValue: document.getElementById(`${prefix}OpacityValue`),
        group: document.getElementById(`${prefix}StyleControls`),
      }]));
      const allLayerControls = { streets: { color: lineColor, weight: weightRange, opacity: opacityRange, weightValue, opacityValue, group: document.getElementById("streetStyleControls") }, ...detailStyleControls };
      for (const [id, controls] of Object.entries(allLayerControls)) {
        const prefix = id === "streets" ? "street" : id === "rivers" ? "river" : id;
        controls.editButton = document.getElementById(`${prefix}EditButton`);
        controls.summary = document.getElementById(`${prefix}StyleSummary`);
        controls.sample = document.getElementById(`${prefix}Sample`);
        controls.colorValue = document.getElementById(`${prefix}ColorValue`);
        controls.hint = document.getElementById(`${prefix}VisibilityHint`);
        controls.visibility = detailLayerInputs.find(input => input.dataset.detailLayer === id);
      }
      const creditCityName = document.querySelector("#creditCityName");

      let frameRatio = [16, 9];
      let frameRect = null;
      const webgpuRoadRenderer = createWebGpuCityRoadRenderer(map);
      const detailLayerDefinitions = {
        coast: { id: "coast", type: "line", status: "coastline", style: coastStyle },
        forest: { id: "forest", type: "line", status: "forest", style: forestStyle },
        rivers: { id: "rivers", type: "line", status: "rivers", style: riverStyle },
        rail: { id: "rail", type: "line", status: "rail", style: railStyle },
      };

      window.WEBGPU_ROAD_STATUS = webgpuRoadStatus;

      window.CITY_ROADS_APP = {
        downloadPdf,
        downloadSvg,
        downloadPng,
        exportSvgMarkup,
        get state() {
          return {
            mode: currentMode,
            selectedCity: selectedCity?.name ?? null,
            renderer: webgpuRoadStatus.active ? "webgpu" : "canvas",
            zoom: map.getZoom(),
            textColor: textColor.value,
            external: Boolean(selectedCity?.external),
            externalArea: externalAreaSelect.value,
            externalRoadMode: externalRoadModeSelect.value,
            streetProvider: "openfreemap",
            streetLoad: lastStreetLoad,
            renderedRoadLayers: roadLayers.length,
            renderedSegments: currentSegments.length,
            renderedCoastSegments: currentCoastSegments.length,
            renderedDetailLineSegments: currentDetailLineLayers.reduce((total, layer) => total + layer.segments.length, 0),
            monument: currentMonument?.name ?? null,
            detailColors: detailColorState(),
            cachedDetails: detailCache.size,
            cachedCoasts: coastCache.size,
            cachedDetailLayers: detailLineCache.size,
            cachedMonuments: monumentCache.size,
            frameRatio: `${frameRatio[0]}:${frameRatio[1]}`,
            frameRect,
            webgpu: { ...webgpuRoadStatus },
          };
        },
      };

      function style() {
        return {
          color: lineColor.value,
          weight: Number(weightRange.value),
          opacity: Number(opacityRange.value),
          renderer: roadRenderer,
          interactive: false,
          lineCap: "round",
          lineJoin: "round",
        };
      }

      function detailStyle(id) {
        const controls = detailStyleControls[id];
        return {
          color: controls.color.value, weight: Number(controls.weight.value), opacity: Number(controls.opacity.value),
          renderer: roadRenderer, interactive: false, lineCap: "round", lineJoin: "round",
        };
      }

      function coastStyle() { return detailStyle("coast"); }
      function riverStyle() { return detailStyle("rivers"); }
      function railStyle() { return detailStyle("rail"); }
      function forestStyle() { return detailStyle("forest"); }

      function parkStyle() {
        return {
          color: parkColor.value,
          weight: 0.65,
          opacity: 0.24,
          renderer: roadRenderer,
          interactive: false,
          lineCap: "round",
          lineJoin: "round",
        };
      }

      function setStatus(text) {
        statusText.textContent = text;
        statusText.dataset.state = /could not|failed|not found|reduce area/i.test(text) ? "error" : /loading|searching|creating/i.test(text) ? "loading" : "ready";
      }

      function rendererStatusText() {
        return currentSegments.length ? "Map ready" : "Choose a city";
      }

      function updateRendererStatus() {
        setStatus(rendererStatusText());
      }

      function setDataState({ source = "osm", state = "OpenStreetMap · place search", cache = "Ready" } = {}) {
        const canLoad = source === "osm" && Boolean(selectedCity?.external);
        externalLoadControls.hidden = !canLoad;
        sourceOsmBadge.classList.toggle("active", source === "osm");
        dataStateText.textContent = state;
        cacheStateText.textContent = cache;
        loadExternalAreaButton.disabled = !canLoad;
        if (streetLoad) setStreetLoading(true);
      }

      function setPaperColor(value) {
        document.documentElement.style.setProperty("--frame-paper", value);
        setTextColor(bestTextColorForBackground(value));
      }

      function setTextColor(value) {
        textColor.value = value;
        document.documentElement.style.setProperty("--art-text", value);
        updateTextStyle();
      }

      function setMonumentColor(value) {
        document.documentElement.style.setProperty("--detail-monument-color", value);
      }

      function detailColorState() {
        return {
          coast: coastColor.value,
          forest: forestColor.value,
          rivers: riverColor.value,
          rail: railColor.value,
          parks: parkColor.value,
          monument: monumentColor.value,
        };
      }

      function setTheme(theme) {
        const isDark = theme === "dark";
        document.body.classList.toggle("theme-dark", isDark);
        themeToggleButton.textContent = isDark ? "☼" : "☾";
        themeToggleButton.title = isDark ? "Switch to light mode" : "Switch to dark mode";
        themeToggleButton.setAttribute("aria-label", themeToggleButton.title);
        themeToggleButton.setAttribute("aria-pressed", String(isDark));
        try {
          window.localStorage.setItem("city-roads-theme", theme);
        } catch {
          // Ignore storage failures; the toggle should still work for this session.
        }
      }

      function toggleTheme() {
        setTheme(document.body.classList.contains("theme-dark") ? "light" : "dark");
      }

      function initialTheme() {
        try {
          const stored = window.localStorage.getItem("city-roads-theme");
          if (stored === "dark" || stored === "light") return stored;
        } catch {
          // Fall through to system preference.
        }
        return "light";
      }

      function clearRoads() {
        detailLoadController?.abort();
        detailRenderToken++;
        currentSegments = [];
        updateExportControls();
        currentCoastSegments = [];
        currentDetailLineLayers = [];
        currentMonument = null;
        coastLayer.clearLayers();
        clearMonumentMarkers();
        roadLayer.clearLayers();
        labelLayer.clearLayers();
        coastLayers.length = 0;
        roadLayers.length = 0;
        webgpuRoadRenderer.setSegments([]);
        webgpuRoadRenderer.setCoastSegments([]);
        webgpuRoadRenderer.setDetailLineLayers([]);
      }

      function addCanvasDetailSegments(segments, styleFn) {
        const layerStyle = styleFn();
        for (const segment of segments) {
          const layer = L.polyline(segment, layerStyle).addTo(coastLayer);
          coastLayers.push({ layer, styleFn });
        }
      }

      function addCanvasRoadSegments(segments) {
        const layerStyle = style();
        for (const segment of segments) {
          const layer = L.polyline(segment, layerStyle).addTo(roadLayer);
          roadLayers.push(layer);
        }
      }

      function renderSegments(segments, coastSegments = [], detailLineLayers = [], monument = null) {
        currentSegments = segments;
        updateExportControls();
        currentCoastSegments = coastSegments;
        currentDetailLineLayers = detailLineLayers;
        currentMonument = monument;
        coastLayer.clearLayers();
        clearMonumentMarkers();
        roadLayer.clearLayers();
        coastLayers.length = 0;
        roadLayers.length = 0;
        if (webgpuRoadRenderer.isActive()) {
          webgpuRoadRenderer.setSegments(segments);
          webgpuRoadRenderer.setCoastSegments(coastSegments);
          webgpuRoadRenderer.setDetailLineLayers(detailLineLayers);
          addMonumentMarker(monument);
          return;
        }
        addCanvasDetailSegments(coastSegments, coastStyle);
        for (const layer of detailLineLayers.filter(layer => !["rail", "rivers"].includes(layer.id))) {
          addCanvasDetailSegments(layer.segments, layer.style);
        }
        addMonumentMarker(monument);
        webgpuRoadRenderer.setSegments([]);
        webgpuRoadRenderer.setCoastSegments([]);
        webgpuRoadRenderer.setDetailLineLayers([]);
        addCanvasRoadSegments(segments);
        for (const layer of detailLineLayers.filter(layer => ["rail", "rivers"].includes(layer.id))) addCanvasDetailSegments(layer.segments, layer.style);
      }

      function addMonumentMarker(monument) {
        if (!monument) return;
        const marker = document.createElement("div");
        marker.className = "monument-overlay-marker";
        marker.title = monument.name;
        marker.innerHTML = `<span class="monument-dot" aria-hidden="true"></span>`;
        map.getContainer().appendChild(marker);

        const updateMarkerPosition = () => {
          updateFrame();
          const point = map.latLngToContainerPoint([monument.lat, monument.lon]);
          marker.style.left = `${point.x}px`;
          marker.style.top = `${point.y}px`;
          const insideFrame =
            point.x >= frameRect.left &&
            point.x <= frameRect.right &&
            point.y >= frameRect.top &&
            point.y <= frameRect.bottom;
          marker.hidden = !insideFrame;
        };

        for (const eventName of ["move", "zoom", "resize"]) {
          map.on(eventName, updateMarkerPosition);
        }
        marker.cleanup = () => {
          for (const eventName of ["move", "zoom", "resize"]) {
            map.off(eventName, updateMarkerPosition);
          }
          marker.remove();
        };
        updateMarkerPosition();
        monumentMarkers.push(marker);
      }

      function clearMonumentMarkers() {
        monumentLayer.clearLayers();
        for (const marker of monumentMarkers) {
          if (typeof marker.cleanup === "function") {
            marker.cleanup();
          } else if (typeof marker.remove === "function") {
            marker.remove();
          }
        }
        monumentMarkers.length = 0;
      }

      function addCityLabel(city) {
        creditCityName.textContent = printTitle.value.trim();
      }

      function boundsForCity(city) {
        return L.latLngBounds(
          [city.bounds[0], city.bounds[1]],
          [city.bounds[2], city.bounds[3]]
        );
      }

      function frameAreaBounds() {
        const mapSize = map.getSize();
        const panelRect = document.querySelector(".panel").getBoundingClientRect();
        const topbarHeight = document.querySelector(".app-topbar").getBoundingClientRect().height;
        const isMobile = window.innerWidth <= 760;
        const leftMargin = isMobile ? 18 : Math.min(mapSize.x - 110, Math.ceil(panelRect.right + 48));
        const topMargin = Math.ceil(topbarHeight + (isMobile ? 32 : 64));
        const rightMargin = isMobile ? 18 : 28;
        const bottomMargin = isMobile ? 32 : 70;
        return {
          left: leftMargin,
          top: topMargin,
          width: Math.max(80, mapSize.x - leftMargin - rightMargin),
          height: Math.max(80, mapSize.y - topMargin - bottomMargin),
        };
      }

      function updateFrame() {
        const area = frameAreaBounds();
        const ratio = frameRatio[0] / frameRatio[1];
        let width = area.width;
        let height = width / ratio;
        if (height > area.height) {
          height = area.height;
          width = height * ratio;
        }
        const left = area.left + (area.width - width) / 2;
        const top = area.top + (area.height - height) / 2;
        frameRect = {
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
        };
        for (const element of [compositionFrame, framePaper]) {
          element.style.setProperty("--frame-left", `${Math.round(left)}px`);
          element.style.setProperty("--frame-top", `${Math.round(top)}px`);
          element.style.setProperty("--frame-width", `${Math.round(width)}px`);
          element.style.setProperty("--frame-height", `${Math.round(height)}px`);
          element.dataset.ready = "true";
        }
        applyFrameClip();
        updateExportControls();
      }

      function applyFrameClip() {
        const mapSize = map.getSize();
        const clipValues = {
          "--render-clip-left": Math.max(0, Math.round(frameRect.left)),
          "--render-clip-top": Math.max(0, Math.round(frameRect.top)),
          "--render-clip-right": Math.max(0, Math.round(mapSize.x - frameRect.right)),
          "--render-clip-bottom": Math.max(0, Math.round(mapSize.y - frameRect.bottom)),
        };
        for (const [property, value] of Object.entries(clipValues)) {
          map.getContainer().style.setProperty(property, `${value}px`);
        }
      }

      function framePadding() {
        updateFrame();
        const mapSize = map.getSize();
        const innerPadding = 18;
        return {
          paddingTopLeft: [
            Math.max(0, Math.round(frameRect.left + innerPadding)),
            Math.max(0, Math.round(frameRect.top + innerPadding)),
          ],
          paddingBottomRight: [
            Math.max(0, Math.round(mapSize.x - frameRect.right + innerPadding)),
            Math.max(0, Math.round(mapSize.y - frameRect.bottom + innerPadding)),
          ],
        };
      }

      function boundsForFrame() {
        updateFrame();
        const southWest = map.containerPointToLatLng([frameRect.left, frameRect.bottom]);
        const northEast = map.containerPointToLatLng([frameRect.right, frameRect.top]);
        return [
          Math.min(southWest.lat, northEast.lat),
          Math.min(southWest.lng, northEast.lng),
          Math.max(southWest.lat, northEast.lat),
          Math.max(southWest.lng, northEast.lng),
        ];
      }

      function boundsForRadius(city, radiusKm) {
        const latDelta = radiusKm / 111;
        const lonDelta = radiusKm / Math.max(1, 111 * Math.cos(city.labelLat * Math.PI / 180));
        return [
          city.labelLat - latDelta,
          city.labelLon - lonDelta,
          city.labelLat + latDelta,
          city.labelLon + lonDelta,
        ];
      }

      function selectedExternalBounds() {
        if (!selectedCity?.external) return null;
        if (externalAreaSelect.value === "frame") return boundsForFrame();
        return boundsForRadius(selectedCity, Number(externalAreaSelect.value));
      }

      function initialCityBounds(city) {
        // A municipality can span hundreds of square kilometres. Start around
        // the selected place, using the same scale as a normal on-demand load.
        const radiusKm = externalAreaSelect.value === "frame" ? 5 : Number(externalAreaSelect.value);
        return boundsForRadius(city, radiusKm);
      }

      function fitCity(city) {
        const padding = framePadding();
        map.fitBounds(boundsForCity(city), {
          animate: false,
          paddingTopLeft: padding.paddingTopLeft,
          paddingBottomRight: padding.paddingBottomRight,
        });
      }

      async function loadDetail(city) {
        return loadVectorDetail(city);
      }

      async function searchWorldPlaces(query, signal) {
        const cacheKey = `places-city-v3:${navigator.language}:${normalize(query)}`;
        const cached = await localCache.get(cacheKey);
        if (cached?.cities) return cached.cities;
        signal?.throwIfAborted();
        const requestAt = Math.max(Date.now(), nextNominatimRequestAt);
        nextNominatimRequestAt = requestAt + 1100;
        await waitForSearchSlot(Math.max(0, requestAt - Date.now()), signal);
        setStatus(`Searching ${query}`);
        const response = await fetch(nominatimSearchEndpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, language: navigator.language || "en" }), signal,
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.error || `City search returned ${response.status}.`);
        }
        const results = await response.json();
        const cities = nominatimResultsToCities(results);
        if (!cities.length) throw new Error(`No city found for ${query}.`);
        await localCache.set(cacheKey, { cachedAt: Date.now(), cities });
        return cities;
      }

      function waitForSearchSlot(delay, signal) {
        return new Promise((resolve, reject) => {
          let timer;
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          }, delay);
        });
      }

      function isLocalityResult(place) {
        const category = place.class ?? place.category;
        const localityTypes = ["city", "town", "village", "hamlet", "municipality"];
        if (category === "place") return localityTypes.includes(place.addresstype || place.type);
        // Administrative boundaries also describe cities, but not every boundary is a city.
        return category === "boundary" && place.type === "administrative"
          && localityTypes.includes(place.addresstype);
      }

      function nominatimResultsToCities(results) {
        return results
          .filter(isLocalityResult)
          .map(cityFromNominatim)
          .filter((city) => Number.isFinite(city.labelLat) && Number.isFinite(city.labelLon));
      }

      function cityFromNominatim(place) {
        const lat = Number(place.lat);
        const lon = Number(place.lon);
        const bounds = boundsFromNominatim(place, lat, lon);
        const name = place.address?.city || place.address?.town || place.address?.village || place.address?.municipality || place.name || place.display_name.split(",")[0];
        const address = place.address ?? {};
        return {
          name,
          external: true,
          externalId: `osm:${place.osm_type}:${place.osm_id}`,
          bounds,
          labelLat: lat,
          labelLon: lon,
          fullSegmentCount: 0,
          segments: [],
          displayName: place.display_name,
          placeType: place.addresstype || place.type || place.class || "place",
          regionName: address.state || address.province || address.county || address.region || "",
          countryName: address.country || "",
          countryCode: address.country_code || "",
        };
      }

      function boundsFromNominatim(place, lat, lon) {
        if (Array.isArray(place.boundingbox) && place.boundingbox.length === 4) {
          const south = Number(place.boundingbox[0]);
          const north = Number(place.boundingbox[1]);
          const west = Number(place.boundingbox[2]);
          const east = Number(place.boundingbox[3]);
          if ([south, west, north, east].every(Number.isFinite)) {
            return limitBoundsAroundCenter([south, west, north, east], lat, lon);
          }
        }
        return [lat - 0.035, lon - 0.035, lat + 0.035, lon + 0.035];
      }

      function limitBoundsAroundCenter(bounds, lat, lon) {
        const maxLatSpan = 0.24;
        const maxLonSpan = 0.28;
        const south = Math.max(bounds[0], lat - maxLatSpan / 2);
        const north = Math.min(bounds[2], lat + maxLatSpan / 2);
        const west = Math.max(bounds[1], lon - maxLonSpan / 2);
        const east = Math.min(bounds[3], lon + maxLonSpan / 2);
        if (north - south < 0.025 || east - west < 0.025) {
          return [lat - 0.035, lon - 0.035, lat + 0.035, lon + 0.035];
        }
        return [south, west, north, east];
      }

      function cityCacheKey(city) {
        return city.externalId ?? city.name;
      }

      function externalRoadCacheKey(city) {
        return `ofm-roads-v3:${city.tileSource}:${cityCacheKey(city)}:${city.roadMode}:${boundsCacheKey(city.bounds)}`;
      }

      function boundsCacheKey(bounds) {
        return bounds.map((value) => Number(value).toFixed(5)).join(",");
      }

      function externalCitySnapshot(city) {
        return {
          name: city.name,
          external: true,
          externalId: city.externalId,
          bounds: city.bounds,
          labelLat: city.labelLat,
          labelLon: city.labelLon,
          fullSegmentCount: city.fullSegmentCount,
          segments: [],
          displayName: city.displayName,
          roadProvider: city.roadProvider,
          tileSource: city.tileSource,
          roadMode: city.roadMode,
        };
      }

      function resolvedExternalRoadMode() {
        if (externalRoadModeSelect.value !== "auto") return externalRoadModeSelect.value;
        return map.getZoom() < 12.75 ? "major" : "all";
      }

      function lineDetailCacheKey(city, definition) {
        return `detail-v4:${definition.id}:openfreemap:${city.tileSource || ""}:${cityCacheKey(city)}:${boundsCacheKey(city.bounds)}`;
      }

      async function loadLineDetail(city, definition, signal) {
        const key = lineDetailCacheKey(city, definition);
        signal?.throwIfAborted();
        if (detailLineCache.has(key)) return detailLineCache.get(key);
        const module = await vectorModule();
        const metadata = city.tileSource ? { tiles: [city.tileSource], maxzoom: 14 } : undefined;
        const result = await module.loadOpenFreeMapLines({ bounds: city.bounds, layer: definition.id, metadata, signal, timeoutMs: 25000 });
        signal?.throwIfAborted();
        detailLineCache.set(key, result.segments);
        return result.segments;
      }

      async function renderCity(city, shouldFit = true) {
        autoLoadEnabled = false;
        areaDirty = false;
        clearTimeout(areaRefreshTimer);
        cancelStreetLoading();
        ++renderToken;
        ++detailRenderToken;
        clearNominatimOptions();
        currentMode = "detail";
        selectedCity = { ...city, bounds: initialCityBounds(city), external: true, roadProvider: "openfreemap" };
        clearRoads();
        printTitle.value = selectedCity.name;
        addCityLabel(selectedCity);
        if (shouldFit) fitCity(selectedCity);
        updateRoadAttribution();
        updateActiveCity();
        setDataState({ source: "osm", state: "OpenFreeMap · choose area and detail", cache: "Ready" });
        cityMeta.innerHTML = `<strong>${escapeHtml(city.name)}</strong><span>Adjust the area and load streets from OpenFreeMap.</span>`;
        setStatus("Ready to load streets");
      }

      function scheduleRefreshSelectedDetails() {
        window.clearTimeout(detailRefreshTimer);
        detailRenderToken++;
        detailLoadController?.abort();
        detailRefreshTimer = window.setTimeout(() => { detailRefreshTimer = null; refreshSelectedDetails(); }, 250);
        updateExportControls();
      }

      function setLayerStatus(id, text) {
        const label = document.querySelector(`#${id}LayerStatus`);
        if (label) label.textContent = text;
      }

      async function refreshSelectedDetails() {
        if (streetLoad || !selectedCity || currentSegments.length === 0) return;
        detailLoadController?.abort();
        const controller = new AbortController();
        detailLoadController = controller;
        updateExportControls();
        const token = ++detailRenderToken;
        const city = selectedCity;
        const segments = currentSegments;
        const activeDefinitions = activeDetailDefinitions();
        const lineResults = [];
        let monument = null;
        let failures = 0;
        let remaining = activeDefinitions.length;
        const isCurrent = () => token === detailRenderToken && selectedCity === city;
        const deadline = window.setTimeout(() => controller.abort(new DOMException("Layer loading timed out", "TimeoutError")), 25000);
        for (const input of detailLayerInputs) {
          setLayerStatus(input.dataset.detailLayer, input.checked ? "Loading…" : "Off");
        }
        // Remove disabled layers immediately and retain already loaded active layers.
        const activeIds = new Set(activeDefinitions.map(d => d.id));
        renderSegments(segments, activeIds.has("coast") ? currentCoastSegments : [], currentDetailLineLayers.filter(l => activeIds.has(l.id)), activeIds.has("monument") ? currentMonument : null);
        if (remaining) setStatus(`Map ready · loading ${remaining} layer${remaining === 1 ? "" : "s"}`);
        try {
          await Promise.all(activeDefinitions.map(async definition => {
            const started = performance.now();
            try {
              const loadedSegments = await loadLineDetail(city, definition, controller.signal);
              if (!isCurrent()) return;
              lineResults.push({ definition, segments: loadedSegments });
              setLayerStatus(definition.id, loadedSegments.length ? `${loadedSegments.length.toLocaleString("en-US")} paths · OpenFreeMap · ${((performance.now() - started) / 1000).toFixed(1)} s` : "No features in this area");
            } catch (error) {
              if (!isCurrent()) return;
              failures++;
              setLayerStatus(definition.id, "Could not load · switch off and on to retry");
            }
            if (!isCurrent()) return;
            remaining--;
            applyLoadedDetails(city, segments, lineResults, monument);
            if (remaining) setStatus(`Map ready · loading ${remaining} layer${remaining === 1 ? "" : "s"}`);
          }));
          if (isCurrent()) {
            applyLoadedDetails(city, segments, lineResults, monument);
            if (failures) setStatus(`Map ready · ${failures} layer${failures === 1 ? "" : "s"} could not load`);
            else updateRendererStatus();
          }
        } finally {
          window.clearTimeout(deadline);
          if (detailLoadController === controller) detailLoadController = null;
          updateExportControls();
        }
      }

      function applyLoadedDetails(city, segments, lineResults, monument) {
        const coastSegments = lineResults.find((result) => result.definition.id === "coast")?.segments ?? [];
        const detailLineLayers = lineResults
          .filter((result) => result.definition.id !== "coast")
          .map((result) => ({
            id: result.definition.id,
            segments: result.segments,
            style: result.definition.style,
          }));
        renderSegments(segments, coastSegments, detailLineLayers, monument);
        updateCityMeta(city, segments, coastSegments, detailLineLayers, monument);
      }

      function activeDetailDefinitions() {
        return detailLayerInputs
          .filter((input) => input.checked)
          .map((input) => detailLayerDefinitions[input.dataset.detailLayer])
          .filter(Boolean);
      }

      function updateCityMeta(city, segments, coastSegments, detailLineLayers = [], monument = null) {
        const detailParts = [];
        if (coastSegments.length) detailParts.push(`Coastline: ${coastSegments.length.toLocaleString("en-US")} traces`);
        for (const layer of detailLineLayers) {
          if (layer.segments.length) {
            detailParts.push(`${detailLayerDefinitions[layer.id].status}: ${layer.segments.length.toLocaleString("en-US")} traces`);
          }
        }
        if (monument) detailParts.push(`Monument: ${monument.name}`);
        const completeCount = city.fullSegmentCount || segments.length;
        cityMeta.innerHTML = `
          <strong>${escapeHtml(city.name)}</strong>
          <span>${segments.length.toLocaleString("en-US")} visible segments. ${completeCount.toLocaleString("en-US")} full segments available.${city.external ? " OSM on demand." : ""}${detailParts.length ? ` ${escapeHtml(detailParts.join(". "))}.` : ""}</span>
        `;
      }

      function setInitialEmptyView() {
        detailRenderToken += 1;
        currentMode = "empty";
        selectedCity = null;
        clearRoads();
        creditCityName.textContent = "";
        updateActiveCity();
        map.setView([40, -3], 5);
        setDataState({
          source: "osm",
          state: "OpenStreetMap · place search",
          cache: "Ready",
        });
        cityMeta.innerHTML = `<span>Search for a city or town, then choose a result to load its streets.</span>`;
        updateRendererStatus();
      }

      function normalize(text) {
        return text
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function renderNominatimOptions(cities, query) {
        osmResultList.innerHTML = "";
        osmResultList.classList.toggle("hidden", !cities.length);
        if (!cities.length) return;
        for (const city of cities) {
          const button = document.createElement("button");
          button.className = "osm-result-button";
          button.type = "button";
          button.innerHTML = `
            <span>
              <span class="osm-result-main">${escapeHtml(city.name)}</span>
              <span class="osm-result-sub">${escapeHtml(nominatimOptionSummary(city))}</span>
            </span>
            <span class="badge">OSM</span>
          `;
          button.addEventListener("click", () => selectNominatimOption(city));
          osmResultList.appendChild(button);
        }
        cityMeta.innerHTML = `<span>${cities.length} OpenStreetMap result${cities.length === 1 ? "" : "s"} for "${escapeHtml(query)}". Choose one to continue.</span>`;
      }

      function clearNominatimOptions() {
        osmResultList.innerHTML = "";
        osmResultList.classList.add("hidden");
      }

      function nominatimOptionSummary(city) {
        return [city.placeType, city.regionName, city.countryName || city.countryCode.toUpperCase()]
          .filter(Boolean)
          .join(" · ");
      }

      async function selectNominatimOption(city) {
        clearNominatimOptions();
        citySearch.value = city.name;
        document.querySelector("#searchWorldButton").disabled = city.name.trim().length < 2;
        await renderCity(city);
      }

      async function searchAndRenderWorldPlace(query = citySearch.value.trim()) {
        if (query.length < 2) return;
        const token = ++nominatimSearchToken;
        nominatimSearchController?.abort();
        const controller = new AbortController();
        nominatimSearchController = controller;
        const deadline = setTimeout(() => controller.abort(new DOMException("Search timed out", "TimeoutError")), 15000);
        try {
          setDataState({
            source: "osm",
            state: "OSM search · Nominatim",
            cache: "Searching",
          });
          setStatus("Searching OpenStreetMap");
          const cities = await searchWorldPlaces(query, controller.signal);
          if (token !== nominatimSearchToken) return;
          renderNominatimOptions(cities, query);
          setDataState({
            source: "osm",
            state: "OSM search · choose result",
            cache: "Ready",
          });
          setStatus("Choose an OSM result");
        } catch (error) {
          if (token !== nominatimSearchToken) return;
          console.debug("No se pudo buscar localidad:", error);
          clearNominatimOptions();
          setStatus("Place not found");
          setDataState({
            source: "osm",
            state: "OSM search failed",
            cache: "Check query",
          });
          cityMeta.innerHTML = `<span>${escapeHtml(error.name === "TimeoutError" ? "Search timed out. Please retry." : error.message || "City search failed. Please retry.")}</span>`;
        } finally {
          clearTimeout(deadline);
          if (nominatimSearchController === controller) nominatimSearchController = null;
        }
      }

      function updateRoadAttribution() {
        document.querySelector("#roadAttribution").innerHTML = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors · &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>';
      }

      function setStreetLoading(busy) {
        for (const input of [externalAreaSelect, externalRoadModeSelect, loadExternalAreaButton]) input.disabled = busy;
        cancelStreetLoadButton.hidden = !busy;
        if (busy) { downloadPdfButton.disabled = true; downloadSvgButton.disabled = true; downloadPngButton.disabled = true; }
        else updateExportControls();
      }

      function cancelStreetLoading() {
        if (!streetLoad) return;
        streetLoad.controller.abort();
        streetLoad = null;
        renderToken++;
        detailRenderToken++;
        clearRoads();
        setDataState({ source: "osm", state: "Loading cancelled · load streets to retry", cache: "Not saved" });
        setStatus("Loading cancelled");
        document.querySelector("#streetLoadMetrics").textContent = "Loading cancelled. No partial map was saved.";
        setStreetLoading(false);
      }

      async function loadVectorDetail(city) {
        const request = streetLoad;
        const module = await vectorModule();
        request.controller.signal.throwIfAborted();
        const metadata = await module.getTileMetadata({ signal: request.controller.signal });
        city.tileSource = metadata.tiles[0];
        const key = externalRoadCacheKey(city);
        const cached = detailCache.has(key) ? { segments: detailCache.get(key) } : await localCache.get(key);
        request.controller.signal.throwIfAborted();
        if (cached?.segments) {
          city.fullSegmentCount = cached.segments.length;
          detailCache.set(key, cached.segments);
          lastStreetLoad = { provider: "openfreemap", cache: true, totalMs: performance.now() - request.started, segments: cached.segments.length };
          setDataState({ source: "osm", state: "OpenFreeMap · saved streets", cache: "From cache" });
          return cached.segments;
        }
        let lastPreview = -Infinity;
        let firstDrawMs = null;
        let previewMs = 0;
        const result = await module.loadOpenFreeMapRoads({
          bounds: city.bounds, mode: city.roadMode, metadata, signal: request.controller.signal,
          onProgress(progress) {
            if (streetLoad !== request) return;
            setDataState({ source: "osm", state: `OpenFreeMap · ${progress.completed}/${progress.total} tiles`, cache: "Network" });
            setStreetLoading(true);
            const now = performance.now();
            if (progress.edges.length && now - lastPreview > 750 && progress.completed < progress.total) {
              renderSegments(module.joinRoadEdges(progress.edges, progress.zoom).segments);
              setStreetLoading(true);
              if (firstDrawMs === null) firstDrawMs = performance.now() - request.started;
              lastPreview = performance.now();
              previewMs += lastPreview - now;
            }
            setStatus(`Loading streets · ${progress.completed}/${progress.total}`);
          },
        });
        request.controller.signal.throwIfAborted();
        city.fullSegmentCount = result.segments.length;
        lastStreetLoad = { ...result.stats, firstDrawMs, previewMs, totalMs: performance.now() - request.started, cache: false, segments: result.segments.length };
        detailCache.set(key, result.segments);
        await localCache.set(key, { cachedAt: Date.now(), city: externalCitySnapshot(city), segments: result.segments, stats: result.stats });
        if (streetLoad === request) setDataState({ source: "osm", state: "OpenFreeMap · vector streets", cache: "Cached" });
        return result.segments;
      }

      async function loadSelectedExternalArea() {
        if (!selectedCity?.external) { setStatus("Search an external city first"); return; }
        clearTimeout(areaRefreshTimer);
        areaDirty = false;
        autoLoadEnabled = true;
        cancelStreetLoading();
        detailLoadController?.abort();
        const token = ++renderToken;
        detailRenderToken++;
        const city = { ...selectedCity, bounds: selectedExternalBounds(), roadProvider: "openfreemap", roadMode: resolvedExternalRoadMode() };
        const area = externalAreaSelect.value;
        const request = { city, controller: new AbortController(), started: performance.now() };
        streetLoad = request;
        city.loadSignal = request.controller.signal;
        lastStreetLoad = null;
        selectedCity = city;
        clearRoads();
        addCityLabel(city);
        updateRoadAttribution();
        document.querySelector("#streetLoadMetrics").textContent = "Loading streets…";
        const deadline = setTimeout(() => request.controller.abort(new DOMException("Street loading timed out. Please retry.", "TimeoutError")), 45000);
        try {
          setDataState({ source: "osm", state: "OpenFreeMap · loading tiles", cache: "Loading" });
          setStreetLoading(true);
          const module = await vectorModule();
          request.controller.signal.throwIfAborted();
          if (area === "frame") city.bounds = boundsForFrame();
          city.roadMode = resolvedExternalRoadMode();
          const segments = await loadDetail(city);
          if (token !== renderToken) return;
          renderSegments(segments, []);
          if (area !== "frame") fitCity(city);
          updateCityMeta(city, segments, []);
          updateRendererStatus();
          document.querySelector("#streetLoadMetrics").textContent = `OpenFreeMap · ${(lastStreetLoad.totalMs / 1000).toFixed(1)} s · ${segments.length.toLocaleString("en-US")} paths${lastStreetLoad.cache ? " · saved data" : ""}${lastStreetLoad.zoom < 14 ? " · Overview detail: zoom in for smaller streets" : ""}`;
          if (!segments.length) {
            setStatus("No streets at this scale. Zoom in to see more detail.");
            document.querySelector("#streetLoadMetrics").textContent = "No streets at this scale. Zoom in or choose a different area.";
          }
          scheduleRefreshSelectedDetails();
        } catch (error) {
          if (token !== renderToken) return;
          clearRoads();
          const message = ["TimeoutError", "AbortError"].includes(error.name) ? "Street loading timed out. Please retry." : error instanceof TypeError ? "Could not reach the street provider. Please retry." : error.message || "Could not load streets. Please retry.";
          lastStreetLoad = { provider: city.roadProvider, totalMs: performance.now() - request.started, error: message };
          setStatus("Could not load streets");
          setDataState({ source: "osm", state: message, cache: "Failed" });
          document.querySelector("#streetLoadMetrics").textContent = message;
          cityMeta.innerHTML = `<strong>${escapeHtml(city.name)}</strong><span>${escapeHtml(message)}</span>`;
        } finally {
          clearTimeout(deadline);
          if (streetLoad === request) { streetLoad = null; setStreetLoading(false); }
        }
      }

      function updateActiveCity() {
        document.querySelector("#editorCityName").textContent = selectedCity?.name || "Choose a city";
        document.querySelector("#editorCitySource").textContent = selectedCity
          ? "OpenFreeMap · streets on demand"
          : "Search OpenStreetMap for a city or town.";
        fitCityButton.disabled = !selectedCity;
      }

      function updateCurrentStyle() {
        updateLayerValues(allLayerControls.streets);
        const nextStyle = style();
        for (const layer of roadLayers) layer.setStyle(nextStyle);
        webgpuRoadRenderer.requestDraw();
      }

      function updateTextStyle() {
        setMonumentColor(monumentColor.value);
        for (const entry of coastLayers) entry.layer.setStyle(entry.styleFn());
        webgpuRoadRenderer.requestDraw();
      }

      function stepRangeControl(targetId, direction) {
        const input = document.getElementById(targetId);
        if (!input) return;
        const step = Number(input.step) || 1;
        const min = Number(input.min);
        const max = Number(input.max);
        const decimals = (input.step.split(".")[1] ?? "").length;
        const nextValue = Number(input.value) + step * direction;
        const clamped = Math.min(max, Math.max(min, nextValue));
        input.value = clamped.toFixed(decimals);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }

      function syncFineZoomControl() {
        const zoom = map.getZoom();
        fineZoomRange.value = zoom.toFixed(2);
        fineZoomValue.textContent = zoom.toFixed(2);
      }

      function setFineZoom(value) {
        const zoom = Number(value);
        if (!Number.isFinite(zoom)) return;
        map.setZoom(zoom, { animate: false });
        syncFineZoomControl();
      }

      function webGpuPixelRatio() {
        return Math.min(3, Math.max(2, window.devicePixelRatio || 1));
      }

      function createWebGpuCityRoadRenderer(mapInstance) {
        const canvas = document.createElement("canvas");
        canvas.className = "webgpu-road-canvas";
        canvas.setAttribute("aria-hidden", "true");

        let device = null;
        let context = null;
        let pipeline = null;
        let bindGroupLayout = null;
        let format = null;
        let msaaTexture = null;
        let isActive = false;
        let frameRequested = false;
        let frameBuffers = [];
        let segments = [];
        let coastSegments = [];
        let detailLineLayers = [];

        async function init() {
          if (!navigator.gpu) {
            webgpuRoadStatus.reason = "navigator.gpu unavailable";
            updateRendererStatus();
            return false;
          }
          try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
              webgpuRoadStatus.reason = "WebGPU adapter unavailable";
              updateRendererStatus();
              return false;
            }
            device = await adapter.requestDevice();
            device.lost.then(info => disableGpu(info.message || "WebGPU device lost"));
            context = canvas.getContext("webgpu");
            format = navigator.gpu.getPreferredCanvasFormat();
            bindGroupLayout = device.createBindGroupLayout({
              entries: [{
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: "uniform" },
              }],
            });
            const shader = device.createShaderModule({ code: roadShaderCode() });
            pipeline = device.createRenderPipeline({
              layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
              vertex: {
                module: shader,
                entryPoint: "vs",
                buffers: [{
                  arrayStride: 8,
                  attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
                }],
              },
              fragment: {
                module: shader,
                entryPoint: "fs",
                targets: [{
                  format,
                  blend: {
                    color: {
                      srcFactor: "src-alpha",
                      dstFactor: "one-minus-src-alpha",
                      operation: "add",
                    },
                    alpha: {
                      srcFactor: "one",
                      dstFactor: "one-minus-src-alpha",
                      operation: "add",
                    },
                  },
                }],
              },
              primitive: { topology: "triangle-list" },
              multisample: { count: webgpuRoadStatus.sampleCount },
            });
            mapInstance.getContainer().appendChild(canvas);
            isActive = true;
            webgpuRoadStatus.active = true;
            webgpuRoadStatus.reason = "active";
            mapInstance.on("move zoom resize moveend zoomend", requestDraw);
            requestDraw();
            updateRendererStatus();
            return true;
          } catch (error) {
            console.warn("WebGPU city-roads disabled:", error);
            isActive = false;
            webgpuRoadStatus.active = false;
            webgpuRoadStatus.reason = error.message || "WebGPU initialization failed";
            updateRendererStatus();
            return false;
          }
        }

        function disableGpu(reason) {
          isActive = false;
          webgpuRoadStatus.active = false;
          webgpuRoadStatus.reason = reason;
          mapInstance.off("move zoom resize moveend zoomend", requestDraw);
          for (const buffer of frameBuffers) buffer.destroy();
          frameBuffers = [];
          msaaTexture?.destroy();
          msaaTexture = null;
          canvas.remove();
          renderSegments(currentSegments, currentCoastSegments, currentDetailLineLayers, currentMonument);
          updateRendererStatus();
        }

        function isActiveRenderer() {
          return isActive;
        }

        function setSegments(nextSegments) {
          segments = nextSegments;
          webgpuRoadStatus.renderedSegments = segments.length;
          requestDraw();
        }

        function setCoastSegments(nextSegments) {
          coastSegments = nextSegments;
          webgpuRoadStatus.renderedCoastSegments = coastSegments.length;
          requestDraw();
        }

        function setDetailLineLayers(nextLayers) {
          detailLineLayers = nextLayers;
          requestDraw();
        }

        function requestDraw() {
          if (!isActive || frameRequested) return;
          frameRequested = true;
          requestAnimationFrame(() => {
            try { draw(); }
            catch (error) { disableGpu(error.message || "WebGPU drawing failed"); }
          });
        }

        function draw() {
          frameRequested = false;
          if (!isActive) return;
          webgpuRoadStatus.renderedVertices = 0;
          if (!isActive || !device || !context || (segments.length === 0 && coastSegments.length === 0 && detailLineLayers.length === 0)) {
            resizeCanvas();
            clear();
            return;
          }

          const size = resizeCanvas();
          const coastVertices = verticesForSegments(coastSegments, size.cssWidth, size.cssHeight, coastStyle());
          const detailVertices = detailLineLayers.map((layer) => ({
            id: layer.id,
            style: layer.style(),
            vertices: verticesForSegments(layer.segments, size.cssWidth, size.cssHeight, layer.style()),
          }));
          const roadVertices = verticesForSegments(segments, size.cssWidth, size.cssHeight, style());
          const detailVertexCount = detailVertices.reduce((total, layer) => total + layer.vertices.length, 0);
          webgpuRoadStatus.renderedVertices = (coastVertices.length + detailVertexCount + roadVertices.length) / 2;
          if (coastVertices.length === 0 && detailVertexCount === 0 && roadVertices.length === 0) {
            clear();
            return;
          }

          const currentView = context.getCurrentTexture().createView();
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: msaaTexture.createView(),
              resolveTarget: currentView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          pass.setPipeline(pipeline);
          drawVertices(pass, coastVertices, coastStyle());
          for (const layer of detailVertices.filter(layer => !["rail", "rivers"].includes(layer.id))) drawVertices(pass, layer.vertices, layer.style);
          drawVertices(pass, roadVertices, style());
          for (const layer of detailVertices.filter(layer => ["rail", "rivers"].includes(layer.id))) drawVertices(pass, layer.vertices, layer.style);
          pass.end();
          device.queue.submit([encoder.finish()]);
          // Submitted commands retain their resources until execution finishes.
          for (const buffer of frameBuffers) buffer.destroy();
          frameBuffers = [];
        }

        function drawVertices(pass, vertices, layerStyle) {
          if (vertices.length === 0) return;
          const vertexBuffer = device.createBuffer({
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          frameBuffers.push(vertexBuffer);
          const colorBuffer = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          frameBuffers.push(colorBuffer);
          const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: colorBuffer } }],
          });
          device.queue.writeBuffer(vertexBuffer, 0, vertices);
          device.queue.writeBuffer(colorBuffer, 0, colorForStyle(layerStyle));
          pass.setBindGroup(0, bindGroup);
          pass.setVertexBuffer(0, vertexBuffer);
          pass.draw(vertices.length / 2);
        }

        function clear() {
          if (!isActive || !device || !context) return;
          const currentView = context.getCurrentTexture().createView();
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: msaaTexture.createView(),
              resolveTarget: currentView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          pass.end();
          device.queue.submit([encoder.finish()]);
        }

        function resizeCanvas() {
          const size = mapInstance.getSize();
          const pixelRatio = webGpuPixelRatio();
          const width = Math.max(1, Math.floor(size.x * pixelRatio));
          const height = Math.max(1, Math.floor(size.y * pixelRatio));
          webgpuRoadStatus.pixelRatio = pixelRatio;
          if (!msaaTexture || canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            canvas.style.width = `${size.x}px`;
            canvas.style.height = `${size.y}px`;
            context.configure({
              device,
              format,
              alphaMode: "premultiplied",
            });
            if (msaaTexture) msaaTexture.destroy();
            msaaTexture = device.createTexture({
              size: [width, height],
              sampleCount: webgpuRoadStatus.sampleCount,
              format,
              usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
          }
          return { cssWidth: size.x, cssHeight: size.y };
        }

        function verticesForSegments(sourceSegments, width, height, layerStyle) {
          const halfWidth = Math.max(0.05, layerStyle.weight / 2);
          const capExtension = Math.min(1.2, halfWidth * 0.65);
          const pad = 96;
          const vertices = [];

          for (const segment of sourceSegments) {
            for (let i = 1; i < segment.length; i += 1) {
              const p1 = mapInstance.latLngToContainerPoint(segment[i - 1]);
              const p2 = mapInstance.latLngToContainerPoint(segment[i]);
              if (
                (p1.x < -pad && p2.x < -pad) ||
                (p1.x > width + pad && p2.x > width + pad) ||
                (p1.y < -pad && p2.y < -pad) ||
                (p1.y > height + pad && p2.y > height + pad)
              ) {
                continue;
              }
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const length = Math.hypot(dx, dy);
              if (length < 0.001) continue;
              const ux = dx / length;
              const uy = dy / length;
              const nx = -uy * halfWidth;
              const ny = ux * halfWidth;
              const ax = p1.x - ux * capExtension;
              const ay = p1.y - uy * capExtension;
              const bx = p2.x + ux * capExtension;
              const by = p2.y + uy * capExtension;
              pushQuad(vertices, ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, bx - nx, by - ny, width, height);
            }
          }

          return new Float32Array(vertices);
        }

        return {
          init,
          isActive: isActiveRenderer,
          requestDraw,
          setCoastSegments,
          setDetailLineLayers,
          setSegments,
        };
      }

      function pushQuad(vertices, ax, ay, bx, by, cx, cy, dx, dy, width, height) {
        pushPoint(vertices, ax, ay, width, height);
        pushPoint(vertices, bx, by, width, height);
        pushPoint(vertices, cx, cy, width, height);
        pushPoint(vertices, cx, cy, width, height);
        pushPoint(vertices, bx, by, width, height);
        pushPoint(vertices, dx, dy, width, height);
      }

      function pushPoint(vertices, x, y, width, height) {
        vertices.push((x / width) * 2 - 1, 1 - (y / height) * 2);
      }

      function colorForStyle(layerStyle) {
        const parsed = parseHexColor(layerStyle.color);
        return new Float32Array([parsed.r, parsed.g, parsed.b, layerStyle.opacity]);
      }

      function parseHexColor(color) {
        const value = color.replace("#", "");
        return {
          r: parseInt(value.slice(0, 2), 16) / 255,
          g: parseInt(value.slice(2, 4), 16) / 255,
          b: parseInt(value.slice(4, 6), 16) / 255,
        };
      }

      function contrastRatio(first, second) {
        const firstLum = relativeLuminance(parseHexColor(first));
        const secondLum = relativeLuminance(parseHexColor(second));
        const light = Math.max(firstLum, secondLum);
        const dark = Math.min(firstLum, secondLum);
        return (light + 0.05) / (dark + 0.05);
      }

      function relativeLuminance(color) {
        const channels = [color.r, color.g, color.b].map((channel) => (
          channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        ));
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      }

      function bestTextColorForBackground(backgroundColor) {
        const dark = "#20251c";
        const light = "#ffffff";
        return contrastRatio(dark, backgroundColor) >= contrastRatio(light, backgroundColor) ? dark : light;
      }

      function exportFileBaseName(extension) {
        const cityName = selectedCity?.name ?? "city-roads";
        return `${normalize(cityName).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "city-roads"}-${frameRatio[0]}x${frameRatio[1]}${["pdf", "svg"].includes(extension) ? "-low-resolution" : ""}.${extension}`;
      }

      function exportSvgMarkup() {
        updateFrame();
        const width = Math.max(1, Math.round(frameRect.width));
        const height = Math.max(1, Math.round(frameRect.height));
        const framePaperColor = getComputedStyle(document.documentElement).getPropertyValue("--frame-paper").trim();
        const text = textColor.value;
        const cityName = printTitle.value.trim();
        const attributionLine1 = "© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap";
        const attributionLine2 = "carta.example.com";
        const roadLayerStyle = style();
        const clipId = `frame-${Date.now().toString(36)}`;
        const paths = [
          pathsForSegments(currentCoastSegments, coastStyle()),
          currentDetailLineLayers.filter(layer => !["rail", "rivers"].includes(layer.id)).map((layer) => pathsForSegments(layer.segments, layer.style())).join(""),
          pathsForSegments(currentSegments, roadLayerStyle),
          currentDetailLineLayers.filter(layer => ["rail", "rivers"].includes(layer.id)).map((layer) => pathsForSegments(layer.segments, layer.style())).join(""),
        ].join("");
        return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${printSize().widthMm}mm" height="${printSize().heightMm}mm" viewBox="0 0 ${width} ${height}" role="img">
  <title>${escapeXml(cityName || "City-roads")}</title>
  <style>${artworkFontStyles}</style>
  <defs>
    <clipPath id="${clipId}"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="${framePaperColor}"/>
  <g clip-path="url(#${clipId})">
    ${paths}
    ${monumentSvg(currentMonument)}
  </g>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" fill="none" stroke="#20251c" stroke-opacity="0.48" stroke-width="1.5"/>
  ${cityName ? `<text x="${width - 14}" y="${height - 36}" text-anchor="end" font-family="Barlow Condensed, Arial, sans-serif" font-size="23" font-weight="500" fill="${text}" stroke="${framePaperColor}" stroke-width="4" paint-order="stroke fill">${escapeXml(cityName)}</text>` : ""}
  <text x="${width - 14}" y="${height - 21}" text-anchor="end" font-family="DM Sans, Arial, sans-serif" font-size="8" fill="${text}" stroke="${framePaperColor}" stroke-width="3" paint-order="stroke fill">${escapeXml(attributionLine1)}</text>
  <a href="https://carta.example.com/" target="_blank" rel="noopener noreferrer"><text x="${width - 14}" y="${height - 12}" text-anchor="end" font-family="DM Sans, Arial, sans-serif" font-size="8" fill="${text}" stroke="${framePaperColor}" stroke-width="3" paint-order="stroke fill">${escapeXml(attributionLine2)}</text></a>
</svg>`;
      }

      function pathsForSegments(segments, layerStyle) {
        if (!segments.length) return "";
        const stroke = escapeXml(layerStyle.color);
        return segments.map((segment) => {
          const d = pathDataForSegment(segment);
          if (!d) return "";
          return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${formatSvgNumber(layerStyle.weight)}" stroke-opacity="${formatSvgNumber(layerStyle.opacity)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }).join("");
      }

      function pathDataForSegment(segment) {
        if (segment.length < 2) return "";
        return segment.map((point, index) => {
          const projected = map.latLngToContainerPoint(point);
          const x = formatSvgNumber(projected.x - frameRect.left);
          const y = formatSvgNumber(projected.y - frameRect.top);
          return `${index === 0 ? "M" : "L"}${x} ${y}`;
        }).join(" ");
      }

      function monumentSvg(monument) {
        if (!monument) return "";
        const point = map.latLngToContainerPoint([monument.lat, monument.lon]);
        const x = formatSvgNumber(point.x - frameRect.left);
        const y = formatSvgNumber(point.y - frameRect.top);
        const markerColor = monumentColor.value;
        const framePaperColor = getComputedStyle(document.documentElement).getPropertyValue("--frame-paper").trim();
        return `
    <circle cx="${x}" cy="${y}" r="9.5" fill="${framePaperColor}" fill-opacity="0.86" stroke="${markerColor}" stroke-opacity="0.98" stroke-width="1.8"/>
    <circle cx="${x}" cy="${y}" r="4.4" fill="none" stroke="${markerColor}" stroke-opacity="0.98" stroke-width="1.4"/>`;
      }

      function formatSvgNumber(value) {
        return Number(value).toFixed(2).replace(/\.?0+$/, "");
      }

      function escapeXml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      async function downloadSvg() {
        if (!currentSegments.length || exportInProgress || streetLoad || areaDirty || detailLoadController || detailRefreshTimer) return;
        exportInProgress = true;
        updateExportControls();
        try {
          const source = exportSvgMarkup();
          const name = exportFileBaseName("svg");
          const ratio = [...frameRatio];
          const dimensions = printSize();
          const { createLowResolutionArtwork, rasterSvg } = await import("./city-roads/low-resolution-export.mjs");
          const artwork = await createLowResolutionArtwork(source, ratio);
          const svg = rasterSvg(artwork, dimensions);
          downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), name);
          document.querySelector("#exportNote").textContent = "Low-resolution SVG ready · 1024 px. Contains a raster image, not editable vector artwork.";
        } catch (error) { document.querySelector("#exportNote").textContent = error.message || "Could not export SVG. Please retry."; }
        finally { exportInProgress = false; updateExportControls(); }
      }

      async function downloadPdf() {
        if (!currentSegments.length || exportInProgress || streetLoad || areaDirty || detailLoadController || detailRefreshTimer) return;
        exportInProgress = true;
        updateExportControls();
        downloadPdfButton.textContent = "Preparing…";
        const note = document.querySelector("#exportNote");
        note.textContent = "Preparing your low-resolution PDF…";
        try {
          // Snapshot before awaiting the converter so later map edits cannot mix exports.
          const source = exportSvgMarkup();
          const { widthMm, heightMm } = printSize();
          const name = exportFileBaseName("pdf");
          const title = `${selectedCity?.name || "Carta"} · Low resolution`;
          const ratio = [...frameRatio];
          const includeCropMarks = pdfCropMarksToggle.checked;
          const { createLowResolutionArtwork } = await import("./city-roads/low-resolution-export.mjs");
          const artwork = await createLowResolutionArtwork(source, ratio);
          const module = await import("./city-roads/pdf-export.mjs?v=2");
          const blob = await module.createLowResolutionPdf(artwork, title, { includeCropMarks, widthMm, heightMm });
          downloadBlob(blob, name);
          note.textContent = includeCropMarks
            ? "Low-resolution PDF ready · 1024 px · with frame and crop marks."
            : "Low-resolution PDF ready · 1024 px · with frame, without crop marks.";
        } catch (error) {
          note.textContent = error.code === "UNSUPPORTED_PRINT_CHARACTER"
            ? error.message
            : "Could not export PDF. Try again, or download SVG.";
        } finally {
          exportInProgress = false;
          downloadPdfButton.textContent = "PDF";
          updateExportControls();
        }
      }

      async function downloadPng() {
        if (!currentSegments.length || exportInProgress || streetLoad || areaDirty || detailLoadController || detailRefreshTimer) return;
        exportInProgress = true;
        updateExportControls();
        downloadPngButton.textContent = "Preparing…";
        const note = document.querySelector("#exportNote");
        note.textContent = "Preparing your image…";
        try {
          const source = exportSvgMarkup();
          const name = exportFileBaseName("png");
          const ratio = [...frameRatio];
          const { outlineSvgText } = await import("./city-roads/print-text.mjs");
          const svg = await outlineSvgText(source);
          const { createSocialPng } = await import("./city-roads/png-export.mjs");
          const { blob, width, height } = await createSocialPng(svg, ratio);
          downloadBlob(blob, name);
          note.textContent = `PNG ready · ${width} × ${height} px. Ready to share.`;
        } catch (error) {
          note.textContent = error.code === "UNSUPPORTED_PRINT_CHARACTER"
            ? error.message
            : "Could not export PNG. Try again, or download SVG.";
        } finally {
          exportInProgress = false;
          downloadPngButton.textContent = "PNG";
          updateExportControls();
        }
      }

      function createMemoryCache(maxEntries) {
        const entries = new Map();
        let points = 0;
        return {
          has: key => entries.has(key),
          get(key) {
            const value = entries.get(key);
            if (!value) return undefined;
            entries.delete(key); entries.set(key, value);
            return value.segments;
          },
          set(key, segments) {
            if (entries.has(key)) { points -= entries.get(key).points; entries.delete(key); }
            const count = segments.reduce((total, segment) => total + segment.length, 0);
            if (count > 500000) return;
            entries.set(key, { segments, points: count }); points += count;
            while (entries.size > maxEntries || points > 500000) {
              const oldest = entries.keys().next().value;
              points -= entries.get(oldest).points; entries.delete(oldest);
            }
          },
          clear() { entries.clear(); points = 0; },
        };
      }

      function createLocalCache() {
        const dbName = "city-roads-cache";
        const storeName = "entries";
        let dbPromise = null;

        function openDb() {
          if (dbPromise) return dbPromise;
          dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = () => {
              request.result.createObjectStore(storeName);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return dbPromise;
        }

        async function withStore(mode, callback) {
          const db = await openDb();
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        }

        return {
          get: async (key) => {
            const value = await withStore("readonly", store => store.get(key)).catch(() => null);
            if (value && value.cachedAt > Date.now() - 7 * 86400000) return value;
            if (value) await withStore("readwrite", store => store.delete(key)).catch(() => null);
            return null;
          },
          set: async (key, value) => {
            try {
              const db = await openDb();
              const transaction = db.transaction(storeName, "readwrite");
              const store = transaction.objectStore(storeName);
              const cursor = store.openCursor();
              let count = 0;
              cursor.onsuccess = () => {
                const item = cursor.result;
                if (item) {
                  if (item.value.cachedAt < Date.now() - 7 * 86400000 || ++count > 40) item.delete();
                  item.continue();
                } else store.put({ ...value, cachedAt: Date.now() }, key);
              };
              await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = reject; transaction.onabort = reject; });
            } catch { /* A map remains usable when storage is full or disabled. */ }
          },
          clear: () => withStore("readwrite", store => store.clear()),
        };
      }

      function roadShaderCode() {
        return `
          struct VertexOut {
            @builtin(position) position: vec4f,
          };

          @group(0) @binding(0) var<uniform> roadColor: vec4f;

          @vertex
          fn vs(@location(0) position: vec2f) -> VertexOut {
            var out: VertexOut;
            out.position = vec4f(position, 0.0, 1.0);
            return out;
          }

          @fragment
          fn fs() -> @location(0) vec4f {
            return roadColor;
          }
        `;
      }

      function setFrameRatio(value) {
        const [width, height] = value.split(":").map(Number);
        frameRatio = [width, height];
        for (const button of frameButtons) {
          button.classList.toggle("active", button.dataset.frameRatio === value);
          button.setAttribute("aria-pressed", String(button.dataset.frameRatio === value));
        }
        updateFrame();
        scheduleAreaRefresh();
      }

      function selectToolTab(name, focus = false) {
        for (const tab of toolTabs) {
          const selected = tab.dataset.toolTab === name;
          tab.setAttribute("aria-selected", String(selected));
          tab.tabIndex = selected ? 0 : -1;
          if (selected && focus) tab.focus();
        }
        for (const panel of toolPanels) panel.hidden = panel.id !== `tools${name[0].toUpperCase()}${name.slice(1)}`;
        document.querySelector("#toolScroll").scrollTop = 0;
      }

      function syncPaletteSelection() {
        let label = "Custom";
        for (const button of presetButtons) {
          const palette = palettes[button.dataset.preset];
          const selected = paperColor.value === palette.paper && lineColor.value === palette.line && textColor.value === palette.text;
          button.setAttribute("aria-pressed", String(selected));
          if (selected) label = palette.name;
        }
        document.querySelector("#paletteName").textContent = label;
      }

      function applyPalette(name) {
        const palette = palettes[name];
        if (!palette) return;
        paperColor.value = palette.paper;
        lineColor.value = palette.line;
        setPaperColor(palette.paper);
        setTextColor(palette.text);
        updateCurrentStyle();
        syncPaletteSelection();
      }

      function syncLayerControls() {
        for (const controls of Object.values(allLayerControls)) updateLayerValues(controls);
        document.querySelector("#layerCount").textContent = `${1 + detailLayerInputs.filter(input => input.checked).length} shown`;
      }

      function openLayerEditor(id) {
        const opening = allLayerControls[id].group.hidden;
        for (const [key, controls] of Object.entries(allLayerControls)) {
          const expanded = opening && key === id;
          controls.group.hidden = !expanded;
          controls.editButton.setAttribute("aria-expanded", String(expanded));
        }
      }

      function resetLayerStyle(id) {
        const controls = allLayerControls[id];
        for (const input of [controls.color, controls.weight, controls.opacity]) input.value = input.defaultValue;
        updateLayerValues(controls);
        if (id === "streets") { updateCurrentStyle(); syncPaletteSelection(); }
        else updateTextStyle();
      }

      function updateLayerValues(controls) {
        const width = String(Number(controls.weight.value));
        const opacity = `${Math.round(Number(controls.opacity.value) * 100)}%`;
        controls.weightValue.textContent = width;
        controls.opacityValue.textContent = opacity;
        controls.colorValue.textContent = controls.color.value.toUpperCase();
        const visible = !controls.visibility || controls.visibility.checked;
        controls.summary.textContent = `${width} width · ${opacity} opacity${visible ? "" : " · Off"}`;
        controls.hint.textContent = !visible ? "Hidden on the map. Turn on Show to preview your changes."
          : Number(controls.opacity.value) === 0 ? "Invisible at 0% opacity. Increase it to see this layer." : "";
        controls.sample.setAttribute("stroke", controls.color.value);
        controls.sample.setAttribute("stroke-width", width);
        controls.sample.setAttribute("stroke-opacity", controls.opacity.value);
      }

      function printSize() {
        const widthMm = Number(printWidth.value) * 10;
        const heightMm = widthMm * frameRatio[1] / frameRatio[0];
        if (!Number.isFinite(widthMm) || widthMm < 100 || widthMm > 1200 || heightMm > 1200) throw new Error("Choose a print width from 10 to 120 cm, with height no greater than 120 cm.");
        return { widthMm, heightMm };
      }

      function updateExportControls() {
        let dimensions;
        try { dimensions = printSize(); } catch { /* The input can be incomplete while editing. */ }
        document.querySelector("#printSizeHint").textContent = dimensions
          ? `${(dimensions.widthMm / 10).toFixed(1)} × ${(dimensions.heightMm / 10).toFixed(1)} cm after trimming. Print at 100%.`
          : "Width: 10–120 cm. Maximum height: 120 cm.";
        const ready = currentSegments.length > 0 && !streetLoad && !areaDirty && !detailLoadController && !detailRefreshTimer && Boolean(dimensions);
        if (selectedCity) document.querySelector("#editorCitySource").textContent = ready
          ? `${selectedCity.external ? "OpenStreetMap" : "Saved city"} · ready to style`
          : (selectedCity.external ? "OpenFreeMap · streets on demand" : "Loading saved streets…");
        downloadPdfButton.disabled = !ready || exportInProgress;
        downloadSvgButton.disabled = !ready || exportInProgress;
        downloadPngButton.disabled = !ready || exportInProgress;
        document.querySelector("#exportDimensions").textContent = ready && frameRect
          ? `${(dimensions.widthMm / 10).toFixed(1)} × ${(dimensions.heightMm / 10).toFixed(1)} cm`
          : "Load a map first";
      }

      for (const tab of toolTabs) {
        tab.addEventListener("click", () => selectToolTab(tab.dataset.toolTab));
        tab.addEventListener("keydown", (event) => {
          const index = toolTabs.indexOf(tab);
          const next = event.key === "ArrowRight" ? (index + 1) % toolTabs.length : event.key === "ArrowLeft" ? (index + toolTabs.length - 1) % toolTabs.length : event.key === "Home" ? 0 : event.key === "End" ? toolTabs.length - 1 : -1;
          if (next !== -1) { event.preventDefault(); selectToolTab(toolTabs[next].dataset.toolTab, true); }
        });
      }
      for (const button of presetButtons) button.addEventListener("click", () => applyPalette(button.dataset.preset));
      document.querySelector("#resetStyleButton").addEventListener("click", () => {
        applyPalette("classic");
      });
      document.querySelector("#searchWorldButton").addEventListener("click", () => searchAndRenderWorldPlace());

      function setPanelOpen(open) {
        const expanded = mobileViewport.matches && open;
        document.body.classList.toggle("panel-open", expanded);
        panelToggleButton.setAttribute("aria-expanded", String(expanded));
        panelToggleButton.textContent = expanded ? "Close" : "Controls";
        editorPanel.inert = mobileViewport.matches && !expanded;
      }

      panelToggleButton.addEventListener("click", () => {
        setPanelOpen(panelToggleButton.getAttribute("aria-expanded") !== "true");
      });
      editorPanel.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && mobileViewport.matches) {
          setPanelOpen(false);
          panelToggleButton.focus();
        }
      });
      mobileViewport.addEventListener("change", () => setPanelOpen(false));
      gridToggle.addEventListener("change", () => {
        compositionGrid.hidden = !gridToggle.checked;
      });
      setPanelOpen(false);

      citySearch.addEventListener("input", () => {
        document.querySelector("#searchWorldButton").disabled = citySearch.value.trim().length < 2;
        nominatimSearchToken += 1;
        nominatimSearchController?.abort();
        clearNominatimOptions();
      });
      citySearch.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchAndRenderWorldPlace();
        }
      });
      fitCityButton.addEventListener("click", () => {
        if (selectedCity) fitCity(selectedCity);
      });
      printWidth.addEventListener("input", updateExportControls);
      printTitle.addEventListener("input", () => { if (selectedCity) addCityLabel(selectedCity); });
      downloadPdfButton.addEventListener("click", downloadPdf);
      downloadSvgButton.addEventListener("click", downloadSvg);
      downloadPngButton.addEventListener("click", downloadPng);
      loadExternalAreaButton.addEventListener("click", loadSelectedExternalArea);
      cancelStreetLoadButton.addEventListener("click", () => { autoLoadEnabled = false; areaDirty = true; clearTimeout(areaRefreshTimer); cancelStreetLoading(); });
      themeToggleButton.addEventListener("click", toggleTheme);
      fineZoomRange.addEventListener("input", () => setFineZoom(fineZoomRange.value));
      weightRange.addEventListener("input", updateCurrentStyle);
      opacityRange.addEventListener("input", updateCurrentStyle);
      lineColor.addEventListener("input", updateCurrentStyle);
      paperColor.addEventListener("input", () => setPaperColor(paperColor.value));
      textColor.addEventListener("input", () => setTextColor(textColor.value));
      for (const button of frameButtons) {
        button.addEventListener("click", () => setFrameRatio(button.dataset.frameRatio));
      }
      for (const button of rangeStepButtons) {
        button.addEventListener("click", () => stepRangeControl(button.dataset.rangeTarget, Number(button.dataset.rangeStep)));
      }
      for (const input of detailLayerInputs) {
        input.addEventListener("change", () => {
          syncLayerControls();
          scheduleRefreshSelectedDetails();
        });
      }
      for (const button of document.querySelectorAll("[data-edit-layer]")) {
        button.addEventListener("click", () => {
          openLayerEditor(button.dataset.editLayer);
          if (button.getAttribute("aria-expanded") === "true") button.scrollIntoView({ block: "start" });
        });
      }
      for (const button of document.querySelectorAll("[data-reset-layer]")) {
        button.addEventListener("click", () => resetLayerStyle(button.dataset.resetLayer));
      }
      for (const controls of Object.values(detailStyleControls)) {
        for (const input of [controls.color, controls.weight, controls.opacity]) {
          input.addEventListener("input", () => { updateLayerValues(controls); updateTextStyle(); });
        }
      }
      for (const input of [lineColor, paperColor, textColor]) input.addEventListener("input", syncPaletteSelection);
      function scheduleAreaRefresh(force = false) {
        if (!autoLoadEnabled || !selectedCity || (!force && externalAreaSelect.value !== "frame")) return;
        clearTimeout(areaRefreshTimer);
        areaDirty = true;
        updateExportControls();
        areaRefreshTimer = setTimeout(() => loadSelectedExternalArea(), 600);
      }
      map.on("zoomend moveend", () => { syncFineZoomControl(); scheduleAreaRefresh(); });
      for (const input of [externalAreaSelect, externalRoadModeSelect]) input.addEventListener("change", () => scheduleAreaRefresh(true));
      document.querySelector("#clearLocalData").addEventListener("click", async () => {
        autoLoadEnabled = false;
        clearTimeout(areaRefreshTimer);
        nominatimSearchController?.abort();
        detailLoadController?.abort();
        cancelStreetLoading();
        try {
          await localCache.clear();
          for (const cache of [detailCache, coastCache, detailLineCache, monumentCache]) cache.clear();
          localStorage.removeItem("city-roads-theme");
          location.reload();
        } catch { setStatus("Could not clear storage. Use your browser’s site settings."); }
      });
      map.on("resize", () => {
        updateFrame();
        if (selectedCity) fitCity(selectedCity);
      });

      setTheme(initialTheme());
      setPaperColor(paperColor.value);
      updateCurrentStyle();
      updateTextStyle();
      updateFrame();
      setInitialEmptyView();
      syncPaletteSelection();
      syncLayerControls();
      syncFineZoomControl();
      webgpuRoadRenderer.init().then((active) => {
        if (active) renderSegments(currentSegments, currentCoastSegments, currentDetailLineLayers, currentMonument);
        updateRendererStatus();
      });
