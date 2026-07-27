# YNX Quant Lab Current Plan

Status: Active  
Stage: INTEGRATE  
Last protected remote commit: `8b211d08a67abc9e2b3d3f3254bbc87f4293b08e`

## Completed in this checkpoint

- protected explicit desktop artifact provenance and pinned Source Commit gates;
- pinned container base image digests, reduced dependency download scope, and disabled implicit Go VCS stamping;
- fixed non-root named-volume initialization without running services as root;
- preserved the loopback-only Preview write boundary by colocating web proxy and core API network namespace;
- added a fail-closed container verification gate covering dirty/source drift, five-service Compose startup, non-root/read-only/capability boundaries, exact version/health, Preview mutation, ordered restart persistence, backup SHA, isolated restore and audit-chain continuity;
- verified the local Linux arm64 image against Source Commit `8b211d08a67abc9e2b3d3f3254bbc87f4293b08e`;
- rebuilt macOS and Windows candidates twice reproducibly against the same source;
- strictly verified and cold-started the fresh macOS archive with exact version, health, metrics, frontend and live-funds-disabled evidence;
- passed the integrated release plus container runtime/restart/restore Preflight.

## Next highest-priority autonomous actions

1. Protect the evidence refresh with Commit/Push/Local=Remote verification.
2. Add deterministic measured local capacity evidence for API, backtest and worker paths, retaining raw samples and percentile calculations without public-scale extrapolation.
3. Extend packaged accessibility evidence where the local platform permits.
4. Build/run the container on Linux amd64; retain arm64-only evidence until then.
5. Consume accepted Wallet, Oracle, Exchange, DEX and Data Fabric owner schemas when available; do not invent acceptance or bypass owner contracts.

## Cross-product execution sequence

Wallet/Auth and StrategyMandate freeze → Oracle schema freeze → Exchange/DEX terminal receipt and reconciliation freeze → Data Fabric event mapping → negative vectors → bounded Exchange Testnet → bounded DEX Vault Testnet → risk, revoke, restart and recovery → public release gates.
