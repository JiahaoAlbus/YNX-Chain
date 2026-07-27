# YNX Pay evidence index

## Direct local evidence

- Go Pay/Card race suites: passing at recovery checkpoint `c20beda`.
- Pay client: six tests and TypeScript check passing at `c20beda`.
- Merchant Console: seven tests and production build passing at `c20beda`.
- Card client: eight tests and TypeScript check passing at `c20beda`.
- Environment, secret and disallowed-placeholder scans: passing at `c20beda`.
- Product release records: `apps/pay/product-release.json`, `apps/merchant-console/product-release.json`, `apps/card/product-release.json`.
- Canonical Wallet/Gateway handoff: `docs/integration/pay-card-wallet-registry.json`.
- Split Payment runtime and negative tests: `internal/payproduct/split.go`, `internal/payproduct/split_test.go`; `go test ./internal/payproduct/... -count=1` and `go test -race ./internal/payproduct/... -count=1` passed on 2026-07-27.
- Split consumer flow at `a405604714645df1084ed9e06cc7d7b6f9a4d4b0`: strict Invoice/Split reference parsing, QR/deep links, signed plan display, 12-language and Arabic RTL share UI, secure claim recovery, automatic Wallet-auth resume, child Invoice v4 handoff, 11 client tests and Android/iOS Hermes exports.
- Canonical Pay contract and cross-product vectors: `release/integration/pay-contract.json`, `docs/integration/INTEGRATION_HANDOFF.md`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Full-goal machine coverage: `.ai-bridge/full-goal-coverage.json`.

## Historical-only evidence

`internal/payproduct/proof/live-testnet-payment.json` proves an earlier source version and cannot establish current public deployment or current artifact behavior.

## Missing direct evidence

Fresh Testnet transaction/receipt, sponsored UserOperation, authoritative refund transaction, bridge destination confirmation, central integration, staging/public URLs, hosted immutable artifacts, current Android/iOS install and cold launch, production signatures, store releases, CI run URLs, SBOM/provenance, migration/restore drill, load measurements, deployed telemetry and public `/pay` remain unproven.

