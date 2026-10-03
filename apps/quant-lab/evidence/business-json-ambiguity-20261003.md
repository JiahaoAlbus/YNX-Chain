# Quant business JSON ambiguity boundary

Owner predecessor: `cbb5e6dbf31bf5b258e5bb9498ba7a8a8229b56c`.
Only owned Quant HTTP business request decoding and direct tests changed.

## Reproduced before the fix

`go test ./internal/quantlab -run 'TestBusinessJSON|TestAmbiguousReconciliationHTTP' -count=1`
failed. Duplicate, case-alias, escaped and Unicode simple-fold keys plus nested
object/array aliases were accepted. An actual isolated HTTP POST containing
`{"Cash":0,"cash":1,"Position":0}` returned 200 with a reconciliation delta
of 99,999,999,999 and KillSwitch=true, instead of rejecting the ambiguous input.
The disposable Paper service had no real account, Wallet, or capital execution.

## Implemented boundary

- Read the existing 8 MiB-limited request body and reject ambiguity before typed decoding.
- Scan decoded field names recursively with the existing Quant canonical Unicode
  simple-fold key function, separate seen sets per object and depth limit 128.
- Preserve typed unknown-field rejection and the single JSON value requirement.
- Keep research's existing duplicate/null-specific `invalid_research_parameters`
  contract via its existing stricter scanner; no persisted records or engine changed.
- Errors do not echo submitted fields or values.

Actual isolated HTTP regression now proves ambiguous reconciliation returns 400
`invalid_json`, leaves cash/position/delta/kill state unchanged, and a subsequent
unambiguous exact reconciliation succeeds with no kill activation.

## Verification

`go test -race ./internal/quantlab -count=1`: PASS, 3.119s final run.
Includes ambiguity, valid distinct array objects, unknown/trailing/malformed
input, excessive depth, body limit and existing research/scheduler/Paper/service
regressions. Optional external PostgreSQL cases are not claimed as executed by
this command without their explicit environment.

`gofmt` and `git diff --check`: PASS.

Source/runtime distinction: no shared authority, permission, SDK, Host, formal
artifact or deployment mutation. This is a source/business test correction;
public source-bound runtime and real Wallet/capital/native acceptance are not
proved by this local suite. Release integration remains with the unique release
owner. Full Financial goal remains incomplete.
