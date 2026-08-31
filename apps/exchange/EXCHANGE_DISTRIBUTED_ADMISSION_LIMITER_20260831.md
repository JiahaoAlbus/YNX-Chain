# Exchange distributed admission limiter — source checkpoint

Date: 2026-08-31

Scope: `apps/exchange/**` only, under Central source lock
`P0-EXCHANGE-DISTRIBUTED-ADMISSION-LIMITER-20260831`.

## Change

The Exchange server command now requires `YNX_EXCHANGE_DATABASE_URL` and
initializes a product-owned PostgreSQL table:

```text
ynx_exchange_admission_windows(client_hash, window_start, requests, updated_at)
```

Each request hashes the normalized client identifier with the scoped
`ynx-exchange-admission-v1` domain separator. A single PostgreSQL `INSERT …
ON CONFLICT … DO UPDATE … WHERE requests < limit RETURNING` statement consumes
the fixed one-minute window atomically. Therefore separate Exchange processes
using the same database share the 600-requests-per-minute limit. Database
timeouts or errors return HTTP 503 and do not allow a request.

The previous in-memory limiter remains only as an isolated unit-test fixture;
the production server entry point cannot select it.

## Evidence completed locally

```text
go test ./apps/exchange/server ./internal/exchangeproduct
go test -race ./apps/exchange/server ./internal/exchangeproduct
go vet ./apps/exchange/server ./internal/exchangeproduct
git diff --check
```

The PostgreSQL multi-instance test is intentionally gated on
`YNX_EXCHANGE_POSTGRES_TEST_URL`; it opens two admissions against one
operator-provided test database and proves a third request is rejected across
instances. It was not run here because no test DSN was supplied.

## Truthful remaining gates

This is source and local-test evidence only. It does not prove a public
Exchange deployment, PostgreSQL injection on a public runtime, wallet account
approval, signing, order placement, matching, settlement, installed behavior,
or a Testnet trade. Those require separately frozen artifact, rollback, and
deployment/visible-evidence authorization.
