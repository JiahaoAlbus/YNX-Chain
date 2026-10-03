# Exchange real isolated PostgreSQL continuation

Owner predecessor: df175ac0b3748662f924a8783dc5983adeedf30e. Only Exchange tests and its isolated QA runner changed; no runtime, schema migration, shared authority, production database or release changed.

## Newly demonstrated gap and correction

The first real isolated run returned Go exit zero but skipped `TestPostgreSQLStateStoreMultiInstanceCASAndRestartRecovery`: the existing test required revision layout, while the actual new-database migration creates integrity layout. The new runner treats any required skip as failure. Initial failure logs are retained at `/private/tmp/ynx-exchange-postgres-it-m7fh8F`; its owned PostgreSQL process was stopped.

The CAS test now executes for both supported layouts. It verifies exactly one concurrent winner and one conflict, retained sequence after service reopen, and durable account test balance after another reopen. Revision counters remain checked only in revision mode; integrity mode uses its existing hash fence. No production logic changed.

## Exact executed QA

Command:

`node apps/exchange/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin`

Final root: `/private/tmp/ynx-exchange-postgres-it-q6Pxs5`; localhost port 59790; PostgreSQL 17.11. Eight required case executions passed, none skipped:

- Integrity-layout multi-instance CAS/reopen: twice.
- Revision-layout multi-instance CAS/reopen: twice, with a separately created controlled legacy-layout table, not a proposed migration.
- Finance signed read across service instances and persisted nonce replay rejection: twice.
- Integrity-layout bootstrap/hash-CAS/stale writer rejection: twice.

Each case used a fresh isolated database to avoid legacy bootstrap state polluting another case. Both environment-variable interfaces were exercised explicitly. Separately, an actual PostgreSQL stop/start retained a written receipt. The final owned cluster was identity-checked and stopped; stopped data/logs remain local. No claim that fixture database tables are empty or deleted.

Receipt: `/private/tmp/ynx-exchange-postgres-it-q6Pxs5/receipt.json`, SHA256 `7fc6a8ef0791d25f5c53684289717bd8a64cc369ab1ba353f781f11999af2020`. It contains every executed case, database layout, terminal stop truth and per-phase log digests.

Runner SHA256: `3e1a05039847b146d192d8ee84b22f321034fcbca058bf1d2920f8b41503da6d`.

PostgreSQL executable SHA256: `038ff8ec454ef37da4c7d88b7b461cb8de8203146ff1ea6f11d3a9632a84551e`.

`go test -race ./internal/exchangeproduct -count=1 -timeout=120s`: PASS, 8.767s. This separate ordinary run does not configure PostgreSQL; only the explicit isolated runner proves actual database cases. Node syntax and git diff checks passed.

## Remaining delivery boundary

Local database QA is not public multi-instance operation, native installation, real Wallet approval, a production persistence migration or public trading. The accepted Web write-route/proof gap in `web-write-contract-gap-20261003.md` remains. Release owner must consume ordinary changes into its coherent source graph and publish with its own live namespace/configuration/rollback contract. No credentials, user data, actual account request, signature, order or chain transaction were used.
