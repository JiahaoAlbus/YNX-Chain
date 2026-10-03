# Quant audit read recovery

Parent checkpoint: 1ecc889dafb33b5f664af857eb11eb9366700312.
Ordinary app and direct tests only; no audit schema/backend/authority changes.

Original defect: null readback became an invented empty-history label; malformed
container/row/hash could throw from slice/Hash.slice and interrupt workspace
rendering. Direct regression initially FAILED on null falsely shown as empty.
Now only an actual empty array shows empty history. Unavailable containers and
invalid rows have separate localized recovery status; valid rows survive beside
bad rows. Display fields require actual strings, a 64-hex source Hash and finite,
calendar-valid RFC3339 CreatedAt. Text is escaped; hash is exposed in full title.
This is source readback, not independent hash-chain/signature verification.

Both empty and unavailable messages support all existing 12 locales. Malformed
rows do not fabricate action/time/hash. Refresh replaces status with the actual
new read; normal research forms remain usable. No action is retried or created.

Tests:
- Business suite 65/65 PASS, 368.065ms, covering malformed containers/rows/hash,
  impossible calendar date, mixed valid rows, 12 locale changes and empty restore.
- Targeted actual Go/local Chrome 3/3 PASS, 4267.13075ms: declared audit readback
  fixture recovers invalid container -> mixed records -> empty, preserves valid
  row and full hash title, escapes object markup, 12 locales, zero non-GET API
  calls, zero pageerrors and one page. Normal actual-service reconcile and kill
  lost-read recovery also pass. No full unchanged suite rerun.
- Browser test initially failed because its request recorder compared the method
  function rather than calling method(); it erroneously counted/aborted a GET
  sso/config read. Diagnostic run identified GET exactly; recorder fixed, final
  targeted run PASS. This fixture failure is not concealed or called a runtime bug.
- JS syntax and diff checks PASS.

All fixtures are local QA, not public/installed/authenticated Wallet evidence.
Fixture hashes/records are explicitly test-only, not generated product audit
success. No Host/shared pins/permissions changed, no real financial operation.
Release owner must integrate ordinary hunks and source-bound asset identity;
do not publish this inherited mixed checkout. Rollback this UI/test delta only;
no database migration or record deletion is needed.
