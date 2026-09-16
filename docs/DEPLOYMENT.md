# Deploying Carta

The repository uses **`https://carta.example.com/`** and **`https://example.com/`** as placeholders. Real domains belong in local ignored configuration or GitHub environment secrets. CI dry runs do not publish the app or change DNS.

## Set your domains

Copy `deployment.example.json` to `.deployment/config.json` and replace both origins with your HTTPS domains. Keep the file in the ignored `.deployment/` directory. Alternatively, set `CARTA_SITE_ORIGIN` and `CARTA_AUTHOR_ORIGIN` together in the deployment environment.

After building, `npm run deploy:prepare` copies the public assets and Worker into the ignored `dist/deploy/` directory. It applies your domains to links, export signatures, SEO metadata, the Custom Domain and the Nominatim contact URL. It also regenerates the app version and JSON-LD CSP hashes. Tracked source and generated files retain placeholders. Preparation fails if either origin is missing or still uses an example domain.

The checked-in social image uses example domains too. For a branded production image, place a replacement JPEG at `.deployment/og-image.jpg`; preparation copies it into the deployment. Use 1200 × 630 pixels, keep it under 300 KB and retain the map credits. This local image is never committed.

Review the prepared files, then validate them with `npx --no-install wrangler deploy --dry-run --config dist/deploy/wrangler.jsonc`. This command does not publish anything.

## Cloudflare configuration

`wrangler.jsonc` contains an example Worker Custom Domain. Deployment preparation replaces it with your configured app domain:

```json
{ "pattern": "carta.example.com", "custom_domain": true }
```

Cloudflare manages the DNS record and certificate for a Custom Domain. The zone must already be active in the target account. Check for an existing record or service on this hostname before deploying; resolve conflicts rather than replacing an unrelated service. See [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

`BASE_PATH` is an empty string, so the editor is served at `/` and its APIs at `/api/search` and `/api/tiles/`. `CONTACT_URL` identifies the project to Nominatim. Only `public/` is exposed. `workers.dev` and preview URLs are disabled. The main website at `example.com` remains a separate Pages project.

For a fork, change the Worker name, custom domain, contact URL, privacy operator and rate-limit namespace before deployment. Keep Durable Object migrations once applied; do not reset migration history on an existing deployment.

## Before the first deployment

- Confirm the domain, account, Durable Object availability and account limits. Keep all three rate-limit namespaces dedicated to Carta. Map limits start at 1,200 requests and 480 upstream attempts per network per minute; they apply separately at each Cloudflare location and are not a global spending cap. Review shared-network usage, traffic and any additional edge controls before raising them.
- Review the privacy notice for the actual operator and processing arrangements. The current notice uses the operator's published LinkedIn contact route; a dedicated privacy email is still a launch decision.
- Review `npm run check`, the CI run, and the exact commit to deploy.
- Configure credentials with access only to the intended account and zone. Use a scoped Workers deployment token, including the domain/route permissions required for the Custom Domain. Do not put tokens in Wrangler configuration or Git.

## Manual GitHub Actions deployment

1. Create a GitHub environment named `production` and restrict deployment branches to `main`. Add a required reviewer where the account plan supports it and the maintainer setup makes it practical.
2. Add environment secrets named `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CARTA_SITE_ORIGIN` and `CARTA_AUTHOR_ORIGIN`. Set each origin to its complete HTTPS URL without a path. Domain values are kept out of the public source, but remain visible in the deployed website and may appear in deployment logs. The local social image override is not available in Actions; CI uses the checked-in example image unless you provide a production image through a private build step.
3. Set the **repository** Actions variable `DEPLOY_ENABLED` to `true` only when launch is authorised. While absent or false, the deploy job is skipped.
4. Open **Actions → Deploy → Run workflow**, select `main`, and review the commit. The workflow checks and deploys that same commit. It never deploys automatically on push or pull request.

Deployment credentials are available only to the final deploy step. Pull request CI has read-only repository access and no production environment. Actions use immutable commit references; scanner downloads use pinned checksums. See [GitHub's secure use guidance](https://docs.github.com/en/actions/reference/security/secure-use) and [Cloudflare's GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

To deploy from a trusted local checkout, configure your domains, authenticate Wrangler, then run `npm ci` and `npm run deploy`. This checks the source, prepares the ignored deployment copy and publishes that copy. Use this command instead of deploying the placeholder configuration directly. The `DEPLOY_ENABLED` gate belongs to the GitHub workflow, not the local command.

## Verify the live result

After deployment, check the custom hostname over HTTPS, its certificate, security headers, city search, layers, and PDF/SVG export. Confirm that metadata returns same-origin tile URLs and that private paths such as `/.git/config`, `/package.json` and `/worker/index.ts` return 404. Check the main website independently to confirm it still serves Pages.

A rollback should use a known-good Worker version and compatible assets. Review Durable Object schema compatibility first; rolling back code does not undo stored data or migrations. Pause manual deployments by removing `DEPLOY_ENABLED` or setting it to `false`.

## Before making GitHub public

Enable private vulnerability reporting and the secret-scanning/push-protection features available to the repository. Protect `main` with the CI checks (`Check (Node 22)`, `Check (Node 24)` and `Dependencies and secrets`) and disallow force pushes. Review any paid feature requirements before enabling them.

The editor credits include a GitHub source link after OpenFreeMap. Print exports keep their existing attributions. For a fork, update the link in `#repositoryCredit` in `public/index.html` and check that the destination repository opens without signing in.

Local working notes are ignored and untracked in the current tree. Earlier commits can still contain files that were once tracked. Review history as well as the current tree; `.gitignore` is not a history eraser. The secret scan covers all fetched refs, but cannot detect every possible sensitive value.

### HTML integrity and analytics

HTML responses use `Cache-Control: no-cache, no-transform` to preserve the strict script policy and prevent Cloudflare from injecting Web Analytics or JavaScript Detections. Do not add a rule that requires `cf.bot_management.js_detection.passed` for Carta: this signal will be missing. The proxy rate limits and other zone protections still apply. This setting also prevents edge recompression of uncompressed HTML; JavaScript, fonts and map tiles keep their existing cache and compression behavior.

After deployment, check the delivered HTML for injected scripts and the browser console for CSP errors. See Cloudflare’s documentation on [JavaScript Detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/#if-your-origin-sends-a-no-transform-header) and [Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/).
