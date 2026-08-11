# YNX Cloud object-storage contract

Status: implemented and tested for the bounded local filesystem adapter. This is not a claim of replicated durability, KMS-backed keys, malware scanning, public cloud availability, or production cloud readiness.

## Write contract

- A logical object write is accepted only after strict JSON decoding, ownership and scope checks, an 8 MiB product bound, quota reservation, MIME/extension validation, and scanner acceptance.
- The service hashes decoded bytes with SHA-256. New blobs are addressed inside an opaque `SHA-256(product, owner)` storage namespace and then by the lowercase 64-hex content digest. Request names, product names, account addresses, and user paths never become filesystem paths.
- Same-name siblings are retained as distinct object IDs. No create, upload, autosave, version restore, or conflict recovery silently overwrites another object.
- Object metadata, immutable version metadata, quota state, and the hash-chained audit event are persisted atomically through a new state snapshot. A failed persistence step restores the previous in-memory state.
- Duplicate content may share one content-addressed blob only within the same owner and product boundary. Cloud and Docs, or two owners, never share a physical reference merely because plaintext hashes match. Permanent deletion removes logical references first, computes remaining `hash + providerRef` references, and calls the provider delete contract only for the final scoped reference. Local deletion verifies the bounded path and hash before removal. Remote writes and direct-upload plans bind the opaque scope; remote deletion binds the expected SHA-256.
- Artifact retention is enforced before logical deletion: legal holds never auto-expire, ephemeral artifacts require a future expiry at creation, and active standard/ephemeral retention timestamps block deletion until the recorded UTC instant. Expiry makes an owner-authorized deletion eligible; it never triggers silent automatic erasure.
- A provider deletion failure returns truthful `logical-deletion-complete` / `physicalDeletion: pending`, persists a redacted owner-visible deletion record, and supports an authenticated retry. It never reports physical erasure before provider success. Completed local deletion proves removal from this adapter only, not media sanitization by a production provider.

## Read contract

- Every object, version, share-preview, download, and restore read loads the referenced digest, enforces the configured size bound, recomputes SHA-256, and rejects a mismatch.
- The API returns `X-Content-SHA256` for verified content. A missing blob, non-regular file, symlink, invalid digest, oversize body, hash mismatch, wrong owner, revoked/expired grant, or revoked/expired link fails closed.
- Reads do not retry corrupted data. Adapter/network retry is permitted only for a transport failure before a verified response and must remain bounded and idempotent.

## Versioned storage lifecycle

- Every immutable file/document version carries a control-plane storage class (`hot`, `cold`, or `archive`), monotonically increasing class version, read mode, and optional transition timestamp. The object summary mirrors only its current immutable version; historical versions keep independent lifecycle truth.
- A lifecycle request requires the exact Wallet account, Product Session product, product-specific write scope, owned object, current immutable version, SHA-256, provider ref, source class and target class. Cloud and Docs sessions are not interchangeable even for the same Wallet account.
- The provider adapter must bind the transition ID, opaque owner+product scope, original provider ref, digest, source class, target class and whether isolation is required. A mismatched or incomplete response is failure, not partial success. Provider evidence and `asOf` are mandatory for completion.
- When another logical version shares the same physical ref and digest, changing one version's class requires copy-on-write. The provider must return a distinct verified ref before the requested version changes class; otherwise both logical versions remain unchanged.
- Archive is fail closed. `Content` returns `restore-required` and does not silently read from the old ref until a provider-bound transition restores an immediate-read class.
- A transition starts as persistent `pending`, becomes `completed` only after a bound provider result and atomic metadata save, or becomes persistent `failed` with a redacted operator-retry reason. `pending` and `failed` transitions block permanent object deletion and product-account erasure so ambiguous provider state is not discarded.
- Schema-v7 migration does not manufacture provider transitions or durability evidence. Legacy immutable versions normalize to bounded direct-read `hot` compatibility; legacy metadata-only records remain without lifecycle state. Production lifecycle claims require provider-native tests for idempotency, restore latency, cache invalidation, replication/erasure coding, region placement, billing and exit migration.

## Quota, timeout, retry, and duplicate rules

- Quota is evaluated over immutable-version bytes deduplicated within each owner and product boundary. Equal content in Cloud and Docs is charged independently because it is physically isolated. A write that would exceed the configured 64 MiB local quota is rejected before metadata commit.
- HTTP bodies, provider responses, scanner reads, and backup files are bounded. Remote Wallet/AI/scanner calls use configured client timeouts; no unavailable dependency is replaced with canned success.
- Clients may retry idempotent reads. Create retries must use the returned object ID or an application idempotency key at the orchestration boundary; blind duplicate create is intentionally visible as another object.
- Offline upload queue entries have stable local IDs and are deleted only after a successful server write. The first failure pauses the queue for explicit retry.

## Backup and restore

- `ynx-cloudd -backup <new-dir>` creates `ynx-cloud-recovery/v1` with exact relative paths, byte sizes, SHA-256 digests, and mode 0600/0700.
- `ynx-cloudd -restore <backup-dir> -data <new-dir>` accepts only a new destination and verifies the entire manifest before atomic placement.
- Restore rejects unknown fields, manifest/version mismatch, duplicate paths, traversal, symlinks, non-regular files, missing/extra files, oversize files, size mismatch, and hash mismatch.
- `apps/cloud/scripts/smoke.sh` proves a Cloud/Docs transaction set, backup, restore, and byte-identical state round trip. `internal/cloud/recovery.go` tests tamper rejection.

## Production adapter requirements

An operator may replace the bounded filesystem adapter only with an adapter that preserves this contract and adds: multi-zone replication, explicit durability target, authenticated encryption with owner-controlled KMS, malware scanning and quarantine, object-lock/retention policy, transactional metadata, bounded retries with jitter, backup restore drills, metrics, and audited credential rotation. Until that adapter and its remote drills exist, `deployedStaging`, `deployedPublic`, and production-cloud claims remain false.

## Presigned direct upload

Only the remote adapter implements direct upload. The control plane requests a short-lived PUT plan over its authenticated provider channel, rejects non-HTTPS destinations except loopback tests, rejects credential-bearing response headers, and never persists the signed URL. The returned URL origin must exactly equal operator-configured `YNX_DIRECT_UPLOAD_ORIGIN`; the same exact origin is the only additional Web CSP `connect-src`. Missing, path-bearing, or mismatched origins fail closed. The client uploads directly, then asks Cloud to complete. Completion requires the provider to bind exact ref, SHA-256, bytes, and `scanStatus: accepted`; only then are authoritative object/version metadata and quota committed. Expired, mismatched, unavailable, unscanned, or local-adapter flows fail closed. API maximum is 5 GiB; the current Web client deliberately limits in-memory SHA-256 preparation to 64 MiB.
