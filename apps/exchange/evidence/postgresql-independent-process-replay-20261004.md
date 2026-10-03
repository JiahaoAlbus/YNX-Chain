# Exchange independent-process PostgreSQL replay verification

## Source and scope

Inherited checkpoint: `2c21d650acd0350fb69782723c629e53588ce31c`, tree `5b3fd10e8c7e8fdc9ff94c89311131e2692617d9`.
Branch: `codex/exchange-sso-cookie-binding-20261002`.
This checkpoint adds tests only; it does not change production service, Wallet authority, release pins or deployment.

## Executed behavior

The real Go test binary starts two independent OS processes, each running the actual Exchange HTTP server and PostgreSQL repository. Both schema layouts (`integrity` and legacy `revision`) are exercised in individually generated schemas on a temporary, loopback-only PostgreSQL 17.11 cluster. Controlled test signatures, Gateway authorization, deposits and quote funding are fixtures, not public Wallet approvals or chain transfers.

The two processes race the same buyer intent against one seller order. At least one request commits; conflict or exact same-order replay is permitted, but distinct order identities are not. The test shuts down both processes with SIGTERM, starts two new processes, and retries the exact signed intent. It checks the original order identity, two owner-isolated account histories, one match, balanced ledgers, unchanged persisted state (including fees and audit), and guest market projection without private order or account identifiers. A foreign-owner proof paired with the buyer signature must fail with 401.

Initial verbose run observed distinct child PIDs `73748`, `73750`, `73771`, `73774` (integrity) and `73801`, `73803`, `73836`, `73839` (revision). These are local process observations, not server deployment evidence.

## Commands and results

With `YNX_EXCHANGE_POSTGRES_TEST_URL` pointing only to the temporary `ynx_exchange_qa_20261004` database:

- `go test -race -v ./internal/exchangeproduct -run '^TestPostgreSQLIndependentProcesses' -count=1`: PASS, 11.367 seconds.
- `go test -race ./internal/exchangeproduct -run '^TestPostgreSQLIndependentProcesses' -count=3`: PASS, 29.052 seconds.
- `go test -race ./internal/exchangeproduct -count=1`: PASS, 19.156 seconds (includes configured PostgreSQL tests).
- Generated `ynx_exchange_qa_%` schema count after tests: `0`.
- `gofmt` and `git diff --check`: PASS.

The temporary database is stopped after validation; its toolchain and cluster remain recoverable for future local tests. No production credentials or private keys are included in evidence.

## Remaining release boundaries

Public current-source deployment, installed runtime, actual Wallet approval, Product Session v2, external accounts and public transactions remain NOT_VERIFIED. The inherited base64 JSON state-envelope release boundary remains mandatory: old and new writers must not be mixed, and binary-only rollback after new persisted writes is unsafe. Release owner must use a coordinated, data-preserving cutover and a compatible decoder rollback; this test checkpoint authorizes no production migration or deployment.

This test covers orderly shutdown/restart, not SIGKILL, power loss, PostgreSQL server failover, public network recovery or installed-app behavior.
