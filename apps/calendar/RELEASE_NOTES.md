# YNX Calendar release notes

## Current source candidate

Source commit: `b00f32da16218edb90fcc9f9b504607e374077ce`  
Channel: local-tested, unreleased  
Overall goal: ACTIVE / FREEZE

### Added

- Explicit Calendar state payload schema version 1.
- Legacy schema-zero state normalization and future-schema fail-closed behavior.
- Deterministic authenticated backup envelope with Calendar product identity, state version, UTC creation time, SHA-256 state digest and HMAC-SHA-256.
- Isolated restore API that refuses to overwrite live state or an existing target.
- Path containment, symbolic-link, stale-time, wrong-product, incompatible-version, digest and HMAC rejection.
- Operator CLI for backup and isolated restore.
- Recovery tests, runbook, migration/rollback evidence, SLO/capacity plan, observability plan and unit-economics model.
- Integration test vector `CAL-X-013` for Security/SRE recovery acceptance.

### Verified

- `go test ./internal/calendar ./apps/calendar/statectl`
- `go test -race ./internal/calendar`
- `go vet ./internal/calendar ./apps/calendar/statectl`
- `npm test`
- `npm run test:release`
- `npm run build`
- `npm run build:statectl`
- `npm run smoke`
- `npm run browser:proof`
- Local operator backup and restore drill with matching state SHA-256 and live state unchanged.

### Compatibility

Existing authenticated state without an explicit payload version loads as schema 1. Existing event IDs, recurrence IDs, mutation replay state and audit data remain additive. Unknown future state schema versions are rejected rather than guessed or downgraded.

### Security and recovery boundary

Backups are authenticated but not encrypted. Verification depends on retained Calendar HMAC key material. Encrypted offsite retention, independent key escrow, representative production RTO/RPO, release SBOM/provenance, central Testnet integration, current-source hosted artifacts and public deployment remain unproved.

### Release truth

`implementedLocal` and `testedLocal` are true. `installedLocal`, `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain false for the current source.

Historical `e227c4f0505537b19f4588ea26478c54518f0a4c` preview artifacts remain test-only evidence and are not current-source release proof.
