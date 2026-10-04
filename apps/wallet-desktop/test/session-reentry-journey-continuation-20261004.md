# Connected-app recovery and re-entry continuation

Parent: `3ee474d713b70d5d9956e91341f727a1526a6631`, tree `9b652c80dd10a85375c577d5302e3bffde9b3093`. Owned worktree d386, original branch retained. Only Desktop owned source/tests changed. Native App.tsx remains SHA256 `c9f67581648d11a3793f08a92113f8299c124eb7f978227dcbcafa213951907f`.

## Actual source changes

- Session reads are latest-view owned; refused, thrown, malformed, duplicate, expired inventories remain unavailable, never verified empty. Explicit retry performs reads only. Topic/origin/name/expiry validation follows the existing transport producer, not a new protocol.
- Account rendering clears old balance/journal presentation first, then retires connected-app rows, chooser nodes and input; semantic key-state changes retire them too. Entering Connections rereads status and sessions. Neither old detached row nor old file chooser can operate on a later account.
- Disconnect is single-flight per row. Only the existing producer's matching topic and both `disconnected`/`localPermissionRevoked` true can report complete success. Partial/failed responses request inventory refresh before an explicit retry, not automatic revocation replay.
- Actual authorization/proposal callbacks capture account/view/security/key revision plus exact real queue item identity. Old callbacks cannot write new review notices/dataset or finish a reused-ID new queue item. The original main authority and callback contracts are unchanged.
- QR bytes are decoded locally only while their chooser/reader remains current. Pair/cancel/status replies and failures cannot overwrite a recovered account or enable a newer busy control. No automatic pair, approval, signing, new secret or transaction is introduced.
- Six display-only session notices are wired into all twelve locale dictionaries. Session topics, origins, signed content and diagnostics are not translated.

## Evidence retained

Logs: `/tmp/ynx-wallet-desktop-ui-20261004-wjXlEW/`.

| Probe | Original | Evidence SHA256 |
|---|---|---|
| session-reentry-original-bounded.log | 0 pass / 10 fail | d6e72151d838d7d9bce8318dc36168b87578a35b38d0ac4216cb59aabaa1ec31 |
| session-approval-original-v2.log | 2 pass / 6 fail | 0b307674b8e339ce95d0762f955c8015b86a5bdcb99dc7f37c08fb105c845683 |
| session-qr-original.log | 1 pass / 4 fail | ac429b910889534d744ccfde9a6ca4ce173f1c65bfba69c56584b060d8d56039 |
| session-reentry-final-related-v5.log | 223 pass / 0 fail | 814796c40ae441b6531a0887df4516eadf9fb9fb40a460be7fc65abf0722a388 |

Inventory original ran against the inherited QA renderer before replacement. Approval and QR originals ran against retained 897 renderer: those exact handlers were unchanged through parent 3ee. Actual renderer fragments and real ApprovalReviewQueue were exercised, not replacement guards.

Final related run includes mounted re-entry/QR/approval, account state/security composition, shell, WalletConnect session binding/inbox/private storage, queue, actual authority, permission epoch, key lifecycle, original transaction resolution and recovery UI. No unchanged 148/75 aggregate was mechanically rerun. Syntax and diff checks pass.

Intermediate evidence preserved: first original detached-row fixture waited before resolving its follow-up read; only exact owned test processes were terminated, then fixture was bounded and all 10 original failures retained. First approval fixture included an unrelated reject-button registration; extraction boundary corrected, original six real stale failures retained. First final related run 219/220 failed an exact source-order assertion: balance and journal clear were restored as the first account-render statements, not a weakened assertion. Wrong-relative-path copy attempt in QA failed; explicit owned absolute source copy corrected. Old logs were not overwritten.

## Gates and next work

This is source/test candidate evidence, not independent admission or complete Wallet delivery. Mac GUI remains locked; no credentials requested, automatic bypass, real approval, real funds, user profile reset, or device takeover. Unknown journals and original signed bytes retain their existing guards; no main/vault/transport/journal production source changed in this batch.

Protected Pay factory/37 real OS ports, shared crypto policy, release versions, signing, installers, website and MONSTER remain outside this owned batch. Real Android/iOS/Desktop camera, backup, biometric/system approval, callback, private Product Session business journey and user acceptance remain NOT_VERIFIED. This batch does not activate hybrid crypto or impersonate Pay.

Next owned continuation: inspect remaining standard Provider approval and Native connection re-entry/callback ownership against the same account/recovery/unknown-journal boundaries; test actual retained source before change. Shared contracts require A's supplied authority, not fabricated adapters. Preserve all earlier candidates and failures.
