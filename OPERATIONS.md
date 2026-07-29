# Security Platform Operations

## Promotion

Build in an unprivileged isolated worker, generate SBOM and provenance, scan dependencies/container/artifact, reproduce the build, and register its digest. A separate authorized deploy identity verifies policy and signature before canary or blue-green promotion. Rollback targets an already verified immutable digest.

## Secret rotation

Inventory metadata identifies owner, manager reference, expiry, runbook, and last drill evidence. Create a new version in the manager, narrow access, deploy consumers, verify dual-read only when supported, revoke the old version, and attach audit evidence. Never print values. Emergency rotation also invalidates sessions or artifacts derived from the credential.

## Break-glass

Require an incident ID, two independent approvers, exact scope, reason, expiry under one hour, and an isolated operator identity. Alert immediately. Record commands and results without secrets. Revoke at expiry or earlier, rotate touched credentials, and review within one business day.

## Backup and restore drill

Quiesce or use an atomic snapshot mechanism; export database, object, chain/config, and release metadata; encrypt before leaving the workload boundary; create hashes and object counts; copy to immutable/offline and cross-region storage. Restore into an isolated environment, verify hashes and application invariants, run smoke tests, record achieved RPO/RTO, and destroy drill credentials. Signer recovery is a separate multi-party ceremony.

The local drill tool accepts a key file without printing its value:

```sh
node scripts/security-backup.mjs create --source SNAPSHOT_DIR --output BACKUP.enc --manifest BACKUP.manifest.json --key-file RUNTIME_KEY_FILE --source-commit SOURCE_SHA
node scripts/security-backup.mjs restore --backup BACKUP.enc --manifest BACKUP.manifest.json --destination EMPTY_RESTORE_DIR --key-file RUNTIME_KEY_FILE
```

The key file must contain 32 raw bytes or 64 hexadecimal characters, be created outside the repository with owner-only permissions, and be destroyed after a local drill. Production backup keys require Secret Manager or HSM-backed custody and separate recovery approval.

## Artifact build and verification

`npm run security:artifact` creates a commit-bound deterministic tar archive, CycloneDX SBOM, SLSA candidate provenance, and unsigned manifest under `dist/security-platform/`. The result cannot be promoted publicly.

The local drill independently rebuilds the archive, compares both SHA-256 digests, creates an ephemeral in-memory Ed25519 test signer, persists only a public JWK and detached signature, verifies the artifact set, and proves rejection of manifest tampering, artifact tampering, unknown signer identity, and test-signed public promotion:

```sh
node scripts/security-artifact.mjs local-drill \
  --source-commit SOURCE_SHA \
  --output release/artifacts/SOURCE_SHA \
  --evidence evidence/security-platform/LOCAL_ARTIFACT_DRILL_SOURCE_SHA.json
```

Production signing is not implemented by the local tool. It requires an approved external secure signer, signing identity, certificate chain, timestamp, transparency record, revocation path, product/environment/release binding, and independent verification evidence.

## Incident sequence

Declare severity and incident commander; preserve evidence; contain with the least destructive action; communicate confirmed facts and uncertainty; eradicate; recover through verified artifacts and backups; monitor; notify affected users when required; publish a redacted postmortem with actions, owners, and dates.

Required exercises are credential compromise, compromised service, artifact tamper, DDoS, region failure, database loss, object loss, CI supply-chain failure, backup restore, rollback, accidental production noindex, quant-worker escape attempt, and public security evidence generation.
