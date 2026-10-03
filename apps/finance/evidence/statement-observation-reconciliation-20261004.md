# Observed statement reconciliation and readable period

Base df1317e473db28521eca949174e27d0bf8c28a99. Finance-owned statement presentation/controller and direct tests only. No Finance authority, shared Wallet/Auth, producer, scope, persisted data, export format, formal artifact or Host change.

Controlled actual Chrome red test returned zero activity records but `observedTotals.incomingYnxt=1`; the old normal statement controller displayed “observed income 1 YNXT / returned records 0” (995.634875ms case; 1205.551625ms runner). Schema, owner and dates alone did not prove the supplied partial arithmetic consistent.

Before accepting a partial observation into the normal statement view, the controller now checks safe nonnegative integer amounts/fees/totals, incoming/outgoing direction, valid absolute record timestamps and membership in the exact selected half-open period. BigInt accumulation compares returned records against each supplied observed total without unsafe intermediate arithmetic. Contradictory data fails into the existing localized unavailable/explicit-read recovery path; it is not repaired, fabricated, POSTed or promoted to a full-period total. Unknown/unavailable observations remain unknown; historical profiles and records are not changed.

The inclusive displayed end instant previously passed a Date object into the strict absolute-timestamp formatter, which intentionally accepts only valid strings. This produced “date unavailable” even for a valid selected period. Converting that computed end instant to ISO fixes presentation without changing requested UTC bounds.

Executed:

- Actual controller rejects foreign owner, wrong period, empty-record/nonzero total contradiction, unsafe total, invalid calendar date, invalid direction, exclusive-end record, negative/string amount and negative fee. Correct incoming/outgoing records and timezone-equivalent boundary recover their exact observed sums; records themselves remain unchanged and full totals remain unknown.
- Seven-group owned Finance response/read/save/AI/overview browser regression: 53/53 PASS, 42511.790166ms. No protected/shared authority tests changed.
- Final actual Chrome mobile-sized statement workflow across all 12 existing locales: contradictory total becomes localized unavailable, explicit verified retry restores partial view, inclusive-end date is available, full-period totals stay unknown, 27 controlled GET completions / one tab / zero page errors. Focused PASS, 1357.076125ms case / 1632.711208ms runner (added after the complete group run; production code unchanged).
- Node syntax and diff checks PASS. Existing controlled-read recovery regression also PASS immediately after correction, 900.567625ms.

These are controlled local browser responses through existing owner code, not public ledger/source validation, canonical Wallet approval, native install or public release evidence. Source/public/native/user gates remain separate and incomplete. A must consume the compatible owned Finance source graph and update real runtime/assets through its existing release authority; this owner did not mutate deployments, shared protocols or permissions.
