# Finance cancellation display recovery

Baseline: `fa7339b18d399c32c22e22007ce91a18880b7846`, branch `codex/exchange-sso-cookie-binding-20261002`. Changes are limited to ordinary Finance display and its direct tests; shared permission/Wallet/SDK, Finance authority/service, Host, release and data are unchanged.

## Service-shaped failure

`internal/finance/broker_order_types.go` defines cancellation intent/attempt timestamps as Go `time.Time` with `omitempty`; a zero struct timestamp serializes as `0001-01-01T00:00:00Z`, not absent/null. The existing cancellation service in `broker_dispatch.go` uses `IsZero()` to distinguish a missing attempt. The ordinary page instead used JavaScript truthiness. As a result, a provider submitted/partially-filled record with the actual zero-time wire value hid its cancellation-request button, incorrectly treating the record as already attempted.

The existing real-Chrome cancellation recovery fixture previously supplied null timestamps and missed this. Supplying the exact Go zero-time value made the pre-fix browser regression fail: timeout waiting for the cancellation button. The fixture now retains that wire shape through the initial and legacy-unresolved states.

## Minimal ordinary correction

`brokerCancellationRecorded()` recognizes only the exact Go zero sentinel and legacy undefined/null/empty absence as no record. Every other value, including malformed strings, false, zero numbers and objects, remains fenced as recorded rather than enabling repeated cancellation on ambiguous data. Intent and attempt display use this same distinction. No timestamp is rewritten and no new cancellation/provider authorization or execution is implemented.

## Executed evidence

- Direct ownership/display tests: 11/11 PASS, 1061.715291 ms. Includes unknown-value fences plus account/revision/readback recovery.
- Targeted real Chrome cancellation recovery: 1/1 PASS, 2171.019625 ms. The shipped page talks only to declared isolated HTTP/Wallet fixtures. Initial partial fill with zero attempt exposes the request; after the controlled request is recorded it disappears; reload shows queued intent, not provider success; a subsequent nonzero attempt plus partial fill remains blocked and displays no-resend text in English/Chinese; unresolved zero intent shows legacy-unknown text without retry.
- Full production-page Chrome regression run on final bytes: 26/26 PASS, 15369.095458 ms.
- JavaScript syntax for app and both changed test files, plus whitespace/diff checks: PASS.

These are local controlled browser flows, not public authenticated cancellation, Wallet approval, provider DELETE or chain transactions. The isolated fixture accepts a test dialog and intercepts the request; no actual trading action occurred. Public deployment and installed runtimes for this fix remain NOT VERIFIED.

## Integration/rollback

Only ordinary app.js display hunks and direct tests should be brought into A's current coherent graph; never replace the inherited entire checkout or silently change formal pins. Rollback is a normal successor revert of this display-only fix; no storage, server state, migration or production mutation needs reversal. Previously reported public source mismatch and the baseline Wallet source-marker test failure remain separate unresolved integration gates.
