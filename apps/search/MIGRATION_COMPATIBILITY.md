# YNX Search Migration and Compatibility

Version: 3  
Effective: 2026-07-27  
Source commit: `52c70f74220df06208b6a415580a5a879c4a8cb8`

## Source Registry v2 to v3

Version 3 adds explicit source owner, jurisdiction, authorization digest and
review time, robots policy, permitted scope, terms and permitted use, data
rights, retention, remedy URLs, languages, freshness, request-rate and backoff.

On read, any pre-v3 source that lacks these fields is migrated fail-closed:

- `enabled=false`
- `indexingStatus=disabled`
- `migrationRequired=source-registry-v3`
- a visible operator error requires renewed governance review
- documents from the source are excluded from Search and AI retrieval

No raw authorization reference is synthesized. The operator must re-register the
source using reviewed evidence and the v3 contract.

## Compatibility

- Search result schema v1 remains readable by existing clients.
- New public source-status fields are additive and redact legacy raw evidence.
- Existing v2 data files can be opened; unsafe sources are disabled rather than
  deleted.
- Browser clients must tolerate the new `backoff` and `disabled` source states.
- AI clients must not assume ordinary Search eligibility implies AI context rights.

## Rollback boundary

A code rollback to a pre-v3 runtime is unsafe after v3 sources have been written,
because older code does not enforce the same governance or AI data-right fields.
Rollback therefore requires:

1. stop writes;
2. preserve the v3 database and hash;
3. restore a pre-migration backup to a separate path;
4. run the previous runtime read-only;
5. never merge v3 writes into v2;
6. return to v3 through reviewed source re-registration.

A destructive in-place downgrade is prohibited.

## Remaining verification

- versioned backup/restore drill for v3;
- retention expiry and deletion job;
- reindex from approved registry and raw observation source;
- old Browser client acceptance;
- staging migration on the current source commit.
