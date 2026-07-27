# YNX Quant Lab Current Plan

Status: Active  
Stage: INTEGRATE  
Last protected remote commit: `5a626ac3967a7beac51535575eb8dc9311d6927c`

## Completed in this checkpoint

- protected and pushed the recovered Quant runtime and evidence history;
- hardened the release gate against missing `rg`, unhealthy Python executables,
  Python 3.9 incompatibility, and non-reproducible desktop archives;
- added fail-closed Exchange and DEX owner-transport adapters with terminal
  receipt binding, outcome-unknown replay protection, exact reconciliation and
  persistent kill-switch tests;
- rebuilt, scanned, installed and cold-started the macOS candidate from
  `89a180911e40d66e47789eab419dff21d93a42d8`;
- created the full-goal coverage matrix and standard integration package;
- added a machine validator that prevents premature central/Testnet/public
  promotion.

## Next highest-priority autonomous actions

1. Run the complete Quant release gate and protect this integration-package
   checkpoint with Commit/Push/Local=Remote verification.
2. Probe Docker availability. When available, build and run the self-hosted
   image, verify health/version, persistence, restart, backup/restore and image
   hash; otherwise retain `implementedLocal` without claiming a verified image.
3. Add deterministic, measured local capacity evidence for API/backtest/worker
   paths and raw percentile samples without extrapolating to public scale.
4. Extend manual/package accessibility evidence where the local platform permits.
5. Consume accepted Wallet, Oracle, Exchange, DEX and Data Fabric owner schemas
   when they are available; do not invent owner acceptance or bypass them.

## Cross-product execution sequence

Wallet/Auth and StrategyMandate freeze → Oracle schema freeze → Exchange/DEX
terminal receipt and reconciliation freeze → Data Fabric event mapping →
negative vectors → bounded Exchange Testnet → bounded DEX Vault Testnet → risk,
revoke, restart and recovery → public release gates.

## Current blockers

- canonical Wallet Product Session and mandate attestation not accepted;
- Exchange and DEX owner transports and real Testnet receipts absent;
- Oracle/Data Fabric owner schemas not centrally accepted;
- shared Testnet, public deployment, immutable hosting and production signing
  evidence absent;
- Windows host, Kubernetes cluster and external scanner/audit evidence absent.

These blockers do not complete the goal. Continue independent runtime,
verification, capacity, recovery, accessibility and integration work.
