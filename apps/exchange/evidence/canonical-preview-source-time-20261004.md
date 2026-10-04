# Exchange canonical preview source time

Source checkpoint: 20335d30a55ab6755fdeb443b6b59e9e7a75a7b8.
Tree: 45f407fb2187eabb1b4277ef3412cdcefba13df6.

The standalone read-only order preview previously relied on Date.parse, which normalizes impossible calendar days and accepts locale-dependent or timezone-free input. It now imports the existing public market module's isVenueTimestamp predicate before freshness admission. No second timestamp implementation, Wallet SDK or execution authority was created. Valid timezone offsets and nanosecond RFC3339 attribution remain unchanged; invalid dates fail with the existing localized RULES_STALE code.

Exact application delta for A's compatible composition:

- order-preview.js SHA256 76f29706a7bb6e799f0fef6c9c63e8bf26c228a0c546b1b0136f85ea2fb8f2cb.
- app.js SHA256 01513dac93f88b1f8e6d8e9b43ba561048fad5b4dd661723e05da67eb74f4e40 (only order-preview import version changed).
- index.html SHA256 28ec2df73de729c3500dbb4243257efc587475d780f10fc8143279e7f314c040 (only app.js version changed).
- Existing market-data.js remains SHA256 77e901697a7c3e24fb181a4069d88c20a6c06000d1cf91ba0539e51840be4ec7. The new nested import uses this same hash-bound module.

The previous 45ebcc32 UI archive and manifest remain immutable historical UI inputs; they do not claim to include this business successor. A must bind a new exact composed artifact if adopting this delta, not relabel the historical archive. Shared/generated bundles, private producer contracts, UI layout and Wallet code were not modified.

Validation executed:

- Order-preview arithmetic/source tests: 9 passed, 0 failed/skipped, 54.587417 ms. Negative vectors are Date.parse-valid but calendar/format-invalid; valid offsets and nine-digit fractions preserve source bytes.
- Two targeted actual locale-browser preview/error journeys: 2 passed, 0 failed/skipped, 3506.358166 ms. Exact amounts and localized errors remain unchanged.
- Actual candles/preview/browser suite: final 6 passed, 0 failed/skipped, 9558.17675 ms. Original account-transition fence, observation localization, bounded stalled-read recovery, book ordering, conflicting revision and desktop/mobile trace views passed. Initial 4/6 run exposed two classic-script fixtures missing the new import dependency; adapted to the original predicate, not a permissive stub, before final pass.
- Original Go engine HTTP money-rule cross-runtime comparison: `go test -race ./internal/exchangeproduct -run TestGuestPreviewConsumesActualConfiguredEngineRulesOverHTTP -count=1 -timeout=120s`: PASS, 2.021 seconds, ten exact configured-fee/reservation vectors and unchanged venue state.
- Syntax, diff checks and strict asset verifier: PASS, 4 page assets / 4 module assets. No broad shared-SDK admission rerun was performed.

These are controlled local source/HTTP/browser proofs only. Public source-bound deployment, installed provider approval, private write-scope integration, orders/withdrawals and user acceptance remain unverified. No account request, signature or trade was performed.
