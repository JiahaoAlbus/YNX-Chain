# YNX Music release notes

## 0.3.0-testnet — active release candidate

Runtime source commit: `74716a19d95fc191b54102adc02000a91fafec24`

This is a local Testnet candidate, not a public or store release. No commercial catalog, paid royalty finality, production signing, immutable download or public deployment is claimed.

### Runtime integrity

- Made YNX Trust case and YNX Pay settlement idempotency account-scoped and atomic.
- Added replay compatibility for legacy global idempotency claims.
- Rejects same-key changed-body requests without creating a second record.
- Added sixteen-caller concurrency coverage for Trust and Pay intents.
- Changed persisted state mutations to copy-on-write: memory is updated only after durable save succeeds.
- Restored private audio and artwork paths after restart without serializing server paths into public JSON.
- Added failed-persistence and restart media recovery tests.

### CI and platform evidence

- Enabled the `music-platforms` workflow on the final Music branch.
- Added Go unit/integration, Race, daemon smoke, Wallet contract and 12-locale audit jobs.
- GitHub Actions run `30277833892` proved Service and Android jobs green for the runtime source commit.
- The same run failed the iOS Simulator job; iOS remains unverified and has no current artifact or installation proof.
- Rebuilt Android debug, instrumentation and unsigned release APKs locally and recorded hashes, bytes, minimum OS and signing class.

### Release and integration package

- Added truthful `product-release.json` and `ARTIFACT_MANIFEST.json`.
- Added public metadata for the `/music` website handoff without claiming publication or runtime deployment.
- Added a versioned Music integration contract, dependency acceptance matrix and cross-product negative vectors.
- Added a machine-readable full-goal coverage matrix and recovery logs.

### Known release blockers

- iOS Simulator build failure must be diagnosed and closed.
- Wallet, Pay, Trust, AI and Data Fabric contracts require owner acceptance and shared Testnet evidence.
- Migration, rollback, backup and restore drill are not implemented.
- FLAC/MP3 ingestion, malware quarantine, private object storage/CDN and signed expiring media URLs are incomplete.
- Licensed public catalog and independent rights evidence are absent.
- Threat model, automated security scans, reproducible artifacts, provenance and public artifact hosting are incomplete.
- Android and iOS current-commit install/cold-start evidence is incomplete.
- Capacity, SLO, RTO/RPO and unit-economics measurements are absent.
- Public runtime, production signing and store release remain false.
