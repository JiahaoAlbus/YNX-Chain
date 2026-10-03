# Exchange acknowledged-order recovery after SIGKILL

Inherited source: `daa293da1ed337912216a1ab8a4b6ba1a3374b64`, tree `7af3bf42798cf68ed41dc92556fd922fc333f987`; branch `codex/exchange-sso-cookie-binding-20261002`.

## Actual local execution

The test starts two separate Go test-binary processes running the actual Exchange HTTP service and real loopback PostgreSQL 17.11 repository, using random isolated schemas. After the concurrent buyer intent has an acknowledged persisted match, it kills both processes. It verifies each child termination's OS wait status is specifically SIGKILL, not a successful orderly exit or an unrelated error. Two fresh processes then retry the same signed test intent and read owner-isolated account history and guest market data.

Both `integrity` and `revision` schema layouts recover the same original order. The inherited assertions verify exactly two orders and one trade, balanced account ledgers, no duplicate fees/audit/state changes, foreign-owner authorization rejection, and no private account/order identity in public projections. The parent test retains no server-side private key; signing and Gateway/deposit authority remain explicitly controlled local test fixtures.

Commands with `YNX_EXCHANGE_POSTGRES_TEST_URL` set to the temporary local QA database:

- `go test -race -v ./internal/exchangeproduct -run '^TestPostgreSQLKilledProcesses' -count=3`: PASS, 17.531 seconds. Six schema cases; first run initial child PIDs 79265/79270 and 79327/79329 are killed, then independent replacement PIDs serve the recovery checks.
- `go test -race ./internal/exchangeproduct -count=1`: PASS, 28.854 seconds, including configured PostgreSQL and normal independent-process restart tests.
- `gofmt` and `git diff --check`: PASS.
- Generated QA schema count after both commands: `0`; temporary PostgreSQL service stopped after validation.

## Honest boundaries and handoff

This proves recovery after an acknowledged commit followed by application-process SIGKILL. It does not prove crash during SQL commit, PostgreSQL server crash/power loss, host failover, installed app behavior, public network recovery, real Wallet approval or public trading. No production service, database, shared SDK, authority, build pin or deployment is changed.

The inherited base64-json-v1 state-envelope release compatibility warning remains: coordinate new writers and compatible rollback readers; do not run old binaries against newly written envelope rows or restore old snapshots over new accepted orders. Public source binding and actual approved account/private-session/business release remain pending the existing release owner, not inferred from this test.
