# Blockers

Updated: `2026-07-29T02:36:11Z`

No local implementation blocker remains for the observability slice.

## Central dependency gates

### DOCS-BLOCK-OBS-ACCEPTANCE

- Owner: YNX 13, YNX 29 and YNX 30
- Reason: metric labels/retention, trace propagation, dashboard ingestion and alert policy are central contracts.
- Evidence: `release/integration/docs-contract.json`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/operations/OBSERVABILITY.md`
- Prepared: local endpoints, structured logs, correlation IDs, tests and source commit are complete.
- Why YNX 35 cannot close it alone: YNX 35 must not modify Monitor, Integration or SRE worktrees or claim their acceptance.
- Minimum input: accepted contract version plus dashboard and alert probe receipts bound to the exact runtime SHA.
- Resume condition: YNX 13/29/30 acceptance evidence becomes available.
- First action after input: record acceptance and execute the shared observability vector without promoting public deployment.

### DOCS-BLOCK-SHARED-TESTNET

- Owner: YNX 02/14/15/20/26/29/30
- Reason: accepted Wallet, Cloud, AI, Trust, Data Fabric and shared deployment endpoints are required.
- Prepared: product contract, fail-closed adapters and test vectors are present.
- Minimum input: accepted endpoint/credential/deployment envelope for the shared Testnet.
- Resume condition: all required central contracts identify one frozen version and source SHA.
- First action after input: execute the ordered Docs Testnet sequence in `docs/integration/INTEGRATION_HANDOFF.md`.

These are integration gates, not excuses to stop autonomous local work on remaining YNX 35 scope.
