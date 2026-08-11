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
- Production observability at `1eb2764c95368d5a62483028891eb6c3f67f2c1a`: dependency-aware readiness, build version, bounded metrics, structured logs, request/trace/error correlation, upstream `traceparent` propagation and panic/private-value redaction pass local and Race tests.
- Local capacity at `0d3c238`: 1,000 loopback `/health` and `/version` requests, concurrency 25, 0 failures, 32,067.0 req/s, p50 0.633 ms, p95 1.495 ms and p99 2.888 ms. This is explicitly not staging or settlement capacity.
- Web/PWA and browser gate at `0600d5ab87a9062ccc5b757affe30e234f1b7730`: Android/iOS/Web exports plus Chromium keyboard, accessible-name, 390×844 and Arabic RTL/no-overflow tests pass.
- Supply-chain candidate at `0600d5ab87a9062ccc5b757affe30e234f1b7730`: 0 called Go vulnerabilities after upgrading gRPC to 1.82.1, 0 high/critical npm findings, deterministic Linux/amd64 server and store builds, SHA-256 provenance, and Go/client CycloneDX SBOMs in `apps/pay/evidence/supply-chain/`.
- Canonical Pay contract and cross-product vectors: `release/integration/pay-contract.json`, `docs/pay/INTEGRATION_HANDOFF.md`, `docs/pay/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/pay/DEPENDENCY_ACCEPTANCE.md`, `docs/integration/pay-quant-billing.json`.
- Exact-source CI, unsigned iOS Simulator install, artifact-retention and URL-scheme evidence: `release/evidence/pay-exact-source-ci-2026-07-30.json`.
- Current-source public Pay Product backend and canonical App Gateway evidence: `apps/pay/evidence/pay-product-public-2026-08-11.json`. Public TLS health reports release `ynx-pay-product-7ab9bd9f7fe3`, exact source `7ab9bd9f7fe35718908378bb48de3cdf3053aa0b`, YNX Testnet 6423 and authoritative central Pay evidence. Both server units are active; required store/central-Pay readiness is green; protected mutation without a Product Session fails closed with HTTP 401. `scripts/verify/pay-product-public-session.mjs` also completed a fresh public Pay session, crossed the App Gateway to the Pay service, proved one-use replay rejection, revoked the session and proved post-revoke denial without moving assets or retaining secrets.
- Public Merchant backend session/API evidence: `apps/merchant-console/evidence/public-gateway-2026-08-11.json`. A fresh canonical `pay-merchant` Wallet session exchanged for an owner merchant session, authenticated state read passed, and an operator-route escape remained 404. The Merchant Web client remains unhosted.
- Current authoritative Testnet payment: `apps/pay/evidence/authoritative-testnet-payment-2026-08-11.json`. A Wallet-signed 7 YNXT transfer committed in block 951118; invoice, payer, payout, amount, transaction, receipt and audit evidence matched the central Pay API before `committed`. The refund remains only `requested`, the dispute remains `open`, webhook delivery succeeded and unavailable AI did not fabricate output.
- Full-goal machine coverage: `.ai-bridge/full-goal-coverage.json`.

## Historical-only evidence

`internal/payproduct/proof/live-testnet-payment.json` proves an earlier source version and cannot establish current public deployment or current artifact behavior.

## Missing direct evidence

Sponsored UserOperation, authoritative refund transaction, bridge destination confirmation, two-account Split payment, accepted Quant/Data Fabric verifier key and live evidence stream, Quant Invoice v5 Testnet payment, hosted immutable native artifacts, current Android/iOS install and cold launch, production signatures, store releases, production-volume RTO/RPO and remote backup retention, staging payment-load measurements, deployed dashboards/alerts, complete dark/manual assistive-technology review and a public native/Web Pay client remain unproven. The backend route and one payment are public evidence; they must not be confused with publishing the complete Pay product.
