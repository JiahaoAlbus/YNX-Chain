# Native Paper observation fences, successor of 88ce / 743c

Preserved predecessor code 88ce968f7dce7dcb4bc15760c77fde8089addeb3 and evidence 743c7b726dadcd6df8a75acb1ad14a9ff4322b42 remain immutable. This successor addresses findings supplied by the current audit owner; earlier source/test packets do not prove these findings closed.

## Actual changes

- A bounded snapshot must match requested history version, offset and revision, all record cardinalities and the catalog metadata before becoming ready. A missing/contradictory receipt is not a legacy-compatible success. A continuation page requires a revision before HTTP.
- Snapshot reads have an operation sequence. A delayed older read cannot replace or clear a later authorized snapshot, including after it returns an error. Owner/session epoch and proof checks remain independent.
- Receipt-button success, catch and finally bind the exact active operation, native account/epoch, original UI nodes and observed snapshot. A retired operation cannot change the new user's result or button restoration. Confirmation feedback has the same operation/actor/DOM fences. Identity/view retirement releases only the retired local UI operation; original per-account UNKNOWN journals remain controlled by the original controller.
- Receipt GET validates its exact key selector before workspace lookup. It loads only already persisted account binding and existing tenant snapshots via the existing integrity-checking file/DB read stores. It never calls enrollment, tenant allocation, New/openStateStore, save/audit or a filesystem writer-lock directory. Missing mapping, missing tenant and missing receipt remain unavailable, not proof of non-execution. Normal first-workspace compatibility is unchanged.

## Affected tests executed

Actual Chrome runs original paper-actions and original intent controller, with delayed controlled transport, for A success/error after switching to B. B feedback/control state and A UNKNOWN journal stay unchanged; one receipt GET, no POST. Original full native-session controlled browser journey passes separately. These are local test doubles, not real native Wallet approval.

Go tests exercise authorized HTTP invalid/unbound first receipt without mapping/tenant artifacts, three missing-tenant lookups without mapping-byte/audit change, existing tenant receipt-byte preservation, foreign owner refusal, cold-start saved receipt and existing native workspace compatibility. Focused race gate passed 5.128 s. Consumer focused gate passed 17/17 including version/count/revision mismatch and late old-response suppression.

No shared Wallet/SDK/authority changes, no new permissions, no schema migration, no scheduling or real capital execution. No SSH/Host upload or public mutation. Public deployment, installed execution, true Wallet approval/callback, signatures, transactions and ComputerControl remain unverified.

The first full Node run exposed an existing research browser observation race: it asserted the kill-active label immediately when receipt state became visible, before awaited refresh/finally released the admitted risk lane. The actual app correctly still displayed unconfirmed during that intermediate transition. An isolated rerun passed; the fixture now waits for the same confirmed kill receipt AND risk lane completion (not a weakened economic assertion). The original full-run failure is recorded here, not relabeled PASS.
