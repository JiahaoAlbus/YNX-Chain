# Original desktop QR chooser isolation in normal Wallet/Pay paths

Parent owned source: `f7c8a39e02214140ddea316e75a0d5bbab015faa`. Scoped source changes: normal Desktop renderer, receiving-image scan entry, protected Pay modal and the mounted shared DOM file-input mechanism. No Native App.tsx/startup assets, shared SDK/Auth/registry, formal versions, main/preload IPC authority, vault, profile, installer or OS signing changes.

## Fixed product behavior

The existing controls reused their file input DOM nodes while separately replacing captured intent after a close/reopen. An old native chooser's queued change could therefore borrow a new intent before file bytes were read. Account/revision checks after decoding do not distinguish two chooser attempts in the same new context.

The original receiving, ordinary-invoice and protected-Pay entry points now replace the file input node on invalidation. The old node keeps only its original listeners and is no longer current: queued old clicks/changes cannot capture a new intent, read its selected file, initiate decode IPC, consume the new intent or fill the new draft/reference. A fresh node preserves original field ID/accept/ARIA attributes and locale data; existing labels and keyboard focus remain connected by the same ID. No permission, camera, upload, signing or payment capability is added.

- Receiving Scan replaces the input for each panel activation and for account/draft/lock/close invalidation; original account, key revision, draft revision and open checks remain before calling the existing recipient input lease.
- Ordinary invoice replaces the input on opening, reference edit, close/cancel, account-status change and key/lock transition. Existing controller capture/revision fences still guard async file reading and decode; QR only fills a reference and does not query the service automatically.
- Protected Pay replaces the input on opening, reference edit, next invoice, close/cancel and actual account/key/lock changes. Existing QR revision/live checks still guard each await; a current valid local decode only fills the original signed-invoice reference. Review, approve, original-hash check, settlement, authenticated receipt and Done remain explicit, with unchanged main-held authority and retained-original protections.
- Unchanged lifecycle notifications still do not cancel or recursively restore an active Pay operation. All 12-language Pay notices, original identifiers/facts, RTL isolation and history behavior remain unchanged.

## Verification and limitations

Isolated Desktop candidate: `/tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop`; current owned source delta copied over prior source, dependency baseline read-only admitted SDK `9555b01e47519a5df882bb0092d2d20e1d7ce6e2`.

- QR input/receiving/mounted Pay/12-language targeted tests: **35/35**, exit 0; `desktop-qr-chooser-targeted.log`.
- Normal renderer/account/balance/lock/invoice mounted-handler regressions: **45/45**, exit 0; `desktop-qr-chooser-renderer.log`.
- Full Desktop source regression: **655/655**, exit 0, no skips (six added cases, prior mounted cases strengthened); `desktop-qr-chooser-regression.log`.
- All four changed production JavaScript modules pass `node --check`; workspace `git diff --check` exit 0.

Tests execute the real current UI/controller/DOM-input mechanisms and actual extracted normal-renderer handlers using controlled DOM/FileList/native-chooser timing, synthetic local bytes and the existing controlled protected service. They include the old chooser event BEFORE decoding on a new same-account open, interrupted arrayBuffer reads, valid fresh selection, no automatic service query/payment, and unchanged balance/lock behavior. Extracted balance/lock fixtures now include the actual new clear function and its input invalidation dependency; no production boundary was skipped to obtain passing tests.

Actual Electron/native OS chooser timing, rendered focus/accessibility, installed upgrade preservation, public website downloads, real invoice/independent policy/current membership/business/settlement and real payment remain **NOT_VERIFIED**. This is a source-compatible mounted product fix, not public/platform acceptance. A is still the sole issuer and must compose matching real dependencies/ports and preserve published Android code 34 and Windows 0.6.18 baselines. The full Wallet goal remains active/incomplete; MONSTER remains **NOT_VERIFIED**.
