# Confirmed owned save reads a post-save overview

Predecessor 8e17f4aec42e4bfc4a9210fdab3482e836b74479. Ordinary Finance business view only. No shared Auth/SDK, authority, Host, financial execution, Wallet/account request or public mutation.

Previously `submitForm` awaited `load()` after an exact confirmed save. If an overview GET was already running before that save, load's same-context coalescing returned the old promise: the saved record could be absent in the view, or a delayed old error could clear the newly saved workspace. The fail-first test found only one GET where a fresh second GET was required.

Normal refreshes still coalesce. Confirmed category/budget/reminder/privacy saves explicitly call `load({fresh:true})`. Each new owned overview read captures a monotonic read revision and the existing account context. Retired success/error results cannot render, mark data unavailable or trigger the old permission-failure handling. Old finally blocks cannot retire newer load operations. This does not suppress a failure of the current read and does not change server permissions or write receipts.

Direct shipped-controller test checks both stale success and stale 401. Actual Chrome executes the shipped save and load controllers against isolated controlled API completions: start old GET, submit actual category form, return exact write receipt, read new GET, then deliver old GET. One write remains, category draft resets only after confirmed receipt, fresh categories remain displayed, no stale sign-out occurs. This is controlled browser evidence, not public identity/session proof.

Focused real-Chrome regression PASS (1/1, 1992.966917 ms). `go test -race ./internal/finance` PASS (15.256s); JS syntax/diff PASS. Concentrated suite `node --test apps/finance/tests/owned-read-controller.test.mjs apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-save-browser.test.mjs apps/finance/tests/owned-ai-controller.test.mjs` PASS 29/29, zero skip, 53106.244917 ms. The existing actual-export browser test took 46973 ms, but completed without failure; no timeout or fast-run claim is made.

Public source binding, real private account approval, installed release and user acceptance remain unverified. The unique release owner must integrate this ordinary delta with the accepted final graph/pins; frozen predecessor build-input inventories are not silently promoted to this successor. Report outstanding issues only to 接续测试网生态审计工作.
