# Quant Paper cost PostgreSQL process evidence

Source checkpoint: `8766a2de6962555083bfa5d4d96b4f6a40ce00d4`, tree `41a4373d9495a2da257fbba5d5b6bf0cc988f40c`.
Classification: isolated local native PostgreSQL QA; NOT public, installed, Wallet approval or Testnet capital execution evidence.

Command: `node apps/quant-lab/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-finance-postgres-qa.J359YD/runtime/bin`.

Final retained root: `/private/tmp/ynx-quant-postgres-it-uRFuif`; PostgreSQL 17.11, loopback port 59054, database `ynx_quant_qa`. Runner reports testsPassed=true, serverStopped=true, productionDatabaseUsed=false, required integration executions=22 (11 gates twice), full regression top-level PASS=155, databaseRestartVerified=true and final state/nonce counts=`0|0`.

The original HTTP process test now executes both legacy and explicit-cost cases. Two independent OS service processes handle 16 concurrent requests from two tenants using the same request key. Each tenant retains its own strategy, amount and fee/slippage policy. Independent fixed expected v1 receipts: A execution price 1200600, notional 1200600, fee 1201, marked loss 1801; B price 1201200, notional 2402400, fee 3604, marked loss 6004. A third offline process retrieves exact receipts after restart without another charge. Changed fee, changed amount, cross-tenant strategy and killed/offline new execution refuse; replay leaves SQL revision and payload bytes unchanged. All prices and funds here are explicitly controlled local Paper inputs.

Logs retained at the final root:

- `integration.json`: SHA256 `38c1413904f911c7a239d3e6749a99e8d8f385515cb399bcc5cc007ea5e470ee`.
- `full-regression.json`: SHA256 `d603aca03797fdd08f2441401d689d8fd16cf241be6b6d47c494d621420b3eea`.
- `row-receipt.json`: SHA256 `875fb9aea8c2545a2c454189edc13d8bb66d1622577ac46cc8c414cbb2613841`.

Failed runs are preserved, not relabeled as PASS:

1. `/private/tmp/ynx-quant-postgres-it-Ol76Aw`: the runner's old database name conflicted with the original child helper's strict `/ynx_quant_qa` guard. Corrected the runner, not the guard. Integration log SHA256 `7dfa91832eab73c11a079ec503578e48f2f6b30c54bc7b0f484b4cb9b84f76d9`.
2. `/private/tmp/ynx-quant-postgres-it-ctwjFd`: 22 required executions and full regression passed but final counts were `3|0`, so the runner correctly failed. The readiness test closed its original pool and lacked cleanup of its own namespace. Added a separately reopened, exact-namespace cleanup; no broad deletion. Integration SHA256 `9d25d138bdb001afcb3d497bdb7138ce5a63a557ee8efb62e028ca696d16d037`, full regression SHA256 `59314821c240d804d17d41475ee16b7b5cfada8548138774489048001df8dc65`.

An actual child rejection regression proves an unapproved database fails before readiness and state creation. Early terminal child exits are now distinguished from startup timeouts. No credentials, production DSN, shared SDK/generated bundle or formal deployment inputs changed.

Remaining: independent late-response UI recovery defect is being repaired separately; formal source-bound runtime/installer publication remains with the release owner. Local SQL tests are not evidence of public SQL deployment or product completion.
