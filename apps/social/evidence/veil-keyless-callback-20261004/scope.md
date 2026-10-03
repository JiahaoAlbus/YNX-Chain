# Social dormant JNI successor evidence

Parent source: 0c498286e3a375b3b1943d481c4314a7d099f7c5.
Scope: Social-owned dormant native store enum, isolated official-libsignal Java
adapter, QA programs, and evidence. No shared contracts, deployment, activation,
wallet account requests, signatures, transactions, or key export.

## Changes

- Every SDK callback checks its native transaction lease before address work,
  native record getters, serialization, or store I/O.
- Session enumeration/deletion parses the complete SDK address, matches the
  complete peer name, and rejects noncanonical rows before partial deletion.
  Valid peer names containing dots retain their own sessions.
- Protected lifetime receipts prevent replacement of enrolled key IDs and
  reuse of retired curve, signed, or one-time KEM prekeys. Identical retries
  remain idempotent. Last-resort KEM keys retain their primary record while
  replay receipts bind the signed-key ID and public base key.
- KEM purpose is required and pinned. Missing historical purpose receipts
  require recovery, rather than automatic enrollment or migration.

## Evidence ordering and boundaries

1. veil-prekey-lifecycle-20261004/compile.txt records successful compilation of
   the lifecycle changes with the native Kotlin port and actual SDK.
2. veil-prekey-lifecycle-20261004/lifecycle-check.txt records eight passing
   lifecycle checks. jni-adapter-regression.txt records ten affected adapter
   regressions. These ran BEFORE the subsequent callback/address changes;
   they are not represented as a rerun against the final successor.
3. This directory's compile.txt and keyless-check.txt record final Java adapter
   compilation and seven passing callback/address checks. The checks use actual
   SDK addresses, a public-only identity, an empty session-record counter, and
   a controlled transaction port. They do not prove real Android persistence,
   Keystore authentication, independently approved identity, or durable anchors.

The original independent review failures remain preserved in the controller's
social-0c498-independent-review evidence. This successor is submitted for
independent reproduction and reverse-boundary review; SOURCE_HOLD is not lifted
by owner tests. The prior checkpoint closure is a limited checkpoint result,
not full cryptographic or product acceptance. Original SQL rejection assertions
were retained with necessary new-schema fixture adaptation; the Cursor shim
also gained type/typeof columns. SQL fixtures are not claimed byte-identical.

## Remaining gates

The official SDK is libsignal 0.104.0. Published JAR checksum verification is
separate from exact upstream Git build provenance, which remains NOT_VERIFIED.
The previous independent API35 compile and owner API36 compile are distinct.

No production independent device directory/verifier or authenticated durable
monotonic checkpoint provider is integrated. No automatic reset, re-enrollment,
tombstone pruning, epoch rollover, or protocol fallback is implemented. Lifetime
receipts consume the bounded native store budget and may require a recovery HOLD;
unbounded availability and trusted epoch rollover remain incomplete.

Actual Android Keystore/SQLite/JNI operation, crash recovery, fresh SPQR
contribution, all crypto requirements, migration, two real nodes, native/public
source binding, ordinary-user flows, and actual dot/MONSTER acceptance remain
open. This is source/evidence progress only, not Social completion or a release.
