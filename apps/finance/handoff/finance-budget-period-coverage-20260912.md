# Finance budget period / coverage correction — local only

Source: `607b912746ae0e6cfd0ce7a54a7848a289f4694b`  
Tree: `dc18f9c180e17e6a5429b21dd72cbb8e3ff4afe2`  
Branch: `codex/finance-wallet-flow-20260912`  
Predecessor: `954bf974f1683247ee9309eb2fd0ffad7cd9d589`

Exact changed-file blobs/bytes/SHA and executable test descriptions are in
`apps/finance/evidence/finance-budget-period-coverage-20260912.json`.
This handoff deliberately binds its predecessor source commit, not itself.

## What is fixed

- Weekly boundaries now start Monday 00:00 UTC, not Monday at the current time
  of day. Monthly boundaries use UTC calendar fields even for a non-UTC caller.
- Budget activation is respected: counting begins at the later of the period
  boundary and stored `startsAt`. Future budgets are explicitly not-started.
- Explorer availability/sync is not a completeness proof. Its current contract
  returns only the latest 100 global transactions, filtered to the account.
  Full weekly/monthly spending and remaining budget therefore stay unknown.
- Web now consumes the actual `budgetProgress` response. It shows observed
  spending, UTC period, activation cutoff and coverage separately from unknown
  full spending/remaining. Missing values no longer become 0/0%.
- Finance native consumer types and rendering make the same distinction; old
  cached responses without coverage cannot display a fabricated percentage.
- Observed sums fail closed for negative amounts, int64 overflow and missing
  timestamps. New budget rendering refuses unsafe browser integer values.

## API / persistence boundary

No stored Budget/AccountState schema, state repository, migration, Wallet SDK,
private proof scope or authentication logic changed.

`/api/overview.budgetProgress[]` retains existing identity/limit/period keys.
`spentYnxt` and `remainingYnxt` now explicitly permit null. New observation
fields are `observedSpentYnxt`, `observedActivityCount`, `calculationStatus`,
`reason`, `coverageComplete=false`, `coverage`, `effectiveFrom`,
`periodTimezone=UTC`. Available bounded records yield `partial`, not complete.
An observed zero says only that no matching amount appeared in returned records.

`/api/monthly-review` similarly returns null full `totals` and
`categorySpendYnxt`; returned-record sums live under `observedTotals` and
`observedCategorySpendYnxt`. Unavailable source sums/count are null.

This is a deliberate nullable wire-semantic correction. Both owner consumers
were updated; any external consumer must accept null before a future release.
No complete-history assumption was invented to preserve a misleading number.

## Verification

- `npm test` in apps/finance: **47/47 PASS**, no skipped tests.
- `npm run security`: PASS, 343 text files at the source checkpoint.
- `go test -race ./internal/productsessionv2 ./internal/finance ./apps/finance/cmd/... -count=1`:
  PASS, 75 passing test events. PostgreSQL integration skipped because no test
  database is configured; cmd/server compiles but has no test files.
- Two accounts, two independent file-store handles, 32 concurrent reads, reopen
  and repeat: isolated category/budget observations and byte-identical persisted
  state. This is not a live PostgreSQL multi-instance claim.
- Exact Web app executes in VM and actual local Chrome. Budget fixture clearly
  labelled local; no provider request is made by the new browser test.
- Native TS/TSX syntax transformed in memory plus nullable/rendering assertions.
  Full native typecheck/build/install not run: native dependencies are absent.
- Existing Standard/Private SDK callback/replay/cold-restore/late-response tests
  remain passing with disposable local fixtures, not public user authorization.

## Remaining gaps / next owner slice

1. Full account-period history requires an accepted Explorer coverage contract;
   these observations cannot calculate an exact remaining/overspent budget.
2. Upstream transaction filtering still compares raw 0x/ynx strings. The alias
   omission is not repaired by a partial-history label and remains separate work.
3. General Web `Number(value||0)`, unsafe form inputs, and existing raw-Web versus
   native /1e6 amount scaling need one explicit atomic-unit contract. This slice
   does not claim monetary precision/denomination closure.
4. Pay receipt `firstInt64` parse failures and float conversion remain unresolved;
   neither Pay product paths nor that parser were modified.
5. Legacy statement sums and broader localization/native release need separate
   work. Monthly review was corrected; statements were not silently promoted.

## Release truth and rollback

Source/local tests only. **No new build archive, SSH, deployment, public version
access, state migration, native installation or financial action.** The earlier
public SDK release evidence remains immutable and does not cover this change.
The prior public /version browser denial was not retried by another channel.

No runtime rollback is needed. Source rollback is an ordinary reviewed revert
of `607b912746ae0e6cfd0ce7a54a7848a289f4694b`, with no reset or force push.
