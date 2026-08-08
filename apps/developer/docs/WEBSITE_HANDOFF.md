# YNX Developer Website Handoff

Handoff date: 2026-07-29  
Product owner: `11-developer`  
Integration owner: `29-integration`  
Website owner: `28-website`

## Required public route

- Official domain: `https://ynxweb4.com`
- Canonical route: `https://ynxweb4.com/developer`
- Route status: public Testnet route verified at `https://developer.ynxweb4.com/`; website DApp route integration is in review
- Founder domain `huangjeo.com` is not a product, documentation, release, support or canonical URL for this handoff.

## Source and release truth

- Release-candidate source: `63a678ac3c423b53c9628fa35c415d554827eccb`
- Browser-evidence source: `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`
- Product metadata: `apps/developer/public-product-metadata.json`
- Product release truth: `apps/developer/product-release.json`
- Release class: unsigned Testnet Preview
- `implementedLocal=true`, `testedLocal=true`, `installedLocal=true`
- `integratedCentral=false`, `deployedStaging=true`, `deployedPublic=true`
- `downloadHosted=true`, `productionSigned=false`, `storeReleased=false`
- GitHub pre-release: `developer-v0.2.0-testnet-preview.1` (published 2026-07-29, unsigned Testnet Preview)

## Page content package

The page may truthfully describe YNX Developer as a bounded Web IDE and native Testnet Preview for YNX Chain projects, API Studio workflows, permissioned YNX AI Build and Wallet-only deployment review. It may link to the immutable unsigned GitHub pre-release downloads. It must not claim arbitrary EVM compatibility, private-key custody, provider activation, central integration, a public production release or production signing.

Recommended evidence cards:

1. Web IDE and API Studio — OpenAPI validation, reviewed previews, explicit approval, host-broker credential references, bounded response inspection and generated client/adapter artifacts.
2. Accessibility and responsive evidence — 15/15 Chrome checks and six current-source screenshots from a clean pushed source.
3. Desktop Testnet Preview — locally verified macOS arm64 and Windows x64 packages, both unsigned and hosted by the GitHub pre-release.
4. Wallet-only boundary — Developer never stores a private key and cannot claim deployment success without an authoritative Wallet-signed receipt.

## Current-source visual assets

Exact hashes are authoritative in `evidence/ui/current-accessibility/accessibility-audit.json`.

- `desktop-light-1440x900.png` — `e6c3a3970e1abb5b1c9c3dbaf74028fe07778e89abe8c0b427fcafd5c0cad0c0`
- `keyboard-focus-api-studio-1440x900.png` — `622c5ceba9746fcb98bdcf1e2af5c2965b9c88acb41117bc31ec9555eb0aa42a`
- `desktop-dark-1440x900.png` — `30ec419a760c30cc228b19da8cf4af9af001142c50a15c8b167c9a80679aeb0b`
- `mobile-light-390x844.png` — `596d3aeda5bc2ca49b6ce9bf187a9f886485a411983d3ad168995953134d958b`
- `mobile-arabic-rtl-390x844.png` — `459ae141073ba871856e30842de7bcfd0dd90ad39dc591fb2ab9a18af88eabce`
- `mobile-large-text-390x844.png` — `b7da98bc4d2f883e512e9d3bbf243c288a253fb41a38e082e342127251113fa4`

## Download boundary

Direct public URLs for the exact macOS and Windows ZIPs are served from `https://developer.ynxweb4.com/downloads/` so the official website can provide YNX-domain downloads. The Windows Actions artifact (`9025496664`) expires on 2026-08-22 and must not be used as the public download. Every CTA must say unsigned Testnet Preview; production signing remains unavailable.

## Acceptance gates for Website owner

Before setting `deployedPublic=true`, owner 28 must verify:

1. `/developer` is served from the authoritative website repository and Vercel deployment.
2. Canonical, Open Graph, JSON-LD, sitemap and robots all use `https://ynxweb4.com/developer`.
3. Page copy preserves every release and signing boundary above.
4. Screenshot bytes match the supplied SHA-256 values.
5. Download controls use only the immutable GitHub pre-release URLs and label both packages unsigned Testnet Preview.
6. Public HTTP 200 content visibly identifies YNX Developer rather than a placeholder or generic product page.
7. The deployed commit and deployment URL are recorded in owner 28 evidence and accepted by owner 29.

Creating this handoff does not prove Website integration or deployment.
