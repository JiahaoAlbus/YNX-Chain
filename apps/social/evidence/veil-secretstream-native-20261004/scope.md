# Dormant native attachment algorithm component

Based on production source checkpoint dea5b92a5b1d78868d9b2305a9d5b9b995658106.
Uses official libsodium secretstream_xchacha20poly1305, not a custom cipher/KDF.
Reference: https://doc.libsodium.org/secret-key_cryptography/secretstream

Actual installed dependency is libsodium1.0.20. Previously selected1.0.22 is NOT
installed/integrated/provenance-admitted by this evidence. No dependency upgrade
or production build configuration changed. No shared/Host/Chain changes.

Native-only component accepts externally protected key and admitted metadata,
uses bounded64KiB chunks with required final tag, and exposes the candidate
plaintext only after all chunks authenticate. Candidate plaintext, key copies,
metadata copies and sodium state are wiped on failure/free. Handles and buffers
require exclusive native ownership; no concurrent mutation guarantee is claimed.
25MiB attachment and4096B metadata budgets are local component limits, not a
negotiated public wire format. No versioned framing or transport is activated.

clang c11 -Wall -Wextra -Werror with address+undefined sanitizers passes compile
and runtime, exact exits retained. 20 checks exercise synthetic multi-chunk
roundtrip, distinct random headers, wrong key/AAD, middle tampering, swap,
missing final frame, shortened final frame, header tamper, and recovery using
unmodified cipher. Two invalid-seal checks use an already occupied output slot;
they prove preserving/rejecting occupied output, NOT isolated size-boundary
coverage. No allocator-failure, memory-locking or live OS-key proof is claimed.

Missing before production: native protected-key/authorization lifecycle wrapper,
actual Android/iOS bridges and exact1.0.22 build provenance/packaging, atomic
storage/publication/revocation, negotiated metadata/framing and recipients,
Matrix attachment transport/UI, platform failure/recovery and actual user tests.
This is an inactive prerequisite, NOT Social acceptance or ready-to-release.

Reproduction:
clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer $(pkg-config --cflags libsodium) apps/social/crypto-engine/sodium/veil_attachment.c apps/social/crypto-engine/sodium/veil_attachment_check.c $(pkg-config --libs libsodium) -o "$STAGE/check"
"$STAGE/check"
