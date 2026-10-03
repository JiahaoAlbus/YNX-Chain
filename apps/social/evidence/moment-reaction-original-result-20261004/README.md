# Original reaction result recovery

Parent: 9966587d334e204862a4d6e0ace4a6d43df36127.

Previously an accepted reaction idempotency key referenced only the mutable
moment/account display row. A later reaction could make an older request's
replay return the later action rather than the original operation result.

New reaction receipts store the immutable value snapshot in the existing signed
Social idempotency record. Replay validates the original payload and returns
that snapshot without changing the latest display row, audit or notifications.
Current actor and moment visibility checks remain before receipt access.
Legacy receipts lacking the original snapshot are retained with ErrConflict;
the latest row is never used to invent their lost original response.

The added JSON field is optional with omitempty: unrelated and legacy receipts
retain their existing field encoding. Five inherited positional literals were
converted to named fields with unchanged original values. Their initial compile
failure is preserved in tests.txt, not suppressed.

Regression uses actual Social business methods and signed state save/cold
decode with the existing synthetic authority fixture. It covers original like,
later love, cold original replay preserving latest display, altered payload,
missing legacy snapshot and revoked current actor. The complete Social package
race result is in tests-repair.txt/status.txt. The exact read-only shared
dependency overlay is c5e4178bb548baa05f552e8e1bc0f566ddc6f72d, whose durable
snapshot and overlay reproduction details are retained in the prior
moment-delete-cold-recovery-20261004 evidence directory.

This is source-composition evidence, not real authority admission, actual
native/installed UI, public behavior, MONSTER acceptance or crypto activation.
No deployment, account request, signing, transaction or shared source change.
