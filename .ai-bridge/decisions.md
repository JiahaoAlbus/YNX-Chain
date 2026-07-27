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
