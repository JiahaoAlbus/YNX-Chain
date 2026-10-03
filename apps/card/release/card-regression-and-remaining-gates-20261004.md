# Card Testnet regression and remaining gates

Owner branch: codex/card-test-service-recovery-20261002.
Scope: apps/card only. No formal build or deployment in this checkpoint.

## Corrections

- Corrected the previously disclosed amount-test expected value: 9007199254740993 tokens is 9007199254740993000000000000000000 wei. Production conversion code is unchanged.
- Excluded the runtime test directory from the Expo application TypeScript project. The CJS service integration test had pulled Node-only server imports into the frontend compiler. The existing separate server TypeScript project remains required and checked; no server typing or validation was removed.

## Executed regression

- npm test: 285 source tests, 39 hosted/private UI tests, 23 guest/application/recovery/operations integration tests, 11 native patch tests; 358 passed, zero failed or skipped.
- npm run typecheck: frontend and separate server compiler both exited zero after the project boundary correction.
- Preserve the first failing typecheck log, alongside the successful separated check and complete test log, in evidence/20261003-testnet-operations.
- These are local source gates, not installed/public business acceptance or a formal build.

## Remaining end-to-end gates

- Keep the original public Card tab and MetaMask request; do not repeat eth_requestAccounts. Manual user approval or rejection has not returned to Card. Do not bypass extension-page tool restrictions.
- The observed prior YNX restore and local disconnect do not prove fresh approval, remote permission revocation, or MetaMask account/chain readback.
- After the user handles the original prompt, verify the actual selected provider, approved account, chain 0x1917, chooser closure, refresh and provider events before claiming a standard connection lifecycle.
- Standard connection is not Card private authorization, Product Session, a signature, account/card activation, or funding acceptance.
- The newer Card operations and original-key readback must be admitted and formally bound by the sole release owner to an exact backend/source tuple. Do not invent scopes, relax the current tuple, or self-deploy a new backend.
- Then verify user-approved application persistence/recovery, the actual accepted sandbox backend receipt, actual YNXT Testnet transaction and credit, authorization/capture/reversal/refund, statement reconciliation and identity isolation on the admitted public release.
- Formal native build/signing/installed lifecycle and formal public release remain with the sole release owner.

No real issuing, PAN/CVV, fiat, real merchant payment, real settlement, AICardAPI or Live integration is introduced. No signature, transaction, ACTIVE card, confirmed top-up, migrated Product Session or complete Testnet journey is claimed by this checkpoint.
