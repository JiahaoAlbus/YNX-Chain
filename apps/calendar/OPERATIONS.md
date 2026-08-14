# YNX Calendar operations

Current product source: `31a34c5736a848eb3fa6d5d3a55ea5187654af14`
Public Web runtime source: `635f6745db8b5d4e4f00253d72fd5ab97da471ac`
Release boundary: public Testnet Web/API with canonical Wallet, not fully centrally integrated, not production scheduling and not production signed.

## Runtime

The Calendar service stores authenticated state at `${YNX_CALENDAR_DATA_DIR:-./var/calendar}/state.json` and its 32-byte HMAC key at the adjacent `.hmac-key` path. The state envelope and payload are both versioned. The service fails closed when the envelope, HMAC, payload JSON, or future state schema is invalid.

Required runtime checks:

```sh
npm test
npm run build
npm run smoke
npm run browser:proof
```

The runtime endpoints are `/v1/health`, `/v1/ready`, `/v1/version` and `/v1/metrics`. API responses include a bounded `X-Request-ID`. Public deployment is proven only when the external runtime, exact build identity and served assets match the release record. These endpoints alone do not prove production scheduling, Mail/push delivery, AI/Data Fabric acceptance or production readiness. The public Web runtime remains an older exact build and is not claimed to expose the newer local telemetry contract.

## Build the state operator

```sh
npm run build:statectl
```

This writes `/tmp/ynx-calendar-state`. Operators may instead use `go run ./apps/calendar/statectl` from the repository root.

## Create an authenticated backup

Create the destination directory first. The command refuses to overwrite an existing backup file and writes mode `0600`.

```sh
/tmp/ynx-calendar-state backup \
  --data-dir ./var/calendar \
  --output ./backups/calendar-YYYYMMDDTHHMMSSZ.backup.json
```

The backup includes:

- backup envelope schema version 1;
- Calendar product identity;
- state payload schema version 1;
- UTC creation time;
- canonical state bytes;
- SHA-256 state digest;
- HMAC-SHA-256 authentication using the Calendar state key.

The backup is integrity-protected but **not encrypted**. Store it only on access-controlled encrypted storage. Do not publish it, attach it to issues, or place it in release artifacts.

## Perform an isolated restore drill

The restore root must already exist. The target must be a new relative path inside that root. The command refuses absolute paths, path escape, symbolic-link traversal, existing targets, stale backups, wrong products, incompatible versions, invalid digests, and invalid HMACs.

```sh
mkdir -p ./restore-drills
/tmp/ynx-calendar-state restore \
  --data-dir ./var/calendar \
  --input ./backups/calendar-YYYYMMDDTHHMMSSZ.backup.json \
  --restore-root ./restore-drills \
  --target drill-YYYYMMDD/state.json \
  --max-age 720h
```

Success returns JSON containing the relative target, state schema version, state SHA-256, user count, event count, and `liveStoreModified: false`. Reopen the restored store and run the Calendar smoke and targeted scenario tests against the isolated data directory before any promotion decision.

## Promotion and rollback

The restore operation intentionally never overwrites live state. Promotion is a separate operator-controlled maintenance action:

1. Stop Calendar writes and confirm no reminder worker is active.
2. Export the current account/state evidence and create a fresh authenticated backup.
3. Verify the isolated restore, state digest, event counts, recurrence expansion, invitation state, audit continuity, and reminder idempotency.
4. Move the current live state and key to a timestamped quarantine location without deleting them.
5. Move the verified restored state and its newly generated key into the live data directory using the platform's atomic maintenance procedure.
6. Start Calendar, verify `/v1/health`, login, event reads, recurrence, reminder recovery, audit, export, and a controlled mutation preview/approve/revert.
7. Roll back by stopping writes and restoring the quarantined live state/key pair if any gate fails.

Do not copy a state file without its matching `.hmac-key`. Do not reuse a restored state file with the old live key.

## Recovery objectives and evidence boundary

The local empty-state drill on 2026-07-29 produced a 522-byte backup and completed the restore command in 61 ms with state SHA-256 `58f20ddf9650f8f3ca038d343694789ee8192273cd80d65bd947a7452ee4b8f4`.

This proves the local control path only. It is not a production-scale RTO/RPO result. Current local RPO semantics are the backup creation point. Production RTO/RPO require representative data volume, encrypted offsite retention, independent key escrow, failure injection, restore host provisioning, and Security/SRE acceptance.

## Key and retention boundary

The backup HMAC is verified with the Calendar state HMAC key. Losing both the live key and its approved escrow copy makes the backup unverifiable. Calendar does not implement key escrow or backup encryption; owner `30-security-platform` must provide the accepted secret-retention and disaster-recovery policy.

Recommended local test retention is short-lived and non-production. Production retention, geographic replication, deletion schedule, legal hold, and service-shutdown export windows remain unaccepted.

## Shutdown and user exit

Before service shutdown:

- stop accepting new mutation approvals;
- keep export and account deletion available for the announced exit window;
- create and verify final authenticated backups under the accepted retention policy;
- publish a truthful status notice through the Website/Status owners;
- preserve audit evidence without exposing private event content;
- revoke central sessions and provider credentials;
- document the final deletion and retention disposition.

Calendar currently has local account export and delete flows, but no approved public shutdown window or offsite retention policy.

## Incident classification

- HMAC mismatch, wrong product, future schema, or digest mismatch: integrity incident; do not retry by bypassing validation.
- Missing state key: recovery-key incident; do not generate a replacement key for an existing state file.
- Reminder replay or duplicate delivery: pause external delivery adapters and preserve audit/state evidence.
- Public route/build/asset mismatch: roll back to the retained exact binary, set the affected public state false and notify Website/Integration owners.
- Central Wallet, Mail, AI, or Data Fabric outage: fail closed and retain local truthful state; do not substitute production mocks.
