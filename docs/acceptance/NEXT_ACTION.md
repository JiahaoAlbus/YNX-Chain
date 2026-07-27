# YNX Pay next action

Current phase: FREEZE → INTEGRATE. Goal status: Active.

## Immediate checkpoint action

1. Preserve the full Split consumer-flow commit `a405604714645df1084ed9e06cc7d7b6f9a4d4b0`.
2. Commit and push its source-bound Release, Contract, Handoff and coverage metadata.
3. Begin the Quant/service-billing evidence validator and migration/restore drill.

## Next engineering/integration action

`29-integration` must freeze `release/integration/pay-contract.json` against the accepted Wallet/Auth and App Gateway source commits, then run `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.

After the central routes are deployed, regenerate fresh evidence for:

- Faucet → Wallet/Smart Account;
- Invoice → Wallet approval → committed YNXT receipt;
- two independent Wallet accounts claiming and paying Split shares;
- sponsored UserOperation and exhausted-budget failure;
- authoritative refund;
- Trust-linked dispute;
- webhook failure, backoff, dead letter and audited replay;
- Explorer and Monitor evidence.

## Pay-owned autonomous gaps after this checkpoint

- Quant high-water-mark billing evidence validator;
- fixture-based forward/rollback migration and timed restore drill;
- dependency-aware health/version, metrics and traces;
- repeatable p50/p95/p99 capacity and unit-economics measurement;
- current Android/iOS install/cold-launch proof;
- 12-locale, Arabic RTL, accessibility, dark mode and 390px acceptance;
- source-bound SBOM, provenance and hosted artifact evidence.

Do not set central, staging, public, hosted, production-signed or store release states true without direct evidence.
