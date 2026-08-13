# YNX Calendar feature completion evidence

Runtime source: `73d0a66f8143b7a87d4a2f55125ae784a40433dc`
Overall status: **ACTIVE / FREEZE**

## Release-state truth

| State | Value | Direct evidence |
|---|---:|---|
| implementedLocal | true | Calendar service, Web client, native clients, recurrence mutation scopes and state operator are present. |
| testedLocal | true | Calendar unit, Race, Vet, Web, browser, build and smoke gates pass. |
| installedLocal | false | Current-source all-platform install/cold-start proof is incomplete. |
| integratedCentral | false | Canonical Wallet is accepted; AI, Mail, Data Fabric and shared Integration acceptance are missing. |
| deployedStaging | false | No direct staging runtime proof. |
| deployedPublic | true | Exact-build public Web/API and health proof at `calendar-testnet.43.153.202.237.sslip.io`. |
| downloadHosted | false | No immutable current-source artifact URLs. |
| productionSigned | false | No production signing or notarization proof. |
| storeReleased | false | No store listing or review proof. |

## Completed local recovery slice

- Calendar state payload schema version 1 is explicit.
- Missing/zero legacy state schema loads and normalizes to version 1.
- Negative or future state schema versions fail closed.
- Backups are deterministic for identical state and timestamp.
- Backup envelope includes product identity, state version, UTC creation time, state SHA-256 and HMAC-SHA-256.
- Restore writes only to a new isolated relative target.
- Restore verifies the new state by reopening it and comparing the digest.
- Tampered, wrong-product, incompatible-version, stale, future-time, absolute, path-escaping, symbolic-link and existing-target inputs fail closed.
- Operator output reports the relative target and never claims that live state was modified.
- Local CLI drill completed with matching state digest.

## Direct tests

| Gate | Result |
|---|---|
| `go test ./internal/calendar ./apps/calendar/statectl` | pass |
| `go test -race ./internal/calendar` | pass |
| `go vet ./internal/calendar ./apps/calendar/statectl` | pass |
| `npm test` | pass |
| `npm run test:release` | pass after script addition |
| `npm run build` | pass |
| `npm run build:statectl` | pass |
| `npm run smoke` | pass |
| `npm run browser:proof` | pass; desktop/mobile proof and zero console errors |

The 390px proof renders all seven week headers at once with no horizontal overflow. Public build `73d0a66f` serves the same CSS/JavaScript and health reports the exact commit. Its notification center covers invitation, RSVP, comment, calendar-permission and revoke activity; unread state is persistent, availability-only notices are privacy-redacted, and Mail delivery remains explicitly separate. ComputerControl confirmed the public control and the guest fail-closed message. A 100-request health probe at parallelism 50 returned 100 HTTP 200 responses.

Recovery-specific tests:

- `TestCalendarBackupRestoreIsAuthenticatedDeterministicAndIsolated`
- `TestCalendarRestoreRejectsInvalidInputs`
- `TestCalendarLegacyStateSchemaNormalizesAndFutureSchemaFailsClosed`
- `TestExportDeleteCookieAndStoreTamper`
- `TestPersistenceEventStateConflictIdempotencyAndRestart`
- `TestLegacyRecurrenceLineageNormalizesOnRestart`
- `TestRecurrenceMutationScopesAreAtomicReplayableAndRecoverable`

## Local drill

- Backup size: 522 bytes for the empty-state fixture.
- Restore command duration: 61 ms.
- State SHA-256: `58f20ddf9650f8f3ca038d343694789ee8192273cd80d65bd947a7452ee4b8f4`.
- Live store modified: false.
- Classification: local empty-state control-path proof only.

## Remaining acceptance gates

1. Security/SRE encrypted offsite retention, independent key escrow and production-scale restore drill.
2. Integration acceptance of Calendar contract and CAL-X-013.
3. AI, Mail and Data Fabric Testnet flows plus shared Integration acceptance; canonical Wallet already has direct public proof.
4. Current-source Android, iOS and macOS install/cold-start evidence.
5. Current-source SBOM, provenance, immutable hashes and hosted artifacts.
6. Continue Website product/support/privacy/security/status route probes and keep the published registry synchronized.
7. Representative performance, capacity, RTO/RPO and unit-economics measurement.

No local test, historical preview artifact, handoff file or bare HTTP 200 is represented as central integration, production signing or store release. Public deployment is true only because exact build identity, content, health, runtime URL and Website registry were checked together.
