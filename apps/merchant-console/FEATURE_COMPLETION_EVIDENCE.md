# Merchant Console feature completion evidence

Evidence date: 2026-07-27. Source branch: `codex/final-merchant-console`.

This ledger is intentionally fail-closed: `implemented` means current source contains the behavior; `tested` means a named local command exercised it; deployment fields remain false until remote evidence exists.

| Capability | Implemented | Tested | Direct evidence | Remaining gate |
|---|---:|---:|---|---|
| Canonical Wallet sign-in | yes | yes | `src/auth.js`; `npm test` Wallet callback, product, scope and device proof tests | Central registry and Gateway deployment |
| Owner/Finance/Developer/Support/Viewer RBAC | yes | yes | `console_auth.go`; role matrix, fuzz, fault and soak tests | Staging Wallet role walkthrough |
| Role change session invalidation | yes | yes | `TestMerchantRoleMatrixAndMembershipChangeInvalidatesSession` | Remote session revocation evidence |
| Signed invoices and authoritative settlement | yes | yes | `service.go`; settlement mismatch, provider fault, fuzz and soak tests | Funded public Testnet transaction hash |
| Webhook signature, SSRF containment, retry and operator visibility | yes | yes | Signature fuzz/soak, public-DNS/IP/redirect tests and DNS-rebinding fault persistence | Public receiver delivery evidence |
| Reconciliation CSV | yes | yes | Authenticated route, explicit schema-v1 response header and golden pending/committed evidence fixture | Remote export against staging records |
| Merchant data export and deletion-request controls | yes-local | yes | Owner-only `data-manage`; schema-v1 tenant export; runtime-secret redaction; v1/v2→v3 migration; exact-confirmation/idempotency/cooling-off/blocker/cancel/audit tests at `b0934a0` | Approved deletion execution, legal-hold disposition, provider-specific completion evidence and orderly shutdown exit |
| Refund/dispute request and Trust evidence reference | yes | yes | `wallet.go`; `TestGatewayBoundPaymentCreatesPayerCases` | Official Trust adapter verification |
| AI explanation/draft authority boundary | yes | yes | AI cancellation and non-execution tests | Official AI Gateway credential and cost evidence |
| 12 locales, RTL and accessibility | partial | yes-local | Localized authentication/authority surface, valid skip targets, focus retention, RTL layout rules, 10 frontend tests and focused 1280x720/390x844 browser checks | Translate authenticated operational copy; full zoom/keyboard/screen-reader/rules/screenshot matrix |
| Provider Integration Hub | partial | yes | Nine-category versioned catalog, credential-reference-only configuration, server-side probe contract, failure/disable/audit tests and UI | Implement and remotely verify each official production adapter |
| Capital tools and transparent fee waterfall | partial | yes | Evidence-only `capital-v1` API/UI; 14 disclosed capabilities; unknown reserves/costs/net remain unavailable | Implement authorized providers and complete authoritative fee records |
| Snapshot v1/v2 to v3 migration | yes | yes | `TestLegacySnapshotsMigrateAndFutureVersionFails`; Provider/data-request map normalization; guarded local backup/restore/rollback drill | Production-sized staging migration/rollback and old-client evidence |
| Backup/verify/restore/rollback | yes-local | yes | Recovery CLI, nested HMAC verification, exact-SHA guard, store lock, rollback copy and `evidence/backup-restore-drill.json` | Repeat with production-sized staging copy and remote operator evidence |
| Request observability and runtime metrics | yes-local | yes | Correlated request/trace/error IDs, redacted JSON logs, outbound trace propagation, fail-closed monitor endpoint and race-tested bounded metrics | Add OpenTelemetry/exporter, durable business metrics, alerts and staging dashboard |
| Supply-chain inventory and verification | partial | yes-local | Frontend/backend CycloneDX, deterministic Go generator, exact vendor manifest, input/hash/path tests and two-run identical bundle evidence | Resolve Wallet Auth provenance/license; approved scanners, independent hermetic build, signed provenance and hosted immutable artifacts |
| Runtime release identity | yes-local | yes | `/version`, release metadata response headers and linker-injected build fields at source commit `1f7963c`; `TestVersionExposesAuditableReleaseMetadata`; exact Wallet/Pay/Monitor dependency states remain separate | Inject non-local release metadata in CI and verify from staging/public service |
| Integration contract and full-goal coverage | yes-local | validated | `release/integration/merchant-console-contract.json`, integration handoff, cross-product vectors, dependency acceptance and `.ai-bridge/full-goal-coverage.json`; JSON parsing passed | Acceptance and execution by central owners/29 Integration |
| Git recovery checkpoint | yes-remote | verified | Branch synchronized through runtime commit `b0934a09df9d2dbea67abb596ad84154ab168312`; prior verified local bundle remains recovery history | Rebind evidence documents to the runtime commit and keep subsequent checkpoints synchronized |
| Public/staging deployment | no | no | No current URL, health response or hosted hash | Operator inputs and deployment |

The product is not release-complete while any remaining gate above is open.
