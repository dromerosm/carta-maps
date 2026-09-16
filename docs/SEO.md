# Search and social previews

The editor and privacy page have distinct titles, descriptions and canonical URLs. `scripts/seo.mjs` generates their Open Graph and X/Twitter cards, JSON-LD, `robots.txt` and `sitemap.xml` during `npm run build`. Edit the page definitions in that script rather than the generated head sections.

The site has one language, English. It does not declare translations, review ratings, social account handles or search actions that the product does not provide. City searches and map tiles are excluded from crawling in `robots.txt`; the editor is the indexable product page. Robots directives are crawler guidance, not access controls.

`public/og-image.jpg` is a 1200 × 630 JPEG, under 300 KB. It uses a Carta-generated Zaragoza print as the reference for the social artwork and retains the map credits. The image is delivered by the same Worker as the editor. When replacing it, retain attribution and update the metadata if its URL, dimensions or format change. Social platforms may cache an older card until their next fetch.

The generated `worker/seo-csp.ts` contains SHA-256 hashes for the JSON-LD. These permit only the exact structured-data blocks, without allowing arbitrary inline scripts. Tests check that the HTML, canonical routes, sitemap and hashes agree. Do not enable `unsafe-inline` for scripts to solve a metadata problem.

## Checks after deployment

Verify the editor, `/privacy`, `/robots.txt`, `/sitemap.xml`, `/og-image.jpg` and `/favicon.svg` over HTTPS. Confirm the image content type and dimensions, valid JSON-LD, the intended canonical URLs, no injected scripts and no console errors. Run Lighthouse against the public hostname on mobile and desktop. Performance traces are laboratory measurements; report device and throttling conditions rather than presenting them as real-user data.

Edge security rules can affect social preview fetchers. Check the deployed page with the relevant platform's preview tool; a successful browser visit alone does not prove the platform can fetch it. Keep deployment-specific firewall conditions in private operational notes. Do not weaken access controls based only on a claimed crawler User-Agent.
