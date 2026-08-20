# YNX Data Fabric Evidence Index

Engineering Source Commit: `02e115743786d5e78adc02a1df6029891e81dfb0`
Release Candidate: `ynx-data-fabric-02e115743786`
Phase: `INTEGRATE`
Status: `ACTIVE`

## Source, Git and CI

- Exact YNX 26 Workspace and `codex/final-data-fabric` Branch were verified before modification.
- No concurrent Git writer was found. A CodexPro server process was observed for this Worktree and left untouched.
- Commit `02e115743786d5e78adc02a1df6029891e81dfb0` is the frozen Engineering Source Commit. It preserves the Chain Core commitment reference boundary, account isolation and bounded Producer admission, and adds the PostgreSQL resilience probe plus exact-head CI binding; remote review Branch `codex/data-fabric-typescript-sdk-20260814` and PR `#92` target the protected product Branch.
- Current-source Run `31775538974` passed both Data Fabric jobs after exact PR-head checkout. Its source-bound PostgreSQL resilience artifact was downloaded and both JSON SHA-256 values matched.
- The workflow runs full Go tests, Data Fabric Race tests, vet, vulnerability analysis, Linux builds and hashes, SBOM generation, quality gates, secret scanning, JSON validation and isolated PostgreSQL 17.10 transaction and logical backup/restore tests.
- The workflow does not upload a public artifact; `downloadHosted` and all public states remain false.
- The two stale untracked recovery summaries discovered at takeover are preserved under `recovery/2026-07-23/` and are not current truth.

## Canonical protocol

- Envelope runtime: `internal/datafabric/envelope.go`
- Envelope v2 Schema: `schemas/data-fabric/event-envelope-v2.schema.json`
- Envelope v1 migration compatibility: `schemas/data-fabric/event-envelope-v1.schema.json`
- Runtime-to-Schema drift test: `internal/datafabric/event_schema_artifact_test.go`
- Schema Registry runtime and artifact: `internal/datafabric/schema_registry.go`, `schemas/data-fabric/schema-registry-v2.json`
- Product ownership and protocol policy: `integration/product-event-contracts.json`
- Machine integration contract: `release/integration/ynx-data-fabric-contract.json`
- Handoff and vectors: `docs/integration/INTEGRATION_HANDOFF.md`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Chain Core external commitment boundary: `internal/datafabric/chain_commitment.go`, `internal/datafabricapi/chain_commitment.go`; frozen authority is implementation `0da66c319629a79613739df351b5000b85a1371a` bound by release `b481a46f6d77644d0dff13e3917a51f8503e88f4`.

## Reliable transport, Saga and Ledger

- Transactional Outbox and Inbox: `internal/datafabric/store.go`, `internal/datafabricpostgres/store.go`
- JetStream transport and durable consumption: `internal/datafabricnats/broker.go`
- Dispatch, retry, backoff and DLQ: `internal/datafabric/dispatcher.go`, `internal/datafabricpostgres/dispatcher.go`
- Replay, backfill and leased recovery: `internal/datafabric/redelivery.go`, `internal/datafabricpostgres/redelivery.go`
- Saga model and leased compensation recovery: `internal/datafabric/saga.go`, `internal/datafabricpostgres/saga.go`, `cmd/ynx-data-fabric-worker/main.go`
- Immutable double-entry Ledger and correction: `internal/datafabric/ledger.go`, PostgreSQL migration `0004`
- Atomic usage billing: `internal/datafabric/billing.go`, `internal/datafabricpostgres/billing.go`, PostgreSQL migration `0006`
- Pay BFT event bridge and Billing Ledger reconciliation: `internal/datafabricpay`, `internal/datafabricpayledger`, `cmd/ynx-pay-data-fabric-bridge`

## Migration, privacy and recovery

- PostgreSQL migrations: `internal/datafabricpostgres/migrations/0001` through `0006`, including rollback files for 0002 through 0006.
- File and PostgreSQL backup and restore: `internal/datafabricbackup`, `internal/datafabricpgbackup`.
- Subject export, erasure, retention and analytics suppression: `internal/datafabric/privacy.go`, `internal/datafabricpostgres/privacy.go`, `internal/datafabricpostgres/analytics.go`.
- Migration and compatibility report: `MIGRATION_COMPATIBILITY.md`.

## API, SDK, operations and UI

