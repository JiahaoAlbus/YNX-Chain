# Official JNI transaction-port adapter, not active product wiring

Base source: be99a1ad56a559925152dcdbbef8800080c56e19.
SDK bytes: org.signal:libsignal-client:0.104.0, 158492237 bytes,
SHA-256 c2b415784ea95b6552a87bea4b644d1f5178142cb7cc4113c0b2c68a35c43ec9,
matches the official published checksum. Selected upstream source is
257105c55a7389ca6b1e85185e2769465e6729f1; build provenance to that commit is
NOT_VERIFIED. Product dependency/lockfiles are unchanged, AGPL disposition open.

VeilSignalProtocolStore lives outside active Gradle sources. It implements the
official interface against the native transaction port: serialized sessions,
identity pins, own enrolled public/private pair, registration and prekeys. The
own public pin is checked before private-record access, and the derived private
public key must also match. Unapproved peers are not trusted or auto-saved.
KEM purpose must already be in protected enrollment metadata. One-time use
removes the KEM record; last-resort retains it and rejects reused signed/base
tuples. Legacy SenderKey writing and reading are explicitly not this engine.
Old Matrix/LegacyReader data and senders remain unchanged.

Actual compile: Kotlin native port against Android API 36/JVM17; Java adapter
against official 0.104.0/JDK24 with release21. Actual desktop JNI runtime with
-Xcheck:jni: 10 adapter/lease checks passed. The fixture uses the real native
authority primitive but a SYNTHETIC admission verifier and IN-MEMORY record port.
This is not authenticated enrollment, Android SQLite/Keystore, durable JNI
transaction atomicity, multi-node prekey consumption or full last-resort
publishing/rotation verification. Producer key-ID retirement/rotation and
independent verified-public-identity mapping still need closure.

Checkpoint canonical-type fix is a separately recorded follow-up after this JNI
test; final native component compilation covers that fix. Old JNI/lease green
suites were not repeated merely for a counter. The legacy REAL revision alias
and its SQL regression are preserved in veil-checkpoint-canonical-20261004.

Remaining gates: actual native proof verifier, independent verified peer/device
identity directory and own-public mapping; durable external checkpoint/recovery;
Android device, platform toolchain/packaging and JNI callbacks on that store;
fresh SPQR contribution and protocol vectors; paired groups, two real nodes,
migration/backup/attachments; independent review/license/activation; all Social
product journeys and actual dot/MONSTER user validation. No real account, funds
key, Wallet prompt, sign/tx, deployment or activation occurred in this QA.
