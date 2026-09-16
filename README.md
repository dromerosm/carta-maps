# Carta Maps

[![CI](https://github.com/dromerosm/carta-maps/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dromerosm/carta-maps/actions/workflows/ci.yml)
[![CD: manual](https://img.shields.io/badge/CD-manual_Cloudflare_deploy-blue)](.github/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js: 22 and 24](https://img.shields.io/badge/Node.js-22_%7C_24-339933)](package.json)

Turn a city's streets into a print. Carta uses OpenStreetMap place search and OpenFreeMap geometry to create maps you can style and download low-resolution PDF and SVG previews or a PNG for sharing.

- Search for cities and towns worldwide.
- Choose a frame and print width, with height calculated from the aspect ratio.
- Style streets, coastlines, forests, rivers and railways independently. Each layer has its own colour, line width, opacity and reset.
- Download PDF and SVG previews with a 1024-pixel long edge. PDF crop marks are optional. Share a PNG with a 2048-pixel long edge.
- Render with WebGPU where available, with a Canvas fallback.

Built by Diego Romero. Domain names in this repository are placeholders. Configure your own domains using the [deployment guide](docs/DEPLOYMENT.md). Deployment is manual; the CD badge describes the workflow, not deployment health.

## Run locally

Use Node.js 22 or 24. `.nvmrc` selects 24.

```sh
npm ci
npm run build
npm run serve
```

Open [localhost:8787](http://127.0.0.1:8787/). Wrangler runs the Worker, Durable Objects and cache locally. Internet access is needed for uncached searches and map tiles; libraries and fonts are served locally. No Cloudflare account is needed for local development. Serve through Wrangler, because search and tiles use the Worker's same-origin API.

## Checks and automation

```sh
npm run check
```

This builds the browser assets, generates Worker types, runs the Node and workerd tests, checks TypeScript and packages a deployment without uploading it. CI runs these checks on Node 22 and 24 for pushes to `main` and pull requests. It also checks that generated assets match the source, audits locked dependencies, scans Git history for secrets and validates the workflows. Weekly runs catch newly reported dependency problems.

GitHub Actions have read-only repository permissions. Actions are pinned to commit SHAs, and downloaded scanner binaries are checked against pinned SHA-256 hashes. Pull requests receive no deployment credentials. Dependabot proposes npm and Actions updates; it does not merge them automatically.

See [Contributing](CONTRIBUTING.md) for the development workflow and [Security](SECURITY.md) for private vulnerability reporting. The CI badge links to actual results; private repository badges may require authentication.

## Deploy to Cloudflare

Carta is a Worker with static assets and SQLite Durable Objects. It serves the root of your configured domain, with `/api/search` and `/api/tiles/` on the same origin. The examples use `carta.example.com` for Carta and `example.com` for the author's website.

Follow the [deployment guide](docs/DEPLOYMENT.md) to configure the custom domain, credentials and manual GitHub Actions workflow. Only `public/` is served. The production workflow accepts `main` only, repeats the checks and is gated by the `DEPLOY_ENABLED` repository variable. It never runs on a push or pull request.

## Downloads and print layout

Choose dimensions in **Style → Print size & title**. Print width ranges from 10 to 120 cm; height follows the frame ratio and cannot exceed 120 cm. Print at **100% / actual size**. Crop marks add 12 mm outside each edge, and the PDF TrimBox records the finished size. SVG files carry physical millimetre dimensions.

PDF and SVG files contain a raster image with at most 1024 pixels on the longest edge. Their names include `low-resolution`; they are previews, unsuitable for high-quality large prints. Map paths and editable text are not included. PDF cutting guides remain vector lines. Lower resolution limits print detail but does not prevent copying or reuse. The higher-resolution PNG download remains available.

Text is shaped and rasterized in the browser, so recipients do not need the fonts installed. The included fonts cover Latin, Greek, Cyrillic, Chinese, Japanese, Korean, Arabic, Hebrew, Devanagari, Thai, Bengali, Armenian, Georgian, Tamil and Telugu. Coverage is not universal: unsupported characters produce a message asking you to edit the title. Extra script fonts load only when needed; the first CJK export downloads about 16.5 MB.

Large areas use overview tiles, which can omit smaller streets. Zoom in for finer map detail. Exports cannot add detail missing from the source. Maps are illustrations, not survey or navigation data, and the PDF is not a tagged accessible document.

PNG exports keep the chosen frame ratio, paper colour, title and map credits, without crop marks. The longest edge is 2048 pixels regardless of the print dimensions or screen resolution. Files are created in your browser.

## Data and privacy

Searches pass through a shared seven-day cache and a global Nominatim request gate. Geometry comes only from OpenFreeMap. Edited titles and generated files stay in the browser. Provider availability and Cloudflare quotas still apply.

Read the [privacy notice](public/privacy.html) for data flows and storage, and the [architecture notes](docs/ARCHITECTURE.md) for implementation details.

## Repository layout

| Path | Purpose |
| --- | --- |
| `public/` | Editor, browser modules, fonts and bundled licences |
| `worker/` | Same-origin API, provider limits, caches and response headers |
| `src/` | Entry points for generated browser bundles |
| `scripts/` | Build, notices, script versioning and local server |
| `tests/` | Geometry, editor, exports and Worker tests |
| `.github/` | CI, manual deployment and contribution templates |

Generated browser bundles are committed so they can be reviewed alongside source changes. Font files and notices are needed for portable exports. Local agent notes, review reports, caches and generated prints are ignored.

## Licences

Original application code is [MIT licensed](LICENSE), copyright 2026 Diego Romero. `package.json` keeps `private: true` to prevent accidental npm publication; this does not restrict the MIT licence or GitHub visibility.

Libraries and fonts retain their own licences. See the [bundled notices](public/city-roads/THIRD-PARTY-LICENSES.txt) and [font sources and checksums](public/city-roads/fonts/sources.json). The code licence does not relicense map data. Keep the OpenStreetMap, OpenMapTiles and OpenFreeMap credits on shared prints; carta.example.com is the project signature.
