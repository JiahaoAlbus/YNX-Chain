# Veil V2 authenticated application envelope — exact inactive contract

This contract closes the application-context gap in the actual dormant SessionCipher producer/consumer: `encrypt(plaintext)` currently authenticates only its byte payload, while room/op enter a local receipt fingerprint outside the ciphertext. The observed roomA→roomA-other controlled decrypt/save remains SOURCE_HOLD. This is a versioned **application payload inside the existing reviewed SDK encryption**, not a new cipher, detached hash, caller AAD, trusted directory or activation. The original 06d/4ca limited source gates do not authorize this new wire.

## Current scope and admission

Only direct, one-sender-device → one-recipient-device messaging is defined here. Groups, multi-recipient fan-out, membership epochs, broadcasts, legacy dual-send, migrations and suite downgrade are unsupported and must reject. Historical legacy messages remain read-only through their original reader; a new message is never retried through the old wire.

Candidate suite name `signal-session-0.104.0` identifies the exact existing pinned libsignal SessionCipher source lineage, **not a claim that PQXDH/SPQR/Triple Ratchet or device enrollment is verified**. Sender and receiver must have that matching reviewed SDK/JNI artifact provenance before selecting this suite. No arbitrary suite string or algorithm fallback is accepted. Production suite registration/handshake/device directory and independent monotonic provider remain unimplemented; this contract does not self-enroll them.

A trusted context is read from the original independently authenticated device admission + protected protocol store in one live lease/transaction: local SignalProtocolAddress and serialized IdentityKey, admitted remote SignalProtocolAddress and serialized IdentityKey, authenticated stable routing-session ID, admitted directory generations of both devices, and the negotiated session epoch. None may be sourced only from a request room string, Matrix MXID, SSO subject, transport event, origin epoch, user-supplied metadata or the envelope itself. Existing dormant synthetic verifier/memory checkpoint ports remain engineering-only. If any independent input is unavailable, return VEIL_APPLICATION_CONTEXT_UNAVAILABLE; do not accept an external caller's replacement.

## Exact canonical bytes (network byte order)

The encrypted payload is exactly the following sequence, with no trailing bytes:

1. 8-byte magic: hex `59 4e 58 56 45 49 4c 00` (`YNXVEIL` then NUL).
2. uint16 envelopeVersion =2.
3. uint16 suiteByteLength then ASCII bytes, exactly `signal-session-0.104.0`.
4. uint8 mode =1 (direct one-device).
5. uint16 routingSessionByteLength then strict UTF-8 routingSessionId, 1..512 bytes. This is the authenticated stable route/session identity, not a local UI label.
6. Sender: uint16 addressNameByteLength + strict UTF-8 address name (1..256 bytes); uint32 deviceId in1..127; 33 bytes of exact admitted SDK IdentityKey.serialize(); uint64 independently authenticated directoryGeneration >0.
7. Recipient: same exact four fields and constraints, 33-byte admitted SDK identity. Sender and recipient address tuples must differ.
8. uint64 sessionEpoch >0, from the existing mutually admitted session context. This is not an invented local reset counter.
9. 16 bytes senderMessageId, RFC4122 UUIDv4 variant/version. Persist once in the original protected outbox transaction before releasing ciphertext.
10. uint32 contentByteLength 1..65536 followed by those exact opaque user-content bytes. Content is not normalized, decoded/re-encoded, or used as an authority claim.

Maximum total plaintext envelope =68KiB; compute lengths with checked arithmetic before allocation or SDK encrypt, check encoded total, and reject before any store access/sign/cipher work on invalid fields. Existing content limit stays64KiB; only the SDK envelope buffer cap changes explicitly from64KiB to68KiB. Ciphertext cap remains2MiB. UTF-8 decoding is fatal; reject unpaired UTF-16 in Java inputs, overlong/invalid encodings, controls U+0000..001F/U+007F, zero/oversize strings and extra/truncated bytes. Do not normalize Unicode, percent-decode addresses, reinterpret integers, or repair malformed input. Binary re-encoding must equal the decrypted original bytes.

## Producer and replay contracts

