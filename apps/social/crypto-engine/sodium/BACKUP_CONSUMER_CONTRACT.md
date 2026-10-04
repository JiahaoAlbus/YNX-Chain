# Native backup consumer required inputs

Candidate C ABI source: 9aa659033ad3f494d119facc575362f021dcbca9. This contract is a required-input request to the existing unique native/shared owner, not a new provider, store, authorization grant or activated backup path.

The owned C functions are veil_backup_seal/open, veil_backup_bytes/size/free. Exact candidate format and fixed KDF parameters are in apps/social/evidence/veil-backup-core-20261004/README.md. Existing libcipher/native payloads are not automatically converted.

## Required original native producer

1. Exact admitted CryptoEngine/libsignal SDK/platform build identity and the SDK-supported bounded export/import representation. Provide the existing original key/session state schema, not JSON assembled from keys or a JS-created substitute. Payload is opaque, 1..8MiB. Unknown version or unreadable legacy state remains retained.
2. Current native account/device/key namespace, independently established device directory/provenance/generation/revocation/checkpoint bindings and an original operation identity. Wallet/SSO identity, MXID, legacy self-signature and local UI flags do not substitute these facts. No secret values belong in the handoff.
3. Native-only explicit user backup/restore review and native password entry. Password bytes never cross into JS, a service request, analytics, logs, shared UI text or the controller handoff. Strong user-held recovery material policy and Argon2id performance/memory admission must be tested on each actual target.
4. An exact externally reviewed 32-byte expected backup context bound to the original native namespace/backup lineage. Context is public authenticated metadata, not a new trust root. Restore cannot simply adopt context from an untrusted artifact. No public account string or SSO-derived guess is sufficient by itself.
5. Source-bound official libsodium 1.0.22 for each admitted Android/iOS/macOS build, native bounded file input and cancellable ownership of secret buffers. The local arm64 static check binary is not a platform library or signed package. Explicit memory-lock denial must surface without downgrade.
6. Original current-observer checks before export/open, after every external/native await, before file publication or applying restored state. Late result from a revoked/switched account is wiped/released without touching the new account; started writes remain recoverable under their original operation, not falsely undone by a stale response.
7. Existing atomic native restore transaction/checkpoint/rollback facilities, preserving original account IDs, keys, history, inbox/outbox and unresolved operations. Authentication success is not permission to replace state. No key wipe, self-enrollment, implicit migration, auto-restore or new parallel key store.
8. Exact normal dedicated QA device window and matching protected producer. User follows ordinary confirmation and verifies export, cancel, wrong input, revocation/switch, process death, unknown save, cold restore and retained old history through actual UI. Synthetic source checks are not A/B/C users, installed acceptance or MONSTER.

## Boundary ownership

Social retains its owned backup core and consumer UI; the existing unique native/shared owner supplies authoritative SDK/OS/identity/registry/protected producers and coordinates platform/release locks. Host/package signing/activation remains with that owner and Root. No new emulator, device lease, key directory, service endpoint or stopped shared branch is authorized by this document.

Until the actual producers and review exist: dormant candidate only, activationApproved=false, activated=false; do not expose a fake working backup button, accept JS fixture authority or operate real user keys. Continue independently executable Social UI work. This missing producer does not close the full Social v2 or crypto649 goal.
