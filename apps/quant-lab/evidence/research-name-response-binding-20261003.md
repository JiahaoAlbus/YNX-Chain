# Research response name binding

Owner predecessor 2ab93cd23ad2278f940868ec5f95e30332f621ee/tree eccaa58c7d35bdc5a5c7116a50ab438eb05783a2. Ordinary Quant UI/tests, no shared protocol, service authority or deployment changes.

The existing response fence bound strategy ID/family/seed/parameters and assumptions but not strategy Name. A response with the correct ID/parameters and a different name could replace the latest result and clear a saved pending intent. The service's normalizeResearchParameters validates name but does not trim/rewrite it. The client now requires exact submitted name equality, preserving whitespace rather than normalizing either side. Market-derived Source is intentionally not compared to the client draft's source: the existing engine replaces it with authoritative market-history provenance.

Executed gates:

- Business/UI 83/83 PASS, 524.689417ms. New explicit-ID raw mismatch fixture returns 999 bps with a different name: prior 120 bps remains, pending saved intent remains, explicit corrected response reuses identical body/key and then clears pending. A name containing leading/trailing spaces is retained exactly.
- Actual Chrome research suite 9/9 PASS, 11609.962458ms. Existing mismatch test adds a fourth response with name mismatch, proves previous 120 bps unchanged and pending intent retained. Other cases retain all-language fields, precise cost validation, malformed-history recovery, schedules, delayed request coalescing, denied storage, temporary-public provenance across mode transition/refresh/reload and account-panel guest visibility.
- `go test -race ./internal/quantlab -run 'Research|Backtest' -count=1`: PASS, package 1.899s. No external PostgreSQL execution is claimed by this command.
- Node app/business/browser syntax and git diff checks PASS.

Fixture corrections: ID-less VM responses are explicitly response templates, now binding their nonblank name to submitted name as already done for ID; explicit IDs/names and malformed names stay raw. The direct ID comparison fixture now includes its complete name. One actual Chrome positive public-provenance fixture originally returned an unsubmitted hard-coded name and timed out under the new guard; it now explicitly submits that exact fixture name before its delayed request. The negative browser response remains inconsistent by design, so the real DOM guard is independently exercised rather than masked by VM template binding.

All browser/server evidence is isolated local test execution, not public release, real account approval, signature, native installation or capital/Testnet order proof. No wallet account/signature/transaction was requested. Formal coherent release integration remains with the designated release owner; consume only ordinary hunks from this owner checkpoint.
