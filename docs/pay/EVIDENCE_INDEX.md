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
- Split consumer flow at `a405604714645df1084ed9e06cc7d7b6f9a4d4b0`: strict Invoice/Split reference parsing, QR/deep links, signed plan display, 12-language and Arabic RTL share UI, secure claim recovery, automatic Wallet-auth resume and child Invoice v4 handoff.
- Quant/service billing at `8118cea0404030f6818a4769cc847f8716f60490`: external Ed25519 verifier registry, stale/tamper/key-collision rejection, net-flow-adjusted high-water-mark calculation, deposit exclusion, Invoice v5 service/evidence/payer binding, wrong-payer rejection, owner/finance RBAC, public payer redaction, 13 client tests, independent evidence signature/digest/math verification, 12-language fee review and Android/iOS Hermes exports.
- Store recovery at `2303ceeed6ff8e7a8606b87a2e7155702e4e27b1`: atomic fsync persistence, strict future-version rejection, immutable `0600` backups, SHA/bytes/record receipts, single-read source validation, fixture migration, verified rollback, corrupt-destination quarantine, wrong-key/corrupt-source rejection and fail-closed operator CLI. Go, Race, Vet, Pay API and full Pay smoke passed.
- Canonical Pay contract and cross-product vectors: `release/integration/pay-contract.json`, `docs/integration/INTEGRATION_HANDOFF.md`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/integration/DEPENDENCY_ACCEPTANCE.md`, `docs/integration/pay-quant-billing.json`.
- Full-goal machine coverage: `.ai-bridge/full-goal-coverage.json`.

## Historical-only evidence

`internal/payproduct/proof/live-testnet-payment.json` proves an earlier source version and cannot establish current public deployment or current artifact behavior.

## Missing direct evidence

Fresh Testnet transaction/receipt, sponsored UserOperation, authoritative refund transaction, bridge destination confirmation, accepted Quant/Data Fabric verifier key and live evidence stream, Quant Invoice v5 Testnet payment, central integration, staging/public URLs, hosted immutable artifacts, current Android/iOS install and cold launch, production signatures, store releases, CI run URLs, SBOM/provenance, production-volume RTO/RPO and remote backup retention, load measurements, deployed telemetry and public `/pay` remain unproven.

