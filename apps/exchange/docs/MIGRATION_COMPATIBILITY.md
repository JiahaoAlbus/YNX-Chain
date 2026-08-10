# YNX Exchange migration and compatibility

Runtime evidence commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

## Persistent state

Current schema: `9`.

Schema evolution represented by the current codebase:

- v2: dead-man switch state;
- v3: hash-chained execution event sequence;
- v4: conditional orders and reserved-balance lifecycle;
- v5: OCO groups with one shared reserve;
- v6: TWAP schedules, reserve state and child linkage;
- v7: iceberg display/replenishment and explicit queue-priority sequence;
- v8: atomic scale-plan parent/child linkage;
- v9: persistent Quant strategy kill state and nonce-domain ownership used for aggregate-capital reconciliation.

Startup verifies the whole-state integrity hash before normalization or rewrite. Unknown future schema versions and invalid hashes fail startup. The v9 migration path normalizes missing additive maps, raises `schemaVersion` to 9 and writes through fsync, atomic rename and directory sync with a new integrity hash.

Direct generated compatibility vectors currently prove:

- schema v1-shaped state can be integrity-verified and rewritten as v9;
- schema v8-shaped state using the reconstructed v8 field layout can be integrity-verified and rewritten as v9;
- tampered v1/v8 vectors fail startup;
- a killed Quant nonce domain and its order ownership survive v9 restart.

Tests: `TestStateSchemaV1MigratesToCurrentAfterLegacyIntegrityVerification`, `TestStateSchemaV8MigratesToV9AndRejectsTamper`, Quant kill/restart tests and aggregate-capital/restart tests.

### Compatibility limitation

The repository does not contain immutable byte fixtures captured from every historical v2–v8 runtime. The current fallback has explicit legacy layouts for v1 and v8 only. Therefore real historical v2–v7 files are **not claimed compatible** and may fail closed at integrity verification. Before public deployment, each shipped historical schema needs an immutable fixture produced by its source commit, expected hash, forward migration test and rollback/export test. The two remote attempts to retrieve historical source through GitHub on 2026-07-27 timed out during TLS handshake, so no remote-history claim was substituted.

The migration does not intentionally discard orders, balances, ledger entries, sessions, deposits, withdrawals, fees, audit events or idempotency records. That invariant is locally tested for the available vectors, not universally proven for absent historical bytes.

## API and authorization compatibility

- Existing GTC limit authorization remains `ynx-exchange-order-v1`.
- New TIF/Post-only and Market IOC requests use `ynx-exchange-order-v2`.
- Amend uses `ynx-exchange-amend-v1`.
- Order cancel uses `ynx-exchange-cancel-v1`.
- Mass cancel uses `ynx-exchange-mass-cancel-v1`.
- Dead-man control uses `ynx-exchange-dead-man-v1`.
- TWAP creation/cancel use `ynx-exchange-twap-v1` and `ynx-exchange-twap-cancel-v1`.
- Iceberg creation uses `ynx-exchange-iceberg-v1`; active/hidden remainder uses the order-cancel signature.
- Scale creation/cancel use `ynx-exchange-scale-v1` and `ynx-exchange-scale-cancel-v1`.
- Quant mandates use `ynx-quant-execution-adapter-v1`.
- Persistent strategy kill uses the distinct `ynx-quant-strategy-kill-v1` payload. A mass-cancel signature is deliberately incompatible.

New JSON response fields are additive. Strict request decoding continues to reject unknown request fields. Old clients can continue submitting signed v1 GTC limit orders.

## Rollback and deprecation truth

Binary rollback to a build that does not understand schema v9 is unsafe after v9 has been written. No automatic destructive downgrade exists. Operators must restore a verified pre-migration backup or use a separately reviewed export transformation after reconciling dead-man state, conditional/OCO/TWAP/iceberg/scale orders, Quant kill domains and stream consumers.

A production-grade rollback migration, remote encrypted backup/restore drill, retention policy, immutable historical fixture set and full old-client conformance matrix remain required before public deployment.
