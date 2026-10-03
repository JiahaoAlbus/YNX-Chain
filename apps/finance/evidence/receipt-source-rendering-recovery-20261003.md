# Finance receipt/support source recovery

Inherited owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Predecessor: `128ced2378dd8f6a36ef5a2a5ad0e054c5cc1c5c`.

## Reproduced defect and ordinary-page correction

The actual shipped receipt renderer threw `TypeError: Cannot read properties of null (reading 'available')` in installed Google Chrome under a controlled local page when source status was null. Missing support objects and malformed individual receipt rows could also abort rendering.

Only Finance ordinary rendering and its direct browser test changed. Receipt availability now requires literal boolean true and an array of records. Unreadable sources are unavailable, not an empty verified history. Malformed individual rows render unavailable without hiding valid neighboring records; usable records require their existing contract's nonempty string id. Incorrectly typed status/hash/date fields cannot produce object text or crash short/date helpers. The existing actual amount formatter preserves valid zero while reporting missing, negative, string or unsafe-integer amounts as unknown. Null, primitive and array support values produce three unavailable cards. Existing strict HTTPS navigation policy remains unchanged.

No authority, Wallet/Auth/SDK, Host, deployment, installer, DEX or Pay changes. No account requests, signatures, orders or capital execution.

## Executed evidence

- Before fix: actual browser regression failed on null source status; pre-existing navigation test passed.
- After fix: `node --test apps/finance/tests/owned-navigation-browser.test.mjs apps/finance/tests/owned-read-controller.test.mjs`: 8/8 PASS, zero skips. Covers navigation, malformed sources, valid-neighbor preservation, workspace/read races, account switching, sign-out and export isolation.
- Extended malformed-field cohort: `node --test apps/finance/tests/owned-navigation-browser.test.mjs`: 2/2 PASS, zero skips, 2459.112208 ms. Tests source truth types, malformed lists/rows, valid zero, missing/unsafe amounts, incorrectly typed metadata and absent support.
- `node --check apps/finance/web/app.js` and `git diff --check`: PASS.
- Save/AI-controller and 12-locale regression: `node --test apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-ai-controller.test.mjs apps/finance/tests/finance-12-locales.test.mjs`: 18/18 PASS, zero skips, 507.199042 ms.

These are source and controlled local Chrome rendering proofs only. Public runtime binding, installed-native behavior, real provider approval/callback, Product Session lifecycle and user acceptance remain NOT_VERIFIED here. Formal integration/publication remains with the unique release owner through `接续测试网生态审计工作`.
