# Exchange owned-record time recovery

Parent source: 8bc1e392dd6f116ab2d473d102a8afd80f54740e.
Ordinary record rendering/tests only; account authority/SDK/API contract unchanged.

Reproduced in real local Chrome using the actual product renderer: a record at
09:00+09:00 (00:00 UTC) incorrectly sorted ahead of a later 01:00Z record because
createdAt strings were compared. Initial regression FAILED with offset-earlier
first. Open-order sorting also called missing createdAt.localeCompare, although
existing account read validation admits legacy missing dates.

Fix: shared product-only RFC3339/calendar/finite timestamp reader; sort by actual
instant with deterministic ID tie-break, unknown dates last. Preserve rows with
unknown dates but display —; reject numeric-looking, missing and impossible
calendar values rather than normalize them to a fabricated time. Open orders
and all owned activity tables use the same functions. Dates follow the actual
selected document language instead of the machine default. Source records are
not mutated; no account permission, status or amount is inferred from date.

Tests:
- Actual renderer/browser timestamp + existing owned activity: 2/2 PASS,
  1980.181625ms, including missing/numeric/impossible dates, UTC offsets, all 12
  date locales, exact source JSON preservation and no pageerrors.
- Related locale renderer tests initially 1 PASS/1 FAIL: old assertion required
  date text unchanged across language changes. Corrected to verify localized
  date plus unchanged identifiers/financial values/raw reason code separately.
  Final 2/2 PASS, 5197.794125ms, preserving unknown/reviewed venue statuses.
- Owned-record integrity/controller tests 6/6 PASS, 66.32525ms; malformed reads,
  account isolation, Standard Wallet independence and read recovery preserved.
- JS syntax and diff checks PASS.

Controlled account inputs/isolated Chrome with network aborted: not actual
private approval, authenticated public history, installed product or orders.
No write buttons invoked. No trading data seeded in product runtime. Formal
source/pin/publication remains release-owner work; integrate ordinary hunks, not
the inherited checkout wholesale. Rollback this isolated renderer/test delta;
no DB migration or user-record deletion.
