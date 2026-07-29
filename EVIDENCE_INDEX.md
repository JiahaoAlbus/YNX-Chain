# YNX Shop Evidence Index

Updated: 2026-07-29

## Source and recovery

- Current implementation source: `a9f9ff932ede1091882509a219755b4b18a88c92`
- Metrics/load source: `14984342ebf49f0b9a1f5ec516b1aef99c6e8879`
- Migration source: `d2a55ecffb8800df6046bfa7bd152c1bc956cbcc`
- Migration evidence checkpoint: `c929056bfd083d124dff7998166bc1ee86d71393`
- Agent recovery state: `docs/agent-memory/`
- Full goal matrix: `.ai-bridge/full-goal-coverage.json`

## Product and release truth

- `apps/shop/product-release.json`
- `apps/shop/public-product-metadata.json`
- `FEATURE_COMPLETION_EVIDENCE.md`
- `docs/handoffs/shop.md`

## Integration

- `release/integration/ynx-shop-contract.json`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `internal/commerce/integration/shop-registry-v2.json`

## Runtime, recovery and operations

- `MIGRATION_COMPATIBILITY.md`
- `OBSERVABILITY.md`
- `SLO_CAPACITY_PLAN.md`
- `UNIT_ECONOMICS.md`
- `OPERATIONS.md`
- `RUNBOOK.md`

## Tests

- Commerce race suite: `go test -race ./internal/commerce/... -count=1`
- Local capacity: `go test ./internal/commerce -run TestShopConcurrentReadLoadBaseline -count=1 -v`
- Handler benchmark: `go test ./internal/commerce -run ^$ -bench BenchmarkShopProductsRead -benchmem -benchtime=3s -count=3`
- Buyer Web: `npm --prefix apps/shop test`, build, smoke and native static verification
- Validation: `make no-placeholder-check`, `make secret-scan`

## Public observations

Observed on 2026-07-29:

- Historical Shop Staging: HTTP 404.
- Historical Shop health/version: HTTP 404.
- Official `/shop`: HTTP 200 generic SPA shell, homepage canonical, not verified as a Shop product page.

These observations are availability/truth evidence only. They are not current-source deployment evidence.

## Missing release evidence

- Current deterministic artifact and download
- SHA-256 manifest
- SBOM
- Provenance
- Current-source Staging health/version/metrics
- Restart/restore and packaged load evidence
- PR/CI/merge
- Shop GitHub Release
- Wallet/Pay/Trust shared-Testnet flow
- Shop-specific official page and indexing
- Native current-source builds/installations
- Production signing/store/audit evidence