Snapshot all mutable content/admission/address/identity fields before provider entry. Verify the original live device lease and exact peer admission in the transaction, create the stable senderMessageId once, encode the exact envelope and call the existing SessionCipher.encrypt(envelopeBytes). Persist candidate ciphertext, senderMessageId, original envelope/context digest, local outbox operation and ratchet/prekey changes in the same original transaction; release only after its durable checkpoint/commit returns. A retry of the *same local send operation* returns that immutable existing ciphertext/messageId after current admission recheck; it must not generate another ID or encrypt again. A caller changing context/content under that operation is rejected.

SenderMessageId is a stable authenticated sender-generated message identity. Sender's local operation, recipient's local operation/idempotency key and Matrix transport event ID are **different namespaces**, and may legitimately differ. Do not force recipient operation to equal senderMessageId or use an untrusted transport event as the authenticated message ID.

## Receiver and transaction release

Snapshot original ciphertext, packet type and supplied route handle. Validate the real trusted route/peer/local admission first. Inside the original native transaction, decrypt through the existing SDK, then parse strict envelope and match **all** fields against the already trusted current context: version/suite/mode, routingSessionId, sender address/device/identity/generation, recipient local address/device/identity/generation, and current negotiated sessionEpoch. The identity pins come from original admission/store; never adopt envelope pins. Wrong room, recipient, peer generation, session epoch or suite aborts the transaction without saved plaintext, replay receipt or ratchet/prekey commit. No plaintext is returned or rendered before these checks and native durable commit. Memory model checks do not establish real OS transaction support.

The durable incoming replay identity is `(authenticated sender device address, admitted sender identity, routingSessionId, sessionEpoch, senderMessageId)`. It is distinct from recipient local operation. Persist mapping to the original local operation and ciphertext/envelope digest with message and ratchet state in the same transaction. Same authenticated message under a new local operation returns the original committed result only if exact authenticated context/body/ciphertext match the established replay contract; otherwise VEIL_AUTHENTICATED_MESSAGE_REUSE. Never decrypt and save it as a second new message merely because the local operation/Matrix event changed. A retry after unknown commit reads the original durable mapping, never blind reencrypt/redecrypt or rollback.

When copying plaintext for release, preserve private ownership until commit; wipe temporary decrypted/envelope buffers on every exit. A changed lease/admission during the operation aborts before final commit. Advancing an external anchor before a database failure is trusted-recovery-required, never self-reset/re-enroll or accept a new caller checkpoint.

## Typed outcomes and necessary whole-batch tests

Reject with stable codes: VEIL_APPLICATION_CONTEXT_UNAVAILABLE, VEIL_ENVELOPE_VERSION_UNSUPPORTED, VEIL_ENVELOPE_SUITE_UNSUPPORTED, VEIL_ENVELOPE_INVALID, VEIL_AUTHENTICATED_CONTEXT_MISMATCH, VEIL_AUTHENTICATED_MESSAGE_REUSE, VEIL_NATIVE_RECOVERY_REQUIRED. Do not include decrypted content/key bodies in logs. Wrappers may retain their original transaction-aborted envelope with the typed cause. No legacy fallback on any error.

The original unchanged cross-room negative must become a strict rejection with zero message/receipt/ratchet/prekey commit. Also test changed recipient address/identity, sender identity, generations/epoch, suite/version, malformed UTF-8/UTF-16, duplicate/truncated/trailing bytes, content size boundary, independent recipient local operation success, same authenticated senderMessageId replay with different local operation, sender retry immutable ID/ciphertext, late lease revoke, and cold unknown commit. Use actual pinned SDK for cipher tests; keyless codec tests alone cannot close the cipher/context gate. Source/SDK/OS store/real directory/activation/user delivery remain separate gates.

## Ownership and current status

Shared wire/admission contract: A. Owned Java/native Outbox/Inbox codec and direct-message consumer: original Social owner, with its existing protected store/ratchet transaction. Real independent directory/device verifier and durable monotonic provider: A/provider integration, currently missing, not a provided synthetic API. No wallet funds/validator keys are touched or linked. Native Wallet consumer retains its own source ownership and does not become a Social device trust root merely by SSO. This contract is frozen to unblock ordinary Social source implementation; it is not a live registry/consensus/Veil activation approval.
