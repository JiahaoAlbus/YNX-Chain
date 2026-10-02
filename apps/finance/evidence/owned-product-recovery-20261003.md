# Finance owned-business recovery — 2026-10-03

Status: **SOURCE_TESTED; not public, installed, or user accepted.**

Coordination recipient: `接续测试网生态审计工作`, thread
`01a094cc-0ba3-7901-bcd5-56fce8330c0d`. Shared Wallet/Auth/SDK/authority,
compatible final builds, Host changes and publication remain with
`wallet_release_owner`. This is not a deployment authorization.

## Exact product sources

Branch: `codex/exchange-sso-cookie-binding-20261002`. Apply only the reviewed
Finance deltas to a compatible release source; do not take unrelated ancestor
history or overwrite shared files.

| Commit | Owned change |
| --- | --- |
| `542075ed54005a2e90ebd30bfa0de861f5c44e66` | Inherit approved Web513 product surface; no authority restoration or replacement. |
| `f3f5cb52781cc60badeefb5259ee0d0d52d6c34f` | One pending save intent, original retry key/body/time after unknown response, account-bound drafts. |
| `def17c307b5ef4531aab48833cb9dbdffeeac1e1` | Account/operation fences for save, statements and exports; actual disabled baseline and edited privacy values retained. |
| `97c12ef907a18dc0213cc531132ece18e17c7e53` | Normal owned privacy-save and refresh journey through isolated NodeHost and Finance Go. |
| `7473632a15b4d541a67d3e966fc26361d1e68b76` | Canonical reminder option values across all 12 locales; normal reminder and owned JSON download validation. |

The final Finance source checkpoint above has tree
`0c5215e1279682000fff12fb2b725b34765d4019`.
Its `web/app.js` Git blob is `0e4ebed814ddf78d523693ddf291f338c23df221`,
`web/index.html` blob is `6a2fbd32829b970d43c83cb8d6f79c895f6b3d60`, and
`tests/local-product-session-cross-service.test.mjs` blob is
`72541e5e3f5fa3b1891a16dee3493815744593ac`.

## Executed evidence and limits

- `go test -race ./internal/finance -count=1`: PASS, 13.200 seconds.
- Direct save/read controller and actual Chromium form cases: 14 passed.
  These cover single-flight saves, response-loss retry, account switching,
  late statements/exports, draft preservation and privacy PUT semantics.
- `node --test apps/finance/tests/owned-save-browser.test.mjs`: 4 passed.
  Canonical monthly/weekly/custom values stay unchanged under 12 locale labels.
- `node --test --test-name-pattern='local QA selected-login reaches' apps/finance/tests/local-product-session-cross-service.test.mjs`:
  1 passed, 16.654 seconds in the final reminder/export run. Normal browser
  actions created category, budget and reminder, saved privacy, read back the
  profile after refresh and downloaded the owned JSON export. The export's
  incomplete coverage remained explicitly false, not fabricated completeness.
- Selected-login rejected and revoke/rebegin variants: 2 passed. Rejection did
  not disconnect Standard Wallet; unconfirmed revoke remained retry-required.

These tests use isolated accounts/Wallet callbacks and a local real NodeHost/Go
boundary. They are **not real public Wallet approval, an installed app test,
production data, or MONSTER acceptance**. No user key, account approval,
signature or transaction was requested by this recovery work.

## Exact outstanding integration requirements

1. Supply one compatible shared dependency closure for inherited Web513:
   `browserIdentityMatchesSelected`, the matched wallet/private entry points,
   hosted adapter, Pair SDK and the accepted endpoint-authority/trust roots.
   Current local c6 dependency composition reproducibly throws
   `browserIdentityMatchesSelected is not a function` after local central SSO
   account read. This is a **local composition failure**, not evidence of the
   public site's root cause. Do not insert a permissive fallback or change
   scopes/origins to pass it.
2. Complete the already reported public config/history 503 diagnosis with the
   shared owner. Source diagnostics alone do not establish public recovery.
3. Build an internally consistent asset/cache graph and backend/source binding,
   preserve the active release and data for rollback, then publish under the
   shared owner's authority. No new installer or release was generated here.
4. After the actual release, repeat the normal user journey: identity return,
   explicit private approval/rejection, owned records/save/reload/export,
   account switch/logout and cold/warm recovery. Public, installed, Relay and
   user-acceptance gates must be recorded separately. MONSTER remains NOT_RUN.

Database/schema migration: none in these product changes. No shared protocol,
Wallet, Calendar, DEX, Card, Pay, Host or production files were changed.
