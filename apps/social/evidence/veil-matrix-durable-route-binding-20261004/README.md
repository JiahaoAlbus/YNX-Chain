# Durable Matrix route binding successor

Source parent: a1aaf49fef4f101e2a7d0933b6d42c7d03eaa4d3.
This is a dormant source repair, not an activated release or runtime admission.

The protected operation binding now stores a versioned 76-byte VMX3 record:
magic, independently reviewed durable native routing generation, authenticated
application-context digest, and exact homeserver/self/peer/room routing digest.
The digest is a comparison binding, not a cryptographic trust producer.
The generation must come from independently admitted native authority; a JS
value or a process epoch does not satisfy this contract.

Preparation checks this binding before encryption in the same native
transaction. Subsequent send and original-event observation check the persisted
binding before continuing. Changing the generation while preserving context
and routing fails closed. Reopening the same admitted generation and routing
is permitted. Legacy 32-byte bindings and missing bindings with existing
journal or cipher records remain retained recovery cases; they are not adopted,
rewritten, rebound, or automatically sent. UNKNOWN resend policy is unchanged.

Evidence scope:

- Java journal model: 22 assertions, synthetic cipher and in-memory storage.
- Durable route binding model: 18 assertions, synthetic authority and storage.
- Updated Kotlin pipeline compiled in the same module as original native store
  sources against the pinned Matrix SDK API and libsignal artifact.
- Artifact hashes and modified-source hashes are recorded in SHA256SUMS.txt.

The prior independent-review finding remains preserved in the parent commits.
These checks do not prove a real NativeRoutes producer, protected OS storage,
monotonic anchor, actual SDK upload/send, raw UTF-8 validation before FFI,
bounded upstream SDK streaming/cancellation, device/public lifecycle, or the
complete Social acceptance goal. No deployment, account request, signing,
transaction, key collection, or device activation was performed.
