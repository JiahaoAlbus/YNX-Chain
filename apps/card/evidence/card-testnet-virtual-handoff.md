# YNX Card Testnet Virtual Card Simulation — Handoff (P0-013)

## Scope and policy
- Working dir: `apps/card/**` only.
- No changes were made to Wallet Protocol, Gateway, SDK, or central control-plane.
- Product claim remains explicit Testnet simulation only (`SIMULATION`/`sandbox` language in UI).

## Files changed (this handoff)
- `apps/card/App.tsx` (simulation tab + EIP-1193 wallet connection + YNX Testnet top-up evidence flow + idempotent authorization/capture/reversal/refund simulation + local audit/recovery)
- `apps/card/src/simulation.test.ts` (new tests for idempotent replay + failed->recovered audit transition)

## Evidence intent vs collected status
- Evidence requirement: "actual YNXT top-up tx or explicit chain-integration blocker"
  - Attempted chain tool path uses only YNX Testnet (`loadTestnetTopupEvidence`) and requires proof hash to proceed with simulation.
  - `topup` cannot be marked successful in this workspace without an actual mobile wallet + chain transaction.
  - Therefore recorded as explicit blocker in this environment.

- Evidence requirement: idempotent auth/capture/reversal/refund
  - Added UI controls and audit logic in simulation tab; local ledger enforces per-operation replay detection.
  - Added unit test:
    - `src/simulation.test.ts`
    - "simulation replay detection keeps one canonical record for same idempotency key"
    - "recoverLastFailed marks failed simulation entries as recoverable"

- Evidence requirement: persistent audit/recovery
  - Local persistent ledger via `loadSimulationAudit` / `saveSimulationAudit`.
  - Recovery action replays failed records and updates status.

## Commands run for verification
- `cd apps/card && npm test`
  - Result: blocked (`tsx` not installed in environment)
- `cd apps/card && npm exec -- tsc --noEmit --pretty false`
  - Result: blocked (`tsc` package not available from local project deps in this workspace)

## Manual verification checklist (next environment)
1. Sign in with central session (wallet connect flow unchanged).
2. Open **Simulation** tab.
3. Connect EIP-1193 wallet and switch to YNX Testnet (`0x1917`) if needed.
4. Paste a real YNX Testnet top-up tx hash and verify.
5. Submit top-up proof via Card gateway.
6. Run simulated `authorization`, `capture`, `reversal`, `refund` with same idempotency key once and again:
   - expect second call to mark duplicate.
7. Force one operation failure (if environment permits), then press **Recover failed simulations**.
8. Confirm local simulation ledger persists and updates across cold start.
