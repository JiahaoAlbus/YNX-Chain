# YNX Data Fabric Operations

## Current operating class

The runtime has two explicitly separated operating classes. Production mode selects PostgreSQL as the authoritative API repository and a separate worker dispatches lease-claimed Outbox records to TLS-authenticated NATS JetStream after verifying exact migration checksums. Local development may explicitly select the atomically replaced file Store and append-and-fsync JSONL transport. The analytics warehouse, staging PostgreSQL/replicated-NATS environment evidence, staging/public deployment, production signing and Mainnet service remain incomplete.

## Build

```sh
go build -trimpath -o ./dist/ynx-data-fabricd ./cmd/ynx-data-fabricd
go build -trimpath -o ./dist/ynx-data-fabricctl ./cmd/ynx-data-fabricctl
go build -trimpath -o ./dist/ynx-data-fabric-worker ./cmd/ynx-data-fabric-worker
```

The daemon requires absolute paths for state and key registry; local file mode additionally requires an absolute event-log path. Private key, NATS credentials, PostgreSQL DSN and registry files must be mode `0600` or stricter. Never paste event signing keys, Wallet keys, validator keys, Seed phrases, PEM material, database credentials, or provider secrets into chat, source control, logs, or an event payload.

## Start

Set every value in `configs/data-fabric.env.example`, including the exact build commit and release. The canonical introspection endpoint must be HTTPS or loopback HTTP. Startup fails if the persistent integrity audit, key registry, store, or authorization configuration fails.

```sh
./dist/ynx-data-fabricd \
	--store=postgres \
	--postgres-dsn-file=/run/secrets/ynx-data-fabric/postgres.dsn \
	--listen 127.0.0.1:8094 \
	--state /var/lib/ynx-data-fabric/state.json \
	--event-keys /etc/ynx-data-fabric/event-keys.json \
	--introspection-url http://127.0.0.1:8080/app/session/introspect \
	--rate-limit-per-minute 120 \
	--source-commit "$YNX_DATA_FABRIC_SOURCE_COMMIT" \
	--source-release "$YNX_DATA_FABRIC_SOURCE_RELEASE"
```

Public ingress must terminate TLS outside this process and expose only approved routes. The service does not accept Bearer tokens or browser cookies. User-scoped APIs require canonical product, bundle, session, device, nonce, timestamp, device signature, exact method/path/body SHA-256/scope, expiry, and request-binding introspection. The service independently hashes the bounded body before introspection. Accepted nonces are consumed locally until session expiry (bounded at ten minutes), and requests older than two minutes or more than thirty seconds in the future fail closed.

`GET /operator/` serves the read-only operator shell. It exposes no protected data until an installed canonical Wallet bridge returns a product/bundle context and exact request-bound headers. The browser requests use `credentials: omit`; Content Security Policy allows only same-origin assets and API connections. Do not expose this route publicly until the real Wallet bridge, locale/accessibility audit, gateway policy and operator role scopes have direct evidence.

The daemon applies a bounded in-memory per-session/device/product request limit as defense in depth and returns `429` plus `Retry-After` when exceeded. The canonical Gateway must still enforce the accepted distributed account, product, device, abuse and ingress policies; the local limiter is instance-scoped and is not a substitute for those controls.

Before the first PostgreSQL-backed deployment, apply the checksum-locked schema from a private DSN file. The command takes a PostgreSQL advisory lock and runs each migration in a serializable transaction:

```sh
./dist/ynx-data-fabricctl migrate-postgres \
	--dsn-file /run/secrets/ynx-data-fabric/postgres.dsn \
	--timeout 2m
```

The API Repository abstraction propagates request cancellation/deadlines to PostgreSQL and covers events, Ledger, Saga, reconciliation, subject export/erasure, integrity health and metrics. Repository failures return a generic `503` without leaking DSNs or internal database details. The repository has direct isolated PostgreSQL 17.10 transaction/constraint evidence; do not interpret that bounded test as API, staging or deployment evidence.

Start the PostgreSQL Outbox worker only after migration. It verifies every embedded migration checksum before accepting work, uses `FOR UPDATE SKIP LOCKED` leases for safe horizontal concurrency, and requires TLS plus NATS credentials:

```sh
./dist/ynx-data-fabric-worker \
	--postgres-dsn-file /run/secrets/ynx-data-fabric/postgres.dsn \
	--dispatcher-id data-fabric-worker-zone-a-0001 \
	--nats-url tls://nats.data-fabric.svc:4222 \
	--nats-credentials /run/secrets/ynx-data-fabric/nats.creds \
	--nats-ca /run/secrets/ynx-data-fabric/ca.pem \
	--nats-cert /run/secrets/ynx-data-fabric/tls.crt \
	--nats-key /run/secrets/ynx-data-fabric/tls.key \
	--nats-replicas 3
```

