# YNX Finance Decisions

## 2026-07-27

### Source evidence is health-gated

Finance will not treat an account endpoint response as authoritative unless Explorer health is available, operational and identifies `YNXT`. This prevents a reachable but mismatched or unhealthy source from becoming a portfolio fact.

### Source status is explicit

Every Finance source adapter must expose source, version, `asOf`, timestamp semantics, bounded coverage, synchronization state and failure reason. Availability alone is insufficient.

### Activity cursor design

Finance activity cursors use HMAC-SHA-256 and bind version, Wallet account, offset and the current activity snapshot. The snapshot is derived from record IDs and timestamps. Cursor tamper, cross-account reuse or changed data fails closed and requires pagination restart.

### Cursor key boundary

`YNX_FINANCE_CURSOR_SIGNING_KEY` is a distinct operator secret with a minimum length of 32 characters. It must not reuse Wallet, Pay, AI, provider or production signing credentials. Rotation intentionally invalidates old cursors; this is safer than silently accepting pagination across source snapshots.

### Current upstream limit remains truthful

Finance continues to fetch the latest 100 Explorer transactions and does not claim complete history or opening balance. A true account-history cursor must be owned and frozen by Explorer before Finance changes that statement.

### Product boundary remains read-only

Future Exchange, DEX, Quant and Economics integrations will consume versioned evidence only. Finance will reject signing, withdrawal, trading, owner-change, risk-limit, leverage or treasury mutation capabilities and deep-link users to the owner product for any action.

### Backup authentication and encryption boundary

Finance backup envelopes use a distinct operator-managed HMAC-SHA-256 key of at least 32 bytes. Authentication detects alteration and wrong-key use; it is not encryption. Backup storage encryption, access policy and retention remain Security/SRE responsibilities and must not be inferred from the envelope format.

### Restore is offline and fail-closed

Every Finance writer must be stopped before a live restore. Restore verifies the envelope first, preserves the existing state with hash/byte evidence, atomically installs the snapshot, reopens it and automatically rolls back when post-write verification or receipt persistence fails. A running process must never be allowed to overwrite the restored disk state from stale memory.

### Version compatibility is explicit

Version 1 is the first persisted Finance state schema. Unknown fields and unsupported versions are rejected. Missing version-1 collection fields are normalized only for backward compatibility inside the same schema. No invented legacy migration is claimed; a deterministic forward and rollback migration test is required before any version increment.

### Security scanners must not fail open

A missing primary text scanner may use a tested fallback, but command-not-found or scanner errors cannot be reported as a clean result. The repository placeholder and sensitive-material gates now distinguish matches, no matches and scanner failures.
