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

- Owners: `02-wallet-auth`, `14-ai`, `20-cloud`, `25-mail`, `26-data-fabric`
- Reason: deployed/accepted Wallet verification, AI streaming, attachment, Mail delivery and canonical event transport are missing.
- Raw evidence: `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Prepared: fail-closed adapters, proposed schemas, local negative tests and handoff requirements.
- Minimum input: accepted source commit, health/version, exact endpoint/schema and direct failure/success evidence from each owner.
- Recovery condition: dependency acceptance rows move from pending/not-started to accepted with central proof.
- First action after recovery: rerun the corresponding cross-product vector without production mocks.

## CAL-BLOCK-WEB-001 — `/calendar` route fallback

- Owner: `28-website`
- Reason: `https://ynxweb4.com/calendar` returns HTTP 200 but serves the generic YNX Chain homepage and canonical `https://ynxweb4.com/`.
- Raw evidence: public probe at 2026-07-29T03:10:38Z and `docs/integration/WEBSITE_INTEGRATION_HANDOFF.md`.
- Prepared: current public metadata, FAQ, risks, structured-data proposal, asset list and exact publication gates.
- Minimum input: Website deployment commit consuming current metadata.
- Recovery condition: Calendar-specific visible content and canonical `https://ynxweb4.com/calendar`, plus Open Graph, JSON-LD, sitemap and required route probes.
- First action after recovery: probe content and metadata; set `websitePublished`/`deployedPublic` true only if direct evidence matches.

## CAL-BLOCK-REL-001 — current-source release package

- Owner: `30-security-platform` with `29-integration`
- Reason: no current-source installed artifacts, immutable hosted downloads, SBOM, provenance or production signing evidence.
- Prepared: current release records and truthful separation from historical `e227c4f` preview artifacts.
- Minimum input: accepted artifact build/signing environment and release workflow.
- Recovery condition: exact-source artifacts pass scans, install/cold-start/restart/callback proof and immutable publication.
- First action after recovery: update release records with URLs, bytes, SHA-256, signing class, minimum OS, SBOM and provenance.
