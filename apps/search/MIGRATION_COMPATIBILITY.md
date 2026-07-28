# YNX Search Migration and Compatibility

Version: 4  
Effective: 2026-07-27  
Source commit: `66bc18ea697be99a990143ab0b843652c49931b7`

## Source Registry v3 to v4

Version 4 requires every reviewed source to declare a versioned public-data policy:

- `dataPolicy.version`
- `dataPolicy.allowedClasses`
- `dataPolicy.defaultClass`

The Search-owned policy currently accepts only explicit public classes and rejects
private Social, Mail, Cloud, Wallet, strategy, operator, engineering, credential,
secret, and sensitive-personal classes. Ingestion also rejects unknown classes,
classes outside the source allowlist, and high-confidence credential or internal
engineering content before persistence.

On read, any pre-v4 source that lacks an explicit data policy is migrated
fail-closed:

- `enabled=false`
- `indexingStatus=disabled`
- `migrationRequired=source-registry-v4`
- `lastError` requires explicit public data-class review
- documents from the source are excluded from Search and AI retrieval

No class is inferred from content and no source is silently re-enabled. The
operator must re-register the source against the reviewed v4 contract.

## Earlier registries

Version 3 introduced source owner, jurisdiction, authorization digest and review
time, robots policy, permitted scope, terms and permitted use, data rights,
retention, remedy URLs, languages, freshness, request-rate, and backoff. Version 2
or older entries therefore pass through the same v4 fail-closed gate and require
both renewed governance review and explicit public-class assignment.

## Compatibility

- Search result schema v3 adds `dataClass` and `dataPolicyVersion`; existing v2
  fields remain additive and readable.
- Public source status exposes the reviewed data policy but never raw
  authorization or override evidence.
- Existing databases can be opened; unsafe sources are disabled rather than
  deleted.
- Browser clients must tolerate `backoff`, `disabled`, `migrationRequired`, and
  additive result fields.
- AI clients must not assume ordinary Search eligibility implies AI context
  rights. User filters cannot disable the server-enforced AI-only retrieval gate.

## Rollback boundary

A code rollback to a pre-v4 runtime is unsafe after v4 sources or documents have
been written because older code does not enforce data classes or sensitive-content
rejection. Rollback therefore requires:

1. stop writes;
2. preserve the v4 database and its hash;
3. restore a pre-migration backup to a separate path;
4. run the previous runtime read-only;
5. never merge v4 writes into v3 or older storage;
6. return to v4 through reviewed source re-registration and reindex.

A destructive in-place downgrade is prohibited.

## Verified local recovery

- Source Registry v4 backup manifest with SHA-256 and policy-version binding;
- exact-byte separate-path restore with overwrite and in-place rejection;
- deterministic public projection reindex with metadata/snippet/AI rights preserved;
- tamper, traversal, receipt drift, count drift and unsafe destination rejection.

This local format is not encrypted, off-site durability evidence, or an operational
RPO. Those remain release-policy work.

## Remaining verification

- retention expiry and deletion job;
- reindex from a production-approved registry and raw observation source;
- old Browser client acceptance;
- current-source staging migration and restart evidence.
