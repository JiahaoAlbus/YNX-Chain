# Limited checkpoint canonical-type successor

Inherited independent finding: BE99-CHECKPOINT-NONINTEGER-CANONICAL-COLLISION.
Frozen source be99a1ad56a559925152dcdbbef8800080c56e19 stays unchanged in Git.
Independent review JSON SHA-256:
69143437c7a23a8d4f94393da00d495828587d7e519b041ba48747f3db213294.
Its original schema acceptance and controlled source-model rejection assertions
remain FAIL in the independent review; no evidence is overwritten here.

Owned successor checks a single complete checkpoint row, Cursor storage type and
SQL typeof for both slot and revision BEFORE getLong. Only true SQLite integer
slot=1 and nonnegative signed 64-bit revision enter the unchanged big-endian
8-byte canonical hash header. New database constraints require integer storage
type; no existing schema migration, DB wipe, anchor reset or enrollment is done.
Existing noncanonical snapshots enter VEIL_TRUSTED_CHECKPOINT_RECOVERY_REQUIRED.
Normal existing integer snapshots retain the same canonical header. Revision
increment remains Math.addExact; exhausted counters are not coerced or wrapped.

Actual isolated SQLite regression preserves legacy REAL1.5 acceptance/alias,
then checks strict refusal, new-schema fraction/NULL/TEXT/overflow rejection,
legacy valid integer compatibility, exact BigInt range through Long.MAX_VALUE,
negative and bad row rejection. Five checks pass; Android Cursor/runtime is not
executed. Native Kotlin component compilation of the successor against Android
API36 exits 0. This is not independent SOURCE_PASS or Android exploit closure.

The prior native lease/commit/anchor positive tests are preserved and not rerun
merely for totals. Dormant JNI adapter progress is separately qualified in
veil-jni-store-20261004. Shared protocol/metadata and actual release remain A/Root
owned. No real device verifier, monotonic anchor or trusted recovery provider is
supplied, and no platform key/enrollment/data is created or modified by this fix.

Full Social and crypto S01-S12/32/product gates remain open: actual mobile secure
storage and approved native trust providers, JNI platform wiring, protocol
vectors/fresh SPQR, two nodes/migration/history, independent review/license,
installed/public real journeys and dot/MONSTER. No activation is claimed.
