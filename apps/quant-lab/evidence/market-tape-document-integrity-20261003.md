# Quant market tape document integrity

Predecessor `8780974bc2fe41edea337b86aa9811c5bd32f0b8`, branch `codex/exchange-sso-cookie-binding-20261002`. Only the existing Quant market adapter and direct tests/evidence changed. No shared authority, formal release graph, permissions, endpoint, execution or capital capability changed.

## Actual pre-fix failure

Seven actual local HTTP responses were accepted and produced a persisted saved research result: a second JSON document, trailing garbage, valid JSON prefix followed by more than 4 MiB of padding, omitted externalPrice, null externalPrice, duplicate externalPrice with contradictory values, and case-folded duplicate ExternalPrice. The original decoder consumed one JSON prefix and its LimitReader did not prove the complete response fit the byte ceiling. Default false for a missing/null bool also weakened the source boundary. All seven failed the initial no-persistence regression; that failure is preserved here rather than relabelled as a fixture defect.

## Correction

- Read at most 4 MiB plus one byte, reject read failures and over-limit responses before accepting any document.
- Require exactly one complete JSON document and end-of-input after optional whitespace.
- Reject duplicate keys including case-folded variants, at root and nested objects, and bound nested scanning to 64 levels.
- Require a present root externalPrice value explicitly false; missing/null/true cannot default to a safe source classification.
- Keep the original configured URL, owned-source marker, consumed trade values, sorting/bar conversion and compatible unique additive audit fields. Unknown unique audit fields (including optional null values) remain allowed.

This validates document completeness and ambiguity only. It does not create a cryptographic signature, certify every supplied audit field, prove public matching or establish source freshness. Controlled fixture tape is not production trading evidence.

## Executed tests

Focused document/provenance/actual HTTP cancellation race regression: PASS, 1.589 s before adding the final positive compatibility case.

Final `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1`: PASS, 2.944 s / 1.349 s. `go vet ./internal/quantlab ./apps/quant-lab/server`: PASS. `git diff --check`: PASS.

Final tests cover eight invalid local HTTP documents (the original seven plus a case-folded duplicate consumed trade amount), each unable to alter the existing durable research state. Positive complete tape with whitespace and unique additive audit metadata retains original row count, source URL, exact price/volume/time. Excessive nesting rejects. Existing cancellation/receipt replay/concurrency and provenance fixtures remain in the complete regression. Optional PostgreSQL tests still require the separate disposable QA URL; package success does not certify skipped DB tests.

## Release handoff

The unique release owner should consume this with the earlier saved-research replay/cancellation changes and exact current market adapter, then build and prove the coherent public runtime. No migration is needed. No public deployment, installed app, Wallet approval, private Product Session or transaction acceptance is claimed here. Route only to `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`). No public rollback is needed for this source-only checkpoint; retain the previously signed complete release until integration passes.
