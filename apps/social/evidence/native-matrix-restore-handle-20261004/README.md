# Native Matrix restore handle validation/capture, 2026-10-04

Base source: 27e4b3924d9e68fd8d3fd1df4615d517a7128d38.
Base tree: 40ee89742e21f873751dd66e8f8f92883f231603.
Owner: codex/social-wallet-chooser-20261001.
Controller: 接续测试网生态审计工作.

## Original actual-consumer failures

restore() accepted a malformed SDK generation as an active local session handle.
The first malformed NaN case demonstrates the original acceptance; subsequent
invalid examples were not reached in that original failed test. Separately the
native result object was reread AFTER the subsequent current-authority await,
allowing producer object reuse from generation 7 to 8 to change the captured
handle. Original actual-function test result: 19 PASS / 2 FAIL, retained.

## Product repair

Immediately after native restore resolves, capture its generation scalar and
require a number with Number.isSafeInteger. Use that captured scalar after the
original fresh-authority/epoch checks. Missing/nonfinite/fractional/lossy handles
are rejected as MATRIX_NATIVE_GENERATION_INVALID by the existing cleanup path.
No request data, SSO, public Matrix identity or fixture is used as replacement.

This generation is an opaque process/session callback handle, NOT independent
cryptographic device/directory/route generation or checkpoint/provenance proof.
The repair adds no positive-only or crypto-admission interpretation to the old
handle namespace. Controlled compatibility cases 0 and 7 remain accepted.

## Executed results

- Original consumer suite plus new tests: 19 PASS / 2 FAIL.
- First repaired batch: 40 PASS / 1 FAIL caused ONLY by the new fixture expecting
  MATRIX_SESSION_REQUIRED instead of the original MATRIX_NATIVE_SESSION_REQUIRED.
  That output remains post-fix-fixture-mismatch.txt. The expected ORIGINAL code
  was corrected exactly, not generalized and not changed in product source.
- Final related Matrix/media/recovery batch: 41 PASS / 0 FAIL.
- Corrected malformed test covers NaN, positive/negative infinity, fraction and
  above-safe integer; each refuses restore, leaves no active consumer session and
  preserves the original unknown native journal fixture.
- Capture test mutates the producer result during the second authority await;
  later original rooms call still uses the captured 7, not overwritten 8.
- Full Social tsc --noEmit: exit 0.
- Isolated web build: exit 0; original source811 web stage copied to a fresh stage
  with ALL current src overlaid. Committed web delta is empty and retained. No
  owner dist, APK, user data or history is overwritten.

## Scope and pending acceptance

Controlled bridge/authority fixtures call the REAL product consumer methods.
These are not installed SDK, real Matrix, device generation, keys, transport,
OS/SQLite/checkpoint, backup restore or public application evidence. No bridge/RPC
DTO or native-owner source is changed. Fresh authority and stale-restore guards
remain intact, as do unknown-journal and queue-vs-delivery behavior.

No account, signature, transaction, real SAS approval, device input, installation,
deployment or new SDK activation occurred. activationApproved=false;
activated=false. A/Native matching installed-source/producer/UI verification,
real Matrix/two-node and MONSTER acceptance remain NOT_VERIFIED. The complete
Social v2 / crypto649 goal remains NOT_COMPLETE.
