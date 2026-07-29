# YNX Seller Console Current State

Updated: `2026-07-29T02:41:03Z`

## Identity

- Product: `10 | YNX Seller Console`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/10-seller-console`
- Repository: `JiahaoAlbus/YNX-Chain`
- Branch: `codex/final-seller-console`
- Runtime source SHA: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`
- Evidence checkpoint SHA: `365318525937cb0b0c69f19ac7859094bc2e7cbe`
- Remote evidence checkpoint SHA: `365318525937cb0b0c69f19ac7859094bc2e7cbe`
- Main SHA observed during recovery: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Upstream ahead/behind at evidence checkpoint: `0/0`
- Dirty state at evidence checkpoint: `clean`
- Current phase: `FREEZE / local completion and external acceptance preparation`

This memory is committed after the evidence checkpoint, so the containing documentation-only commit will be one commit newer. On recovery, always verify actual `HEAD`, upstream and dirty state rather than treating this file as self-referential Git truth.

## Latest successful tests

Bound to runtime source `a90d1ee59eec38c15ce42b39420f2625ed758dd0`:

- `go test ./internal/commerce/...`: passed.
- `go test -race ./internal/commerce`: passed; non-failing macOS linker `LC_DYSYMTAB` warning recorded.
- `go vet ./internal/commerce/...`: passed.
- `npm test` in `apps/seller-console`: passed, 3 tests.
- `npm run build` in `apps/seller-console`: passed.
- Seven release/integration/public JSON documents were parsed successfully after evidence updates.

## GitHub and release truth

- GitHub Actions for `codex/final-seller-console`: no runs returned.
- PR state: not verified; bounded GitHub TLS handshake timeout occurred during recovery.
- GitHub Release state: not verified; bounded GitHub TLS handshake timeout occurred during recovery.
- Tag at runtime source/evidence checkpoint: none observed.
- Current immutable hosted artifact: none.
- Current SBOM: none verified.
- Current provenance/attestation: none verified.
- Current-source staging deployment: false.
- Current-source public deployment: false.
- Current-source download hosted: false.

## Public route truth

- Official YNX domain: `ynxweb4.com`.
- Requested route: `https://ynxweb4.com/seller-console`.
- Website handoff created: true.
- Owner 28 accepted handoff: false.
- Canonical verified: false.
- Public route verified against current source: false.
- Historical staging for commit `38e2f68` is retained only as historical evidence.

## Completed locally

- Canonical Wallet-bound Seller session validation.
- Eight-role least-privilege authority matrix.
- Wallet-account-bound invitations and one-time exact-target acceptance.
- Existing-member-only role updates.
- Owner-only local role revocation and store-scoped Wallet receipt validation.
- Transactional Audit and local Seller Outbox.
- Catalog, inventory, order, settlement/refund evidence and fulfillment boundaries.
- Snapshot v6 migration and future-version fail-closed behavior.
- HMAC-protected backup and verified restore primitives.
- Non-destructive v3/v4/v5 rollback export with lossy-state refusal.
- Owner-only store-scoped Seller data portability export.
- Preview-first transient retention with protected authority and financial evidence.
- Machine-readable integration contract and cross-product vectors.
- Migration runbook, release truth, dependency acceptance and operator-input request.
- Public product metadata and Owner 28 Website handoff for `ynxweb4.com`.

## Remaining

- Bounded provider registry and provider lifecycle controls.
- Central Wallet, Pay, Trust, Data Fabric and Monitor acceptance.
- Shared Testnet end-to-end execution.
- Authenticated staging-copy migration/restore drill.
- SLO/capacity, performance, accessibility and security completion.
- Immutable release artifact, hashes, SBOM and provenance.
- PR/merge/release verification.
- Owner 28 deployment and canonical/public evidence on `ynxweb4.com`.

## Current risks

- No current-source deployed runtime or immutable artifact exists.
- Central dependencies remain pending, so local adapters cannot be called integrated.
- Provider functionality remains intentionally unavailable where no trusted provider is configured.
- The repository-wide test suite has pre-existing failures in non-Seller ownership areas; Seller changes must not overwrite those products.
- GitHub API TLS timeouts reduced PR/Release visibility during this recovery, but did not affect source push verification.

## Evidence entrypoints

- `apps/seller-console/product-release.json`
- `apps/seller-console/public-product-metadata.json`
- `apps/seller-console/FEATURE_COMPLETION_EVIDENCE.md`
- `apps/seller-console/EVIDENCE_INDEX.md`
- `release/integration/seller-console-contract.json`
- `release/integration/seller-console-website-handoff.json`
- `release/integration/operator-inputs.request.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `docs/operations/MIGRATION_COMPATIBILITY.md`
- `.ai-bridge/full-goal-coverage.json`