- API: `internal/datafabricapi`
- Account isolation: `internal/datafabricapi/auth.go`, `internal/datafabricapi/server.go`, `internal/datafabricapi/account_isolation_test.go`; ordinary data APIs are account-scoped and privileged audit export remains product-scoped.
- Producer admission and capacity: `internal/datafabricapi/producer_backpressure_test.go`, `scripts/data-fabric/api-capacity/main.go`, `evidence/capacity/api-1000-producers-clean-source-20260814.json`; 1000 simultaneous independently signed local HTTP producers completed through a 64-request gate with explicit retryable backpressure and zero business errors.
- PostgreSQL resilience and capacity: `scripts/data-fabric/postgres-resilience`, `evidence/postgres/resilience-seed-clean-source-20260814.json`, `evidence/postgres/resilience-verify-clean-source-20260814.json`; exact-source Linux CI exercised 10,000 events with 90% hotspot skew, 1,000 simultaneous duplicate rejects, a real service restart, zero-event RPO, integrity RTO, 10,000 applied Analytics facts and a 10,000-event idempotent second replay.
- Go SDK: `sdk/datafabric`
- TypeScript SDK: `sdk/datafabric-typescript`; its producer and consumer clients enforce HTTPS outside loopback, canonical credential bindings, event and delivery HMAC verification, response byte limits and strict receipt shapes.
- Daemon, worker and operator CLI: `cmd/ynx-data-fabricd`, `cmd/ynx-data-fabric-worker`, `cmd/ynx-data-fabricctl`
- Structured health, ready, version and metrics surfaces: `internal/datafabricapi/server.go`
- Alerts and dashboards: `infra/data-fabric/alerts.yml`, `infra/data-fabric/grafana-dashboard.json`
- Operator console and twelve locales: `internal/datafabricconsole`, `UI_DESIGN_AUDIT.md`
- Linux package, install, cold-start and promotion gates: `scripts/data-fabric/build-testnet-release.sh`, `install-testnet-release.sh`, `generate-cold-start-evidence.sh`, `public-release-promotion-check.sh`

## Release truth and coverage

- Product release: `product-release.json`
- Machine release record: `release/release-record.json`
- Full goal coverage: `.ai-bridge/full-goal-coverage.json`
- Release truth implementation: `scripts/data-fabric/release-truth-check.mjs`
- Release truth positive and negative vectors: `scripts/data-fabric/release-truth-check-check.mjs`
- Quality gate entrypoint: `scripts/data-fabric/quality-gates.sh`
- Release signing boundary: production promotion requires `ed25519-over-sha256`; `rsa-pkcs1-sha256-over-sha256` is accepted only for loopback contract-test portability and is rejected for production promotion.
- Public metadata handoff: `public-product-metadata.json`

The release truth gate derives the latest Engineering Source Commit from tracked Data Fabric runtime, schema, integration ownership, packaging and deployment files. It rejects stale release records, inconsistent states, missing coverage fields, invalid coverage statuses, source-unbound evidence and public URLs or downloads without direct receipts. Negative vectors mutate the Source Commit, public URL, public deployment state and coverage status and must all fail.

## Direct verification for this Source Commit

```sh
go test ./internal/datafabric -count=1
go test ./internal/datafabricapi ./internal/datafabricpay ./internal/datafabricpayledger -count=1
go test -race ./internal/datafabric -count=1
go test -race ./internal/datafabricpostgres ./scripts/data-fabric/postgres-resilience -count=1
npm test --prefix sdk/datafabric-typescript
npm audit --audit-level=high --registry=https://registry.npmjs.org --prefix sdk/datafabric-typescript
go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./...
jq empty schemas/data-fabric/event-envelope-v1.schema.json schemas/data-fabric/event-envelope-v2.schema.json schemas/data-fabric/schema-registry-v2.json integration/product-event-contracts.json
bash -lc 'umask 022; exec go test ./... -count=1'
node scripts/data-fabric/release-truth-check-check.mjs
bash scripts/data-fabric/quality-gates.sh
```

The full repository test and Data Fabric Race suites passed locally and in current-source CI. One hundred simultaneous canonical account sessions each returned only their own event. The clean-source 1000-producer loopback run committed all events with zero business errors and exact Outbox depth 1000, but p95 was 39.94 seconds and throughput 23.37 events/s; it is local file-Store correctness/backpressure evidence. The exact-source PostgreSQL drill separately verified bounded hotspot skew, a duplicate storm, service restart, RPO 0 and two 10,000-event replay passes. Neither result is PostgreSQL-plus-JetStream, shared-Testnet or public capacity evidence. PR `#92` is blocked only by one independent approval; no protection bypass was attempted.

## Evidence still missing

- Central Wallet/Auth and App Gateway owner acceptance.
- Complete producer adapter set and accepted fee and compensation semantics.
- Shared-Testnet invoice, settlement, receipt, refund and reconciliation receipts.
- PostgreSQL-plus-JetStream signed ingress, replicated broker partition/leader loss, PostgreSQL replica failover, consumer/process-kill, sustained-duration and shared-Testnet RTO/RPO evidence.
- Encrypted immutable remote backup and PITR evidence.
- Staging and public runtime receipts.
- Approved secure signer and immutable HTTPS artifact hosting.
- Public health, status, support, privacy, security and download URLs.
- Production artifact hashes, bytes, signing class and cold-install receipts.

Until those receipts exist, the product remains `ACTIVE` in `INTEGRATE`; it is not centrally integrated, staged, public, hosted or production signed.