The PostgreSQL runtime library implements transactional event+Outbox append, leased dispatch, transactional consumer effect+Inbox, immutable Journal+Posting writes, guarded Saga transitions, reconciliation, subject export/erasure, integrity audit and metrics. A shared staging PostgreSQL environment with failure injection, replica behavior, backup/restore and load evidence is still required before enabling staging traffic.

## Health and metrics

`GET /healthz` performs a full persistent integrity audit and returns `503` on failure. `GET /version` returns the configured release and source commit. `GET /metrics` exposes request/error counters and current event, Outbox, Inbox, DLQ, journal, Saga-recovery and reconciliation gauges. Do not route high-frequency probes to `/healthz`; use a bounded operator interval.

## Offline backup

The current backup process requires a write-maintenance window because state and event-log snapshots are not coordinated across processes. Stop API writes and allow the Outbox to drain before backup.

```sh
./dist/ynx-data-fabricctl backup \
  --state /var/lib/ynx-data-fabric/state.json \
  --event-log /var/lib/ynx-data-fabric/events.jsonl \
  --event-keys /etc/ynx-data-fabric/event-keys.json \
  --output /var/backups/ynx-data-fabric/backup-20260722T190000Z \
  --source-commit "$YNX_DATA_FABRIC_SOURCE_COMMIT" \
  --source-release "$YNX_DATA_FABRIC_SOURCE_RELEASE"
```

The command refuses an existing output directory. It audits source and copied state, verifies every event-log record, and writes SHA-256, byte counts and record counts to `manifest.json`.

## Restore drill

Restore targets must not exist. Restore verifies the backup manifest, both hashes, event signatures, ordering, Outbox/Inbox references, ledger balance/corrections, Saga records, reconciliation references and event-log hashes before returning success.

```sh
./dist/ynx-data-fabricctl restore \
  --backup /var/backups/ynx-data-fabric/backup-20260722T190000Z \
  --target-state /var/lib/ynx-data-fabric-restored/state.json \
  --target-event-log /var/lib/ynx-data-fabric-restored/events.jsonl \
  --event-keys /etc/ynx-data-fabric/event-keys.json
```

Before switching traffic, run `ynx-data-fabricctl verify` and compare the restored Manifest counts with the source maintenance-window counts. A successful local unit test is not a completed operational restore drill; final evidence requires the actual command log and hashes at the final source commit.

## PostgreSQL logical backup and restore

Stop writes through the Gateway and workers before asserting `--maintenance-window-confirmed`. The DSN remains in a mode-restricted file; the control command strictly decomposes its PostgreSQL URL into child-only libpq environment variables and never passes the URL in a process argument. Use matching `pg_dump` and `pg_restore` major versions.

```sh
./dist/ynx-data-fabricctl backup-postgres \
  --dsn-file /run/secrets/ynx-data-fabric/postgres.dsn \
  --event-keys /etc/ynx-data-fabric/event-keys.json \
  --pg-dump /usr/lib/postgresql/17/bin/pg_dump \
  --pg-restore /usr/lib/postgresql/17/bin/pg_restore \
  --output /var/backups/ynx-data-fabric/postgres-20260722T190000Z \
  --source-commit "$YNX_DATA_FABRIC_SOURCE_COMMIT" \
  --source-release "$YNX_DATA_FABRIC_SOURCE_RELEASE" \
  --maintenance-window-confirmed

./dist/ynx-data-fabricctl verify-postgres-backup \
  --backup /var/backups/ynx-data-fabric/postgres-20260722T190000Z \
  --pg-restore /usr/lib/postgresql/17/bin/pg_restore

./dist/ynx-data-fabricctl restore-postgres \
  --target-dsn-file /run/secrets/ynx-data-fabric/empty-restore-target.dsn \
  --event-keys /etc/ynx-data-fabric/event-keys.json \
  --backup /var/backups/ynx-data-fabric/postgres-20260722T190000Z \
  --pg-restore /usr/lib/postgresql/17/bin/pg_restore
```

The archive includes only `ynx_fabric` and `ynx_analytics`, has a SHA-256/byte/count/provenance Manifest, and is catalog-listed before acceptance. Restore requires both schemas to be absent, uses one target transaction, then verifies the exact migration checksum, full repository integrity and every Manifest count. This is logical recovery, not PITR. Encrypt and upload through an approved immutable backup system outside this command; never place its credentials in command arguments.

## Incident response

1. Remove traffic through the external gateway without deleting state.
2. Preserve state, event log, structured logs, release, source commit, request IDs, Error IDs and Audit IDs.
3. Run read-only verification. Do not edit journal history or event files.
4. For broker failure, repair the destination, then requeue the exact DLQ event through an approved operator workflow. The library supports `RequeueDeadLetter`; an authenticated operator API/CLI is still required before public operation.
5. For a Saga timeout, inspect completed steps and execute compensations in reverse order. If compensation needs Wallet or venue approval, mark manual recovery and expose `action-required` to the user.
6. For reconciliation mismatch, never rewrite the prior journal entry. Post a linked correction event and new balanced correction entry.
