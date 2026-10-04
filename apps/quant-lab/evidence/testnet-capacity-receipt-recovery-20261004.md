# Quant exact Testnet receipt recovery at capacity

Source: ff7be96f565d95186c2884ce1269bd776408d7c8.
Tree: 02f0bff33518ca870005b784a58a69c587a44844.

Previously the existing-idempotency lookup occurred after new-order frequency and projected-position admission. An already committed order at full position or frequency capacity could reject an exact recovery because its amount was counted twice. A missing receipt behind an existing index could also fall through to fresh reservation.

The exact lookup now occurs after the unchanged kill, mandate existence/revocation/expiry and current risk-observation gates, but before new-order position/frequency accounting. Recovery requires the same request digest plus exactly one stored order with the same mandate, side, price, amount and trimmed Wallet signature. A changed or duplicate record returns conflict; missing or nonterminal reservations remain unavailable and never trigger another Broker submission. All fresh orders retain full position/frequency limits and the preceding exact-arithmetic repair. No shared authorization or adapter protocol was replaced.

Actual persisted-engine regression commits a controlled order at both caps, then reads its exact receipt through the original and a reopened service. It checks receipt byte-equivalent hash, unchanged audit/state and exactly one total controlled Broker call. New-key over-cap execution, changed side/signature and stale observation reject. Pending, missing, duplicated or mismatched stored receipts fail closed without Broker calls or mutation. Kill on one instance is observed by the second and still rejects replay.

Executed:

- `go test -race ./internal/quantlab -run 'TestTestnetExactReceiptRecoveryAtCapacityAcrossRestart|TestUnknownOutcomeReservationPreventsDuplicateVenueSubmission' -count=10`: PASS, 1.839 seconds; includes existing concurrent pending-reservation exclusion.
- `go test -race ./internal/quantlab -count=1 -timeout=180s`: PASS, 4.980 seconds.
- gofmt and diff checks: PASS. An initial compile-only fixture failure used a nonexistent Kill method; corrected to the original `Kill` API before execution.

No opt-in PostgreSQL URL was configured; no new SQL acceptance claimed. Controlled signatures, session and Broker are test inputs only. No public/installed release, real account approval, signing or Testnet venue execution occurred. This improves service-side recovery only; browser reload persistence and full canonical native execution integration remain unfinished separate gates. A-owned formal release composition must carry the exact engine source and independently verify the authorized public user journey.
