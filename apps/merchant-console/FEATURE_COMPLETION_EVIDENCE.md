# Merchant Console feature completion evidence

Evidence date: 2026-07-22. Source branch: `codex/final-merchant-console`.

This ledger is intentionally fail-closed: `implemented` means current source contains the behavior; `tested` means a named local command exercised it; deployment fields remain false until remote evidence exists.

| Capability | Implemented | Tested | Direct evidence | Remaining gate |
|---|---:|---:|---|---|
| Canonical Wallet sign-in | yes | yes | `src/auth.js`; `npm test` Wallet callback, product, scope and device proof tests | Central registry and Gateway deployment |
| Owner/Finance/Developer/Support/Viewer RBAC | yes | yes | `console_auth.go`; role matrix, fuzz, fault and soak tests | Staging Wallet role walkthrough |
| Role change session invalidation | yes | yes | `TestMerchantRoleMatrixAndMembershipChangeInvalidatesSession` | Remote session revocation evidence |
| Signed invoices and authoritative settlement | yes | yes | `service.go`; settlement mismatch, provider fault, fuzz and soak tests | Funded public Testnet transaction hash |
| Webhook signature, retry and operator visibility | yes | yes | `TestSettlementMismatchExpiryAndWebhookRetry`; webhook fuzz and soak tests | Public receiver delivery evidence |
| Reconciliation CSV | yes | yes | `server.go`; authenticated reconciliation route | Golden CSV/schema compatibility test |
| Refund/dispute request and Trust evidence reference | yes | yes | `wallet.go`; `TestGatewayBoundPaymentCreatesPayerCases` | Official Trust adapter verification |
| AI explanation/draft authority boundary | yes | yes | AI cancellation and non-execution tests | Official AI Gateway credential and cost evidence |
| 12 locales and Arabic RTL | yes | yes | `i18n.js`; `npm test` locale completeness | Current-build browser/A11y matrix |
| Provider Integration Hub | partial | yes | Nine-category versioned catalog, credential-reference-only configuration, server-side probe contract, failure/disable/audit tests and UI | Implement and remotely verify each official production adapter |
| Capital tools and transparent fee waterfall | partial | yes | Evidence-only `capital-v1` API/UI; 14 disclosed capabilities; unknown reserves/costs/net remain unavailable | Implement authorized providers and complete authoritative fee records |
| Snapshot v1 to v2 migration | yes | yes | `TestSnapshotV1MigratesProvidersAndFutureVersionFails` | Add full CLI backup/restore/rollback drill |
| Backup/restore drill | partial | no | Integrity-protected atomic local store exists | Add operator command, destructive-restore guard and drill log |
| Public/staging deployment | no | no | No current URL, health response or hosted hash | Operator inputs and deployment |

The product is not release-complete while any remaining gate above is open.
