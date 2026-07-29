# YNX 27 DEX current state

Updated: 2026-07-29T02:27:50Z

- Product: YNX 27 — YNX DEX
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/27-dex`
- Branch: `codex/final-dex`
- Repository: `https://github.com/JiahaoAlbus/YNX-Chain.git`
- Protected checkpoint SHA: `f933440d5cb791044476eb69c58c522d5c91d8a1`
- Remote checkpoint SHA: `f933440d5cb791044476eb69c58c522d5c91d8a1`
- Main SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / Behind at recovery: `0 / 0`
- Dirty state at recovery: clean
- Phase: `FREEZE`
- Long-term status: `ACTIVE`

## Latest verified tests

- `go test -race ./internal/dex ./cmd/ynx-dex-indexerd ./cmd/ynx-dex-recovery` — pass
- `npm test --prefix sdk/dex` — 21 pass
- `npm run check --prefix sdk/dex` — pass
- `npm test --prefix apps/dex` — 17 pass
- `npm run build --prefix apps/dex` — pass
- `make secret-scan` — pass with fail-closed `grep` fallback because `rg` is unavailable
- `make static-check` — pass
- `npm run dex:release:test` — pass
- `npm run dex:manifests:check` — pass
- `npm run dex:artifacts:verify` — pass

## GitHub and release truth

- Pull requests for `codex/final-dex`: none
- GitHub Actions runs for `codex/final-dex`: none
- DEX GitHub Release: none
- DEX GitHub-hosted artifact: none verified
- Local unsigned artifact manifest: `release/dex/artifact-manifest.json`
- PWA SHA-256: `dba64322521d52faa0ef5e66e297a7911bc1204dd2c7f1a75d986527bd57c669`
- SDK SHA-256: `fae8db1d106e7c82ddad2c030c207551155fe3075b4ccedabead23efd17603a5`
- Public DEX runtime: not deployed
- `ynxweb4.com/dex`: not directly verified as a deployed product page

## Completed and protected

- Recovered the original DEX candidate without destructive Git operations.
- Constant-product, StableSwap, Strategy Vault, FairFlow and LP Protection candidates are locally tested.
- Direct StableSwap Vault swap/add/remove actions and canonical approval/reconciliation SDK surface are locally tested.
- Confirmed Indexer state schema v5 and cursor schema v6 migration/reorg coverage are locally tested.
- Authenticated immutable state/cursor recovery bundle and isolated restore drill are locally tested at runtime source commit `7d61369e02ab4d50a9fc36c927dc487e47ce9814`.
- Integration Contract, test vectors, dependency handoff and unsigned artifact hashes exist.

## Remaining

- Clean-room concentrated-liquidity specification and invariant-tested runtime.
- Weighted pool and liquidity bootstrapping candidates.
- Down-schema rollback migration with representability guards.
- Quiesced provisioned-Testnet recovery drill and operational RPO evidence.
- Supply-chain scan closure, SLO/capacity evidence and unit economics.
- Complete 12-language, RTL and accessibility evidence.
- Canonical Wallet/Gateway, Oracle, Quant, Data Fabric, Explorer, Monitor, Trust and Finance acceptance.
- Verified Testnet deployment, bytecode verification, real pools/liquidity/receipts and public consistency proof.
- Independent audit, immutable hosting, production signing, GitHub Release and Website deployment.

## Current risks

- No CI run exists for the protected branch.
- No PR or merge evidence exists.
- No public deployment or release evidence exists.
- Repository-wide `go test ./...` fails in unchanged shared `internal/api` IDE selector metadata tests; see `docs/integration/CROSS_OWNER_ISSUES.md`. Focused DEX tests pass.
- Stable assets, Oracle policy, signer/funding and central registry inputs are not accepted.
- Local recovery RTO is tested, but operational RPO on a provisioned Testnet indexer is unproven.

## Evidence

- `FEATURE_COMPLETION_EVIDENCE.md`
- `.ai-bridge/full-goal-coverage.json`
- `MIGRATION_COMPATIBILITY.md`
- `docs/dex/EVIDENCE_INDEX.md`
- `docs/integration/CROSS_OWNER_ISSUES.md`
- `release/integration/ynx-dex-contract.json`
- `product-release.json`
- `public-product-metadata.json`
