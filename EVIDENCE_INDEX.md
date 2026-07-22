# YNX Data Fabric Evidence Index

## Source and recovery

- Recovery base: commit `719e1018267ed5a53e6fae5211c5fd8a1503c35c` from the pushed `main` branch.
- Product source inventory: `integration/product-event-contracts.json` records the committed product refs observed during recovery and whether a dirty product worktree was present.
- Cross-owner merge contract: `integration/DATA_FABRIC_HANDOFF.md` plus strict canonical introspection request/response schemas.
- External authority packet: `release/operator-inputs.request.json`; it requests secure references and approvals only and explicitly forbids secret material in chat.
- Remote truth observed during recovery: no GitHub Release; mixed successful/failed product Actions; no Data Fabric Action or Artifact; no listening local Data Fabric process.
- Final engineering verification: GitHub Actions run `29942204067` passed both jobs at `f065375cc001513942f0abcebd5483d446eb2665`, including full Go tests, race, vet, official vulnerability analysis, Linux builds/hashes, SBOM and policy gates, and isolated PostgreSQL 17.10 transaction plus logical backup/restore tests.

## Implemented source

- Canonical envelope: `internal/datafabric/envelope.go`
- Durable Outbox/Inbox store: `internal/datafabric/store.go`
- Durable JetStream transport: `internal/datafabricnats/broker.go`
- PostgreSQL schema and checksum-locked migrator: `internal/datafabricpostgres/migrations/0001_initial.up.sql`, `internal/datafabricpostgres/migrate.go`
- PostgreSQL transactional Store and Outbox worker: `internal/datafabricpostgres/store.go`, `internal/datafabricpostgres/dispatcher.go`, `cmd/ynx-data-fabric-worker/main.go`
- Context-aware API Repository and PostgreSQL Saga/reconciliation/privacy/audit surfaces: `internal/datafabricapi/repository.go`, `internal/datafabricpostgres/saga.go`, `internal/datafabricpostgres/reconciliation.go`, `internal/datafabricpostgres/privacy.go`, `internal/datafabricpostgres/audit.go`
- Payload-free pseudonymous analytics projection and erasure suppression: `internal/datafabricpostgres/analytics.go`, `ynx_analytics.event_facts` in migration `0001`
- Restore integrity: `internal/datafabric/integrity.go`
- Billing Ledger: `internal/datafabric/ledger.go`
- Saga catalog and persistence: `internal/datafabric/saga.go`, `internal/datafabric/saga_store.go`
- Reconciliation: `internal/datafabric/reconciliation.go`
- Fail-closed API boundary: `internal/datafabricapi/auth.go`, `internal/datafabricapi/server.go`
- Runnable daemon: `cmd/ynx-data-fabricd/main.go`
- Go SDK and canonical request client: `sdk/datafabric/datafabric.go`, `sdk/datafabric/client.go`
- Schemas: `schemas/data-fabric/event-envelope-v1.schema.json`, `schemas/data-fabric/journal-entry-v1.schema.json`
- Exploratory capacity sample: `evidence/capacity/local-working-tree-20260722.json`
- Exploratory PostgreSQL capacity sample: `evidence/capacity/postgresql-17.10-dirty-20260722.json`
- Isolated PostgreSQL 17.10 execution: `evidence/postgres/local-postgresql-17.10-20260722.json`
- Isolated PostgreSQL 17.10 logical recovery: `evidence/postgres/local-postgresql-backup-restore-20260722.json`
- Website/SEO handoff: `public-product-metadata.json`, `product-release.json`
- Founder KPI measurement contract: `GROWTH_KPI.md`, `release/kpi-definitions.json`
- Monitor source: `infra/data-fabric/prometheus-rules.yml`, `infra/data-fabric/grafana-dashboard.json`
- Supply-chain inventory and runtime/public gate: `release/go-runtime-sbom.spdx.json`, `release/npm-sbom.spdx.json`, `scripts/data-fabric/quality-gates.sh`
- Embedded operator console: `internal/datafabricconsole`, `UI_DESIGN_AUDIT.md`, `evidence/ui/operator-console-unavailable-state-20260722.json`

## Current direct verification

Run from the repository root:

```sh
go test ./internal/datafabric ./internal/datafabricapi ./internal/datafabricnats ./internal/datafabricpostgres ./sdk/datafabric ./cmd/ynx-data-fabricd ./cmd/ynx-data-fabricctl ./cmd/ynx-data-fabric-worker -count=1
go build ./cmd/ynx-data-fabricd
scripts/data-fabric/local-smoke.sh
jq empty schemas/data-fabric/*.json integration/product-event-contracts.json release/*.json public-product-metadata.json product-release.json
git diff --check
```

The PostgreSQL evidence record additionally captures a direct test against an isolated PostgreSQL 17.10 server. The test database-name and explicit destructive-test guards prevent accidental execution against any differently named database. It proves initial migration/checksum verification, transaction and constraint behavior, disjoint Outbox leases, authority checks, reconciliation truth and repository audit in that bounded environment. It does not prove replica failover, commit-boundary process kills, staging, rollback/restore, long-running load or production capacity.

These commands prove only their bounded local scope. The NATS tests start a real embedded server with file-backed JetStream and directly prove PubAck/de-duplication, durable consumer redelivery, network outage, retained Outbox and reconnect recovery. They do not prove a replicated cluster, central integration, installation, staging/public deployment, downloads, production signing, store release, production capacity, RTO/RPO, or public health.

The local smoke directly proves both binaries build, the daemon cold-starts, health/version/metrics respond, an unauthenticated write fails closed, SIGTERM shuts down cleanly, the control binary verifies state, and an empty schema-1 store completes an offline backup/restore cycle. It does not make the product-level `installedLocal` state true because the central Gateway, products, broker/database/warehouse and operator console are absent.

## Missing external evidence

- Accepted canonical App Gateway introspection endpoint and product registration.
- Real product producer commits using the canonical envelope.
- Replicated broker, staging PostgreSQL and warehouse endpoints plus a shared failure-injection environment.
- Testnet chain, Pay, Exchange, DEX and Quant reconciliation receipts.
- Staging/public domains, TLS, status/support/privacy/security URLs.
- Immutable hosted release artifacts and CI at the future centrally integrated source commit.
