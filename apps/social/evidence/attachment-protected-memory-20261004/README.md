# Attachment native protected-memory successor, 2026-10-04

Base source: c75ee8eaf5ab7efebc150f563e5ce899924ca752.
Base tree: cb3352f9ed9241a440f7e05f9c4616466db5196d.
Owner: codex/social-wallet-chooser-20261001; controller: 接续测试网生态审计工作.

## Implementation

The existing veil_attachment.c algorithm remains libsodium 1.0.22 secretstream
XChaCha20-Poly1305 with the existing 64 KiB chunk and authenticated FINAL rules.
There is no change to transport framing, identity admission, attachment metadata,
key generation, or the exposed ciphertext structs. Keys and AAD remain the
independently admitted native caller's responsibility; this is not a KeyManager.

Native-owned stream state, key/AAD copies, plaintext sealing snapshot, and decrypted
output now use sodium_malloc plus an explicit successful sodium_mlock BEFORE secret
input is copied. Allocation failure returns RESOURCE; lock refusal returns the new
MEMORY_LOCK_DENIED (-4). There is no unlocked fallback or partial output on failure.
The existing plaintext-free API zeroes the owned bytes then uses sodium_free;
consumers must continue to use that API, not plain free on the payload. State and
sealing snapshot are explicitly wiped before sodium_free. Caller input ownership
and wiping are not transferred to this component.

## Executed checks

- Original actual primitive checker: exit 0, 20 assertions; ordinary roundtrip,
  independent header, wrong key/AAD, tamper, reorder, missing final, truncation,
  header tamper, rejected input and recovery.
- Actual implementation allocator/lock denial checker: exit 0, 56 assertions.
  Both protected-allocation positions fail independently in seal and open, with
  exact RESOURCE/MEMORY_LOCK_DENIED and null output. Allocation tracking returns
  to zero after each failed operation and after the successful plaintext is freed.
  Tamper rejects; a subsequent original ciphertext still decrypts correctly.
- AddressSanitizer + UndefinedBehaviorSanitizer compile/run: exit 0, same 56 assertions.
  Sanitizers instrument the changed attachment module and test driver, not the
  prebuilt libsodium archive or the entire platform application.
- All compilations use -Wall -Wextra -Werror. Commands, compiler version, source
  and library SHA256 inputs, and actual output are retained in this directory.

The failure checker substitutes only the allocator/lock symbols in the ORIGINAL
attachment translation unit. Successful allocations, locks and cryptography use
real libsodium. Synthetic key and metadata only; no real user input is accessed.
These assertions do not independently prove OS memory wiping, process-wide memory
locking, core-dump exclusion, native key custody or a shipping platform policy.

## Release/acceptance boundary

This dormant native component is not enabled in Gradle/Expo, JS or a public service.
No native library installer, signing, enrollment, restore, account request,
transaction or deployment occurs here. activationApproved=false; activated=false.
Original SDK provenance/licensing, real native identity/generation/checkpoints,
atomic restore, real Matrix attachment transport, installed-source binding,
platform tests and MONSTER user acceptance remain open. Whole Social/crypto649
is NOT_COMPLETE. The typed lock failure must be preserved by an eventual trusted
native adapter rather than interpreted as successful encryption or fallback.
