# Isolated official libsignal native QA

Owner source baseline: ec51462ea13313c988ba17f1cc814b13f7313c12.
Dependency: @signalapp/libsignal-client 0.104.0, upstream source
257105c55a7389ca6b1e85185e2769465e6729f1 (AGPL-3.0-only).
These are isolated Node native-addon tests, not product activation or browser
support. Test installation used an isolated /tmp directory with install scripts
disabled; product dependencies and lockfiles were not changed.

`session-check.json` records actual SDK-backed synthetic two-device session
checks, tamper/replay rejection, out-of-order delivery, and in-memory transaction
abort/outbox retry behavior. In-memory clone/swap is not durable crash recovery.
No Wallet request, real account, relay or production private data is involved.

`upstream-vector-check.json` covers the original public Kyber1024 serialization
fixture plus fixed upstream ACI/PNI identity encoding vectors. Its SHA-1 Git blob
comparison binds the fixture to upstream bytes; SHA-256 records artifact bytes.
These tests are not KEM encapsulation known-answer tests or PQXDH transcript
vectors. Upstream adaptations retain Signal copyright and AGPL identification.
Production license approval remains separate and unapproved.

Pinned `rust/protocol/src/kem.rs` maps the serialized Kyber1024 type to 0x08.
Pinned `rust/protocol/src/triple_ratchet.rs` calls SPQR send/recv and feeds the
returned key into final message-key derivation before AES-256-CBC and MAC
processing. This establishes an upstream implementation path, NOT an independent
measurement that a tested session completed a fresh SPQR key contribution.
Do not infer that from library presence, successful roundtrips or message size.

Unverified: original PQXDH/ratchet known-answer vectors, actual SPQR contribution,
durable storage/process-crash atomicity, last-resort/multi-node prekeys, mobile and
browser bridges, independent review, migration, activation, installed/public
business journeys, and dot/MONSTER acceptance. Existing product senders are not
switched by this QA.

Reproduction (use an isolated official 0.104.0 package installation):

```sh
node apps/social/scripts/veil-libsignal-qa/upstream-vector-check.mjs PACKAGE_ROOT EVIDENCE_DIR
```

Recorded session-check output is preserved rather than rerunning a previously
green suite. The vector harness first failed on strict Uint8Array-versus-Buffer
type comparison despite identical bytes; comparison now normalizes to Buffer
without changing fixture bytes or weakening byte equality.
