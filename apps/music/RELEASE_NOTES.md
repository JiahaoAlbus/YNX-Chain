# YNX Music release notes

## 0.3.0-testnet — active release candidate

Runtime source commit: `22653153c62529f782f44b0a35177b531ae7e8af`

This is a local Testnet candidate, not a public or store release. No commercial catalog, paid royalty finality, production signing, immutable download, shared-Testnet integration or public deployment is claimed.

### Runtime integrity and recovery

- Keeps YNX Trust case and YNX Pay settlement idempotency account-scoped, atomic and compatible with legacy global replay claims.
- Rejects same-key changed-body requests without creating a second record.
- Publishes in-memory state only after the durable copy-on-write save succeeds.
- Verifies state integrity, the full audit sequence/hash chain, track identity and every referenced private media object at startup.
- Introduces persisted state schema v2 and a versioned migration registry.
- Verifies the original schema-v1 integrity and audit chain before a one-version v1→v2 migration, then persists v2 atomically.
- Rejects unknown future schemas, tampered legacy state and migrations that do not advance exactly one version.
- Adds consistent state-plus-media backup manifests with SHA-256 and byte counts.
- Restores only into clean destinations after verifying state, audit and media integrity; existing data is never overwritten.

### CI and platform evidence

- Exact-source GitHub Actions run `30417406111` completed successfully for commit `22653153c62529f782f44b0a35177b531ae7e8af`.
- Service gates passed: Go tests, Race detector, daemon smoke, Wallet contract audit and twelve-locale audit.
- Android unit/build gates and artifact upload passed; physical-device install and production signing remain unverified.
- iOS dynamically created a Simulator, built and installed the app, cold-started it, rejected a tampered callback and restarted it.
- The iOS result is unsigned Simulator evidence only, not physical-device, TestFlight or App Store evidence.

### Release and integration package

- Updates `product-release.json`, public metadata, feature evidence and migration/operations documentation to the exact source commit.
- Keeps Website publication, runtime deployment, hosted downloads, central acceptance, production signatures and store release false.
- Keeps the lawful catalog boundary explicit: only owned, licensed, public-domain or clearly test-only media may be used.

### Remaining release blockers

- Wallet, Pay, Trust, AI and Data Fabric contracts require owner acceptance and shared-Testnet evidence.
- Android physical-device installation/cold-start evidence is absent.
- Remote disaster-recovery rehearsal, measured RTO/RPO and a schema-v2 downgrade/minimum-compatible-version policy are absent.
- FLAC/MP3 ingestion, malware quarantine, private object storage/CDN and signed expiring media URLs are incomplete.
- Licensed public catalog and independent rights evidence are absent.
- Threat model, automated security scans, reproducible artifacts, provenance and immutable public artifact hosting are incomplete.
- Capacity, SLO and unit-economics measurements are absent.
- Public runtime, `ynxweb4.com/music` publication, production signing and store release remain false.
