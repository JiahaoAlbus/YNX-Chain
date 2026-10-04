# Card funding late-response candidate: HOLD

Stable pushed checkpoint remains d1018b3ab3fe940687e801ad95317937280137ac, product source b6f052e13119580f2e5eb50d72a698898981e556.

Uncommitted owner changes only: src/cardFundingSend.ts, src/cardFundingSend.test.ts, src/CardFundingSendExperience.tsx. They add same-request late-hash recovery from UNKNOWN, without resend or ledger credit, plus strict recovery-record fields and current-bound UI update.

Nine focused tests pass, but an additional actual-module synthetic timing test contradicts safety: current becomes false between the final check and deferred provider send; one synthetic send still occurs. No real provider/account/network/signature/transaction was used. This candidate is NOT READY and must NOT be published. No current build/typecheck/public claim is made.

The author identified the regression and asked the human whether to correct it. The next correction is a fresh assertCurrent inside the deferred provider callback, before request, plus a permanent timing regression test. Preserve all existing uncertain records; never resend an already attempted intent. Late RETURNED still means only a provider hash, never Card funding approval.

No Host/alias/shared Wallet/central file was changed. Full Testnet product acceptance remains incomplete.
