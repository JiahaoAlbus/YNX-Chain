# Current Plan — YNX Explorer

## Goal state

- Product: 12 YNX Explorer
- Stage: PROTECT
- Goal: Active
- Workspace: `/Users/huangjiahao/Desktop/YNX Final Worktrees/12-explorer`
- Branch: `codex/final-explorer`
- Runtime source commit: `57b0038312a58e48c97c73f8efaf4473764b9890`
- Evidence checkpoint: `0a2c1e15763152398bf67156ace6bd6a60379276`
- Runtime and evidence pushes: confirmed
- Public deployment: not claimed

## Protected runtime slices

1. Canonical `/block`, `/tx` and `/address` evidence routes with browser history restoration.
2. Canonical Summary migration with legacy read compatibility.
3. HMAC-authenticated, feed-bound opaque cursor pagination and fail-closed error classification.
4. Configured-key cursor continuity across Indexer restart.
5. `explorer.public-evidence.v1` with authority/transport, as-of, freshness, coverage, correction and integrity truth.
6. `explorer.stream-recovery.v1` with monotonic event IDs, 64-event history, retained `Last-Event-ID` replay and explicit snapshot reset.
7. Slow-client disconnect recovery, native EventSource reconnect preservation and bounded polling fallback.
8. Product-owned security scan and real local-Testnet SSE recovery smoke.

## Verification facts

- Targeted Explorer Go and command-package tests: passed.
- Explorer Race test: passed with non-fatal macOS linker warning.
- Explorer binary build: passed.
- Frontend unit tests: 16/16 passed.
- Production web build: passed.
- Accessibility: 1/1 passed.
- Playwright desktop/mobile: 10/10 passed.
- Disposable local-Testnet Explorer smoke: passed, including SSE replay `1 -> 2` and future-ID snapshot reset.
- Explorer security scan: 40 files passed.
- Whole-repository preflight remains red only in other-owner paths.
- GitHub Actions status remains unconfirmed after a TLS handshake timeout.

## Exact next action

1. Inspect current Indexer persistence, rollback and canonical-chain selection paths.
2. Implement a reproducible disposable-Testnet restart-and-reorg drill.
3. Assert deterministic rollback, canonical re-indexing, no duplicates/orphans and truthful health/metrics.
4. Add focused Go tests, run targeted Race/smoke gates, commit and push.
5. Bind the new source SHA into release metadata and cross-product vectors.
6. Keep central integration, public deployment, hosted artifact and signing flags false until direct evidence exists.

## Do not claim

- 29 Integration freeze or shared-Testnet acceptance;
- whole-repository preflight success;
- public runtime deployment or `ynxweb4.com/explorer` availability;
- hosted immutable artifact, SBOM/provenance completeness, production signing or store release;
- completion of market, Quant, economics, solvency or product evidence domains before owner contracts are accepted.
