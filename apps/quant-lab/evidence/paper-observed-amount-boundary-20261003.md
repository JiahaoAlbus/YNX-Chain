# Paper observed amount display/request boundary

Parent source: 87d22c36ddcea0221d430fe6b89a2c9302aa04c0.
Ordinary Quant UI and direct tests only; no authority or backend schema change.

Before fix, observed Cash/Position/ReconciliationDelta used raw HTML interpolation;
numeric strings, unsafe numbers or injected markup could become balance output.
KillSwitch truthy nonboolean also colored an unavailable result as active.
Reconcile sent missing/invalid observed fields; missing fields could reach Go's
zero-value decode instead of the intended observed state. Both new direct tests
FAILED before fix (invalid active class and an unwanted reconciliation POST).

Now only safe integer amounts render; legitimate zero and signed cash/positions
remain exact; negative reconciliation delta is unavailable. No coercion of
strings, null, arrays, objects, booleans, fractional/unsafe/nonfinite numbers.
Only exact boolean true has active risk styling. Reconcile validates the observed
Cash and Position before POST so it never substitutes an unknown value with zero.
Existing localized unconfirmed error is used, with no auto retry or new permission.
Large int64 values beyond JS safe integers are explicitly unavailable, not rounded
and falsely described as exact; a future decimal-string API requires its own contract.

Tests: direct business 64/64 PASS, 364.381625ms. New cases cover invalid values,
exact zero/negative position, and no malformed reconciliation POST.
Local actual Go/Chrome subset 3/3 PASS, 4280.44175ms. A declared malformed readback
fixture overlays the local service snapshot: four unavailable fields, no img,
no risk-active styling, no script effect, no reconciliation POST, pageerrors=0,
one page. Existing actual-service normal reconciliation and confirmed kill/lost
GET/delayed read/reload tests pass. JS syntax and diff checks PASS.
Screenshot: owner-worktree `tmp/quant-lab-evidence/paper-source-values-unavailable.png`.

Not public runtime, installed app, authenticated Wallet users or real funds.
Malformed data is test-only and never shipped as product data. Formal publication
and shared pin updates belong to the unique release owner; integrate ordinary
hunks, not inherited checkout wholesale. No DB migration; rollback this UI/test
delta only. No Host, account approval, signature or transaction action.
