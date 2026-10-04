# Card exact paired candidate, 2026-10-04

Product source: `29321821027b263c981efe21b327d0b35b710461`.
Source tree: `715a0a735247e7b7fd89b2da6224ac335b5bc6c9`.
Branch: `codex/card-test-service-recovery-20261002`.

## Evidence and current outcome

- New envelope/source-freeze tests: 11/11 pass after correcting the fixture count from six to five.
- Runtime pairing tests from this source batch: 10/10 pass; frontend/server typecheck passed.
- Web build completed from isolated exact source using `--pair-current-source`; frontend, source tree and requested backend commit are compiled/published as the same exact checkpoint.
- Nested envelope creation FAILED_CLOSED with `CARD_ENVELOPE_IDENTITY_INVALID`. The new checker requires nested `cardApiCompatibility.productionRealPayments`, but the actual existing builder places `productionRealPayments:false` at the runtime root. This owner-introduced mismatch is not an external sandbox or Central input blocker. Do not deploy this incomplete envelope. Correction awaits the requested user decision; failed logs are preserved.
- Backend main static bundle succeeded from the same source; exact receipt is `../evidence/20261003-testnet-operations/paired-backend-candidate-293218210-20261004.json`.
- Backend bundle: 281838 bytes; SHA256 `270cc7bb1a68e32861e7fe38db524935471af3035542863b377938a1a57ccd8c`; 20 source inputs / 15 external imports. Source commit is a compiled constant. External dependencies remain external; this is not a standalone server or deployed runtime claim.

Temporary candidate root: `/private/tmp/ynx-card-paired-candidate-20261004.0FYT51` (owner-only mode 0700). Web output, backend bundle/metafile, build logs and exact source remain there. No original worktree output, user data, keys, DB or unknown journal was removed.

## Unproven gates

No deployment or alias mutation in this batch. No new public-source readback, installed-wallet approval, signature, YNXT transaction, funding receipt, real private-service acceptance or full payment lifecycle proof. Backend was not started; SDK was not executed. Genuine current producer and formal host remain unsupplied. `publicRuntimeVerified`, `realWalletApproval`, `realYNXTTopup`, `realPrivateApproval`, `realCardApiReadback`, `productsConnected`, `migratedV2`, `ComputerControl` and `productionRealPayments` remain false.

Testnet card ledger and simulated merchant processing are the current product environment, not real payment-card issuance or an external processor sandbox. No PAN/CVV, fiat or real merchant settlement is enabled. The complete original Testnet end-to-end goal remains open.
