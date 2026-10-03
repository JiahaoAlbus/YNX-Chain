# Dormant native inbox / receive persistence

Base: 52e09b7e0397137e2f353375fc1cfb327a739bd7. Only Social-owned source
and evidence change; no shared callback, authority producer, or release path.

VeilSignalInbox wraps actual VeilNativeStore.transaction. SDK session/prekey
updates, retained INBOX_MESSAGE, and INBOX_RECEIPT writes occur in one callback.
Exceptions escape to the outer transaction. Native plaintext is returned only
after transaction completion. The native store seals the message using its
existing per-device key and record kind/id binding; no plaintext SQL table is
introduced. Message copies can be explicitly closed to wipe the retained array.

Receipts bind both complete addresses, both public identities, operation UUID,
conversation, SDK type, and ciphertext. Exact retry reads retained plaintext
without replaying consumed prekeys or advancing a session. An orphan receipt
or message requires recovery rather than reset/re-decryption. SenderKey/legacy
types are refused, not downgraded. No receipt pruning or acknowledgment API is
added; native budget exhaustion remains a HOLD, not automatic data loss.

## Evidence

runner.txt records a fresh native Kotlin API36 compilation and Java21 target
compilation, followed by ten actual SDK receive checks. This initial run is
before the final pre-SDK raw-address wrapper constructor change. Its exact
inputs are retained in initial-runner-inputs.sha256, not claimed final bytes.

final-inbox-check.txt records the final Java compilation's actual SDK checks:
receipt-write fault rolls back SDK/prekey/message changes in controlled atomic
memory; real receive recovers; curve/KEM one-time keys are consumed; retry does
not mutate; conversation/ciphertext reuse rejects; orphan receipt requires
recovery; missing peer pin denies plaintext; legacy type refuses; closed message
denies access and caller ciphertext is preserved. Ten pass, exit 0.

Final source/class/native-port/JAR checksum binding and final compile results
are in sibling veil-context-encoding-20261004/binding.txt. The strict string
fix affects receive and send; their final SDK regressions are separately named.

These are real SDK crypto with synthetic enrollment and controlled atomic
memory transactions. They do NOT prove Android Keystore/SQLite behavior, crash
recovery, authenticated monotonic anchors, real device approvals, fresh SPQR,
or native UI release. No private keys/records are printed or exported.

## Remaining product scope

The consumer is one device/session only. Real directory/revocation/anchor
providers, trusted recovery, group/epoch fanout, attachment encryption, Matrix
event-to-operation mapping/routing, migration/history continuity, two actual
nodes, full native/platform integration, public/installed source binding,
licensing and vendor build provenance, all crypto32 and original Social v2
goals, ordinary user trials, and dot/MONSTER remain incomplete. No public or
Expo factory exists; code stays outside active Gradle source. No protocol
activation, deployment, wallet authorization/signing/transaction occurred.
