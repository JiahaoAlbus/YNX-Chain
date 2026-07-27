# YNX Trust Center Operations

Runtime source: `d31811280ba741026c74a836a212f78fe88c172a`  
Release state: active local candidate; not centrally integrated or publicly deployed.

## Trust state boundary

The product-local state path contains cases, evidence metadata, appeals, labels, AI explanation records, audit records, replay digests and hashed central-session bindings. It does not persist plaintext Wallet session tokens, private keys or seed material. Treat the state and every backup as sensitive operator data.

Required filesystem controls:

- state, backup and restored files: regular file, mode `0600`;
- parent directory: no group/other access;
- no symlink source or destination;
- storage encryption and remote custody are external SRE gates, not provided by the SHA-256 consistency seals.

## Create an immutable backup

Use a point-in-time admitted store. Stop writes during the operator ceremony when a precisely quiesced checkpoint is required.

```text
ynx-trust-backup create -store <state.json> -out <new-backup.json>
```

The destination must not exist. Successful output is a JSON manifest with schema/product identity, creation time, state format, SHA-256, exact bytes, record counts and sequence.

## Restore drill

Always restore to a new path first:

```text
ynx-trust-backup restore -backup <backup.json> -store <new-state.json>
```

The command verifies backup source mode/type, envelope identity and integrity, exact state hash/bytes, embedded version-2 state seal, persisted Wallet session bindings and manifest counts. It then creates a new `0600` store and performs a cold-start admission check. It never overwrites an existing store.

## Rollback procedure

1. Stop public writes and preserve the current store/logs as evidence.
2. Select a backup by manifest creation time, source context and SHA-256.
3. Restore to a new path; do not replace the live store in place.
4. Cold start the restored path and run the Trust health/smoke gates.
5. Compare subject export, transparency counts and expected sequence with the rollback checkpoint.
6. Switch the service configuration only after independent operator review.
7. Retain the pre-rollback store under incident policy; never delete it automatically.

## Verification commands

```text
go test -race ./internal/trustproduct ./cmd/ynx-trust-backup
go vet ./internal/trustproduct ./cmd/ynx-trust-backup ./apps/trust-center
go test ./internal/trustgateway ./internal/trustproduct ./apps/trust-center ./cmd/ynx-trust-backup
./apps/trust-center/check.sh
```

## Recovery truth

The local drill proves deterministic backup validation, rollback to an earlier state, exact restored bytes and clean-process admission. It does not yet prove remote encrypted custody, multi-region recovery, production RTO/RPO, disaster-network access, external signing or independent SRE acceptance.
