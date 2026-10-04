# Finance statement/export account and operation isolation

Predecessor: `d2fe825d67d7e7c6b2f7c84ef14e93ce71903f0d`, tree `76bf85a55fe98054dca1e4bb18a03e7fd2391577`; branch `codex/finance-guoqing-release-20260930`.

## Owned behavior

The shared account-bound `api` already rejects obsolete account responses. However, the statement submit caller's catch still cleared the currently displayed report and displayed an error after that rejection. The export caller could similarly display obsolete feedback. Report requests within the same account also lacked a latest-operation fence, so an older selected date range could overwrite a newer result or replace it with an error.

The actual app now captures workspace context and Wallet revision at each report/export invocation. Reports additionally bind the latest report operation, check ownership before render/cache/error mutation, and preserve the inclusive end-date-to-next-day UTC boundary. Exports check ownership before creating a blob URL or clicking a download and suppress only retired-operation failures; current failures remain visible. Normal downloads retain the requested filename and URL disposal. No changes to statement completeness rules, totals, scopes, server auth/proofs, shared Wallet implementation or transaction behavior.

## Executed validation

- `node --test apps/finance/tests/statement-export-isolation.test.mjs apps/finance/tests/ai-poll-isolation.test.mjs apps/finance/tests/read-sources-web.test.mjs`: 23/23 PASS before adding the seventh same-account operation regression.
- Final `node --test apps/finance/tests/statement-export-isolation.test.mjs apps/finance/tests/ai-order-intent-browser.test.mjs apps/finance/tests/standard-wallet-flow.test.mjs`: **49/49 PASS**, 16.137 seconds. Seven new original-app-function VM cases cover context/revision changes, retired success/failure, latest-range success/failure, exact UTC request bounds, invalid current statement, export bytes/filename/URL and current failure feedback. Inherited local Chrome tests load the real current DOM and app with controlled account/proof/provider/API fixtures.
- `node --check apps/finance/web/app.js`: PASS.
- `node apps/finance/scripts/security-check.mjs`: PASS, 431 text files before this document.
- `git diff --check`: PASS.

These are local engineering tests, not genuine provider approval, public runtime, transaction, installer or ComputerControl evidence. No SSH, Host upload/retry, account request/signature/transaction with a real wallet, or production mutation occurred. Historical artifacts and UNKNOWN channels are unchanged.

## Integration and resources

A remains the formal shared-input/Host publisher. Inherit only these matching owned deltas onto the current complete candidate; do not replace its stronger shared composition with this older entire checkout. Existing immutable package/manifests were not rewritten. Source-bound public and installed product gates remain unproven.

Fresh Data volume capacity at this continuation start: **183 MiB available, 100% full**. New Go compile/link/package remains disallowed pending resource budget; the preceding empty-delimiter Go source regression is still NOT_EXECUTED and earlier full Finance ENOSPC is not a PASS. No cleanup/deletion was performed. Reports and remaining resource/release gaps go only to `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).
