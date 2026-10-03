# Finance AI account-context consent retirement

Inherited clean/pushed predecessor: `83dbefcec708ceafa0d0dc9fe9fe12df171fafdf`, tree `b708438318029492bcbb41796b08206df46d3755`.

## Reproduction and minimal correction

The actual product renderer retires owned forms when the displayed account changes. Its AI retirement previously fenced asynchronous completions but retained checked record IDs, consent and the displayed job. `renderAIRecords` deliberately preserves selections across same-account refreshes; when account B happened to expose the same record ID as A, this retained A's selection and consent for B.

The new local actual-Chrome regression failed against the predecessor: `matching record ID is not fresh consent for another account` (true versus false, 1340.066167ms). It uses controlled overview observations and a controlled old draft display, not real Wallet authorization or AI execution.

`retireOwnedAIView` now clears checked records, consent, `state.aiJob`, status content and visible draft actions while retaining the existing operation-generation and timer fences. It does not revoke a Wallet/session, delete server data, request AI work or change shared authority. Same-account refresh and language changes still preserve selected records. A -> B -> A does not restore old consent.

The existing controller regression assumed consent survived an account retirement. Its first full run produced 97 PASS / 1 FAIL; the test now explicitly proves no new request without renewed consent, then supplies fresh controlled consent and retains the original stale-success/stale-error, single-flight and late-button-unlock assertions. The notification stub records `failed`, not translated UI copy.

## Verification

Focused actual-Chrome regression after correction: 1/1 PASS, 1710.380875ms overall.

Final command:

```sh
node --test apps/finance/tests/standard-wallet-flow.test.mjs apps/finance/tests/overview-source-browser.test.mjs apps/finance/tests/owned-save-browser.test.mjs apps/finance/tests/ai-order-intent-browser.test.mjs apps/finance/tests/finance-12-locales.test.mjs apps/finance/tests/owned-ai-controller.test.mjs apps/finance/tests/owned-save-controller.test.mjs apps/finance/tests/owned-navigation-browser.test.mjs apps/finance/tests/planning-source-browser.test.mjs apps/finance/tests/product-response-recovery.test.mjs
```

98/98 PASS, zero failures/skips/cancellations, 26409.658417ms. Product JavaScript/test syntax and `git diff --check` PASS. New Chrome regression asserts zero AI creation requests and zero page errors; no real private keys, account approval, signatures or transactions are exercised. Other existing Wallet tests use controlled providers and remain local checks only.

## Release boundary and continuation

This is an ordinary Finance source/local-controlled-browser checkpoint, not public runtime, installer, canonical Product Session, real account/AI/order/transaction completion. Formal assets/pins/build/deployment remain with A wallet_release_owner. No Shared, Host, Wallet, Exchange, Quant or DEX source changed. Existing public mismatches and Exchange Web write-profile/producer/mount dependencies remain separate open gates; results are routed to the authorized coordinator chat `接续测试网生态审计工作`.

Source rollback is a normal reviewed revert of this checkpoint, without reset/force-push or changing other owners' work. No production rollback action is authorized or required by this local change. Continue the incomplete product goal after this checkpoint.
