# YNX Cloud object-storage contract

Status: implemented and tested for the bounded local filesystem adapter. This is not a claim of replicated durability, KMS-backed keys, malware scanning, public cloud availability, or production cloud readiness.

## Write contract

- A logical object write is accepted only after strict JSON decoding, ownership and scope checks, an 8 MiB product bound, quota reservation, MIME/extension validation, and scanner acceptance.
- The service hashes decoded bytes with SHA-256. Blobs are addressed only by the lowercase 64-hex digest and written beneath the configured data root; request names and paths never become filesystem paths.
- Same-name siblings are retained as distinct object IDs. No create, upload, autosave, version restore, or conflict recovery silently overwrites another object.
- Object metadata, immutable version metadata, quota state, and the hash-chained audit event are persisted atomically through a new state snapshot. A failed persistence step restores the previous in-memory state.
- Duplicate content may share one content-addressed blob. Permanent deletion removes logical references first, computes remaining hash references, and calls the provider delete contract only for the final reference. Local deletion verifies the path and hash before removal. Remote deletion binds the expected SHA-256.
- A provider deletion failure returns truthful `logical-deletion-complete` / `physicalDeletion: pending`, persists a redacted owner-visible deletion record, and supports an authenticated retry. It never reports physical erasure before provider success. Completed local deletion proves removal from this adapter only, not media sanitization by a production provider.

## Read contract

- Every object, version, share-preview, download, and restore read loads the referenced digest, enforces the configured size bound, recomputes SHA-256, and rejects a mismatch.
- The API returns `X-Content-SHA256` for verified content. A missing blob, non-regular file, symlink, invalid digest, oversize body, hash mismatch, wrong owner, revoked/expired grant, or revoked/expired link fails closed.
- Reads do not retry corrupted data. Adapter/network retry is permitted only for a transport failure before a verified response and must remain bounded and idempotent.

## Quota, timeout, retry, and duplicate rules

- Quota is evaluated over logical current-version bytes per owner. A write that would exceed the configured 64 MiB local product quota is rejected before commit.
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
