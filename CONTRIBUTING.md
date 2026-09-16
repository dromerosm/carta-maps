# Contributing to Carta

Small, focused contributions are welcome. Open an issue before starting a substantial feature so we can agree on the use case. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Development

1. Fork the repository and create a branch for your change.
2. Use Node.js 22 or 24, then run `npm ci` and `npm run build`.
3. Run `npm run serve` and open `http://127.0.0.1:8787/`.
4. Make the change and run `npm run check`.
5. Commit the source and regenerated browser assets together. Open a pull request describing the result and how you checked it.

The tests use controlled provider responses. For browser checks, use normal interactive searches and small areas; do not stress public map services. For UI changes, check a narrow viewport and keyboard access. For export changes, inspect both SVG and PDF, including dimensions, attribution and crop marks.

## Project boundaries

- Use OpenFreeMap for geometry and Nominatim for explicit city searches. Keep requests behind the same-origin Worker API and preserve the shared search gate.
- Keep map attribution, font licences and third-party notices intact.
- Serve only `public/`. Do not add credentials, local reports, browser captures or generated prints to Git.
- Avoid new dependencies or broad refactors when a focused change will do.
- Build generated modules from `src/`; do not patch the minified output directly.

CI checks Node 22 and 24, dependencies, secrets, workflows and generated assets. Dependency updates may require running the build and committing its output. Review scanner version and checksum updates together in the CI workflow. Green checks are useful evidence, not a substitute for reviewing the change.

Contributions are made under the project's MIT licence. Third-party material must include its source and compatible licence. Keep discussion respectful and specific to the work.
