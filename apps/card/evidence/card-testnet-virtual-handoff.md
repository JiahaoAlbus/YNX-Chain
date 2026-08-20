# YNX Card Testnet Virtual Card Simulation — Handoff (P0-013)

## Scope and policy
- Working dir: `apps/card/**` only.
- No changes were made to Wallet Protocol, Gateway, SDK, or central control-plane.
- Product claim remains explicit Testnet simulation only (`SIMULATION`/`sandbox` language in UI).
- Scope confirmed in path lock: `apps/card/**` assigned to `card-testnet-virtual`.

## Files changed
- `apps/card/App.tsx` (simulation tab + EIP-1193 wallet connection + YNX Testnet top-up evidence flow + idempotent authorization/capture/reversal/refund simulation + local audit/recovery)
- `apps/card/src/simulation.ts` (operation simulation handlers, idempotent replay policy, recovery transitions)
- `apps/card/src/wallet.ts` (EVM provider discovery/connect + callback + callback verification helper)
- `apps/card/src/api.ts` (safe Card payload parsing and simulation endpoints)
- `apps/card/src/secureState.ts` (session token + key storage helper)
- `apps/card/src/i18n.ts` (complete locale catalog for new simulation copy and safety language)
- `apps/card/index.ts` (app entry)
- `apps/card/src/api.test.ts`, `apps/card/src/wallet.test.ts`, `apps/card/src/i18n.test.ts`, `apps/card/src/simulation.test.ts`

## Evidence status vs requirements
- Evidence requirement: "actual YNXT Testnet top-up transaction or explicit chain-integration blocker"
  - The UI enforces `loadTestnetTopupEvidence` and blocks simulation actions until top-up proof hash is verified.
  - In this workspace there is no connected live wallet/device to submit a real YNXT Testnet top-up tx hash, so we record explicit blocker as required.
  - Evidence collected: guardrails are implemented and verified in tests / code path; chain evidence pending external runtime.

- Evidence requirement: idempotent test authorization/capture/reversal/refund
  - Added idempotent local simulation ledger with duplicate-key replay detection.
  - Added tests:
    - `src/simulation.test.ts: "simulation replay detection keeps one canonical record for same idempotency key"`
    - `src/simulation.test.ts: "recoverLastFailed marks failed simulation entries as recoverable"`

- Evidence requirement: persistent audit/recovery
  - Local persistent ledger via `loadSimulationAudit` / `saveSimulationAudit` in `apps/card/src/simulation.ts`.
  - Recovery action replays failed records and updates status.

- Evidence requirement: locale/safety completeness
  - Added regression test covering all 12 locales with non-empty translation keys and explicit safety language assertions.

- Requirement: no FIAT/real card details/real merchant/payment claims
  - UI labels remain sandbox/Testnet language (`Testnet`, `Sandbox`, `virtual`, `simulation`) and does not present PAN/CVV/real network claims.

## Verification commands run
- `cd apps/card && npm test`
  - Result: PASS (10 passed, 0 failed)
- `cd apps/card && npm run typecheck`
  - Result: PASS

## Manual verification checklist (next environment)
1. Sign in with central session (wallet connect flow unchanged).
2. Open **Simulation** tab.
3. Connect EIP-1193 wallet and switch to YNX Testnet (`0x1917`) if needed.
4. Paste a real YNX Testnet top-up tx hash and verify.
5. Submit top-up proof.
6. Run simulated `authorization`, `capture`, `reversal`, `refund` with same idempotency key once and again:
   - expect second call to emit duplicate message.
7. Simulate/force one failed operation (if environment permits), then press **Recover failed simulations**.
8. Confirm local simulation ledger persists and updates across cold start.
