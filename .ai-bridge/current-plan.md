# Current Plan — YNX Explorer

## Goal state

- Product: 12 YNX Explorer
- Stage: PROTECT
- Goal: Active
- Workspace: `/Users/huangjiahao/Desktop/YNX Final Worktrees/12-explorer`
- Branch: `codex/final-explorer`
- Runtime source commit: `3e5cd9c7d49adcc631d47e310e2ffbce08ae3eeb`
- Runtime source push: confirmed
- Current tree: source-binding evidence checkpoint pending commit

## Protected runtime slices

1. Canonical `/block`, `/tx` and `/address` evidence routes with browser history restoration.
2. Canonical Summary migration with legacy read compatibility.
3. HMAC-authenticated, feed-bound opaque cursor pagination and fail-closed error classification.
4. Canonical freshness classification using `rpcHeight`, `indexedHeight` and `syncLagBlocks`.
5. `explorer.public-evidence.v1` for block, transaction, account, resource, token and fee records.
6. Authority/transport separation, observed/as-of basis, stale/offline/partial/coverage/correction metadata.
7. Stable SHA-256 evidence identity for successful payloads.
8. Versioned non-200 error envelopes without payload, integrity, internal host or stack disclosure.
9. Product-owned security scan and real local-Testnet envelope smoke.

## Verification facts

- Explorer/Indexer targeted Go, Race and binary build: passed.
- Frontend unit tests: 15/15 passed.
- Production web build: passed.
- Accessibility contract: 1/1 passed.
- Playwright desktop/mobile: 10/10 passed.
- Indexer and Explorer disposable local-Testnet smoke: passed.
- Explorer npm audit: 0 vulnerabilities.
- Explorer security scan: 38 files passed.
- Whole-repository preflight remains red only in other-owner key-permission and Hardhat selector-metadata paths.
- GitHub Actions status remains unconfirmed after a TLS handshake timeout from local `gh`.

## Exact next action

1. Validate source-bound JSON/JSONL and review changes.
2. Commit and push the evidence checkpoint.
3. Verify Local SHA equals Remote SHA.
4. Retry GitHub Actions status without inferring success from push alone.
5. Execute `EXP-CURSOR-006`: same approved 32-byte-or-longer configured cursor key across Indexer restart, with retained-anchor continuation and health persistence proof.
6. Implement explicit SSE `Last-Event-ID` gap detection/replay-or-snapshot semantics and integration tests.
7. Keep central integration, public deployment, artifact hosting and signing flags false until direct evidence exists.

## Do not claim

- central contract acceptance or 29 Integration freeze;
- whole-repository preflight success;
- public runtime deployment or public URL;
- hosted immutable artifact, SBOM/provenance completeness, production signing or store release;
- completion of Trading, Quant, Solvency, Economics or product-public-evidence domains before their owner contracts are accepted.
