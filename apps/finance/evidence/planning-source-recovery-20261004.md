# Finance owned planning recovery

Owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Predecessor: `23dba18510dc986cb3a8b930b8f8be2bb35e16da`.

## Ordinary product changes

Inherited planning rendering directly dereferenced category/budget/reminder arrays and individual rows, and dereferenced every budget-progress row in `find`. Missing lists and malformed rows could abort the page. The correction renders unknown sources as unavailable (not empty histories), isolates unreadable rows, preserves readable neighboring records and restores a still-valid selected category. Broken category records cannot become selectable values. Invalid budget periods and reminder schedules cannot be mislabeled as valid planning records. No new planning product, capital control or backend authority was added.

The existing unknown/zero amount formatter and partial-budget observation rules remain. Reminder frequency now uses the existing weekly/monthly/custom translations instead of displaying raw protocol enums. Protocol values and requests are not translated or changed. Missing date metadata remains unavailable.

## Executed gates

- Actual shipped planning renderer in installed Google Chrome, controlled local DOM: readable neighbors, zero values, null progress entries, retained category selection, missing-source recovery, real empty-list distinctions, refreshed valid choices and one unchanged tab.
- Actual locale module and actual planning renderer in Chrome: twelve selected languages; three frequency labels and unavailable-data message match selected copy; Arabic RTL preserved.
- `node --test apps/finance/tests/planning-source-browser.test.mjs apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-read-controller.test.mjs`: 16/16 PASS, zero skips, 5211.272083 ms (initial planning case plus unchanged save/read isolation regression).
- Final extended browser/locale cohort: `node --test apps/finance/tests/planning-source-browser.test.mjs apps/finance/tests/owned-navigation-browser.test.mjs apps/finance/tests/finance-12-locales.test.mjs`: 7/7 PASS, zero skips, 5882.227333 ms.
- `node --check` on app and new browser test; `git diff --check`: PASS.

## Release boundary

Only ordinary `apps/finance` page, direct tests and evidence changed. Shared Wallet/Auth/SSO/SDK, Finance authority and all Host/release files are untouched. No account requests, signing, transactions or orders. Tests are controlled local rendering/controller evidence, not public deployment, installed-native, provider approval or real owned backend journey proof. Formal coherent-graph integration and release remain with the unique release owner via `接续测试网生态审计工作`; this checkpoint does not mark the long-term goal complete.
