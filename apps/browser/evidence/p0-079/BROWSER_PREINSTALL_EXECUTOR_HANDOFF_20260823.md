# Browser preinstall executor successor handoff

The previous request froze the candidate `.app` but did not freeze creation or rollback of its missing parent directory. This successor closes that single blocker without installing, registering, launching, opening a scheme, requesting an account, signing or sending a transaction.

## Exact implementation

- Branch: `codex/p0-browser-current-source-verification-20260821`
- Implementation: `dd9a9b6e0552868b6559c2edd0b5d3244804fdfc`
- Tree: `c92d934837dbfd87eaf493111ddd0b4da99c6666`
- Parent: `8ccfea1fa1cc07087dd725949202b8f677a15116`
- Executor: `apps/browser/scripts/browser-preinstall-executor.sh`
- Executor SHA-256: `5841c41570308e588fa40fd2d4845553a91e9cc376d1ece0a23850a6d69042b8`

## Missing-parent lifecycle now frozen

The target root `/Users/huangjiahao/Applications/YNX Browser Isolated` is currently absent. The executor no longer uses recursive parent creation. It first verifies the existing `/Users/huangjiahao/Applications` tuple (`16777239:448444`, uid `501`, gid `20`, mode `0700`, nlink `15`), requires the isolated root absent, and creates exactly that one directory with mode `0700`.

Immediately after creation it records the new root device/inode, uid, gid, mode and empty-directory link count in the forward receipt. A post-copy failure or explicit rollback can remove that directory only after the exact candidate is removed, the root identity and metadata still match the receipt, and the root is empty. A substituted root or any unexpected sibling entry is rejected before LaunchServices rollback mutation.

## Direct actual-shell fixture

`npm run verify:macos-preinstall-executor` passes `6/6`. The fixture proves:

1. absent root -> exact single-directory creation -> receipt -> exact candidate rollback -> empty root deletion;
2. post-copy forward failure unregisters only the candidate, restores the exact old handler, removes only the exact candidate and exact empty root;
3. root device/inode substitution is rejected before any unregister/register rollback operation;
4. an unexpected root entry is rejected before any unregister/register rollback operation and is not deleted;
5. a reported candidate process rejects rollback before mutation;
6. production mode without the single-use lease marker is rejected.

Eleven old-copy sentinels, the exact old-handler sentinel and PID `93119` sentinel stay byte-identical across the positive and failure paths. The only successful forward/rollback LaunchServices sequence remains register candidate, unregister candidate, register exact old handler.

## Fresh read-only production state

- The isolated root remains absent.
- Current `ynxbrowser` handler remains `/Users/huangjiahao/Applications/YNX Browser Preserved/YNX Browser Testnet Preview-preserved-95ddf592badb.app` with app device/inode `16777239:149132970` and executable SHA-256 `95ddf592badbdb3cdf4babc31c0febdd186e917d1b1ca81a4a400c2f8839d81e`.
- PID `93119` still executes that exact old binary.
- Spotlight still enumerates exactly eleven `com.ynxweb4.browser.macos` copies.

## Requested decision

Central should independently review the new request JSON and issue one wholly new, nonreusable Browser-only lease. It must explicitly authorize exactly one creation of the missing isolated root, one forward, and at most one receipt-bound rollback. No installation or runtime authority is inferred from this source/fixture evidence.
