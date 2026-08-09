# Migration and compatibility

The authoritative snapshot schema is `ynx-governance-state/v1`; runtime configuration is `ynx-governanced-config/v1`; the API is `ynx-governance-api/v1`; backups are `ynx-governance-backup/v1`.

Unknown schema versions fail closed. Runtime policy drift also fails closed. There is currently no predecessor Governance snapshot and therefore no data migration into v1. A future v2 release must include a pure v1-to-v2 migrator, fixture with every lifecycle status, before/after digests, downgrade or export path, and restart/restore tests before deployment.

API v1 additions may add response fields but cannot silently change lifecycle meanings, source metadata, identity binding, role scope, vote calculation, timelock behavior, or error status. Removing or renaming fields requires a new API version and a documented deprecation window.

Before a migration, stop mutations, create and verify a backup, record source and target release hashes, run the migrator offline, validate the new snapshot, start one canary, and compare counts and selected public records. On failure, stop the canary and restore the preserved v1 artifact. Restart persistence alone is not considered a disaster-recovery drill.

Data export is the validated snapshot plus its backup record. User-facing correction and deletion policy for public vote and audit history requires legal and protocol approval because immutable transparency duties may conflict with deletion requests; this remains unresolved and is not represented as implemented.
