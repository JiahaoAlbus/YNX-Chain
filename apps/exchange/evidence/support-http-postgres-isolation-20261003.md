# Owned support HTTP/database continuation

Base: 818f41905cbf82c5d8f29fce5255971844f221c4. This change adds an actual local HTTP/PostgreSQL business regression; it does not change shared permissions, production services or release identity.

`TestPostgreSQLOwnedSupportTwoHTTPInstancesIsolationAndRestart` runs the existing Exchange support/account handlers through actual loopback HTTP servers and real PostgreSQL pools. Two isolated test accounts use an explicit test-only authorizer. Neither issued test sessions alone nor the production Web read grant authorizes these write routes. Initial execution without the test authorizer returned 401, correctly; that failure was test setup, not a production permission defect.

For each database layout the test covers:

- Two HTTP instances submitting the same account/intent/key concurrently; one durable case only. A stale writer may return conflict; explicit retry returns the exact committed case.
- The other account reusing the key receives conflict with no case ID leak.
- Same account changing intent under the same key receives conflict.
- Retry/rejection does not change persisted state or audit.
- The second account's independent request persists separately.
- Both live instances and a reopened service/pool/HTTP server read exactly their respective one case.
- Unknown proof receives 401 without record disclosure.

No financial action, real Wallet approval, user credentials, public business completion or native installation is claimed. The existing accepted Web v2 route limitation remains; see `web-write-contract-gap-20261003.md`.

## Executed evidence

`node apps/exchange/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin`

Final retained root `/private/tmp/ynx-exchange-postgres-it-ZBVQH6`. Twelve required real-database executions passed without skip: prior eight layout/CAS/bootstrap/Finance nonce tests plus four support HTTP executions (integrity and revision each twice). Actual PostgreSQL stop/start retained its receipt. Owned cluster stopped safely; isolated data/logs preserved, not recursively deleted or asserted empty.

Receipt SHA256 `a1ffef6be8f9971ea2390ee46da26f585fe003a2dd2f5d9e09bf240b97ec2afa`; path `/private/tmp/ynx-exchange-postgres-it-ZBVQH6/receipt.json` contains each execution and per-phase log digest.

Runner SHA256 `7b6bc8fb117af607b1b906d2b6210b0593ccdaba9f9111269ec7d20a8a3f3ea3`.

Test SHA256 `7f7549a6068e331e1ed0d1060ae101c2670c429f42a6e2fcec79599964c6aeac`.

`go test -race ./internal/exchangeproduct -count=1 -timeout=120s`: PASS, 13.784s. Node syntax and git diff checks passed. This separate ordinary race run does not replace the explicit database executions above. Remaining shared method/route/write-grant/SDK and coherent-public-source integration needs are routed only to 接续测试网生态审计工作.
