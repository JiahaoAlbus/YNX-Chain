# Veil v2: one-page actual baseline and next integration batch

Requirements: all 649 lines of YNX_Chain_Social_Crypto_Core_Rebuild_v2_ZH.txt read;
SHA256 ccafae671b2d325abd0e2bd2bfa403289a0b84f7dfc768345d41d39daa5385e8.
Original Social C01-C07/V01-V17 and Telegram-like product goals remain intact.

| Actual baseline | Gap / selected next work |
| --- | --- |
| Source 613801de preserves X25519/HKDF/XChaCha/Ed25519 functions and Matrix native consumers. Public guest bytes differ from source. | Neither is the new PQXDH/Triple Ratchet core. No production migration or activation is approved. |
| Official Matrix 26.09.07 full SDK is SwiftPM, not a trunk Pod. Social's exact-source/checksummed local bridge resolved 97 Pods and the original iOS app built and installed/launched in its dedicated simulator. | UI verification stopped at the Mac lock boundary. Matrix remains transport/account/history infrastructure, not the target new-message cipher. |
| Selected libsignal v0.104.0 / 257105c55a7389ca6b1e85185e2769465e6729f1; official Node 0.104.0 has the same gitHead and recorded SRI. Rust pin uses SPQR v1.6.0; minimum Rust 1.93.1/JDK21. | AGPL-3.0-only obligations, unsupported third-party use, native bridge tests, vectors and actual PQXDH/SPQR state confirmation must be resolved. Node success is not browser support. |
| Selected libsodium 1.0.22-RELEASE / 77e1ce5d6dee871c49ef211222ba18ef0c486bda, ISC. | Bind mature secretstream and Argon2id with independent attachment/backup keys and bounded formats; do not replace protocol KEM/AEAD or hand-write chunk nonces. |
| New draft write policy checks exact source/runtime bridge, license, peer/device binding, trusted-device/self-recovery authorization, revocation freshness, actual mixed SPQR, migration and activation. | Metadata unit tests are not libsignal execution or S03 E2E. No existing sender is switched by this module. Next: controlled native provider, atomic session/outbox and original vectors in isolated QA. |

Migration: preserve accounts, logical conversations, contacts/groups, history,
backup and device records. New versioned rooms/events negotiate Veil; read old
XChaCha/Olm/Megolm via a read-only LegacyReader. Do not dual-send new private
payloads or silently downgrade. Trusted device/user-held recovery, not SSO,
grants decryption. Restored archives never resume old sending counters.

Minimum A contract: one approved event/capability version; authenticated device
directory/revocation and atomically consumed prekeys; logical-conversation route
mapping across two nodes; native key-handle/transaction binding to the current
actor without exporting keys; separate license/review/activation/update gates.
Detailed draft is in VEIL_V2_SHARED_CONTRACT_20261004.md. No shared file is edited.

Risks: metadata/federation linkage persists; PQXDH identity authentication remains
classical. ML-DSA social authentication is a separate unreviewed extension, not a
green claim. S01-S12/X01-X04, full product journeys, real dot/MONSTER, independent
review, migration, actual packages/public delivery and human acceptance remain
open. Chain H_TX/H_CONS, genesis, balances, validators and funding keys untouched.
