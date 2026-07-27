# YNX Quant Lab Current Plan

Status: Active  
Stage: INTEGRATE  
Last protected remote commit: `2ff74fa60d9c539adef1e5549358667193016e84`

## Completed in this checkpoint

- protected and pushed the integration proposal and coverage gates;
- fixed desktop provenance so candidates are built against an explicit release
  Source Commit rather than whichever HEAD happens to run the gate;
- disabled implicit Go VCS stamping and added fail-closed artifact-input drift
  detection;
- rebuilt macOS and Windows candidates twice with identical hashes;
- scanned both archives, strictly verified the macOS ad-hoc signature, and
  cold-started a fresh Applications-layout extraction;
- verified exact `/version`, ready `/health`, Prometheus `/metrics`, frontend HTML,
  live-funds-disabled state and clean child-process shutdown;
- synchronized product release, security, integration and coverage evidence to
  source commit `2ff74fa60d9c539adef1e5549358667193016e84`;
- passed the complete Quant local release gate.

## Next highest-priority autonomous actions

1. Protect this evidence refresh with Commit/Push/Local=Remote verification.
2. Probe Docker availability. When available, build and run the self-hosted image,
   verify health/version, persistence, restart, backup/restore and image digest;
   otherwise retain `implementedLocal` without claiming a verified image.
3. Add deterministic measured local capacity evidence for API, backtest and worker
   paths, retaining raw percentile samples without public-scale extrapolation.
4. Extend packaged accessibility evidence where the local platform permits.
5. Consume accepted Wallet, Oracle, Exchange, DEX and Data Fabric owner schemas
   when available; do not invent acceptance or bypass owner contracts.

## Cross-product execution sequence

Wallet/Auth and StrategyMandate freeze → Oracle schema freeze → Exchange/DEX
terminal receipt and reconciliation freeze → Data Fabric event mapping → negative
vectors → bounded Exchange Testnet → bounded DEX Vault Testnet → risk, revoke,
restart and recovery → public release gates.
