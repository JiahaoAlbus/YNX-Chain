# YNX Quant Lab Current Plan

Status: Active
Stage: INTEGRATE
Last fully verified source checkpoint: `3bff013d86ed5682950a38b114884ce6f17c423d`
Agent Memory: `docs/agent-memory/RECOVERY_CHECKPOINT.json`

## Completed in the latest checkpoint

- recovered and verified the exact 08 Quant Lab worktree, branch and Chain repository identity;
- confirmed the source branch and remote were equal at `3bff013d86ed5682950a38b114884ce6f17c423d`;
- identified stale desktop archive hashes as a release-truth defect rather than accepting partial test success;
- rebuilt macOS and Windows candidates twice reproducibly with Go 1.25.7 on Darwin arm64 and recorded the toolchain-bound hashes;
- added explicit archive mismatch diagnostics and a repeatable packaged macOS cold-start verifier;
- verified safe extraction, executable permissions, strict ad-hoc signature, exact source commit, ready health, live funds disabled, build/risk metrics, frontend identity and clean shutdown;
- passed `apps/quant-lab/scripts/verify-release.sh` after the code/evidence commit;
- preserved truthful boundaries: no central integration, shared Testnet receipt, public deployment, hosted download or production signing claim.

## Next highest-priority autonomous action

Inspect source-addressable integration artifacts on the current remote branches for products 02 Wallet/Auth, 07 Exchange, 19 Oracle/Market Data, 26 Data Fabric, 27 DEX and 29 Integration. Bind only explicit accepted versions into Quant-owned contracts, dependency acceptance and negative vectors; retain all unresolved dependencies as fail-closed pending gates.

Validate with `apps/quant-lab/scripts/validate-integration-package.py` and targeted Quant adapter/mandate tests, then commit, push and verify Local SHA equals Remote SHA.

## Cross-product execution sequence

Wallet/Auth and StrategyMandate freeze → Oracle schema freeze → Exchange/DEX terminal receipt and reconciliation freeze → Data Fabric event mapping → negative vectors → bounded Exchange Testnet → bounded DEX Vault Testnet → risk, revoke, restart and recovery → public release gates.
