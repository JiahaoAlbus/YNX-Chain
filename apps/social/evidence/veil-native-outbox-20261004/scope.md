# Dormant single-device native send/outbox consumer

Base source: 8014a50955e158e68f1059ca5c7f2a35f7665b94.

VeilSignalOutbox wraps the actual VeilNativeStore.transaction callback, uses the
official SessionCipher and VeilSignalProtocolStore, and writes the serialized
SDK message into OUTBOX within that same callback. Exceptions escape to abort
the native transaction. The production method returns its ciphertext only after
the native transaction returns, including its required external checkpoint.
It exposes no Expo/JS entry point and is outside active Gradle source.

No encryption, ratchet, KDF, or network ciphertext format is reimplemented.
The local record wrapper stores the actual SDK type/serialization and a SHA256
idempotence digest; it is not a new cryptographic wire protocol. The digest binds
both full SDK addresses, both admitted public identities, operation UUID,
conversation, and plaintext. Same operation with changed inputs rejects rather
than advancing the session or releasing an old recipient's ciphertext.

The independently admitted own identity/private-pair consistency and remote
public pin remain mandatory. The additional protected SOCIAL_IDENTITY slot
signal-address must bind the local SDK address before any SDK crypto/retry.
This slot is a dormant Social-native consumer requirement, not a new shared
producer contract or a device approval proof. There is no issuer, automatic
enrollment, trust inheritance from SSO/Wallet, or production factory.

## Actual evidence

- compile.txt is the initial draft compilation, BEFORE identity public keys were
  added to the retry digest. It is not the final compile result.
- compile-attempt-1.txt preserves the new QA program's initial use of the removed
  Curve API. The fixture was corrected to the pinned SDK's ECKeyPair.generate
  and ECPrivateKey.calculateSignature API, without altering the assertions.
- check-compile.txt and outbox-check.txt are the final source compilation and ten
  real SDK checks: prekey send, receiver decryption, byte-identical retry without
  session change, changed plaintext/conversation rejection, same-address changed
  identity rejection, injected outbox-write rollback and decryptable recovery,
  missing local admission rejection, and unchanged caller plaintext array.
- The receiver is the official SDK's in-memory store. Sender admission/pins and
  transaction rollback are controlled-memory QA, not signed production device
  approvals, Android SQLite, actual Keystore, or crash/anchor proof.

The initial unkeyed-address-only retry draft was corrected before the actual QA
run. No candidate was activated or deployed. The native SDK test uses generated
QA keys only in process memory; no keys or private records are logged or exported.

## Unfinished integration

This consumer supports one device/session only, up to 64 KiB plaintext and 2 MiB
SDK ciphertext. Group fanout/epochs, attachments, migration, receive persistence,
Matrix event routing, transport dispatch/ack, pruning, independently authenticated
device and address enrollment, revocation/recovery, and real durable crash tests
remain incomplete. The outbox has no deletion or acknowledgment API; entries are
retained so retry receipts cannot silently disappear. Native budget exhaustion
holds rather than pruning or resending. These limits are not full product scope.

SDK roundtrip does not prove fresh SPQR contribution. Official JAR build-to-Git
provenance, licensing approval, actual platforms, full crypto32 and original
Social goals, public/installed source binding, ordinary users, and dot/MONSTER
acceptance remain open. SOURCE_HOLD is not self-lifted. Shared producer paths and
production services are unchanged.
