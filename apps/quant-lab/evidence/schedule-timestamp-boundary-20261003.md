# Quant schedule timestamp read boundary

Parent source: `8c1e9a76f84208008eaba3f7e6ad889a7858f367`.
Ordinary Quant page/tests only; no scheduler, protocol, authority or release edits.

Reproduced: enabled `scheduled` readback with `2026-02-30T00:00:00Z`
passed `Date.parse` and was treated as a known runnable schedule. Regression
failed before the fix, returning the Runtime object instead of null.

Both schedule observation and time display now reuse existing `auditTimeValid`.
Missing, non-RFC, year-one zero time and impossible calendar dates are unavailable;
the existing unknown schedule fence disables writes. Valid leap dates and offset
RFC3339 values remain usable and localized. No source value is rewritten and no
new timestamp parser/protocol is introduced.

Verification:

- Business/UI suite: 76/76, 420.302333 ms.
- Real Chrome schedule tests: 3/3, 5510.816667 ms.
- New controlled mobile Chrome case: all twelve locales, reload, raw timestamp
  preservation, disabled invalid schedule, zero writes, zero page errors, one tab.
- Existing confirmed schedule start/stop and uncertain-response recovery pass.
- `node --check apps/quant-lab/web/app.js` and `git diff --check`: pass.

Commands:

```sh
node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs
node --test --test-name-pattern='schedule' apps/quant-lab/tests/browser.test.mjs
```

Browser tests use controlled local source responses, not public acceptance or
real strategy execution. No account, signature, order or chain transaction.
Public source publication remains a separate release-owner dependency; do not
integrate inherited formal pins/Host/shared Wallet files from this checkout.
