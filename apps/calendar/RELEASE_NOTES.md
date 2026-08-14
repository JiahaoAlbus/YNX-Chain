# YNX Calendar release notes

## Current source candidate

Current product source: `f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2`
Public Web runtime source: `635f6745db8b5d4e4f00253d72fd5ab97da471ac`
Channel: public Testnet Web preview
Overall goal: ACTIVE / FREEZE

### Added

- Explicit Calendar state payload schema version 2.
- Legacy schema-zero and schema-one state migration plus future-schema fail-closed behavior.
- Transactional canonical event outbox for lifecycle, invitation, RSVP, share/revoke, reminder and AI-preview transitions.
- Privacy-bounded canonical records with monotonic sequence, stable idempotency, bounded pull/ack, restart replay, account export/delete and fail-closed overflow rollback.
- Deterministic authenticated backup envelope with Calendar product identity, state version, UTC creation time, SHA-256 state digest and HMAC-SHA-256.
- Isolated restore API that refuses to overwrite live state or an existing target.
- Path containment, symbolic-link, stale-time, wrong-product, incompatible-version, digest and HMAC rejection.
- Operator CLI for backup and isolated restore.
- Recovery tests, runbook, migration/rollback evidence, SLO/capacity plan, observability plan and unit-economics model.
- Integration test vector `CAL-X-013` for Security/SRE recovery acceptance.
- Canonical Wallet public two-user lifecycle and bounded concurrent read proof.
- Compact 390px day/week/month layouts; week view shows all seven days without horizontal scrolling.
- Persistent private activity notifications for invitations, RSVP responses, participant comments, calendar permission changes and revocation.
- Unread count and explicit mark-all-read UI, with privacy-redacted availability-only notifications.
- Preparation and travel buffers bounded to 0–240 minutes, included in conflict previews.
- Authorized attendee availability checks that require explicit calendar/event sharing and return only Busy plus the attendee handle.
- Five deterministic conflict-free weekday drafts for timed single events; choosing one returns to editing and never saves automatically.
- IANA-aware conversion for guest event creation and editing, independent of the browser process time zone.
- A real close control that cannot accidentally submit the event form.
- Bounded request IDs plus health, readiness, version and Prometheus request telemetry using route-template labels.
- Current-source unsigned macOS CLI/Web companion archive verification: SHA-256 `56c8bd7390148a7e6f1efcb1b1a3e97a80e07f5ca87353e8ccc51729e4b6dbed`, 3,058,403 bytes, 0.563-second cold launch and 0.018-second restart.

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
- Public health, served assets and exact binary build identity for `635f6745`; 100/100 HTTP/2 health responses at parallelism 10; ComputerControl exact-build sign-in and guest Calendar proof; immediate Service Worker takeover; rollback binary retained. A 25-way fresh-TLS probe exposed an ingress capacity risk and is not counted as passed.

### Compatibility

Existing authenticated state without an explicit payload version and explicit schema-one state load as schema 2. Existing event IDs, recurrence IDs, mutation replay state and audit data remain additive; the outbox and its sequences initialize safely. Unknown future state schema versions are rejected rather than guessed or downgraded.

### Security and recovery boundary

Backups are authenticated but not encrypted. Verification depends on retained Calendar HMAC key material. Encrypted offsite retention, independent key escrow, representative production RTO/RPO, release SBOM/provenance, full central Testnet integration and current-source native artifacts remain unproved. The Web/API runtime is public but explicitly not a production scheduling service.

### Release truth

`implementedLocal`, `testedLocal`, `installedLocal`, `websitePublished` and `deployedPublic` are true. `installedLocal` is supported by the current-source unsigned macOS CLI/Web companion only; it is not an all-platform or signed-release claim. `integratedCentral`, `deployedStaging`, `downloadHosted`, `productionSigned` and `storeReleased` remain false for the current source.

Historical `e227c4f0505537b19f4588ea26478c54518f0a4c` preview artifacts remain test-only evidence and are not current-source release proof.
