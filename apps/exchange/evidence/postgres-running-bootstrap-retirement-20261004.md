# Exchange running repository bootstrap retirement

Predecessor `68b38866fc505c5c0d2169a2aa6527910c519812`, tree `2d2cd67d9227aec07d88990a2b966412f95043fd`. Existing Exchange business storage only; no shared authority, schema migration, Host or public deployment.

## Defect reproduced and repaired

The legacy PostgreSQL `Load` branch imported `bootstrapPath` whenever SQL returned no rows, including after the running repository had already observed current database authority. A removed record could therefore resurrect an older file instead of reaching the missing-state guard added in `61cd02ee7`. The repository now atomically retires startup import after observing a row or attempting startup bootstrap. Later missing rows propagate absence; `refreshState` rejects cached authority. Existing initial import and both `integrity` and `revision` table layouts remain supported, with no table or permission change.

New actual database/sql driver regression invokes the production repository's QueryRow/Scan/Save control flow in four cases: each layout, initially observed row or initial file import. Subsequent missing rows are checked repeatedly: no reimport SQL writes, no invented existence, and service refresh fails without changing retained integrity. Test SQL driver is scripted and isolated, **not PostgreSQL and not multi-instance deployment evidence**.

## Executed gates

- Focused `go test ./internal/exchangeproduct -run TestPostgresRunningRepositoryNeverReimportsSeedAfterAuthorityDisappears -count=1`: PASS 0.893s.
- Full `go test -race -json ./internal/exchangeproduct -count=1`: PASS 13.895s, 128 passed test/subtest events, zero failures. Seven explicit skips remain: two LocalNodeHost bridge tests; Finance/PostgreSQL nonce and account test; PostgreSQL owned support isolation/restart test; synthetic schema binary compatibility export; PostgreSQL bootstrap/CAS test; PostgreSQL multi-instance/restart test. Do not count these skips as acceptance.
- `gofmt` and `git diff --check`: PASS.

## Remaining exact boundary

The retirement marker is per running repository, not a durable migration receipt. A wholly new process can still perform the historical startup import if an operator configures a retained bootstrap path and the database is empty. Durable explicit migration/initialization policy, real isolated PostgreSQL integration, current-source public publication and private/native user journeys remain incomplete. The atomic runtime fence is not claimed as a solution to that cold-start policy or production persistence loss.

No PostgreSQL daemon or production database was started/contacted, no SSH or Host/deploy mutation, no Wallet/account/sign/order/transaction occurred. Existing public Exchange version remains the older readback in `public-guest-release-gap-20261004.md`, not this source. Release owner must integrate the current owned service and ordinary UI deltas into its exact final candidate and publish source-bound runtime before public acceptance. Missing dedicated PostgreSQL environment and durable cold-start import policy are development/test debt, not a claim that the user owes an external API. Report only to 接续测试网生态审计工作 (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).
