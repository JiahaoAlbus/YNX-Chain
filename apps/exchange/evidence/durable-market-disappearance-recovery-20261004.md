# Exchange durable-market disappearance and recovery

Owner predecessor `608ba2c72a63eaef10331507505fa4bc188c7722`, tree `11994429dd8a6ecc744a3cc31c6154bd13841bd6`. Scope is the existing direct Exchange business service and tests. No shared Wallet/Auth/permission SDK, schema migration, Host or formal release changes.

## Actual defect and repair

`Service.refreshState` previously accepted `Load(... exists=false, error=nil)` after initialization. It kept prior in-memory state while public HTTP/SSE could report a newly observed source from that cache. A disappeared authority is now an error, not an empty or refreshed state. Existing HTTP middleware returns its existing `state_refresh_failed` 503; SSE's existing failure branch emits `source-unavailable` and closes. No HTTP refresh implementation was duplicated: middleware already performs it.

New real local HTTP regression initializes/credits only isolated test state, temporarily renames its owned state file, then checks markets, orderbook, snapshot and stream return 503 without recreating a state file or altering cached integrity/sequence. Restoring the exact retained file restores HTTP snapshot 200 at the same revision, still honestly classified `degraded_single_host`/multiInstance=false. A separate active-stream test removes that isolated backing path after the initial snapshot, verifies source-unavailable and terminal close, and refuses reconciliation or invented state.

The repair applies when the repository reports absence. It is not proof of PostgreSQL outage, production database readiness, or PostgreSQL's legacy bootstrap-path semantics. Those integration gates were not executed here.

## Executed validation

- `go test ./internal/exchangeproduct`: PASS, final 9.318s.
- `go test -race -json ./internal/exchangeproduct -count=1`: PASS, 13.919s; 123 passed test/subtest events, zero failures, seven skipped tests.
- Skipped, retained explicitly: `TestLocalNodeHostExchangeSSOBridge`, `TestFinanceReadPostgresCrossInstanceNonceAndPersistedAccount`, `TestPostgreSQLOwnedSupportTwoHTTPInstancesIsolationAndRestart`, `TestExportSyntheticSchemaV10ForBinaryCompatibility`, `TestLocalNodeHostExchangeBrowserBridge`, `TestPostgresStateRepositoryBootstrapAndCAS`, `TestPostgreSQLStateStoreMultiInstanceCASAndRestartRecovery`. No source/race PASS substitutes for these absent Host/PostgreSQL integration inputs.
- Earlier focused race: missing-state HTTP recovery, two-service authority refresh/stale-write CAS rejection, SSE initial reconciliation/disconnect PASS 1.534s. Final full race additionally includes the new active-stream disappearance regression.
- `gofmt` and `git diff --check`: PASS. Initial compiler failure from a missing `errors` import was fixed using the existing fmt package before successful validation.

## Remaining public closure

This checkpoint is source/local service behavior only. No SSH, public deploy, real account grant/signature/transaction, service lifecycle outside isolated test servers, or actual money operation occurred. Existing single-host tests do not prove multi-instance production. Release owner must integrate this owned service delta and current ordinary UI deltas into its exact source-bound Exchange runtime, freeze hashes, publish through its existing authority, and return public-version identity for actual public no-authority and user-confirmed business QA. Formal shared graph/Host authority is not inferred here. All unproved public/private/native/capital/ComputerControl gates remain false. Report only to 接续测试网生态审计工作 (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).
