# Saved Paper parameter review and restoration

Source `5b60c60e9b70975be757fc7736599d75c956fc73`, tree `323a6d7f9c792dc49deb5d239fe450e42af4aa76`. Inherits exact-intent late-response guards and the original cost-aware backend unchanged. Ordinary Quant UI/tests only; no shared SDK/Auth/Host/protected producer edits or deployment.

Unknown-result recovery now shows the exact saved request key, strategy hash, quantity, side and cost model/rates in a localized, wrapping status panel. A separate type=button restores those exact parameters from the validated current journal. It sends no order, proof or HTTP request and does not rewrite the journal. Original preview and explicit submit confirmation remain mandatory. Restoring rejects invalid/foreign saved strategy data, remains disabled during submission, and supports both original legacy journals and v1 cost journals. A journal replaced by another same-workspace view is re-read rather than overwritten from stale memory. Twelve localized languages remain supported.

Gates:

- Node syntax and `git diff --check`: PASS.
- Business-flow + actual Chrome cache-version: **124 PASS / 0 FAIL / 0 SKIP**, 1529.773125ms.
- Unmodified independent late-success/rejection probes: **2 PASS**, 76.161417ms.
- Full original Go + three real Chrome contexts, including shared-workspace two-tab flow, and four SIGTERM/restarts: **1 PASS**, 18591.941ms (overall 18814.924875ms). Real B new request remains busy/restore-disabled; A late receipt retains B journal; normal A Restore loads amount2000000/fee20/slippage10 with POST count unchanged at3; B own response then clears only its own journal. Two exact service orders and once-only costs survive both reloads. Controlled local tape only, not public market/Wallet/private identity evidence.

One initial new unit test failed because its fake-DOM lookup incorrectly assumed dynamically appended IDs were indexed in the static ID map. Corrected the fixture to find the actual appended controls; production behavior was independently exercised in Chrome. The failure is not relabeled as a product PASS.

Final retained root `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-SviWnT`:

- `same-workspace-late-old-response-en.png`: 226217 bytes, SHA256 `6433a6ed30e92aa7c46cf9252742ec7efcf8d5ff512b14abae118ac3288048c7`.
- `same-workspace-new-request-pending-en.png`: 237124 bytes, SHA256 `ca4edb5bd8fafa05c8c8db7d11fd9d4c57ae39b45cc100080c9d58d75bbabfbd`.
- `same-workspace-two-orders-reloaded-en.png`: 227646 bytes, SHA256 `07fc71747440e9ab53d20802907691b6e7779bd1b7d63135496aa7db7713a515`.

Release-owner matching Web inputs: app SHA256 `0b4be688c8b760c0ed07195bc5ac8aa35ddcbc4bd209a95229d58e63264f9404`; styles SHA256 `787977313b80f9959e649a95519e798d00d1ca6eb40b4d333fb08111dbb4d5d2`; index SHA256 `a93b06c5079abfe787ba6b0a4ccaa00d170789068547bc2e2a236af06a15769d`. Exact cache query binding updated. Formal/public runtime, installers, native mandate, real account/proof/sign/transaction and Product Session v2 remain unproven and cannot be inferred from these local checks.
