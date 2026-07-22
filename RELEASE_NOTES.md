# YNX Data Fabric Release Notes

## Unreleased local Testnet work

- Added canonical strict event envelope, source classification, retention and product-bound integrity verification.
- Added sensitive payload rejection for credentials, card data, private content and raw AI inputs/outputs.
- Added account-bound subject export, HMAC-pseudonymous erasure records, retention truth and analytics replay suppression.
- Added durable single-node Outbox, Inbox, retry/backoff, DLQ, replay and append/fsync event log.
- Added production-selected NATS JetStream transport with TLS/client credentials, publish acknowledgements, message-ID de-duplication, durable pull consumption and double acknowledgements.
- Added real embedded-NATS outage/reconnect/redelivery tests and retained the append/fsync event log only as an explicitly warned local-development mode.
- Added initial PostgreSQL schema and checksum-locked serial migration runner with append-only event/ledger triggers and deferred per-asset/currency balance/fee-consent constraints.
- Added PostgreSQL atomic event+Outbox writes with per-partition advisory ordering, serializable projection+Inbox and Journal+Postings writes, plus a checksum-verifying lease-based PostgreSQL-to-JetStream worker.
- Added the complete context-aware API Repository boundary with production PostgreSQL selection, guarded Saga/reconciliation/privacy persistence, shared integrity audit, statistics and generic fail-closed `503` handling.
- Added immutable balanced Billing Ledger with canonical event/correlation links and append-only corrections.
- Added all required Saga definitions with compensation, timeout, manual recovery and user-visible status.
- Added reconciliation match/mismatch/unavailable/coverage truth.
- Added canonical introspection-only API, product isolation, Saga/reconciliation writes and audit export.
- Bound canonical introspection to bundle, method, path and freshness, added bounded local replay rejection, and prevented write-side repository details from reaching API clients.
- Added signed-state/event-log backup verification and non-overwriting restore tooling.
- Added evidence-backed health/version/metrics and structured request logs.
- Added truthful public metadata/SEO handoff and machine-readable founder KPI definitions with no invented measurements or release URLs.
- Added a Go API client that delegates signing to canonical Wallet credentials and binds method, path, and content digest without handling private keys.
- Added a payload-free pseudonymous PostgreSQL analytics fact projection with atomic Inbox lineage, transactional erasure deletion, and suppression of later rematerialization.
- Added actionable Prometheus alert rules, a Grafana integrity/recovery dashboard, Outbox-age metrics, reconciliation exceptions, and analytics fact counts.
- Replaced cross-partition `MAX(sequence)` SSI contention with per-partition advisory ordering and aggregate sequence rows; recorded a bounded PostgreSQL 17.10 capacity sample after the corrected live tests passed.
- Added a Go runtime SPDX inventory and automated zero-placeholder, fake-success, public-leak, secret-pattern, JSON, and whitespace gates for Data Fabric-owned surfaces.
- Added bounded cursor pagination and an embedded read-only operator console with canonical Wallet request binding, truthful operational states, 12 selectable languages, Arabic RTL, accessibility semantics, reduced motion, light/dark mode, and responsive layout.
- Added bounded per-session/device/product defense-in-depth rate limiting with explicit `429` and `Retry-After` behavior.
- Added W3C trace-context validation/continuation, trace IDs in structured logs, child propagation to canonical introspection, and Prometheus request-duration histograms.
- Added PostgreSQL logical backup/catalog verification and empty-target single-transaction restore with private child-environment credentials, non-overwrite protection, migration checksum, full integrity audit, and exact count verification.
- Added strict canonical introspection request/response schemas and an owner-specific Wallet/Gateway/product/Website/warehouse integration handoff with exact acceptance evidence.
- Upgraded the Go toolchain and reachable affected dependencies to fixed versions after official vulnerability analysis, and added pinned `govulncheck` to CI.
- Added one consolidated operator-input request for central registration, staging services, Testnet observers, public routing/support, secure signing/hosting, and approved capacity/recovery drills; secret values must remain in approved secret systems.

No release version or source commit has been assigned. Product-level implementation/testing, central integration, installation, staging/public deployment, hosted downloads, production signing and store release remain false.
