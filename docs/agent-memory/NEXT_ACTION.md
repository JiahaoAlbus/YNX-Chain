# NEXT ACTION

Updated: 2026-07-29T02:50:00Z

1. Commit and push the Agent Memory, public-route rejection evidence, integration handoff refresh, and machine-readable release-record refresh.
2. Confirm the resulting exact-SHA Governance Actions run succeeds.
3. Open a pull request from `codex/final-governance` to `main` containing the post-PR governance implementation, CI portability fix, central-main reconciliation, recovery checkpoint, and Website acceptance evidence.
4. Merge only after required checks pass; then record the merge SHA and request Product 29 acceptance against `release/integration/governance-contract.json` and `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.
5. Product 28 must replace the generic root-shell fallback at `https://ynxweb4.com/governance` with a Governance-specific page sourced from `release/governance/public-product-metadata.json` and `release/governance/product-release.json`.
6. Do not publish a new governance prerelease until the accepted candidate SHA has exact CI, central integration acceptance, refreshed SBOM/provenance, and machine-readable release records.
