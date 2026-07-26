# Migration, Compatibility, Backup, and Sunset Policy

Status: pre-production policy  
Applies to: node state, APIs, gateways, indexers, public documentation, and user-exportable product data

## Compatibility contract

Version externally consumed HTTP and JSON contracts. Additive fields may ship in a minor release when clients ignore unknown fields; field removal, type changes, changed signing bytes, changed chain identity, or changed economic semantics require a major version or a separately approved network migration. Consensus encoding, transaction signing, addresses, chain ID, native symbol, and state digests are compatibility-critical.

Every release must publish source commit, artifact digest, schema/state version, minimum compatible client/node version, migration steps, rollback boundary, and known incompatibilities. Unknown build identity is not release evidence.

## State migration lifecycle

1. Inventory the source version and hash the source state.
2. Stop or freeze mutations; retain read access when safe.
3. Back up state, integrity markers, configuration, manifests, and encryption metadata.
4. Restore the backup into an isolated environment and verify its hash before migration.
5. Run the migration deterministically; record input/output hashes and counts.
6. Validate invariants: chain identity, height/hash continuity, balances/supply, nonces, audit references, and indexer boundary.
7. Start canary readers, then limited writers, then the approved topology.
8. Observe for the defined hold period before declaring the rollback window closed.

The current snapshot-v2 migration adds a SHA-256 corruption-detection digest and a separate downgrade marker. It is not keyed tamper proof. A post-migration node must fail closed on a legacy downgrade instead of silently rebuilding state.

## Rollback

Rollback is allowed only to a release that can read the current state or to a verified pre-migration backup after mutations are stopped. Never run old and new authoritative writers against the same state. If post-migration writes make the old schema unable to represent current state, rollback means restore-and-reconcile, not binary replacement. Record any accepted transaction that may be absent after restore and provide a reconciliation decision before reopening writes.

## Backup and restore

Use encrypted, access-controlled, off-host backups with retention by data class. Record creation time, source release, chain height/hash, file list, byte counts, digests, encryption/key reference, storage location, and expiry. Secrets and user data must not enter repository evidence.

Proposed minimum cadence: authoritative state at least each finalized checkpoint and daily full backup; indexer daily or reproducibly rebuildable; configuration on every approved change. These are objectives until infrastructure proves them. Run a timed restore drill before launch and quarterly thereafter, restoring to an isolated network and checking all migration invariants. The current RTO/RPO remains unverified.

## Export and deletion

Products holding user-scoped data must offer a documented machine-readable export that identifies schema/version and omits secrets belonging to other parties. A deletion request must distinguish deletable off-chain personal data from immutable public-chain records. Do not promise deletion of valid public-chain history; instead document unlinking, minimization, retention, and lawful restriction processes. Legal/privacy owners must approve retention periods and exceptions.

## Deprecation and sunset

For a breaking public API or service sunset, publish notice through the documentation, status channel, and registered operator channel. The notice must state affected versions, replacement, migration guide, export deadline, support route, final read/write dates, and residual data handling. Proposed minimum notice is 90 days, but contractual or legal obligations may require longer.

At sunset: disable new enrollment first, then writes, preserve time-bounded reads/exports, revoke credentials and provider access, archive required audit evidence, delete eligible data, and publish completion status. Emergency security shutdowns may compress notice but require an incident record and recovery/export path where lawful and technically possible.

## Release gate

Migration readiness remains false until an owner-approved compatibility matrix, representative migration rehearsal, rollback rehearsal, backup restore drill, retention schedule, export verification, and sunset communication owner are in the evidence index.
