# Blockers and Boundaries

## Execution infrastructure

- `EXEC-INFRA-GITHUB-ACTIONS-001`
  - Owner: GitHub API transport / local execution path
  - Evidence: `gh run list --branch codex/final-explorer` failed with `TLS handshake timeout` on 2026-07-29.
  - Impact: Current-SHA Actions status is unconfirmed.
  - Product status: This is not an Explorer product blocker and must not be represented as `externalBlocked`.
  - Recovery condition: GitHub API transport responds normally.
  - First action after recovery: Query branch runs and match `headSha` exactly to the current remote SHA.

## Cross-product acceptance boundaries

- `EXP-29-FREEZE-001`
  - Owner: `29-integration`
  - Required input: Freeze/accept `explorer.integration.v1`, `explorer.public-evidence.v1`, cursor vectors and `explorer.stream-recovery.v1` vectors.
  - Prepared evidence: `release/integration/explorer-contract.json`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/integration/INTEGRATION_HANDOFF.md`.
  - Why Product 12 cannot self-approve: Protocol freeze and shared-Testnet acceptance belong to Owner 29.

- `EXP-30-RELEASE-001`
  - Owner: `30-security-sre-release`
  - Required input: Approved multi-instance `YNX_INDEXER_CURSOR_KEY` secret reference/rotation pattern, immutable artifact publication, SBOM/provenance and release controls.
  - Prepared evidence: Configured-key continuity is tested locally; no secret value is stored.
  - Why Product 12 cannot self-complete: Central secret and release controls belong to Owner 30.

- `EXP-28-PUBLIC-001`
  - Owner: `28-website`
  - Required input: Deploy and verify canonical `/explorer` product route on `https://ynxweb4.com` after central acceptance and artifact availability.
  - Prepared evidence: `release/explorer/public-product-metadata.json` and canonical deep-link contract.
  - Why Product 12 cannot self-complete: Website repository, Vercel deployment and public SEO ownership belong to Owner 28.

## Shared repository risks

- Whole-repository `go test ./...` is red in other-owner key-permission and Hardhat selector-metadata paths; targeted Explorer/Indexer verification is green.
- Root Hardhat development tooling reports three High `adm-zip` advisories with no available npm fix; these dependencies are not shipped in the Explorer bundle.

## Not blockers for local execution

The remaining local Indexer restart/reorg drill, additional negative privacy tests, SLO/capacity work and product documentation can proceed without waiting for the owners above.
