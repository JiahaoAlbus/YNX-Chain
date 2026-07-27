# Agent Status — YNX Explorer

- Updated: 2026-07-27
- Product: 12 YNX Explorer
- Stage: PROTECT
- Goal status: Active
- Workspace/branch match: confirmed
- Runtime source commit: `3e5cd9c7d49adcc631d47e310e2ffbce08ae3eeb`
- Upstream: `origin/codex/final-explorer`
- Runtime source push: confirmed
- Evidence binding: prepared in current checkpoint
- Public deployment: not claimed

## Current checkpoint

The Explorer now has two locally verified runtime slices: secure opaque cursor/deep-link migration and additive `explorer.public-evidence.v1` envelopes for block, transaction, account, resource, token and fee records. The envelope separates authority from transport, exposes observed/as-of/freshness/coverage/correction truth, hashes successful payloads, preserves payloads when only freshness probing degrades, and fails closed without payload or integrity when the source is unavailable.

## Current verification

- Explorer/Indexer Go suites and command packages: passed.
- Explorer/Indexer Race: passed with non-fatal macOS `LC_DYSYMTAB` linker warnings.
- Explorer/Indexer binary build: passed.
- Frontend unit tests: 15/15 passed.
- Production web build: passed.
- Accessibility contract: 1/1 passed.
- Playwright desktop/mobile: 10/10 passed, including public evidence metadata visibility.
- Indexer disposable local-Testnet smoke: passed.
- Explorer disposable local-Testnet smoke: passed, including live `explorer.public-evidence.v1` validation.
- Explorer npm audit: 0 vulnerabilities.
- Explorer security scan: 38 product source and release files passed.

## Known release facts

- Repository-wide `go test ./...` remains red only in other-owner key-permission and Hardhat selector-metadata paths.
- Root Hardhat development tooling reports three High advisories through `adm-zip`, with no npm fix available; these packages are not shipped by Explorer.
- GitHub Actions status for this branch is not yet confirmed because the local `gh` query encountered TLS handshake timeout.
- Central contract freeze, public ingress, hosted immutable artifact, cross-region proof and public deployment remain false.

## Exact next action

Commit and push the source-bound evidence checkpoint, verify Local/Remote SHA equality, retry GitHub Actions status, then execute configured-key cursor restart continuity followed by explicit SSE `Last-Event-ID` gap recovery.
