# Quant PostgreSQL state backend handoff — 2026-08-31

## Source checkpoint

- Commit: `818434e120c4518796fa5e71b94c8474423b9615`
- Tree: `b8eb2c18aae89e5c3e0bd568abe552b7acce6675`
- Migration: `apps/quant-lab/migrations/0001_quant_state_postgres.sql`
- Local Linux build candidate SHA-256:
  `92241fb096cffa78fd905435724592fbca4662e96bbd07f15841eaa2b255fe3d`

## Runtime contract

Set both variables only through the protected runtime environment; neither is
logged by Quant:

```text
YNX_QUANT_DATABASE_URL=postgresql://...redacted...
YNX_QUANT_STATE_NAMESPACE=quant-lab-v1
```

`YNX_QUANT_STATE_NAMESPACE` is mandatory whenever the database URL is set.
The server migrates `ynx_quant_state` idempotently and stores one
integrity-protected payload per namespace. Tenant state uses the derived key
`<namespace>:tenant:<64-hex-tenant-id>`; no tenant shares another tenant's
row.

Each write loads the current revision and uses PostgreSQL compare-and-swap.
Concurrent writes do not silently overwrite each other: the losing request
returns `ErrConflict`, reloads durable state, and can be safely retried using
the existing idempotency key. The service exposes backend truth through
`/health`, `/version`, and `ynx_quant_storage_backend_info`.

## Verification performed

- `go test ./internal/quantlab ./apps/quant-lab/server` — pass.
- `go vet ./internal/quantlab ./apps/quant-lab/server` — pass.
- `npm --prefix apps/quant-lab test` — 6/6 pass.
- `npm --prefix apps/quant-lab run build:wallet` — pass.

The test suite exercises namespace validation, explicit durable-conflict
rollback, file-backend disclosure, existing cross-process file-lock tests,
tenant isolation, API, WebSocket and metrics behavior. A real PostgreSQL
integration run has **not** been performed: no product-owned database URL or
deployment lease was supplied.

## Central integration prerequisites

1. Provision an isolated PostgreSQL database/user with only the required DDL
   and row read/write privileges.
2. Apply the tracked migration and supply the two environment variables through
   secret management.
3. Run a two-process, two-tenant PostgreSQL integration test covering CAS
   conflict, restart recovery, idempotent retry, tenant isolation, and health
   metadata.
4. Freeze the release artifact, rollback target and a Quant-only deployment
   lease before any public switch.

## Truth boundary

This is a source/build candidate only. It proves neither a provisioned
database nor public runtime, installed application, Wallet approval, Product
Session, signature, order, or Testnet execution.
