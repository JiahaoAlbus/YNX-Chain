# Browser preinstall path-specific default-handler successor handoff

P0-232's diagnostic journal identified the exact failure at `RESOLVE_CANDIDATE_HANDLER`: `lsregister -f` registered the copied candidate, but eleven same-Bundle-ID claims left the old running copy as the default `ynxbrowser` path. Its cleanup was complete and retained journal SHA-256 `b48b4b0984371b81ce457f9e68fcd1891e7a82b4bdbbc403f73fd92c28d84dc8`. This successor adds an explicit public path-specific default-handler API without launching or opening the scheme.

## Exact implementation

- Branch: `codex/p0-browser-current-source-verification-20260821`
- Implementation: `7d35babd1049df2b3898ce9425410564e21c110e`
- Tree: `41e2fa179b19f3f38cc605c90eb156c69ad6267d`
- Parent: `a40b2e6a4a371125ffe4115515a83f3c7e6c996b`
- Executor: `apps/browser/scripts/browser-preinstall-executor.sh`
- Executor SHA-256: `66895f67e2ec7e3459f4ccc1fdf8358637e8c11298e2f409e1516d3757fb385b`
- Default-handler helper: `apps/browser/scripts/set-macos-default-handler.swift`, SHA-256 `2c8d2efbb45f21b5ad7dce1905e4484a33d391c245bc683f1098cd2a22f5cef4`

## Exact LaunchServices correction

The read-only LaunchServices dump confirms each YNX claim has rank `Default`, role `Viewer`, `url-type` flags and `ynxbrowser:` binding, while all eleven paths share `com.ynxweb4.browser.macos`. Registration alone therefore does not bind the desired filesystem path.

The successor uses the public macOS 12+ API `NSWorkspace.setDefaultApplication(at:toOpenURLsWithScheme:completionHandler:)`, which accepts an exact application URL. Forward registers the exact candidate, sets that exact candidate URL as the `ynxbrowser` default, then requires non-opening resolution to return the candidate path. Failure cleanup and explicit rollback register the frozen old handler, set its exact app URL back as default, and require resolution to return the old path before deleting the candidate.

A real no-mutation probe typechecked and ran against the source candidate app. It verified bundle ID `com.ynxweb4.browser.macos`, the exact `ynxbrowser` claim, API availability and current old-handler resolution before and after the probe. The setter was not invoked, no URL was opened and PID `93119` remained exact.

## Durable diagnostic boundary

The requested successor journal is uniquely `/private/tmp/ynx-browser-preinstall-p0233.diagnostic`; P0-232's retained journal is immutable. Before each of sixteen pre-receipt stages, including `SET_DEFAULT_HANDLER_CANDIDATE`, the executor atomically replaces the successor journal with non-sensitive state.

If any stage fails, cleanup first unregisters only an attempted candidate registration, restores the exact frozen old handler, removes only the receipt-bound candidate and exact empty root, re-verifies the old handler and absent candidate state, and then preserves `FAILED_CLEANED`, the exact failure stage and whether cleanup was complete. A successful forward preserves `FORWARD_COMPLETE/SUCCESS`; rollback does not erase the journal.

## Missing-parent lifecycle now frozen

The target root `/Users/huangjiahao/Applications/YNX Browser Isolated` is currently absent. The executor no longer uses recursive parent creation. It first verifies the existing `/Users/huangjiahao/Applications` tuple (`16777239:448444`, uid `501`, gid `20`, mode `0700`, nlink `15`), requires the isolated root absent, and creates exactly that one directory with mode `0700`.

Immediately after creation it records the new root device/inode, uid, gid, mode and empty-directory link count in the forward receipt. A post-copy failure or explicit rollback can remove that directory only after the exact candidate is removed, the root identity and metadata still match the receipt, and the root is empty. A substituted root or any unexpected sibling entry is rejected before LaunchServices rollback mutation.

## Direct actual-shell fixture

`npm run verify:macos-preinstall-executor` passes `23/23`. The fixture proves the exact sequence register candidate -> set candidate default -> resolve candidate, and rollback unregister candidate -> register old -> set old default -> resolve old. It injects every one of sixteen pre-receipt stages and proves exact journal, complete cleanup, absent journal temp, unchanged eleven old copies, old handler and PID sentinel. It also preserves the prior lifecycle cases:

1. absent root -> exact single-directory creation -> receipt -> exact candidate rollback -> empty root deletion;
2. post-copy forward failure unregisters only the candidate, restores the exact old handler, removes only the exact candidate and exact empty root;
3. root device/inode substitution is rejected before any unregister/register rollback operation;
4. an unexpected root entry is rejected before any unregister/register rollback operation and is not deleted;
5. a reported candidate process rejects rollback before mutation;
6. production mode without the single-use lease marker is rejected.

Eleven old-copy sentinels, the exact old-handler sentinel and PID `93119` sentinel stay byte-identical across the positive and failure paths. The only successful forward/rollback LaunchServices sequence remains register candidate, unregister candidate, register exact old handler.

## P0-232 terminal and fresh read-only state

P0-232 executed forward once and rollback once, with no retry. The forward journal records `FAILED_CLEANED`, failure stage `RESOLVE_CANDIDATE_HANDLER` and cleanup `COMPLETE`; the external rollback refused before mutation because no success receipt existed. Root, target and receipt remain absent; the old handler, eleven paths and PID `93119` remain exact. Central released it at `dac81185ea479058d19f4e8af8d098dc271ec828`; Heavy and locks are idle/released and the lease is nonreusable.

- The isolated root remains absent.
- Current `ynxbrowser` handler remains `/Users/huangjiahao/Applications/YNX Browser Preserved/YNX Browser Testnet Preview-preserved-95ddf592badb.app` with app device/inode `16777239:149132970` and executable SHA-256 `95ddf592badbdb3cdf4babc31c0febdd186e917d1b1ca81a4a400c2f8839d81e`.
- PID `93119` still executes that exact old binary.
- Spotlight still enumerates exactly eleven `com.ynxweb4.browser.macos` copies.

## Requested decision

After atomically releasing P0-232, Central should independently review the new request JSON and issue one wholly new, nonreusable Browser-only P0-233 lease. It must authorize unique P0-233 receipt/journal paths and only the explicit non-launching path-specific setter for candidate forward and old-handler restoration. No installed runtime or Wallet authority is inferred from source/fixture evidence.
