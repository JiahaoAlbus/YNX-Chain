# YNX Calendar Website integration handoff

Consumer: `28-website`  
Reviewers: `29-integration`, `30-security-platform`  
Metadata source: `public-product-metadata.json`  
Current product source: `f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2`
Public Web runtime source: `635f6745db8b5d4e4f00253d72fd5ab97da471ac`

## Canonical package

- Route: `/dapp/calendar`
- Title: `YNX Calendar — Private scheduling with explicit approval`
- H1: `Your time, clearly under your control`
- Primary color: `#002FA7`
- Current runtime status: public Testnet Web preview; not a production scheduling service
- Current-source downloads: none
- Website published: true
- Public runtime deployed: true

Website must consume the exact feature, FAQ, risk, locale, screenshot and structured-data fields from `public-product-metadata.json`. It must not infer that a passing local build is a deployment or that an older preview package represents the current source.

## Current public proof

The Website now publishes the Calendar-specific product/status route at `https://www.ynxweb4.com/dapp/calendar`, and the direct public runtime is `https://calendar-testnet.43.153.202.237.sslip.io/`. On 2026-08-13T12:02:00Z the runtime returned HTTP 200 and health reported exact build `635f6745db8b5d4e4f00253d72fd5ab97da471ac`. Its public assets matched the premium responsive release and the Service Worker immediately activates and claims existing clients. This proves Website publication and the Testnet Web runtime; it does not prove native package hosting, production scheduling, Mail delivery, AI/Data Fabric acceptance, production signing or store release.

The legacy `/calendar` convenience redirect may remain, but Website must keep `/dapp/calendar` content and release-state truth synchronized with the owner registry. A future canonical-route change still requires exact title, description, H1, Open Graph, JSON-LD, robots/sitemap and support/privacy/security/status probes.

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

These routes are the continuing support/privacy/security/status contract. Website publication is true because the product route and release registry are public; each auxiliary route still requires its own probe before it is represented as independently verified.

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

Until all gates pass, Website must render Calendar as a public Testnet Web preview in active integration, never as a production-signed native release or production scheduling service.
