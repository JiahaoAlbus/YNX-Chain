# Quant durable readiness reads authoritative state

Source predecessor: `2b035d1339e27a73ec8d81822ecdc8148890f634`.
Ordinary Quant backend/tests only; no Host/configuration/SDK/authority writes.

## Defect and correction

`/ready` rejected filesystem snapshots but previously accepted PostgreSQL based
only on static backend capability. A configured but unreadable/closed SQL pool
could therefore return 200. Readiness now executes the existing state store's
read-only load under the service mutex before returning ready. PostgreSQL's
existing five-second query deadline and persisted-state integrity validation
apply. No save, audit, order, scheduler or tenant-creation action is invoked by
this probe; it does not return private state or mutate the cached snapshot.

Read failure returns HTTP 503 / `status=not_ready` and the fixed reason
`authoritative state is temporarily unavailable`. It never returns the raw
database exception. Filesystem remains 503; readable PostgreSQL remains 200.
This is not a whole-request deadline claim: service mutex contention and HTTP
server deadlines are separate from the SQL query deadline.

## Executed tests

- Controlled store regression verifies 503, fixed non-secret error and recovery.
- Real `TestPostgreSQLReadinessRejectsClosedPoolAndRecoversOnReopen` performs a
  successful HTTP readiness read, closes the actual SQL connection pool, checks
  503, opens a new service for the same namespace and checks 200. Closing a QA
  SQL pool is not a production outage or an actual database shutdown claim.
- Required isolated database gates now include this test twice; skips cannot
  satisfy the runner.
- `go test -race ./internal/quantlab`: PASS (2.856 s); optional unconfigured SQL
  skips in this invocation are not counted as database evidence.
- `go vet ./internal/quantlab`, `gofmt`, node syntax and diff checks: PASS.
- Actual PostgreSQL 17.11 runner: 16 integration passes, actual database
  stop/start persistence verified, 110 full regression passes after restart.
- QA root: `/private/tmp/ynx-quant-postgres-it-dY3G88`.
- Integration log SHA256:
  `1451963987e8ca0bd8d8dd4a5aa36959c45256da8f0aac44910af73837ef89e7`.
- Full regression log SHA256:
  `36704d6998eea9ba3f9487e354864becbb2bd40b2d56e6273e8c65349a76a2d7`.
- Owned QA server stopped; remaining state/event rows `0|0`; no production DB.

## Release boundary

The previous real public verification still reports old source and filesystem
storage with `/api/ready` 503. This owned change is not publicly deployed. The
unique release Owner must integrate these ordinary backend hunks into its
coherent build, configure durable tenant storage and run the source-bound public
verifier. A positive readiness read cannot prove all tenant data, multi-user
business correctness, Wallet approval, private authorization or transaction
execution. Full original finance goal remains incomplete.
