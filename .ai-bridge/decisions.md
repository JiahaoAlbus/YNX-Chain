# Decisions — YNX Explorer

## 2026-07-27

### Canonical product identity

The current workspace and branch uniquely match product 12 YNX Explorer. No other worktree may be modified from this thread.

### Pagination authority

Pagination is owned by the Indexer/Explorer API, not by frontend array slicing. The continuation anchor is the last returned block height or transaction hash, wrapped in a versioned HMAC-authenticated cursor.

### Cursor security

- Cursor payload is feed-bound.
- Tampering and cross-feed reuse fail closed.
- Configured keys shorter than 32 bytes are rejected.
- No configured key means process-scoped cursors that expire on restart.
- Health metadata exposes cursor persistence truthfully.
- The key is a secret reference and must not enter Git, logs, evidence or chat.

### Route authority

Canonical public evidence routes are `/block/{height}`, `/tx/{hash}` and `/address/{address}`. Query-string routes remain read-compatible only during migration and must not be the SEO canonical form.

### Summary and freshness authority

The Go Explorer schema using `rpcHeight`, `indexedHeight`, `syncLagBlocks` and a network identity object is authoritative. The frontend reads legacy fields only for migration compatibility; it does not define a second producer contract. Freshness must classify canonical lag as `catching-up` rather than silently treating it as live.

### Failure semantics

An invalid cursor is HTTP 400. An Indexer/RPC outage is HTTP 502. The presence of a cursor must not cause an upstream outage to be mislabeled as a client error.

### Security gate integrity

A validation command that exits 0 after its scanner dependency failed is not accepted as evidence. Explorer therefore owns a Node-based scan covering its runtime, BFF, Indexer, integration and release files without relying on `rg`.

### Release truth

The current checkpoint is locally tested: targeted Go, Race, binary build, frontend unit/build/a11y/E2E, product audit, product security scan and disposable local-Testnet Explorer/Indexer smoke all passed. The long-term goal remains Active because central integration, additional evidence domains, recovery/security/public artifact work and public deployment are incomplete. Repository-wide preflight is not claimed green while other-owner key-permission and Hardhat metadata failures remain.
