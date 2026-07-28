# YNX Data Fabric Evidence Index

Engineering Source Commit: `3a1bcceddc9e680761ce9563bb3d6cd823037222`
Release Candidate: `ynx-data-fabric-3a1bcceddc9e`
Phase: `INTEGRATE`
Status: `ACTIVE`

## Source, Git and CI

- Exact YNX 26 Workspace and `codex/final-data-fabric` Branch were verified before modification.
- No active writer, test, commit or push process was found for this Worktree.
- Commit `3a1bcceddc9e680761ce9563bb3d6cd823037222` was pushed without force and verified with `git ls-remote`.
- GitHub Actions Run `30279794834` completed successfully for the Engineering Source Commit in three minutes and forty-seven seconds.
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
- Go SDK: `sdk/datafabric`
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
jq empty schemas/data-fabric/event-envelope-v1.schema.json schemas/data-fabric/event-envelope-v2.schema.json schemas/data-fabric/schema-registry-v2.json integration/product-event-contracts.json
bash -lc 'umask 022; exec go test ./... -count=1'
node scripts/data-fabric/release-truth-check-check.mjs
bash scripts/data-fabric/quality-gates.sh
```

The first full-repository run under the caller's restrictive `umask=077` invalidated three unrelated permission-negative fixtures by turning requested `0644` files into `0600`. Re-running with the standard CI `umask=022` restored the intended unsafe-file precondition and the full repository passed. This is recorded as an environment diagnosis, not hidden as a green result.

## Evidence still missing

- Central Wallet/Auth and App Gateway owner acceptance.
- Complete producer adapter set and accepted fee and compensation semantics.
- Shared-Testnet invoice, settlement, receipt, refund and reconciliation receipts.
- Production-shaped JetStream partition, PostgreSQL failover, process-kill, long replay, capacity and RTO/RPO evidence.
- Encrypted immutable remote backup and PITR evidence.
- Staging and public runtime receipts.
- Approved secure signer and immutable HTTPS artifact hosting.
- Public health, status, support, privacy, security and download URLs.
- Production artifact hashes, bytes, signing class and cold-install receipts.

Until those receipts exist, the product remains `ACTIVE` in `INTEGRATE`; it is not centrally integrated, staged, public, hosted or production signed.
