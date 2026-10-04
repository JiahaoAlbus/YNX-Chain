# Matrix wrapped storage key failure cleanup

Base source: 97c5562075f456300eb80bc2584a027a28e4dbe2.

Original probe: three failures, one pass. The generated 32-byte plaintext wrapping secret survived encryption or device-ID generation failure; a decrypted invalid-length key survived rejected recovery. Original failures are retained verbatim.

Repair: generate into an explicitly owned buffer and wipe in finally before attempting record insertion, including random generation/metadata/encryption failures. Wipe invalid-length decrypted output before rejecting recovery. The successful recovered key remains usable by its existing caller. Original AES-GCM format, nonextractable key, AAD, device ID rules, read-before-add transaction, preserved original records and recovery error contract are unchanged.

Validation: four boundary tests plus existing session UI tests: 87 pass, zero fail. The final focused file additionally uses actual Node WebCrypto AES-GCM with controlled database fixtures: six pass, zero fail, including original-device/key restoration and rejection of corrupted ciphertext without replacing the original record. Isolated source web build passed using existing owner dependencies. No shared dependencies or runtime authority were changed.

Scope: JavaScript-owned buffers only; this is not proof of wiping browser/engine copies, protected native memory, real IndexedDB durability, a browser/private-service journey or production Matrix authentication. The real WebCrypto tests use an in-memory controlled database, not an installed application or public deployment. No account authorization, signature, transaction, device activation, private identity, deployment or MONSTER acceptance occurred. Full Social/crypto acceptance remains NOT_COMPLETE.
