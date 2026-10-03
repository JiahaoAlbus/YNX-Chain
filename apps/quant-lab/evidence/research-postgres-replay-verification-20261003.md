# Saved research: PostgreSQL multi-instance verification gap

Owner predecessor `c493583030f3184c505eee7ce192f3cb45e54350` on `codex/exchange-sso-cookie-binding-20261002`. This checkpoint adds a real-database integration test, not a new storage implementation, financial product, authorization grant or release.

`internal/quantlab/research_submission_postgres_test.go` opens the existing PostgreSQL state store through `New(Config)`. A unique test namespace is shared by two service instances. Twelve concurrent same-intent requests must yield identical successful receipts; CAS contention may return the existing explicit conflict. A restarted third instance with no market adapter must recover the one persisted receipt on twelve explicit retries, without another market read. Changed costs must conflict. A fourth, independent tenant may use the same idempotency key without observing the first tenant's strategy or record. Cleanup deletes only the two exact test namespace keys. No provider, Wallet grant, API mock, in-memory store, or capital execution is used by this integration test.

## Actual local execution

- `go test -race ./internal/quantlab -count=1`: PASS, 2.628 s. Real PostgreSQL cases remain environment-skipped and are not counted as database validation.
- `go vet ./internal/quantlab ./apps/quant-lab/server`: PASS.
- Focused `go test -v ./internal/quantlab -run '^TestPostgreSQLResearchReplayConcurrentInstancesRestartAndTenantIsolation$' -count=1`: **SKIP**, `YNX_QUANT_POSTGRES_TEST_URL is not configured`. The command exit PASS is not a test PASS for PostgreSQL.
- `gofmt` and `git diff --check`: PASS.

Docker Desktop is installed. Its supported CLI `docker desktop start --timeout 45` returned “already running”, but `docker info` could not connect to the configured desktop-linux socket and `docker desktop status` could not retrieve engine state. Native app inspection reported the Mac locked; no unlock bypass, Docker restart/reset, image download, DB creation or production mutation was performed.

## Executable remaining prerequisite

Central/release owner must supply a disposable reachable PostgreSQL QA database through `YNX_QUANT_POSTGRES_TEST_URL` (not output or commit its value), or restore the existing local Docker engine after manual unlock. Then execute the focused test above and the existing PostgreSQL state/tenant/Finance-read integration tests with `-race -count=1`, retaining actual non-skipped results. Do not use a production customer database as the test target. A source test must not promote public `multiInstance=false` file-snapshot runtime to multi-instance readiness.

The current public Quant snapshot runtime and formal coherent build/public release are unchanged. PostgreSQL replay validation=false; public owner-source adoption=false; installed/provider/authorization/signature/transaction/Product Session completion=false; full goal complete=false. Report dependency and results only to `接续测试网生态审计工作`.
