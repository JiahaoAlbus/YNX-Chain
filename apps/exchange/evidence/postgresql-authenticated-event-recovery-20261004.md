# Exchange PostgreSQL authenticated-event recovery

Parent771f7aa5d6369f4dbf399bbe7850fd715148d031. Ordinary Exchange business implementation/tests only. No shared authority, formal release bindings, Host, production database, real account/signature/transaction or DEX changes.

## Executed failures and root cause

Real PostgreSQL17.11 in the isolated local toolchain /tmp/ynx-finance-postgres-qa.J359YD, dedicated database ynx_exchange_qa_20261004 on loopback64623. Source/build identity is retained in the Quant isolated-real-postgresql-recovery-20261004.md evidence. No external database credentials.

Initial full-suite failure: database tests shared the primary record, so support data from one test polluted an empty-state CAS expectation in another. Every opt-in Exchange test now creates a random owned schema via search_path and drops only that exact schema after all pools/servers close. No supplied database/public schema is deleted. The legacy repository test also accepts the canonical opt-in URL variable rather than silently remaining skipped.

Expanded actual HTTP order fixture to PostgreSQL for both historical integrity-CAS and revision-CAS table layouts. Before the fix both returned503 on concurrent/reopened reads: decode exchange database state: exchange state integrity verification failed. Execution-event RawMessage payload fields were reordered by jsonb, changing authenticated event/state bytes even though JSON values were equivalent.

## Storage correction

No SQL table migration. New PostgreSQL writes use a JSONB envelope with stateEncoding=base64-json-v1, schemaVersion, integrityHash and stateBytes. stateBytes preserves the complete original JSON bytes; envelope normalization cannot alter signed/hash-bound payload order or numeric precision. Existing top-level integrityHash remains available to revision-CAS SQL. Load checks encoding, strict base64, full original state integrity and envelope metadata binding. Legacy plain JSONB records remain readable only if their existing integrity verifies. Previously corrupted records are NOT repaired or bypassed; a trusted original backup is required.

Tests also prove unchanged payload bytes for an execution event containing9007199254740993, valid event-chain verification, legacy byte-intact read and rejection of unknown encoding, invalid base64, changed metadata and inner payload tampering. One temporary diagnostic called a non-existent repository.Close method and failed compilation; corrected to close the actual SQL pool before executed test results below.

## Executed verification

- PostgreSQL/Finance-read focused race PASS2.509s after correction.
- PostgreSQL dual-HTTP order replay for both layouts, count10 race: PASS5.002s. Each run performs actual matching, signed fixture authorization, concurrent duplicate submission, restart/reopen, exact replay, foreign-account rejection, ledger/fee reconciliation, one persisted trade, public depth/trade projection and final unchanged state digest.
- Full Exchange race with real database enabled: PASS14.649s. JSON summary114 top-level PASS,0FAIL,4SKIP, including legacy database gate not yet aliased.
- After enabling the legacy bootstrap/CAS gate through the same isolated URL: final full Exchange race PASS14.964s. Remaining external host/export fixtures are not public acceptance.
- gofmt and git diff --check PASS. Final SQL generated-schema count=0. Temporary database stopped with exact pg_ctl data path; toolchain and dedicated cluster retained, no background service remains.

These are real local SQL and HTTP service instances with controlled test-chain funding and fixture Gateway authority. Not concurrent separate Exchange OS processes, public Wallet approval, real external funds, installed package acceptance or public trade completion.

## Direct public GET identity (2026-10-03T19:10:49Z)

- https://exchange.ynxweb4.com/api/version HTTP200 JSON107B SHA256b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8; old source91c1a40587d28ad4c931d4a4d601766bd467ea20/version0.1.0-testnet.
- /api/health HTTP200 JSON307B SHA2569d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de, same source, routingAvailable=false/productionCustody=false.
- Bare /version and /health returned the same HTML fallback15995B SHA256e19bfb7281f35515b5d5648f893803af94ea3a0c64ed46d766f3495a8e7b63ab; HTTP200 is not a version/health proof on those paths.

## Release/rollback boundary

A release owner must integrate the exact source and perform a coordinated storage-compatible cutover. Old binaries cannot decode the new envelope: do NOT mix old/new writers or roll back only the binary after new writes. Freeze exact prior SQL row/schema backups before any future authorized transition, drain writers and retain a compatible decoder for rollback. Restoring an old database snapshot after new orders would lose accepted records and is NOT authorized by this source checkpoint. Any real rollout needs an explicit data-preserving release/rollback contract.

publicCurrentSource=false; installedVerified=false; publicWalletApproval=false; publicOrders=false; migratedV2=false. No production publication or storage transition performed.
