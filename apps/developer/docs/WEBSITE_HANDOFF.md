# YNX Developer Website Handoff

Handoff date: 2026-07-29  
Product owner: `11-developer`  
Integration owner: `29-integration`  
Website owner: `28-website`

> **2026-08-31 supersession — do not publish from the historical ZIP sections below.**
> Current Developer release truth is
> `apps/developer/product-release.json`. The only current desktop candidates are
> a local macOS ARM64 DMG (`ccab67b2…`) and a CI-installed Windows x64 MSIX
> (`fa73d751…`); both have `downloadHosted=false`. The former ZIP records are
> retained solely as history. Website must not restore ZIP download CTAs. A
> future desktop publication requires immutable official hosting, external HTTPS
> byte/SHA-256 readback, production-signing classification and a separate
> rollback-bound release lease.

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
- Pending Web IDE feature source: `a30308dc1320372c09c7dd03d7715e6a828a68c4`
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
SHA-pinned JUnit Jupiter, dependency-free offline Cargo and pinned offline
Hardhat Solidity project-test execution in the no-network sandbox.
The pending source also routes Node.js, Python, Rust and Go DAP through a
selected owner/project LXD lease using SHA-pinned js-debug, debugpy, Ubuntu LLDB
18 and Delve 1.25.2; Node uses per-session Unix sockets and Go uses a fresh
loopback-only port.
It also adds a reviewed exact Python wheel installation path with an atomic
project venv and SHA-256-bound `requirements.ynx.lock`; source distributions and
Python build scripts are rejected, every installed wheel needs pip integrity
evidence, and temporary package egress must be removed before success.
The pending production transaction additionally requires the fixed
`ynx-pkg-egress` bridge to pass its default-reject DNS/HTTPS-only ACL
verifier before any service or release mutation. The network is not yet present
and the default LXD bridge is not an acceptable substitute.
After the candidate starts, the transaction must also install and run one exact
npm package and one SHA-256-bound Python wheel, restart the service, rerun both
with task networking disabled, verify the persisted locks, and prove no temporary
package NIC remains. Local/mock gates do not replace that production evidence.
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

## 2026-08-20 current local macOS package addendum

The current Developer-owned macOS package is hosted at its immutable Developer official-domain
URL. Its exact source is `e01b9e4a8cc00be2e590e86e8f043fd746696adf`, ZIP SHA-256 is
`af4c57b89ad5d7cca6c42af47f33d156d182a92870e4d43ed1d558f51de1b01f`, size is
168,157,529 bytes and embedded SBOM SHA-256 is
`37436588278850c5052d2032f917572dade2af7cf56c4228d4f79f5359568e9f`.

The package passed extracted provenance, no-Team-ID ad-hoc signing, a native Keychain
write/read/cleanup self-test, native absent-Wallet scheme discovery, cold launch, real bounded C++ compilation, workspace persistence
on a second launch and child-process cleanup. It remains an unsigned Testnet Preview: no Developer
ID signature, notarization or update channel exists. The ZIP, matching SBOM and provenance have
production Caddy HTTP 200/hash-readback evidence at `developer.ynxweb4.com/downloads`; this does
not claim an independent external-browser proof. The full record is
`apps/developer/evidence/desktop/macos-current-e01b9e4a.json`.

## 2026-08-20 current Linux x64 Server package addendum

The current self-hosted Linux x64 Server appliance is available at the Developer official-domain
download route. Its exact protected source is `bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3`,
TAR.GZ SHA-256 is `aab9fb6ea976fffab0ae66382401bf8e9886a05fb377f483dc46103fd8be4c05`, and size is
138,538,840 bytes. It requires Linux x86_64 and Node.js 22 or newer, carries application
dependencies and built frontend, and deliberately excludes workspace state and operator environment.

The archive passed protected-evidence integrity binding, extraction, a separate cold start and
`healthz` check. The TAR.GZ, provenance and SHA-256 manifest are immutable official-domain
downloads. It is an unsigned Testnet Preview server appliance, not a signed container image or
production-signed release. The machine-readable evidence is
`apps/developer/evidence/platform/linux-server-current-bc8a37bc.json`.

## 2026-08-21 current Windows x64 package addendum

The current Windows x64 hosted-workspace client is hosted on the immutable Developer
official-domain route. Its exact source is `6ac39fd140a54675526583c4c3ca6b07fc03af19`,
its protected Web IDE runtime checkpoint is `bc8a37bc6f2bcfcbe9415cb0e9da17a5294046a3`,
the ZIP SHA-256 is `10b6914614a86f694d9e58b21e311148b1dd0dc4b21ff39612c4a2486c5e0627`,
and it is 72,538,901 bytes. The package is an unsigned (`NotSigned`) WPF/WebView2
hosted-workspace client, not a locally bundled compiler sandbox.

GitHub Actions run `32396185202` passed the client tests, all 67 Developer tests,
self-contained package build, portable extraction and resource checks, public workspace
connection, a real remote C++ compilation, and two WPF cold launches. The exact ZIP,
SBOM, provenance, package record, CI install evidence and SHA-256 list received production
Caddy HTTP 200/hash-readback checks at `developer.ynxweb4.com/downloads`. The machine-readable
record is `apps/developer/evidence/desktop/windows-current-6ac39fd1.json`; it is not
Authenticode-signed, store-released or centrally integrated.

An independent public range request also returned `206`, `Content-Range: bytes 0-0/72538901`,
`Content-Disposition: attachment`, `application/zip` and `X-Content-Type-Options: nosniff`.
That proves public reachability and byte size only; the full SHA-256 remains bound by the
production Caddy readback and published checksum file.
