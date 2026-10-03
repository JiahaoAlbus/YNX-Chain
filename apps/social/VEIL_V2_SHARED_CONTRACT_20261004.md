# Draft Veil v2 minimum shared contract, not registered or activated

Root remains the only controller. A owns shared Wallet/Auth/SDK/Host/role/scope,
callback locks and formal release. Social implements only its owned consumer.
Do not treat names in this draft as already-approved actions or wire namespaces.

1. Register one versioned opaque-ciphertext Matrix event/capability contract. Bind
   sender and recipient devices, logical conversation/new room, protocol version,
   message ID, and authenticated membership epoch. Unsupported peers stop new
   private sends; never emit a legacy ciphertext copy for compatibility.
2. Bind the authenticated directory to stable Social identities, independent
   device keys, monotonic versions/revocations, freshness and fork checks. Existing
   Product Session can authorize a product operation but cannot grant history keys
   or add a decrypting device. Add/recovery requires a trusted device or user-held
   recovery; preserve separate account/identity/history recovery outcomes.
3. Prekey serving must consume one-time materials atomically across the actual
   node partition/failover domain and retain upstream last-resort/PQ semantics.
   Route migration needs authenticated versions, conflict/revocation handling,
   deduplication and explicit alternate-node configuration; ordinary MXID does
   not prove arbitrary identity migration.
4. The controlled native libsignal adapter reports exact build/runtime provenance
   and actual handshake/key-mixture state, not a UI assertion. Ratchet advancement
   and ciphertext outbox commit are one native storage transaction; retry returns
   identical ciphertext, authentication failure commits nothing. Preserve keys
   behind platform-controlled handles, independent of funding/validator keys.
5. License disposition, native/browser bridge qualification, original vectors,
   composition review, migration, source/artifact updates and activation remain
   separate approvals. The new policy is not a provider or production switch.
   No unreviewed Web hot update, SSO token, node response or signature algorithm
   label may mark the new engine or active PQ identity authentication approved.

Initial own code: veilCryptoPolicy.ts, bounded metadata write/fanout decisions.
Default integrations must hold while the real native provider is unavailable.
Tests use synthetic metadata, not real keys or crypto proof. Existing Matrix
SDK integration is retained for transport/history while this contract is reviewed.
