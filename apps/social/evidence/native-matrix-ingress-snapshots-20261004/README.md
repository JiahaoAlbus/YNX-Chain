# Native Matrix event ingress snapshot repair, 2026-10-04

Base source: b985d8124581ae4fe7414d4305b42bc461e97b47.
Base tree: f9f9f040ddaf6ac2fc4b81c2e78c476e9d70d3a6.
Owner: codex/social-wallet-chooser-20261001.
Controller: 接续测试网生态审计工作.

## Original actual-consumer failures

The original native callback passed the producer object to asynchronous deliver().
The current-authority await let the producer reuse/change that object before
review and listener dispatch. Dispatch also shared writable objects with listeners.
The original real NativeMatrixConsumer (with a controlled bridge/current binding)
produced 14 existing PASS and four new FAIL, retained in original-run.txt:

1. Timeline rows were changed/appended while current authority was awaited.
2. Producer generation/room reuse changed a legitimate event and it was discarded.
3. Original SAS values changed and widened during review, causing the original
   comparison frame to disappear rather than preserving its original three values.
4. A first subscriber changed route, event body and array length for a second subscriber.

## Product repair

The original generation filter remains first. Matching frames are snapshotted
synchronously before deliver() and its first await. The outer frame, declared
MatrixEvent scalar rows, timeline array and SAS-value array are detached and frozen.
Producer objects/arrays are not frozen or reused. Existing optional-field behavior,
authority/epoch/generation/room/accepted-peer/SAS checks and transport DTO fields
remain unchanged. This is not an identity verifier or decryption/trust proof.

The actual NativeMatrixWorkspace listener stores/maps the event/SAS arrays without
in-place sort/reverse. No UI source change was needed for the immutable input.
No shared interface, native owner, transport format, key storage or SDK activation
is changed by this repair.

## Validation

- Original callback regressions: 14 PASS / 4 FAIL, preserved.
- Repaired native consumer plus original-readback tests: 23 PASS / 0 FAIL.
- Related native Matrix/media/recovery batch: 38 PASS / 0 FAIL.
- Full Social tsc --noEmit: exit 0.
- Isolated web build: exit 0. A fresh copy of the original source811 web build
  stage was used, with ALL current src files copied over. Committed web delta from
  source811 to the base is empty and recorded. No owner dist or APK was replaced.
- Actual source/test byte hashes, outcomes and stage identity are retained.

All checks invoke the original product consumer methods with controlled bridge
and authority data, not an independently admitted real device or homeserver.
No real SAS approval, Wallet request, account request, signature, transaction,
installation, publication or device operation occurred. This is not public or
installed proof. Matching installed callback/UI verification still needs A/Native's
current producer and internally coordinated source-bound platform window.

Original journal/unknown operations/history and queue-vs-delivery distinctions are
retained. New-core activationApproved=false; activated=false. Real Matrix/two-node,
protected native identity/checkpoints/restore and MONSTER acceptance remain open.
Whole Social v2 / crypto649 is NOT_COMPLETE.
