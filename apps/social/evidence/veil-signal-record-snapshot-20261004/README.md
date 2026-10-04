# Native libsignal record image producer candidate

Base source aff997693966082ef1857c43b9787e5e16018bed. This is a dormant
native-only candidate outside active Gradle source sets. No Expo/JS export,
device enrollment, key generation in product code, activation or release.

VeilSignalRecordSnapshot captures the existing VeilRecordTransaction under
its live guard. It retains all 13 current record kinds, including official SDK
session, identity and prekey bytes plus original inbox/replay/outbox metadata.
It bounds the whole image to eight MiB and 4096 rows, checks duplicate IDs,
rejects new unsupported record kinds, and compares the identity pair against
an externally supplied admitted public identity before accepting SDK records.
Official 0.104.0 JNI constructors validate the retained SDK record types.
All serialized SDK bytes remain opaque and are not converted to JSON or JS keys.

## Exact representation

This is a Social storage container, NOT an official SDK whole-store backup API
and NOT a cryptographic protocol. Big-endian uint32 framing:

1. Magic 0x56535231; container version 1.
2. Length-prefixed ASCII libsignal:0.104.0; row count.
3. Each row: length-prefixed explicit kind name, ASCII ID and untouched bytes.

IDs are bounded to 1024 printable ASCII bytes; record kind names to 32 bytes.
Unknown versions, unknown kinds, missing own identity, malformed SDK records,
prekey-ID substitution, truncation, trailing bytes and stale guards fail closed.
Every temporary owned row buffer is wiped; the native image is closeable and
returns independent copies only to its package-private native sealer entry.
JVM wipe is not an OS memory-lock or guaranteed native-handle zeroization claim.

stageImport accepts only a decrypted native image, an independently admitted
own public key and a native current observer. It validates/copies the image but
does not write a record, grant trust, advance an anchor or restore a device.
The image's public key is not its own authority. No restore/write method exists
pending the original native recovery authority's exact atomic consumer.

## Actual QA

Pinned official SDK JAR SHA256:
c2b415784ea95b6552a87bea4b644d1f5178142cb7cc4113c0b2c68a35c43ec9.
Its upstream source/build provenance and license approval are separate gates.

Original QA failed before snapshot validation: the new fixture reversed
SessionBuilder remote/local arguments. Original run.txt/original-run.txt and
exit 1 remain. Official compiled SDK fields confirmed SessionBuilder uses
remote/local, whereas SessionCipher uses local/remote. Only fixture wiring was
corrected; no SDK, assertion or product functionality was removed.

Final fresh compilation uses the current three original Kotlin native port
files, NOT the older eleven-kind native-port.jar. Actual desktop JNI with
-Xcheck:jni generated an SDK PQ prekey session and evolved it through encryption.
Fourteen snapshot checks passed, with original pending ciphertext preserved.
Trust, record storage and other lifecycle metadata remain synthetic memory
fixtures; this is not independent device admission, SQLite/Keystore atomicity,
complete proprietary record semantic validation or SPQR activation evidence.

run-local.sh reproduces with existing local dependencies and does no download.
Fresh compilation inputs/logs, dependency hashes and actual exit statuses are
retained. This evidence does not close native restore or full Social/crypto649.

## Required continuation with the original native/shared owner

The native owner must consume this representation directly in the reviewed
veil_backup_seal/open C boundary, with an independently verified expected
32-byte context, device/namespace/generation/revocation and source checkpoint.
It must retain the original operation and implement the existing atomic record
restore/checkpoint recovery, preserving old keys/history and unknown operations.
Never adopt context/pin/checkpoint from the file itself, SSO or MXID. Explicit
native password review, platform sodium/memory-lock/cancel policy and full
LegacyReader migration remain open. No fake working backup/restore UI is added.
