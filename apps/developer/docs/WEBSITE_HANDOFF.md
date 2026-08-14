# YNX Developer Website Handoff

Handoff date: 2026-07-29  
Product owner: `11-developer`  
Integration owner: `29-integration`  
Website owner: `28-website`

## Required public route

- Official domain: `https://ynxweb4.com`
- Canonical route: `https://ynxweb4.com/developer`
- Route status: full YNX Code platform is live at `https://developer.ynxweb4.com/`; main-website DApp route integration remains in review
- Founder domain `huangjeo.com` is not a product, documentation, release, support or canonical URL for this handoff.

## Source and release truth

- Current full YNX Code macOS source: `76322af5e8c26a64fb6425c51d96c67d2b3df65f`
- Current Windows hosted-workspace client source: `76322af5e8c26a64fb6425c51d96c67d2b3df65f`
- Browser-evidence source: `98fcbe3cff68b4b01ebfd94df2d1476b41ecf2b5`
- Current public Web IDE source: `17ee9ae5bf50677a3316b0838884dd135de80599`
- Pending Web IDE feature source: `dbcb097539164747c77e8983dbf3200346685845`
- Product metadata: `apps/developer/public-product-metadata.json`
- Product release truth: `apps/developer/product-release.json`
- Release class: unsigned Testnet Preview
- `implementedLocal=true`, `testedLocal=true`, `installedLocal=true`
- `integratedCentral=false`, `deployedStaging=true`, `deployedPublic=true`
- `downloadHosted=true`, `productionSigned=false`, `storeReleased=false`
- Historical GitHub pre-release: `developer-v0.2.0-testnet-preview.1` (published 2026-07-29); current download CTAs use immutable YNX-domain URLs.

The pending Web IDE source adds owner/project-scoped persisted environment
records and Secret references, reconnectable terminal inventory and Stop,
reviewed container loopback port previews, redacted running-task inventory and
owner-bound queued/running-task cancellation, plus distinct C17 build/run/test
and C LLDB debugging, Eclipse JDT LS-backed Java language intelligence, plus
SHA-pinned JUnit Jupiter and dependency-free offline Cargo project-test
execution in the no-network sandbox.
These capabilities must remain labelled
`pending public verification` until the protected Developer candidate transaction
returns `passed`, the public `/healthz` version matches the exact deployed commit,
and the transaction evidence path plus immutable LXD image fingerprint are
recorded. Updating this handoff or its website copy is not deployment evidence.

## Page content package

The page must separate available surfaces. The macOS arm64 direct download and public Web IDE are the full React/Monaco/service-based YNX Code Testnet Preview. The current Windows x64 download is a WebView2 hosted-workspace client for that same public service; it passed a real remote C++ compile but must not be described as a bundled local Windows compiler sandbox. No surface may claim arbitrary EVM compatibility, private-key custody, public BFT deployment, central integration, a production release or production signing.

Recommended evidence cards:

1. Web IDE and API Studio — OpenAPI validation, reviewed previews, explicit approval, host-broker credential references, bounded response inspection and generated client/adapter artifacts.
2. Accessibility and responsive evidence — 15/15 Chrome checks and six current-source screenshots from a clean pushed source.
3. Desktop Testnet Preview — full local YNX Code bundle on macOS arm64; current hosted-workspace YNX Code client on Windows x64; both unsigned and directly hosted by the YNX domain.
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

Direct public URLs for exact ZIPs are served from `https://developer.ynxweb4.com/downloads/`. The current full macOS package is `ynx-developer-0.2.0-testnet-preview-76322af5-macos-arm64-unsigned.zip`. The current Windows hosted-workspace client is `ynx-developer-0.2.0-testnet-preview-76322af5-windows-x64-unsigned.zip`; its Actions artifact (`9110259455`) expires and must not be used as the public download. Every CTA must state platform, delivery mode and unsigned Testnet Preview status; production signing remains unavailable.

## Acceptance gates for Website owner

Before setting `deployedPublic=true`, owner 28 must verify:

1. `/developer` is served from the authoritative website repository and Vercel deployment.
2. Canonical, Open Graph, JSON-LD, sitemap and robots all use `https://ynxweb4.com/developer`.
3. Page copy preserves every release and signing boundary above.
4. Screenshot bytes match the supplied SHA-256 values.
5. Download controls use immutable YNX-domain URLs, label both packages unsigned Testnet Preview, and identify Windows as a hosted-workspace client rather than a local compiler runtime.
6. Public HTTP 200 content visibly identifies YNX Developer rather than a placeholder or generic product page.
7. The deployed commit and deployment URL are recorded in owner 28 evidence and accepted by owner 29.

Creating this handoff does not prove Website integration or deployment.
