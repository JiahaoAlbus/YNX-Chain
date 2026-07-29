# YNX Explorer Current State

- Product: `12 — YNX Explorer`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/12-explorer`
- Branch: `codex/final-explorer`
- Runtime source SHA: `57b0038312a58e48c97c73f8efaf4473764b9890`
- Evidence checkpoint SHA: `0a2c1e15763152398bf67156ace6bd6a60379276`
- Remote SHA at snapshot: `0a2c1e15763152398bf67156ace6bd6a60379276`
- Main SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind remote branch: `0 / 0`
- Dirty state at snapshot: `clean`
- Stage: `PROTECT`
- Goal status: `active`
- Updated at: `2026-07-29T02:53:36Z`

## Latest successful verification

- `go test ./internal/explorer ./cmd/ynx-explorerd` — passed.
- `go test -race ./internal/explorer` — passed; non-fatal macOS `LC_DYSYMTAB` linker warning only.
- `go build ./cmd/ynx-explorerd` — passed.
- `npm test` in `apps/explorer` — 16/16 passed.
- `npm run build` — passed.
- `npm run test:a11y` — 1/1 passed.
- `npm run test:e2e` — 10/10 passed.
- `npm run security:scan` — 40 files passed.
- `bash scripts/verify/explorer-check.sh` — passed against a disposable local Testnet, including SSE replay `1 -> 2` and future-ID snapshot reset.
- `scripts/verify/indexer-cursor-restart-check.sh` — configured-key cursor restart continuity is bound to source commit `1d403f82e1e3a17ee892e43187752e2d564767c5`.

## GitHub and release state

- Pull requests for `codex/final-explorer`: none found.
- GitHub Actions for the current branch: unconfirmed because `gh run list` hit a TLS handshake timeout.
- Explorer-specific GitHub Release: none found.
- Immutable hosted artifact: none.
- SBOM / provenance bound to this Explorer candidate: not published.
- Public deployment: not verified.
- `ynxweb4.com` Explorer route: canonical target is `/explorer`; deployment is not claimed.

## Completed in the current recovery cycle

- Recovered the true branch state and confirmed the older plan was stale.
- Verified configured-key cursor restart continuity was already committed and pushed.
- Implemented monotonic SSE event IDs with a bounded 64-event replay history.
- Implemented `Last-Event-ID` ordered replay.
- Implemented explicit `explorer.stream-recovery.v1` snapshot reset for invalid, expired, future and restart-invalidated IDs.
- Disconnected slow stream clients instead of silently dropping events.
- Preserved browser-native EventSource reconnect behavior and bounded polling fallback.
- Added Go, frontend and real local-Testnet recovery evidence.
- Bound runtime SHA `57b00383…` into release metadata, integration contract and cross-product vectors.

## Remaining work

- Obtain 29 Integration freeze/acceptance for `explorer.integration.v1`, `explorer.public-evidence.v1`, cursor vectors and SSE recovery vectors.
- Add reproducible Indexer restart-and-reorg recovery evidence.
- Add accepted read models for market, Quant, economics, solvency and product-release evidence after owner contracts exist.
- Resolve public ingress, immutable artifact, SBOM/provenance, public deployment and `ynxweb4.com/explorer` verification through the owning products.
- Retry current-SHA GitHub Actions inspection when GitHub API transport is healthy.

## Current risks

- Whole-repository `go test ./...` remains red in other-owner key-permission and Hardhat selector-metadata paths; targeted Explorer/Indexer gates are green.
- Root Hardhat development tooling has three High `adm-zip` advisories with no npm fix; it is not shipped in the Explorer web bundle.
- Central acceptance, public deployment and release publication remain false until direct evidence exists.

## Evidence

- `product-release.json`
- `release/integration/explorer-contract.json`
- `release/explorer/public-product-metadata.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `.ai-bridge/full-goal-coverage.json`
