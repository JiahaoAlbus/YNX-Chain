# Exchange PostgreSQL state backend handoff — 2026-08-31

## Source-only checkpoint

This checkpoint adds an optional, runtime-configured PostgreSQL state backend to the owned Exchange matching service. It does **not** deploy Exchange, configure a database, request a Wallet account, sign an order, or claim public runtime success.

The existing `YNX_EXCHANGE_STATE_PATH` JSON snapshot remains local-development and isolated-fixture only. It reports `stateBackend: "file_snapshot"` and `multiInstance: false` in both `/api/health` and `/api/version`.

For a horizontally scaled Testnet deployment, the operator must provide `YNX_EXCHANGE_DATABASE_URL`. The service:

- migrates the single `ynx_exchange_state` JSONB row;
- refreshes that durable state at each API boundary;
- writes using revision compare-and-swap; and
- returns a conflict rather than silently overwriting concurrent orders, balances, idempotency keys, or audit records.

`YNX_EXCHANGE_DATABASE_URL` is server-only configuration. It must not appear in Web assets, logs, artifacts, evidence, or this handoff.

## API and operational contract

| Route | Added fields | Meaning |
| --- | --- | --- |
| `GET /api/health` | `stateBackend`, `multiInstance` | Live process truth about the selected persistence backend. |
| `GET /api/ready` | `status`, `stateBackend`, `multiInstance`, optional `reason` | Returns `503 not_ready` for the file snapshot backend; only a live multi-instance PostgreSQL backend can return `200 ready`. |
| `GET /api/version` | `stateBackend`, `multiInstance` | Same persistence truth bound to version reads. |

The PostgreSQL schema is created idempotently by the server:

```sql
CREATE TABLE IF NOT EXISTS ynx_exchange_state (
  id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Verified locally

- `go test ./internal/exchangeproduct ./apps/exchange/server`
- `go test ./cmd/ynx-exchange-seed-testnet`
- `npm --prefix apps/exchange run verify:wallet-connect`
- `npm --prefix apps/exchange test`

The focused Go tests cover durable-refresh at the API boundary, conflict fail-closed behavior, explicit file-backend non-multi-instance health disclosure, and the readiness split: file snapshots receive `503 not_ready`, while a multi-instance store receives `200 ready`. PostgreSQL integration test source checkpoint `ba9abc14706dd922f6e20c241e10d12b2bb1bd1b` (tree `ecc7429b1b9fbb1fff995c7ea4e22950fcf0f0b5`) was run once against an ephemeral local PostgreSQL 16 container bound to loopback only. It proved two independent Exchange services have exactly one CAS winner and one conflict, restart recovery, backend health metadata, and durable quote-balance readback. The container was stopped and removed after the test.

This does not provision a product database or prove a public Testnet release.

## Central deployment prerequisite

Before any public Testnet release, Central must issue a single product-scoped Exchange deployment lease that binds: exact candidate source/artifact hashes; the current runtime and rollback target; a Testnet PostgreSQL endpoint and credential injection method; migration/readiness commands; and post-deploy `/health` + `/version` source/bytes/hash receipts. Existing public Exchange routes remain unbound HTML fallback and are not deployment evidence.

## Truth gates

| Gate | State |
| --- | --- |
| Source/backend implementation | local source + focused tests complete |
| PostgreSQL Testnet migration | false — no provisioned database/lease |
| Public Exchange deployment | false |
| Real Wallet approval/callback | false |
| Live order/settlement | false |
| Installed app verification | false |
