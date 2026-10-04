# Quant matching introduction/runtime publication handoff

## Immutable candidate

Product source `bd85c9590c3685aacd5b83dd33ace9c137645407`, tree
`2a4820e3287c208ca80c742ac06cb258826d7129`. This evidence-only successor is
not the binary source. Owner branch `codex/exchange-sso-cookie-binding-20261002`.

Archive `/tmp/ynx-quant-microsite-bd85c9590-linux-amd64.tar.gz`, 3880144 bytes,
SHA256 `54008b6b1b91e3195c1da5bfd8267e3c69d3d1bcbe432834496875a8ec80ef6a`.
Independent repeat `/tmp/ynx-quant-microsite-bd85c9590-repeat-linux-amd64.tar.gz`
has identical bytes/hash; `cmp` passes. Release root `ynx-quant-lab-bd85c9590c36`.
These are Linux server engineering archives, NOT user installers.

`ynx-quantd`: 8265912 bytes, SHA256
`7e091d76a4d82a9d47fb3afbaa65820bd9abfc320fa34e2c14e5665b3eb36682`.
ELF64 little-endian x86-64 and embedded source commit are verified.
`BUNDLE_MANIFEST.json`: 5580 bytes, SHA256
`0d48d2de62cc23def50d654d50be58379649127d18102742c5ea8bfee9a3b80e`.
`SHA256SUMS`: 1267 bytes, SHA256
`1bd3874ad77e14571d62a398c4b32fd1a77c9a158655e2007999d2e0158e319e`.
Inventory is exactly 14 files: binary, 11 original/new Web assets, manifest,
and sums. Every payload byte/hash, sums set, Git asset identity and both HTML
dependency graphs are verified by the actual-archive browser gate.

## Executed local gates

- `go test ./internal/quantlab/... ./apps/quant-lab/server -count=1`: PASS.
- `node --test --test-reporter=dot apps/quant-lab/tests/introduction-assets.test.mjs apps/quant-lab/tests/runtime-assets.test.mjs apps/quant-lab/tests/business-flow.test.mjs`: 160 PASS.
- `node apps/quant-lab/tests/introduction-browser.mjs`: actual installed Chrome,
  controlled source; 320/390/1440, English/Chinese, focus/overflow, same-tab
  introduction/app/return/refresh, known deep links and query, locale preservation,
  introduction without SDK/API traffic, zero page errors or non-GET requests.
- `node apps/quant-lab/tests/packaged-guest-browser.mjs /tmp/ynx-quant-microsite-bd85c9590-linux-amd64.tar.gz bd85c9590c3685aacd5b83dd33ace9c137645407`: actual archive-only Chrome at 320/390/1280,
  all 11 Web assets, original logo, English, official YNX/MetaMask fallback,
  original Paper navigation/preferences/reload, one tab, zero page errors/writes.
- Syntax, exact asset verification, `git diff --check`: PASS.

Source screenshot and design comparison: `design-qa.md` and
`evidence/introduction-source-browser-20261004.md`. Packaged captures retained
under `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-packaged-browser-r6sJ4j`.
Resume-turn actual archive rerun also PASS at
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-packaged-browser-VBl4wQ`;
all 11 assets matched, zero page errors/non-GET requests, one tab at each width.
The preview is the actual guest Research workspace with unavailable service
clearly labeled, not a fabricated backtest, order or yield.

## A formal publication contract

A is the single formal Host/Auth/SSO publisher; this owner has performed no Host
or SSH mutation. Normal compatible publication is already authorized: hand off
this exact package, do not silently rebuild SDKs or mix another product source.
Before switching, independently bind the current Quant service/config/data,
exact rollback release and hashes; preserve existing accounts, preferences,
UNKNOWN intents, API/SSO/callback routes and engine permissions. Do not activate
new trading permission or interpret this introduction as execution evidence.

Query-free `/` is the English-first introduction. `/app` and `/index.html` serve
the original application; root query stays the original application. Legacy
application hashes forward in the same tab. Registered APIs/callbacks retain
existing handling. Native wrappers, if any, must use the original app entry and
must be independently tested; Web success is not installed success.

After publication, return exact URL/version/source/binary and all Web asset
bytes/SHA, health/readiness, rollback pointer, and actual public mobile/desktop
introduction → app → return/refresh evidence. Confirm no account request on the
introduction and no blank tab. User account approval/sign/EIP712/send requires
immediate explicit confirmation; no such action is authorized by this handoff.

Local source/tests/browser and matching candidate: verified. Public deployment,
public provider approval, installed native, Product Session/private identity,
real strategies/orders/transactions and final user acceptance: NOT VERIFIED.
Current actionable release dependency: A must publish this exact matching
candidate and return source-bound runtime evidence. Do not count this file as
public completion or a second Host executor authorization.
