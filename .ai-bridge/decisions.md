# Decisions — YNX Trust Center

## D-001 Product authority

Use the exact product-15 workspace/branch match and Trust-specific runtime/handoff as authority. Do not follow stale global Social next-action files.

## D-002 Persistence integrity

Adopt snapshot format version 2 with a SHA-256 seal verified before state admission. Preserve decodable version-1 state through one-time atomic migration rather than resetting or discarding it.

## D-003 Truthful health

Expose the state format and tamper-evident capability through `/health`; do not imply external signing, remote attestation or audit.

## D-004 Release state

Keep installation, central integration, deployment, hosting, production signing and stores false until direct evidence exists.

## D-005 Scope enforcement priority

Treat stored-but-unenforced central Wallet scopes as the next highest-priority security defect. Runtime route-level enforcement is required before central acceptance.

## D-006 Cross-product ownership

Submit contracts, vectors and handoff to canonical owners. Do not modify Wallet/Auth, Integration, Governance, Website or Security worktrees from product 15.

## D-007 Subject export boundary

Expose a read-scoped export only for records owned by or concerning the authenticated account. Omit central session bindings, replay internals, persistence seals and other subjects; never expose an auditor-wide bulk export through the subject route.

## D-008 Recovery immutability

Backups and restored stores are new mode-`0600` files created without overwrite. Verify envelope identity/hash, embedded snapshot integrity, persisted Wallet bindings and manifest counts before writing a restored store, then prove cold-start admission.

## D-009 Integrity truth boundary

SHA-256 backup and state seals prove byte consistency and detect corruption or partial tampering; they are not an external signature, hardware attestation or substitute for restricted storage, encryption and independent audit.
