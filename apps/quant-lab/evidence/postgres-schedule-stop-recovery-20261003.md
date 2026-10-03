# Actual PostgreSQL scheduled research fences

Predecessor `48ba22def0502357fce0871268275a89046cc6a8`.
This checkpoint adds executable database acceptance, not a new scheduler or
shared protocol. Existing schedule semantics are preserved.

The new mandatory actual PostgreSQL test shares a durable namespace between
independent service instances. One claims the due run and waits in a controlled
market adapter. Another cannot duplicate that due claim and explicitly stops
the strategy. Returning market data cannot commit a stopped experiment; a
restarted service retains disabled state and only the original experiment.

A deliberately abandoned durable claim is not immediately retried. At its
persisted next due time, a different instance completes one fresh research run.
The retired claim cannot commit or overwrite that newer completion. Final
research count is exactly two; Paper and Testnet order maps remain empty. This
is research scheduling, not capital execution. Adapter data is controlled, not
live trading evidence or a simulated real process crash.

Runner mandatory gates now include this test. Seven required database gates
each executed twice =14PASS, no database SKIP. Actual PostgreSQL17.11 stop/start
then full Go race regression108top-levelPASS. Durable QA row counts0|0 and
terminal serverStopped=true; productionDatabaseUsed=false.

Commands:

```
node --check apps/quant-lab/scripts/test-postgres-isolated.mjs
node apps/quant-lab/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin
go vet ./internal/quantlab
git diff --check
```

The earlier Go-only targeted invocation compiled but skipped without a database
URL; it is not counted as database execution. Mandatory real runner above ran
the test twice and again after actual database restart.

Receipt `/private/tmp/ynx-quant-postgres-it-sHNLEw/receipt.json` SHA256
`5525da7dd36162b992f0e6cb4c30dd74ab8c1e25ad179f85ca146ba5ed27a01c`.
Focused log SHA256
`0be0f95bb8229aa95f9a287dc915b3f49f4a728a5fe774e7a89c8e2728012b5b`.
Full log SHA256
`8bc9391e854243893e5039144afa0426cc54febf26741a0ec5f3b8940832c2b2`.

No production state/source, accounts, signatures or transactions changed.
This proves the owned scheduler/database boundary locally, not public source
binding, canonical Wallet approval, installed acceptance or product completion.
