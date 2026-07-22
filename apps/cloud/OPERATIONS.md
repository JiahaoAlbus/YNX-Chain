# YNX Cloud and Docs operations

## Local service

```sh
YNX_WALLET_VERIFY_URL=https://wallet-auth.example.invalid \
YNX_WALLET_VERIFY_TOKEN=operator-secret \
go run ./apps/cloud/cmd/ynx-cloudd -addr 127.0.0.1:8092 -data /absolute/operator/data
```

The service refuses to manufacture sessions when the central verifier is absent. `-dev-wallet` is accepted only on loopback and exists solely for canonical protocol tests. Never expose it on a remote listener.

Health is `GET /health`. It reports bounded local durability honestly. Cloud UI is `/cloud/`, Docs UI is `/docs/`, and the shared audited API is `/api/v1/`. The products keep separate Wallet product/client/bundle/callback bindings and sessions.

## User-exit mode

Before planned service cessation, announce the export deadline through the approved support/status channels, create and verify a recovery backup, retain object-provider read/delete credentials, and start the same release with `-user-exit-mode`. Public and restricted health report `mode: user-exit`.

This mode still permits canonical Wallet authentication, listing, read/download, quota, usage, audit, portable export, logout, grant/link revocation, upload/AI cancellation, trash, permanent deletion, and pending provider-deletion retry. It rejects new uploads, document edits, restores, stars, shares, access decisions, comments, presence writes, and AI jobs with HTTP 423 plus `X-YNX-Service-Mode: user-exit`. Retention windows and legal holds continue to block erasure; operators must not bypass them. Keep the service and provider online until the announced exit window closes, monitor export/deletion failures, and retain the verified backup according to the disclosed policy. This is a controlled user exit path, not proof that public cessation has occurred.

## Backup drill

Stop writers or take a filesystem snapshot, then run:

```sh
go run ./apps/cloud/cmd/ynx-cloudd -data /absolute/operator/data -backup /absolute/new-backup
go run ./apps/cloud/cmd/ynx-cloudd -data /absolute/new-restore -restore /absolute/new-backup
```

Start the service on the new restore directory, verify `/health`, sign in through the canonical Wallet flow, download known objects, compare `X-Content-SHA256`, inspect quota and audit, then switch traffic. Keep the previous directory read-only until the rollback window closes.

## Failure boundaries

- Wallet verifier unavailable: no new session; existing unexpired sessions remain bounded to their exact grants.
- AI provider unavailable, 429, timeout, empty, cancel, or interruption: job records an honest failure; source content and permissions remain unchanged.
- Scanner unavailable/rejects: upload fails; no metadata commit.
- State or blob hash mismatch: service fails closed; restore the last verified backup into a new directory.
- Quota exceeded: upload/save fails before commit; user may delete or export data.
- Physical deletion pending: inspect the owner-visible deletion record, restore provider health/credentials, invoke the authenticated retry endpoint, and retain the audit event. Do not tell the user that bytes were erased until status is `completed`; provider media-sanitization evidence remains a separate requirement.
- Retention: ephemeral artifacts require a future `retentionEndsAt`; legal holds cannot declare automatic expiry; any active retention timestamp blocks permanent deletion until the exact UTC time. Trash and export remain available during retention.
- Direct upload unavailable/CSP blocked: set `YNX_DIRECT_UPLOAD_ORIGIN` to the exact trusted scheme and host used in Provider signed URLs (no path/query), restart, inspect restricted health, and verify the returned plan origin. Never use a wildcard CSP or place Provider credentials in client upload headers.
- Schema migration: stop writers, take a verified recovery backup, start the new binary once, retain the exact versioned migration backup, inspect restricted health for schema 4, verify `/api/v1/usage` starts at zero for unobserved historical traffic, and run smoke. For rollback, stop writers and use `-rollback-state-v1` with a new destination; never replace current state in place. Validate the rollback with the previous binary before cutover.
- Conflict: Docs returns 409 with current version/content; user chooses keep-local-as-new-document or use-server.

There is no replicated object store, KMS, antivirus service, public TLS deployment, production signer, store account, or central registry approval in this branch.
