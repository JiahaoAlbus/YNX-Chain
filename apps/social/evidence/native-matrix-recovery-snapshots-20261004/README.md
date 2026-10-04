# Native Matrix original-readback snapshot repair, 2026-10-04

Base source: 909ba71898a7f901070764f18e5c9cf0a8dcd016.
Base tree: 0d51f419619c79f0f5d7716c61dc2f012653abea.
Owner: codex/social-wallet-chooser-20261001.
Controller: 接续测试网生态审计工作.

## Original defect and repair

checkedOriginalObservation validated fields and returned the original producer
objects by reference. A producer could change retained content, event identity,
sender or remote status AFTER validation, changing the already-checked result.
This was demonstrated against the original source, not inferred from a mock API.
original-run.txt preserves two failing regressions and three passing cases.

The actual source now snapshots the known scalar fields in original/event and
freezes the copies BEFORE validation. It does not freeze the producer's objects.
All existing identity/content/local-vs-remote checks remain intact. Result flags
stay sdkObserved=true, delivered=false, freshServerReadback=false and
socialIndexConfirmed=false. No authenticated/server/delivery proof is fabricated.

## Executed checks

- New actual-function mutation, detached/frozen-copy, flag, rejection and original
  list tests: original 2 FAIL / 3 PASS; repaired source 5 PASS.
- Related original NativeMatrixConsumer suite plus new tests: 19 PASS / 0 FAIL,
  including current authority, original nonce/body preservation, stale restore,
  expiry, accepted peer, encrypted room, SAS and journal-not-settled protections.
- Full Social TypeScript check initially caught TS2532 in the NEW test's result[0]
  dereference. Original compiler output is retained. The fixture was corrected by
  assert.ok(retained), not any/non-null suppression/ignored diagnostics. The new
  five tests were rerun and full TypeScript subsequently exited 0.
- Isolated web build exited 0. It reused the original source811 web build workspace
  copied to a fresh stage, with the current two changed src files copied in. The
  committed src/web delta from source811 to this base is empty and recorded.
  Existing owner dist, APKs, caches and histories were not overwritten.
- source-inputs.sha256 records actual final source/test bytes. status.txt records
  separate original/final test, compiler and build exits; no failures were deleted.

## Acceptance boundary

This fixes the REAL product consumer function. Tests use controlled primitive
Matrix-event objects, not a real native server, user account or trust producer.
The isolated web build is a compatibility gate, not direct validation of the
native-only recovery screen. Actual affected installed UI is NOT_RUN: it needs
A/Native's matching installed-source carrier, current protected producer and an
internally coordinated device window. A guest screenshot does not substitute it.

No account request, signature, transaction, private identity injection, real file
readback, reinstall, SDK activation, shared/interface change or public deployment
occurred. Unknown journal entries and old history remain retained. Dormant new
core activationApproved=false; activated=false. Real private recovery, original
server readback, Matrix/two-node operations and MONSTER remain NOT_VERIFIED.
Whole Social v2 / crypto649 is NOT_COMPLETE.
