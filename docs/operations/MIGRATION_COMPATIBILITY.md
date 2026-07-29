# YNX Seller Console Migration and Compatibility

Source commit: `a90d1ee59eec38c15ce42b39420f2625ed758dd0`  
Current persistence schema: `Snapshot v6`

## Supported migration path

Seller Console accepts historical state through Snapshot v6 and migrates older supported snapshots forward on open.

| Source | Runtime behavior |
|---|---|
| v2 | Migrates legacy `manager` roles to canonical `admin`; initializes revocations, Seller events and invitations. |
| v3 | Preserves canonical roles; initializes revocations, Seller events and invitations. |
| v4 | Preserves revocations; initializes Seller events and invitations. |
| v5 | Preserves legacy-compatible Seller events; initializes invitations. |
| v6 | Opens without schema migration. |
| Greater than v6 | Fails closed before normalization or write. |

The runtime never treats an unknown future schema as v6 and never rewrites it downward.

## Normal backup and restore

When `YNX_SHOP_STATE_HMAC_KEY` is configured, the primary state and backup use an HMAC-SHA256 integrity envelope. The key must decode to at least 32 bytes.

A normal write copies the previous primary state to `<state>.bak` before atomically replacing the primary file. Backup restoration verifies the HMAC and supported snapshot version before replacing the primary state.

Example restore:

```sh
YNX_SHOP_STATE_HMAC_KEY=<64-or-more-hex-characters> \
  ynx-shopd --state /secure/path/state.json --restore-backup
```

Do not restore an unsigned backup into a production-class integrity-protected runtime.

## Explicit rollback export

Rollback is an export operation, not an in-place downgrade. The command writes a new file and exits:

```sh
YNX_SHOP_STATE_HMAC_KEY=<64-or-more-hex-characters> \
  ynx-shopd \
  --state /secure/path/state.json \
  --export-rollback /secure/path/state-v5-rollback.json \
  --rollback-version 5
```

Safety properties:

- Supported targets are v3, v4 and v5 only.
- The active state path cannot be the destination.
- An existing destination is never overwritten.
- The active Snapshot v6 state is not mutated.
- The integrity envelope is retained when configured.
- Seller invitations make every older target unrepresentable and therefore fail the export.
- Seller events make v3/v4 unrepresentable.
- Seller revocations make v3 unrepresentable.
- v6-only invitation, role, status or expiry fields in Seller events make v5 unrepresentable.

A failed export is not permission to delete the unrepresentable records. Resolve the rollback plan at the operator and product-ownership level instead.

## Seller data portability export

The authenticated store owner may request:

```text
POST /api/seller/stores/{storeId}/exports
```

Request body:

```json
{
  "Purpose": "operator-approved service exit or portability request"
}
```

The result is store scoped and includes:

- store profile;
- catalog, variants and inventory;
- orders and attached settlement/refund evidence;
- Seller roles, invitations and revocations;
- local Seller integration Outbox;
- store-scoped Audit records, including the export event.

It excludes unrelated stores, buyer profiles and carts outside the store export boundary, AI jobs, rate-limit windows, idempotency records, provider credentials and browser session material. The export is a local Seller Console evidence package; it is not proof of canonical Data Fabric ingestion.

## Transient retention

Retention pruning is deliberately narrow. It may remove only:

- terminal AI jobs with status `applied_draft`, `rejected` or `cancelled` at or before the cutoff;
- rate-limit samples at or before the cutoff.

The cutoff must be at least 30 days old. Failed, running, permission-granted or review-required AI jobs are retained.

Preview:

```sh
YNX_SHOP_STATE_HMAC_KEY=<64-or-more-hex-characters> \
  ynx-shopd \
  --state /secure/path/state.json \
  --prune-transient-before 2026-06-01T00:00:00Z
```

Apply after reviewing the counts and protected classes:

```sh
YNX_SHOP_STATE_HMAC_KEY=<64-or-more-hex-characters> \
  ynx-shopd \
  --state /secure/path/state.json \
  --prune-transient-before 2026-06-01T00:00:00Z \
  --confirm-prune-transient
```

Protected classes are never removed by this operation: stores, products, orders, settlement/refund evidence, Seller roles, invitations, revocations, Seller Outbox, Audit, idempotency records, buyer profiles and carts.

## Pre-production migration gate

Before a production-class schema change or rollback:

1. Freeze writes for the scoped service.
2. Record the source binary commit and Snapshot version.
3. Copy the HMAC-protected state to an access-controlled staging location.
4. Verify normal open, future-version refusal and backup restoration.
5. Generate the rollback export only if the target is representable.
6. Start the target binary against the exported copy, never the active state.
7. Run Seller invitation, role, order, settlement and Audit read checks.
8. Record hashes, commands, operator identity and outcome.
9. Keep the original v6 state immutable until the rollback window closes.

Local tests prove the implementation boundary. An authenticated staging-copy drill and Owner 30 release review are still required before production-class use.
