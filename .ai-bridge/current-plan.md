# YNX Wallet/Auth current plan

Status: Active. Current phase: INTEGRATE. The local encrypted Gateway backup/restore and version-compatibility slice is complete and source-bound.

1. Preserve the canonical Wallet/Auth implementation source `a5c99e4e26e150aa6cf4138f4ecf8ac6d1ea8b2f` and its verified 100/100 package test checkpoint.
2. Preserve the local backup/restore evidence at `apps/wallet/proof/gateway-backup-restore-local-2026-07-29.json`: 6/6 focused tests, exact non-empty restore, replay-state preservation, tamper/policy/permission rejection, validated legacy normalization, future-schema rejection and a 20-sample local drill.
3. Submit the exact Registry, Gateway HTTP/Node host, backup, observability, StrategyMandate and shared-vector contract to the central App Gateway and `29-integration`; do not create a second compatibility protocol.
4. After central acceptance, run installed Wallet→Social, Wallet→Pay, Wallet→Quant→Exchange and Wallet→Quant→DEX flows plus central durable-store restore, Explorer and Monitor evidence.
5. Reattempt current-source Android/iOS installed evidence only when a real emulator/device or full Xcode runtime exists.
6. Keep `integratedCentral`, runtime `deployedStaging`, runtime `deployedPublic`, Smart Account Testnet receipt, production KMS/RTO/RPO, production signing and store states false until direct owner/operator evidence exists.

## Implementation contract

- Work only in `02-wallet-auth` on `codex/final-wallet-auth`.
- Preserve protected commits and concurrent work; do not reset, clean, force-push or overwrite sibling ownership.
- Use small source-bound checkpoints and focused gates before broader preflight.
- Update Integration Contract, Release Record, evidence index and agent status after each verified slice.
- Never place a private key, seed, recovery material, signing asset or provider secret in Git, logs, evidence or chat.
