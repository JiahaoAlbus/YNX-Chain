# Current Plan — YNX Explorer

## Goal state

- Product: 12 YNX Explorer
- Stage: PROTECT
- Goal: Active
- Workspace: `/Users/huangjiahao/Desktop/YNX Final Worktrees/12-explorer`
- Branch: `codex/final-explorer`
- Current tree: source-bound evidence checkpoint, clean after commit

## Protected intent

Do not discard or overwrite the current cursor, routing, schema migration, freshness, security-scan or integration-contract changes. Do not reset, clean or switch worktrees.

## Completed runtime slice

1. Canonical `/block`, `/tx` and `/address` evidence routes.
2. Search-to-evidence navigation and browser back/forward restoration.
3. Frontend migration to canonical Go Summary fields while retaining legacy read compatibility.
4. HMAC-authenticated, versioned, feed-bound opaque cursor pagination in Indexer.
5. Cursor propagation through Explorer APIs and cursor-driven frontend pagination.
6. Fail-closed rejection for tampered, cross-feed, malformed and no-longer-retained cursors.
7. Honest process-scoped versus configured-key cursor persistence in health metadata.
8. Correct HTTP 400 cursor rejection versus HTTP 502 dependency-outage classification.
9. Canonical freshness classification using `rpcHeight`, `indexedHeight` and `syncLagBlocks`.
10. Product-owned security scan that does not depend on the shared `rg` installation.
11. Product coverage matrix, release record, integration contract, handoff, test vectors and dependency acceptance.

## Verification facts

- Explorer/Indexer Go suites: passed.
- Explorer/Indexer Race: passed with non-fatal macOS linker warnings.
- Explorer/Indexer binary build: passed.
- Frontend unit tests: 14/14 passed.
- Production web build: passed against current source.
- Accessibility contract: 1/1 passed.
- Playwright desktop/mobile: 10/10 passed.
- Indexer local-Testnet smoke: passed.
- Explorer local-Testnet smoke: passed.
- Explorer npm audit: 0 vulnerabilities.
- Explorer security scan: passed across 36 files.
- Repository-wide `go test ./...`: still fails only in other-owner packages for shared key-permission and Hardhat selector-metadata issues.
- Root Hardhat tooling audit: 3 High advisories through `adm-zip`, no npm fix available; not shipped in the Explorer package.

## Exact next action

1. Submit the source-bound `explorer.integration.v1` contract and vectors for 29 Integration freeze.
2. Continue the next highest-priority local requirement: versioned public evidence envelopes carrying source, as-of, version, stale, coverage and correction semantics.
3. Add configured-key cursor restart continuity and indexer restart/reorg evidence.
4. Create product-specific Threat Model, SBOM, provenance and artifact scan gates.
5. Keep public deployment, hosting, signing and central integration flags false until direct evidence exists.

## Do not claim

- full product completion;
- central integration acceptance;
- public deployment or public runtime URL;
- hosted immutable artifact;
- production signing or store release;
- repository-wide preflight success while other-owner failures remain.
