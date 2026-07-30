# Security Platform Infrastructure Candidate Review — 2026-07-25

- Recovered baseline commit: `7a24edbf346af287017b6ee594cc8a9cc036f98b`
- Environment: local worktree
- Evidence class: pre-commit candidate verification
- Public deployment evidence: none
- Cluster installation evidence: none
- Production signing evidence: none

This record corrects the earlier uncommitted draft. It does not claim production deployment, immutable storage, cross-region recovery, secret-manager integration, active monitoring, blue-green rollout, or automatic rollback.

## Executed verification

The following commands completed successfully in the specified worktree on 2026-07-25:

```text
npm run security:test
  29 tests passed, 0 failed

npm run security:verify
  PASS security platform policy, truth, artifacts, secret metadata, and tracked-file gates

node scripts/security-integration.mjs render
  staging: pass, 21 rendered documents
  production candidate: pass, 23 rendered documents
  installedLocal: false
  deployedStaging: false
  deployedPublic: false

node scripts/security-ci-policy.mjs
  PASS workflow is validation-only and contains no deployment credential path
```

## Implemented local controls

### Deployment candidates

- Kustomize base and separate staging/production-candidate overlays;
- default-deny network policy candidate;
- strict Istio mTLS and authorization policy candidates;
- non-root, read-only, capability-dropped Quant worker sandbox;
- bounded quota/autoscaling candidates;
- fixed candidate image tags rather than `latest`;
- staging overlay without the public production Ingress;
- backup schedules suspended by default;
- manifest gate that checks every Deployment and CronJob container for required hardening.

### Backup and recovery

`scripts/security-disaster-recovery.mjs` now performs an actual local encrypted backup and restore, verifies the encrypted envelope, and compares every restored file by byte count and SHA-256. Its result explicitly excludes:

- object-lock or offline-copy proof;
- cross-region recovery;
- production RTO/RPO claims;
- validator, treasury, bridge, oracle, mobile, TLS, deploy, artifact-signing, or recovery-key restoration.

The Kubernetes backup files remain disabled candidates. Destination names are not evidence that immutable or replicated storage exists.

### Rotation

`scripts/security-rotation.mjs` now separates:

1. inventory and operator validation;
2. new manager-version creation through a caller-owned file reference;
3. dependent-service verification and grace period;
4. separately acknowledged old-version revocation.

The tool does not read value material into JavaScript and does not automatically approve break-glass access, reload services, isolate production, or declare an incident.

### SEO/crawler SRE

`scripts/security-seo-monitor.mjs` provides configurable direct HTTP probes for:

- HTTP availability;
- robots directives and environment indexability;
- Sitemap and Canonical;
- JSON-LD, hreflang, and favicon;
- public internal-path leakage;
- crawler log path-probe findings.

Website targets remain pending owner acceptance. No public SEO pass is asserted by this local record.

### CI boundary

`.github/workflows/security-platform-deploy.yml` is validation-only. It contains policy, test, dependency, notice, lint, syntax, and Kustomize gates. It does not contain cluster credentials or mutation commands.

## Machine-readable secret inventory state

`security-platform/secret-inventory.json` remains `not-configured`, stores metadata only, and asserts `valueMaterialStored=false`. The schema covers the required separated types, but there are no production inventory entries, owners, manager locations, rotation records, or recovery acceptance records yet.

## Truth-state impact

This candidate review supports continued local implementation and testing only. It does not change the existing false states for:

- `installedLocal`
- `integratedCentral`
- `deployedStaging`
- `deployedPublic`
- `downloadHosted`
- `productionSigned`
- `storeReleased`

A post-commit evidence record must bind the final files and test outputs to the new full Git SHA before this candidate is used as release evidence.
