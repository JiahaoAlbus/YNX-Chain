# Browser preinstall diagnostic-journal successor handoff

P0-231 executed once and its internal fail-closed cleanup restored the complete old state, but it returned no success receipt and could not identify the pre-receipt stage that failed. This successor preserves an atomic, non-sensitive diagnostic journal across both failure cleanup and success. It does not install, register, launch, open a scheme, request an account, sign or send a transaction in this source slice.

## Exact implementation

- Branch: `codex/p0-browser-current-source-verification-20260821`
- Implementation: `dd5dd0586cc4b6857e446cc95c988ad26eb3abbe`
- Tree: `2c9313b67e946cf57684d7173643743c0a397d88`
- Parent: `4ad839a199769c726a0e7a23e2fc38460b1c35b9`
- Executor: `apps/browser/scripts/browser-preinstall-executor.sh`
- Executor SHA-256: `3a441fae95821c5ac15f346feb36593698094c2811695a456bc89fe46ccf82d0`

## Durable diagnostic boundary

The requested production journal is exactly `/private/tmp/ynx-browser-preinstall-p0232.diagnostic`; its only atomic staging path is the exact `.tmp` sibling. Both must be absent before forward. Before each of fifteen pre-receipt stages the executor atomically replaces the journal with schema, action, stage, status, exit code, cleanup state, current Applications/root/target/old-handler tuples, resolved handler, and boolean registration/copy/root-creation facts. It records no account, key, seed, request payload or other sensitive value.

If any stage fails, cleanup first unregisters only an attempted candidate registration, restores the exact frozen old handler, removes only the receipt-bound candidate and exact empty root, re-verifies the old handler and absent candidate state, and then preserves `FAILED_CLEANED`, the exact failure stage and whether cleanup was complete. A successful forward preserves `FORWARD_COMPLETE/SUCCESS`; rollback does not erase the journal.

## Missing-parent lifecycle now frozen

The target root `/Users/huangjiahao/Applications/YNX Browser Isolated` is currently absent. The executor no longer uses recursive parent creation. It first verifies the existing `/Users/huangjiahao/Applications` tuple (`16777239:448444`, uid `501`, gid `20`, mode `0700`, nlink `15`), requires the isolated root absent, and creates exactly that one directory with mode `0700`.

Immediately after creation it records the new root device/inode, uid, gid, mode and empty-directory link count in the forward receipt. A post-copy failure or explicit rollback can remove that directory only after the exact candidate is removed, the root identity and metadata still match the receipt, and the root is empty. A substituted root or any unexpected sibling entry is rejected before LaunchServices rollback mutation.

## Direct actual-shell fixture

`npm run verify:macos-preinstall-executor` passes `22/22`. The fixture injects a failure at every pre-receipt stage and proves the exact journal, complete cleanup, absent journal temp, unchanged eleven old copies, old handler and PID sentinel. It also preserves the prior lifecycle cases:

1. absent root -> exact single-directory creation -> receipt -> exact candidate rollback -> empty root deletion;
2. post-copy forward failure unregisters only the candidate, restores the exact old handler, removes only the exact candidate and exact empty root;
3. root device/inode substitution is rejected before any unregister/register rollback operation;
4. an unexpected root entry is rejected before any unregister/register rollback operation and is not deleted;
5. a reported candidate process rejects rollback before mutation;
6. production mode without the single-use lease marker is rejected.

Eleven old-copy sentinels, the exact old-handler sentinel and PID `93119` sentinel stay byte-identical across the positive and failure paths. The only successful forward/rollback LaunchServices sequence remains register candidate, unregister candidate, register exact old handler.

## P0-231 terminal and fresh read-only state

Central released P0-231 at `0adeb8b08f28b34558e336d59b80b95baf51061c` as `CONSUMED_RELEASED_FAILED_CLOSED_BROWSER_P0231_PREINSTALL_ROLLED_BACK_AUTOMATIC_FORWARD_CLEANUP`; Heavy and Browser locks are idle/released and that lease is nonreusable.

- The isolated root remains absent.
- Current `ynxbrowser` handler remains `/Users/huangjiahao/Applications/YNX Browser Preserved/YNX Browser Testnet Preview-preserved-95ddf592badb.app` with app device/inode `16777239:149132970` and executable SHA-256 `95ddf592badbdb3cdf4babc31c0febdd186e917d1b1ca81a4a400c2f8839d81e`.
- PID `93119` still executes that exact old binary.
- Spotlight still enumerates exactly eleven `com.ynxweb4.browser.macos` copies.

## Requested decision

Central should independently review the new request JSON and issue one wholly new, nonreusable Browser-only P0-232 lease. It must explicitly authorize the exact journal and journal-temp paths, exactly one creation of the missing isolated root, one forward, and at most one receipt-bound rollback. No installation or runtime authority is inferred from this source/fixture evidence.
