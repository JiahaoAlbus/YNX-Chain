# Native PostgreSQL second-start regression

Predecessor: 8bc4a19529cd63bc08c60e3eeca45392706b6e67.
Classification: isolated local database integration, not public/installed acceptance.

Extended the retained native QA runner to stop PostgreSQL fully, start the same
data directory with the same explicit loopback port/socket, read an actual
durable fixture row, drop the probe, and run the complete Quant/readintegration
race suite with the real QA database URL. Caller database URLs are still never
consumed. Identity fencing applies before both stops.

The initial second-start draft omitted the explicit port/socket arguments.
PostgreSQL started with defaults and the expected test port refused connection;
the runner failed closed and stopped its own cluster. Retained failure log:
`/private/tmp/ynx-quant-postgres-it-EaCQBq/restart-probe-read.json`, SHA256
`6751ce58234abe24fae8cd5b3afc45891f7ffaa6145b0377632104dca9f9a0be`.
Corrected the runner, not service logic or database acceptance criteria.

## Actual passing execution

```
node apps/quant-lab/scripts/test-postgres-isolated.mjs --postgres-bin-dir /tmp/ynx-quant-postgres-qa.7c340A/runtime/bin
```

Receipt path `/private/tmp/ynx-quant-postgres-it-MMyrCg/receipt.json` SHA256
`3f2d8cdd9f16907ee6dcdc03057a235679e0a6e727058dbeeb62184fad1f0420`.
Integration (four mandatory actual PostgreSQL tests, twice each): 8 passes.
Full regression after actual PostgreSQL restart: 100 top-level passes,
Quant 2.791s/readintegration 1.118s, race enabled; each mandatory database test
executes again. One separate optional `TestLocalNodeHostQuantBrowserBridge`
remains SKIP (no local Node Host fixture); do not describe all gates as executed.
Full regression log SHA256:
`4795b8607c6ce6fb8004f64a41db38376f53e5088ced5327a9882d474de03c00`.
Durable restart probe read log SHA256:
`d12178268dd40e53efd441a2491a94bfc9b58c9bf244ed1d02227f40c8fabaf9`.

Terminal fields: databaseRestartVerified=true, fullRegressionPassed=true,
testsPassed=true, serverStopped=true, remainingRows=0|0,
productionDatabaseUsed=false. Node syntax/diff whitespace gates PASS.
Stopped cluster/logs retained in the isolated temporary root; no recursive
deletion, system service installation, or production mutation. This verifies
the actual storage layer, not real public Wallet approval, authoritative market
data, capital execution, a native installer or source-bound public deployment.
