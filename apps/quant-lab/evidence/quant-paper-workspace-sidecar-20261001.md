# Native account-bound simulated Paper workspace: backend checkpoint

This checkpoint implements only the existing Paper/research engine adapter under the separately approved `quant:paper:workspace` scope. Identity and `quant:records:read` do not authorize it. No scheduling, Testnet execution, live trading or new engine is introduced. The consumer and installed/public flow are not complete at this backend checkpoint.

Verified native account determines a durable random workspace tenant; submitted account/TenantHeader cannot select ownership. The mapping is isolated in the original store implementation at `<StatePath>.paper-workspaces` or the PostgreSQL namespace `<StateNamespace>:paper-workspaces:v1`. The latter reuses the existing shared database pool and CAS. Service shutdown closes its store without owning the original pool. Empty durable configuration fails closed. Neither the original root nor business-tenant JSON envelope receives the mapping field.

Exact endpoints: GET `/v1/wallet/paper/snapshot`, POST `/v1/wallet/paper/backtests/from-market`, POST `/v1/wallet/paper/orders`. Every request verifies the original fresh ProductSession proof and, when present, central identity association. Original engine operations and idempotent Paper receipts are reused. The response marks `paperWorkspaceAuthorized`, never `statefulPreview`, native execution or schedule permission.

Actual local HTTP/engine and filesystem regression:

```
go test -race ./internal/quantlab -run 'TestNativePaperWorkspaceOwnsDataWithoutTenantOrRecordsPermission|TestPaperMappingWriteFailureAndCASNeverAdoptOwnership' -count=1
go test -race ./internal/quantlab ./apps/quant-lab/server -count=1
```

Results: focused PASS 4.480 seconds; full package PASS 4.855/1.398 seconds. Authorization in this fixture is simulated; this is not installed Wallet or public approval evidence. Tests cover two users, first concurrent ownership binding, owned backtest and Paper receipt, duplicate intent, wrong strategy ownership, unchanged records/account scopes, no Testnet/schedule authority, revoke, cold restart, and failed persistence/CAS not adopting an account or allocating a tenant.

Rollback is executable, not merely documented: the regression extracts exact old source `664b80b00ac576317524f25b49fc01d1c0db7196`, runs its actual Go reader/service against the new adapter's root and tenant data, reads existing history, saves another original experiment and cold-restarts. Its original 13-field envelope/integrity remains valid; the old binary does not open or alter the sidecar. Disabling the new entry with the old binary preserves the current business data and separate mapping. Re-enabling the current reader with the existing sidecar restores the same native account's Paper receipt, not a new workspace. No old snapshot restoration or clearing of state is supported.

PostgreSQL namespace/pool integration has a dedicated optional regression using `YNX_QUANT_POSTGRES_TEST_URL`; no database was configured in this run, so that runtime behavior is NOT_VERIFIED rather than silently counted as passed. Actual PostgreSQL deployment must verify its database/CAS and lifecycle before claiming that backend.

The accepted shared scope is owned by the Wallet contract owner (`f624cc907ac891747ea7823f011604a0f2fbc746`, integrated into main via `65428eb36f0d4496636f08af8cd4e2dca94b3555`). This checkpoint does not change those shared files. New Paper frontend/explicit approval and actual Wallet/Gateway joint tests follow separately; public activation remains disabled until the complete compatible consumer/provider group is verified and released by the unique release owner.
