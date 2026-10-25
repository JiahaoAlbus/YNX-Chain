# Resource Market execution bridge, source candidate R1

This candidate follows sponsor checkpoint `a5466bebcf1b298360db1a9bbeb7f57dc745e59a`. That checkpoint's remote CI compiled consensus and passed chain migration tests, but its sponsor restart equality test failed; a separate minimal empty-DEX-slice repair is pending remote verification. This document does not label either candidate as passed or deployed.

`LegacyResourceMarket` retains the exact original delegation, rental and income records from the complete migration runtime, with `SourceAnchor` supplied internally from the migration hash. Original `Accounts` already include delegation stakes, rental payments, provider/treasury income and the resource usage reduction performed by the authoritative producer. The import does not apply those effects a second time.

The source and target records have different evidence. The old source rental API did not persist the quote body or expiry and did not create a signed native transaction, nonce increment, idempotency record or BFT event. The bridge does not fabricate those fields. Original rental queries retain their original `QuoteID`; querying an unavailable original quote returns an explicit absence result. Source income preserves its original `protocol-resource-fee` domain/string, distinct from the target's new `resource-protocol-fee` records. Original policy hashes are retained as historical source claims rather than recomputed under the current policy.

The imported active delegation inventory participates in actual new rental provider selection. A new renter still supplies a genuine current signed Action, nonce, request hash, bounded maximum price and a reproducible new quote with a valid block-time expiry. New settlement, fee, quote, income and event records are native target records. Original stake and resource usage continue to drive `/resources/<account>` capacity. Existing delegation, rental and income queries and analytics include the original records with explicit source anchors. `/resource/market-source` exposes the typed immutable source segment.

Import validation requires exact source equality, existing account identities, bounded positive settlements, active delegation amounts covered by preserved stake, matching original income recipients and policy metadata, exact rental-to-income sums, no new record shadowing an original ID and bounded combined analytics. It does not reinterpret source aliases as new signed principals. Active PQ signers are still rejected at the common classic Action gate; no PQ resource Action wire is claimed here.

A source/target interaction needed an explicit rule: old `RentResources` reduced the same `ResourceUsage` counters used to reserve sponsor pool allowances. It could therefore erase a still-live reservation. A source checkpoint with remaining sponsor allowance greater than its owner's usage already fails the sponsor adapter's accounting check. New target rentals now replenish only usage above the outstanding sponsor reservation floor; they cannot silently repair or erase an inconsistent reservation. Other source rental semantics and the existing signed target fee remain intact. This rule changes the unsafe cross-module behavior and needs explicit cutover acceptance.

The integration test source builds a real persistent source sponsor, delegation and rental, exports after block/persistence boundaries, imports without recharging source effects, uses the original delegation to admit an actual new signed rental, verifies original plus new settlement/analytics, preserves sponsor reservations and restarts target state. Separate tests assert reservation underflow fails without partial mutation. No Go compilation or tests were run by this subagent for this candidate.

Suggested parent-owned verification:

```sh
go test ./internal/consensus -run '^(TestMigratedResourceMarket|TestResourceRentalPreservesSponsorReservation|TestMigratedSponsor|TestResourceSponsor|TestResourceActions)' -count=1
go test ./internal/consensus -count=1
```

Pay, AI, Trust/governance and original contracts remain explicit execution blockers. Missing bytecode or authority is not supplied by this Resource Market adapter. Public HTTP routing and live migration remain separate gates.
