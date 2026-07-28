# YNX Calendar Website integration handoff

Consumer: `28-website`  
Reviewers: `29-integration`, `30-security-platform`  
Metadata source: `public-product-metadata.json`  
Runtime source: `9cf30f16c4312b4438d087b1df58cec68df54f15`

## Canonical package

- Route: `/calendar`
- Title: `YNX Calendar — Private scheduling with explicit approval`
- H1: `Your time, clearly under your control`
- Primary color: `#002FA7`
- Current runtime status: local-tested, not publicly deployed
- Current-source downloads: none
- Website published: false
- Public runtime deployed: false

Website must consume the exact feature, FAQ, risk, locale, screenshot and structured-data fields from `public-product-metadata.json`. It must not infer that a passing local build is a deployment or that an older preview package represents the current source.

## Asset handoff

The following public paths are proposals and are not hosted yet:

- `/products/calendar/icon.svg`
- `/products/calendar/logo.svg`
- `/products/calendar/screenshots/calendar-desktop.png`
- `/products/calendar/screenshots/calendar-mobile.png`

Before publication, Website must host approved assets, bind immutable hashes, verify alt text, and record its deployment commit. Local browser proof images may be used as source material only after Website copies and validates them; their repository locations are not public URLs.

## Download policy

No current-source download may appear until Calendar and Security/SRE provide:

- exact source commit;
- immutable URL;
- SHA-256 and bytes;
- signing class;
- minimum OS;
- SBOM and provenance;
- install, cold-start, restart and callback evidence.

The historical release `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f` is a real GitHub prerelease published on 2026-07-18. Its target is `e227c4f0505537b19f4588ea26478c54518f0a4c`. It may be shown only in a clearly separated “historical test-only preview” area and must never be the default current download.

## Required public routes

- `/support/calendar`
- `/privacy/calendar`
- `/security/calendar`
- `/status/calendar`

These are proposed canonical routes, not proof that the pages exist. Website must publish and probe them before setting `websitePublished=true`.

## Structured data

Use `SoftwareApplication` with `applicationCategory=ProductivityApplication` and operating systems Web, Android, iOS and macOS. Do not publish pricing or availability claims until direct commercial and release evidence exists. FAQ structured data must match the visible FAQ exactly.

## Publication gates

1. Metadata contains no internal paths, internal hosts, branch names or unsupported production claims.
2. `websitePublished`, `deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain independent booleans.
3. Current-source and historical artifacts are visibly separated.
4. Support/privacy/security/status routes return public responses.
5. Canonical, title, meta description, H1, Open Graph, robots, sitemap and JSON-LD are verified.
6. Desktop and 390px layouts pass keyboard, focus, contrast, reduced-motion and RTL checks.
7. Website commit, public URL probes and Security/SRE acceptance are written back to Calendar evidence.

Until all gates pass, Website must render Calendar as a locally tested product in active integration, not as an already deployed or production-signed service.
