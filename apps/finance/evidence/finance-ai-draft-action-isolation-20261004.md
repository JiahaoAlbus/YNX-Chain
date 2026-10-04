# Finance AI draft creation/action isolation

Predecessor `93cbfc2906af9e4c0177b75730119ec3854c57d7`, tree `615332bd1394320ad2df789f809d9eb3315374cf`, branch `codex/finance-guoqing-release-20260930`.

## Actual owned changes

The prior polling fence did not cover creation and action callers. Their catch/finally paths could display retired-account errors or unlock the new account's pending create button. Cancel/delete/decision responses could mutate a replacement job even when the API's underlying account response fence rejected old results.

Creation now owns an operation bound to workspace context and Wallet revision. Workspace/Standard identity invalidation retires its UI gate immediately, allowing a new explicit draft request; old completions cannot overwrite the replacement job or release a newer gate. Current failures remain visible and restore the original button. This retirement does not cancel or claim rollback of a server-side job whose outcome is unknown, and does not automatically retry it.

The real `handleAIAction` now captures context, revision and job ID, rejects overlapping actions on the same current job, accepts only registered action names, and fences result/error/finally updates. Decision results must return the same job ID. Delete stops the current poll only after the current authorized delete completes. Cancel/apply/reject and copying a draft retain their prior behavior. Copying still fills a review form only: no order submission or trading permission was added.

## Executed local checks

- `node --test apps/finance/tests/ai-action-isolation.test.mjs apps/finance/tests/ai-poll-isolation.test.mjs apps/finance/tests/statement-export-isolation.test.mjs`: **20/20 PASS**, 53.545 ms. New seven test groups execute the original app function bodies in a Node VM, with matrices for context/revision changes, all cancel/delete/apply/reject late returns, same-account job replacement, old error/new action gate, repeated clicks, response ID mismatch and normal current action behavior.
- `node --test apps/finance/tests/ai-order-intent-browser.test.mjs apps/finance/tests/standard-wallet-flow.test.mjs`: **42/42 PASS**, 16.445 seconds. Existing real local Chrome/controlled DOM/provider/API tests verify current validation, draft-only copy, localization, guest surfaces, standard/private separation and account-response fences.
- `node --check apps/finance/web/app.js`: PASS.
- `node apps/finance/scripts/security-check.mjs`: PASS, 433 text files before this document.
- `git diff --check`: PASS.

These are controlled local engineering proofs, not real Wallet approval/signature/transaction, public runtime, installer or ComputerControl evidence. No shared protocol/source, provider implementation, native build, Host upload/retry, SSH or production service was changed. Historical packages/manifests and UNKNOWN channels remain intact. A must compose only these matching owned deltas with its current exact shared inputs, not replace them with this older entire checkout.

## Still incomplete

Data capacity remained **178 MiB available / 100% full** at this continuation start. No new Go compile/link/package was launched. The prior empty-query/fragment Go regression remains NOT_EXECUTED; full Finance Go race remains blocked by ENOSPC, not PASS. Shared actual operation proof/publishing and source-bound public/installed product lifecycles are still unproven. Do not promote any of those gates from these local results. Report only to `接续测试网生态审计工作`.
