# Finance saved outcome and statement-period recovery

Predecessor: `b419147324212e052b7d0836305ce2df9648c8c4`.
Owner branch: `codex/exchange-sso-cookie-binding-20261002`.
Scope: ordinary product UI and its direct tests only; no Finance authority.

Two reproduced user-journey defects:

1. A statement receipt `from=2026-02-30T00:00:00Z` was accepted for a selected
   March 2 period because JavaScript Date.parse normalizes the impossible date.
   The new regression failed before the fix (48.666 ms), showing the invalid
   receipt had reached the renderer. Both response boundaries now require the
   existing strict Finance calendar/RFC3339 validator before instant equality.
   Missing timezone/date-only aliases reject; legitimate leap dates and offset
   representations of the requested UTC instant remain accepted.
2. A matching persisted save receipt was downgraded to `ownedSaveUnconfirmed`
   if the subsequent fresh overview read threw. The new regression failed
   before the fix (54.399 ms). The follow-up read now has its own error outcome:
   confirmed save status stays confirmed, read failure is still reported,
   ownership fences remain, and no automatic write replay occurs.

Installed Chrome directly executed the product form/controller/statement
renderer with controlled local completion fixtures. It proved invalid statement
refusal, explicit GET recovery and leap/offset receipt acceptance, with partial
coverage remaining false. A separate browser journey proved one category write
completion, one failed follow-up read, retained saved status through all twelve
locales, no duplicate POST, no extra tabs/page errors.

The first new statement browser harness failed (calls undefined, 1255.782 ms)
because its helper slice boundary was wrong; corrected the test-only boundary
to the actual helper block. No production behavior was relaxed to pass it.

Final concentrated verification:

`node --test apps/finance/tests/owned-read-controller.test.mjs apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-save-browser.test.mjs apps/finance/tests/overview-source-browser.test.mjs apps/finance/tests/product-response-recovery.test.mjs apps/finance/tests/planning-source-browser.test.mjs`

**49/49 passed**, zero failures/skips, 41726.965 ms. Includes four existing
save types, exact uncertain retry intent, identity retirement, privacy edits,
planning/read sources, statements, exports, strict streamed product JSON,
timeouts and recovery. `node --check apps/finance/web/app.js` and
`git diff --check` passed.

Truth: local source/browser fixture evidence only. No shared Wallet/SDK or
permissions, formal build/hash pins, Host, install, production or public route
changed. Real Wallet approval/signature, source-bound public publication,
Product Session lifecycle, ComputerControl and complete financial service
acceptance remain unproven. Formal integration/publication belongs to A.
