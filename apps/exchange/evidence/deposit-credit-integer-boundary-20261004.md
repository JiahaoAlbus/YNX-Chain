# Exchange deposit ledger integer boundary

Owner predecessor d7d7f7d8c96ecabf556f56a1054f5ffbd4edd215. Isolated controlled engine state only; no real capital, issued test balance, user key, account approval, remote indexer, chain or public service change.

Unmodified-engine RED: `go test ./internal/exchangeproduct -run TestDepositCreditOverflow -count=1` FAIL 0.399s. Both direct confirmed observation and later confirmation accepted an additional micro-unit at AvailableMicro=MaxInt64 with nil error, rather than refusing unsafe ledger arithmetic.

Fix validates positive incoming amount and nonnegative existing available/reserved values, and bounds their combined total before the credit. Observe checks before ID/intent/audit/ledger publication; Refresh checks under the transition lock before confirmation mutation. Existing exact-hash/actor/once-only checks remain. Unsafe credit returns ErrConflict, leaves the intent/pending deposit eligible for explicit later reconciliation and does not silently rewrite existing balances.

Actual observe and refresh regressions assert unchanged in-memory state digest, ID sequence, deposit/intent/ledger and durable file bytes on rejection. Ten boundary vectors cover exact maximum, reserved totals, overflow, negative ledger values, zero/negative incoming amounts. This is six-decimal int64 representation safety, not an on-chain supply attestation.

GREEN: relevant deposit confirmation/hash/overflow tests `-race -count=3` PASS 1.904s; full `go test ./internal/exchangeproduct/... ./apps/exchange/server -count=1` PASS 5.912s / 0.463s; gofmt/diff PASS. Existing published historical balances are not edited; any historical unsafe values need a separately authorized reconciliation. This is source/isolated-test evidence, not public custody execution or product completion. Prior packages require a new binary to carry this correction.
