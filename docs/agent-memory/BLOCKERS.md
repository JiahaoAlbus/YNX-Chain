# Blockers

These are external dependencies, not substitutes for remaining autonomous engineering.

## CLOUD-PROVIDER-001

- Owner: Cloud infrastructure operator.
- Reason: No provisioned S3-compatible object-store endpoint, bucket, region, KMS policy, scanner service or secret-manager reference is available.
- Original evidence: `product-release.json`, `OBJECT_STORAGE_CONTRACT.md`, `FEATURE_COMPLETION_EVIDENCE.md` and provider tests keep remote durability false.
- Prepared: provider-neutral adapter, lifecycle state machine, retries, dedup scope, migration/backup/restore scripts, DAST smoke and operator contracts.
- Why autonomous completion is impossible: remote durability, provider KMS, scanner, CDN, replication and cross-region behavior require an actual provider account and operator-controlled secrets.
- Minimum input: endpoint, region, bucket, secret-manager references, KMS key policy, scanner endpoint and approved test namespace.
- Resume condition: credentials are available through the approved secret path and the test namespace permits destructive lifecycle/restore drills.
- First action after input: run provider acceptance, lifecycle, migration, backup/restore, cross-region and failure-injection suites against the provisioned namespace.

## CLOUD-CENTRAL-001

- Owner: YNX 02 Wallet/Auth and YNX 29 Integration.
- Reason: Cloud/Docs product registrations remain disabled and central schema review is pending.
- Original evidence: `apps/cloud/integration/central-integration.json`.
- Prepared: exact product IDs, client IDs, bundle IDs, callbacks, scopes, algorithms, session limits, failure vectors and registry patch.
- Why autonomous completion is impossible: another owner controls the central registry and shared Testnet acceptance.
- Minimum input: reviewed multi-surface registration semantics and commit-bound acceptance result.
- Resume condition: enabled registration and verifier endpoint are available in the shared integration environment.
- First action after input: execute canonical Wallet session, replay, revoke, expiry, cross-product and unavailable-verifier vectors against the shared environment.

## CLOUD-WEBSITE-001

- Owner: YNX 28 Website, after YNX 29 acceptance.
- Reason: The public `/cloud` status page still advertises stale source `7b3c5f427c17` and local-candidate text.
- Original evidence: `apps/cloud/evidence/PUBLIC_ROUTE_AUDIT_20260729.json`.
- Prepared: `apps/cloud/integration/website-handoff.json`, current metadata, release truth and evidence index.
- Why autonomous completion is impossible: product 20 does not modify the Website worktree or Vercel deployment.
- Minimum input: owner-28 consumption and deployment of the handoff after owner-29 acceptance.
- Resume condition: the deployed website bundle reports the accepted source SHA and preserves false runtime/download states until direct proof exists.
- First action after input: re-audit HTML, canonical, deployed bundle, source commit, status language and download/runtime claims.

## CLOUD-RELEASE-001

- Owner: production release operator.
- Reason: No production signing identity, immutable registry/package host or store account is available.
- Original evidence: `product-release.json` and `ARTIFACT_MANIFEST.json`.
- Prepared: candidate build, checksums, local provenance, SBOM, CI image scan and release notes.
- Why autonomous completion is impossible: production signing and publication are irreversible privileged operations.
- Minimum input: signing authority, immutable destination and approved release classification.
- Resume condition: release operator authorizes the exact accepted source SHA.
- First action after input: rebuild from the accepted SHA, verify reproducibility, sign, publish, checksum, install-test and update release evidence.
