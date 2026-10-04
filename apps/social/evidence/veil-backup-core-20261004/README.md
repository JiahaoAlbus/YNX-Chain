# Dormant native user-held backup core candidate

Base: a9da4f6a21384c024eb19cdf7a27463c4d203702. No production activation or actual user key export.

Owned new C core calls selected official libsodium 1.0.22 Argon2id v1.3 and XChaCha20-Poly1305 directly. No custom KDF, cipher or ratchet implementation. An opaque validated SDK backup payload is encrypted with a caller-held password; no service escrow, upload, cloud fallback, passphrase collection, logging or SDK key serialization is added here.

Candidate wire format: 112-byte authenticated header followed by payload ciphertext and 16-byte tag. Offsets: 0 magic VEILBK01; 8 version=1; 9 suite=1; 10..15 zero reserved; 16 uint64BE Argon2id passes=3; 24 uint64BE memory=67108864; 32 uint64BE payload bytes; 40 sixteen random salt bytes; 56 twenty-four random nonce bytes; 80 thirty-two context bytes. Entire header is AEAD additional data. Stored parameters, version, suite and lengths are checked before KDF/allocation. Payload limit 8MiB, nonempty password limit 1024 bytes. Unknown versions/parameters are held rather than downgraded. This parameter choice is a candidate, not a completed mobile performance/strength policy.

Expected context must come from the reviewed native backup/restore binding, not blindly from the artifact, an SSO account string, legacy self-signature or JS flag. Context is public authenticated metadata, not a secret or authority grant. This core cannot attest it. Native SDK export schema/provenance, explicit user review, stable identity/device mapping, independently fresh directory/revocation/checkpoint policy, atomic restore and platform storage are still required. Old history and old backups are not migrated or replaced.

Derived keys/password copies use sodium guarded allocation and explicit memory lock; restored plaintext is guarded and explicitly locked. Lock denial/KDF/allocation failure returns a typed failure with no fallback. On failure output remains unchanged; plaintext is released only after authentication. Free wipes owned buffers. Caller retains responsibility for its original password/payload buffers and must free restored objects promptly. No claim the external uninstrumented dependency or callers are fully sanitizer-covered.

Actual check: clang C11 -Wall -Wextra -Werror with address/undefined sanitizers on owned wrapper/check, linked to the already source-signature-verified exact local libsodium 1.0.22 static carrier. Compile exit0; 28 synthetic checks exit0. Checks include binary roundtrip, old result preservation, wrong passphrase/context, truncation, eleven independently mutated header/cipher fields, fresh salt/nonce, oversize/empty inputs. No actual account secrets used. Dependency/source/build/check hashes retained.

Official references:
- https://doc.libsodium.org/password_hashing/default_phf
- https://libsodium.gitbook.io/doc/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction

NOT_VERIFIED: real/native SDK backup export/restore, public or installed user flow, cross-platform lock failure/cancellation/crash handling, cold persistent user backup recovery, loss/revocation/key migration, password strength UI, cross-process atomic restore, full cryptographic acceptance. No activation, installation, deployment or sensitive Wallet operation. Overall Social v2 and crypto649 goals remain open.
