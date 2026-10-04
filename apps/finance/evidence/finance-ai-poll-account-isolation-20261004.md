# Finance AI polling account/job isolation

Owned predecessor: `9ecaf626e07cd3e25efd575ea6c90b7ce542a030`, tree `8060ec8701334643076bc55cd9188b217c5eb54a`, branch `codex/finance-guoqing-release-20260930`.

## Observed defect and correction

The original `pollAI` caught an older account's rejected response by clearing `state.aiTimer`, which could already belong to a new account/job, and displayed the obsolete error. Within an unchanged wallet context, a replaced job could also be overwritten by a late earlier-job response. Its asynchronous interval allowed overlapping GETs.

The actual app function now captures wallet revision, workspace context, job ID and its own interval; validates ownership before and after the await; clears only its own interval; suppresses retired-operation feedback; accepts only the same returned job ID; and permits at most one outstanding read per interval. Cancelled/deleted jobs cannot be revived by an outstanding poll. This changes polling only: no new permission, AI execution authority, trading action, Wallet protocol, auth fallback or server route.

## Executed local evidence

- New regression executes the original app function extracted into a Node VM, not a reimplementation. Before the correction, the previous-account failure and replaced-job success cases failed. The first baseline overlap harness waited indefinitely and was interrupted; its duplicate tick was then made non-blocking. This failed baseline is not counted as a PASS.
- `node --test apps/finance/tests/ai-poll-isolation.test.mjs apps/finance/tests/read-sources-web.test.mjs apps/finance/tests/standard-wallet-flow.test.mjs`: **52/52 PASS**, 16.243 seconds. Includes six new polling cases and inherited selected-wallet/private-service separation regressions.
- `node --test apps/finance/tests/ai-order-intent-browser.test.mjs`: **7/7 PASS**, 6.116 seconds. Existing local Chrome/controlled HTTP fixture exercises the real app DOM and draft-only behavior; not a real provider approval or public deployment.
- `node --check apps/finance/web/app.js`: PASS.
- `node apps/finance/scripts/security-check.mjs`: PASS, 428 text files (before this evidence document).
- `git diff --check`: PASS.

## Remaining release gates

This is an owned source/local-test checkpoint, not an installer or public source-bound runtime. No SSH, Host upload/retry, deployment, real account request, signature, transaction or ComputerControl action was performed. Existing UNKNOWN channels and immutable packages remain unchanged. Formal publisher A must inherit only these matching owned file deltas into its current shared-input composition, not use this older whole checkout as a replacement candidate. No frozen historical manifest/archive was rewritten.

The earlier full Finance Go race suite remains **BLOCKED_BY_DISK_CAPACITY**, not PASS; this JavaScript-only fix does not resolve that gap. Latest local capacity readback during this slice: 193 MiB available, Data volume 100% full. No user/other-owner data or scratch was deleted. Report both resource and release dependency gaps only to `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).
