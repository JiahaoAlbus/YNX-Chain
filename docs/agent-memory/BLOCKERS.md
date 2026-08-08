# YNX Calendar blockers

These are not excuses for unfinished local work. Each blocker is outside Calendar ownership and has an explicit recovery condition.

## CAL-BLOCK-SEC-001 — encrypted recovery acceptance

- Owner: `30-security-platform`
- Reason: local backups are authenticated but not encrypted; verification depends on retained Calendar HMAC key material.
- Raw evidence: `apps/calendar/product-release.json`, `apps/calendar/OPERATIONS.md`, CAL-X-013.
- Prepared: backup/restore implementation, negative vectors, isolated drill, migration and rollback runbook.
- Cannot be solved autonomously here because central secret escrow, offsite retention, artifact security and production recovery policy belong to Security/SRE.
- Minimum input: accepted encryption/retention/key-escrow contract and a runnable representative restore environment.
- Recovery condition: encrypted backup, independent escrow recovery, representative RTO/RPO and promotion/rollback evidence accepted.
- First action after recovery: execute CAL-X-013 on the accepted environment and bind immutable evidence to the exact source commit.

## CAL-BLOCK-INT-001 — central protocol and Testnet

- Owner: `29-integration`
- Reason: Calendar contract and vectors are local-tested proposals, not centrally frozen.
- Raw evidence: `release/integration/calendar-contract.json`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`.
- Prepared: canonical API/scope/event/error/migration/recovery contract and CAL-X-001 through CAL-X-013.
- Minimum input: accepted contract version, dependency commits/endpoints and shared Testnet execution window.
- Recovery condition: Integration records accepted versions and direct Testnet request/audit evidence.
- First action after recovery: run Wallet binding/replay, invite→RSVP→update→cancel, recurrence, sharing, conflict, offline, AI and recovery vectors.

## CAL-BLOCK-DEPS-001 — central product dependencies

- Owners: `14-ai`, `20-cloud`, `25-mail`, `26-data-fabric`
- Reason: AI streaming, attachment, Mail delivery and canonical event transport are missing. Canonical Wallet verification is accepted for the current public Calendar flow.
- Raw evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Prepared: fail-closed adapters, proposed schemas, local negative tests and handoff requirements.
- Minimum input: accepted source commit, health/version, exact endpoint/schema and direct failure/success evidence from each owner.
- Recovery condition: dependency acceptance rows move from pending/not-started to accepted with central proof.
- First action after recovery: rerun the corresponding cross-product vector without production mocks.

## CAL-WEB-FOLLOWUP-001 — auxiliary route and canonical cleanup

- Owner: `28-website`
- Reason: `/dapp/calendar`, the release registry and direct Testnet runtime are public, but the preferred convenience canonical and every auxiliary support/privacy/security/status route still need exact independent probes.
- Raw evidence: `docs/integration/WEBSITE_INTEGRATION_HANDOFF.md`, public release registry and build `fb98415c` health/assets.
- Prepared: current public metadata, FAQ, risks, structured-data proposal and exact publication gates.
- Recovery condition: preserve product-page truth and record Open Graph, JSON-LD, sitemap and required auxiliary-route probes.
- First action: keep the Website registry synchronized with the owner release and verify auxiliary routes one by one.

## CAL-BLOCK-REL-001 — current-source release package

- Owner: `30-security-platform` with `29-integration`
- Reason: no current-source installed artifacts, immutable hosted downloads, SBOM, provenance or production signing evidence.
- Prepared: current release records and truthful separation from historical `e227c4f` preview artifacts.
- Minimum input: accepted artifact build/signing environment and release workflow.
- Recovery condition: exact-source artifacts pass scans, install/cold-start/restart/callback proof and immutable publication.
- First action after recovery: update release records with URLs, bytes, SHA-256, signing class, minimum OS, SBOM and provenance.
