# YNX Security Platform Deployment Candidate Guide

This guide describes the repository's current deployment candidates and operator gates. It does not claim that a Kubernetes cluster, service mesh, WAF, monitoring stack, immutable backup store, secret manager, public endpoint, or production signer is installed.

## Current truth boundary

The repository currently provides:

- Kustomize base and separate staging/production-candidate overlays;
- default-deny network policy and strict Istio mTLS policy candidates;
- a non-root, read-only, capability-dropped Quant worker sandbox;
- resource quota, bounded autoscaling, ingress/WAF, and suspended backup schedule candidates;
- local manifest rendering and policy enforcement through `scripts/security-integration.mjs`;
- local encrypted backup/restore verification through `scripts/security-disaster-recovery.mjs`;
- operator-invoked, two-phase secret rotation through `scripts/security-rotation.mjs`;
- configurable SEO/crawler regression probes through `scripts/security-seo-monitor.mjs`;
- a validation-only GitHub Actions workflow.

The following states remain false until direct evidence exists:

- `installedLocal`
- `integratedCentral`
- `deployedStaging`
- `deployedPublic`
- `downloadHosted`
- `productionSigned`
- `storeReleased`

## Candidate layout

```text
infra/k8s/base/
  namespace.yaml
  network-policy.yaml
  quant-worker-sandbox.yaml
  service-mesh-mtls.yaml
  ingress-waf.yaml
  resource-quotas.yaml
  backup-cronjob.yaml

infra/k8s/overlays/staging/
infra/k8s/overlays/production/
```

`secret-manager-integration.yaml` and `monitoring-stack.yaml` remain separate integration candidates. They are intentionally not included in the default Kustomize base because provider selection, owners, runtime identities, notification destinations, and central monitoring acceptance are not yet evidenced.

## Local verification

Run all policy and regression gates:

```bash
npm run security:verify
npm run security:test
npm run security:integration
node scripts/security-ci-policy.mjs
```

Render candidates directly for review:

```bash
kubectl kustomize infra/k8s/overlays/staging
kubectl kustomize infra/k8s/overlays/production
```

A successful render proves only that the candidate can be assembled and passes repository-local policy checks. It does not prove cluster admission, runtime health, workload identity, storage durability, public availability, or rollback safety.

## Deployment safety gates

Before any cluster mutation, an operator-owned deployment contract must identify:

1. target cluster and environment owner;
2. workload identity and trust domain;
3. certificate authority and rotation policy;
4. secret-manager provider and metadata-only inventory acceptance;
5. image digest, SBOM, provenance, signature class, and verification result;
6. namespace, network policy, ingress, egress, quota, and cost limits;
7. database/schema/configuration compatibility;
8. backup destination, immutability controls, encryption boundary, retention, and restore evidence;
9. health, readiness, SLO, alert, on-call, incident, and rollback owners;
10. explicit deployment and rollback approvals.

The repository workflow does not deploy. It rejects static cluster credential paths and direct mutation commands.

## Staging boundary

The staging overlay:

- uses `ynx-services-staging`;
- removes the public production Ingress candidate;
- binds service-mesh identities and internal network policy to the staging namespace;
- uses fixed candidate image tags;
- keeps every backup CronJob suspended.

A staging deployment is blocked until image digests, cluster identity, storage, runtime configuration, and operator approval are supplied outside Git.

## Production-candidate boundary

The production overlay remains a candidate, not a release. It:

- applies production environment labels;
- increases the Quant worker replica target;
- keeps bounded autoscaling;
- uses fixed production-candidate tags;
- keeps backup schedules suspended.

It must not be applied merely because local rendering passes.

## Backup and restore

The Kubernetes backup schedules are disabled by default. Names containing “immutable” or “replica” describe intended destinations only and are not evidence that storage controls exist.

A real local restore drill can be run with an operator-provided test key file outside the repository:

```bash
node scripts/security-disaster-recovery.mjs local-drill \
  --source security-platform \
  --key-file /operator-controlled/test-key-file \
  --source-commit <full-git-sha> \
  --evidence evidence/security-platform/<evidence-file>.json
```

The drill verifies encrypted backup integrity and byte-for-byte restoration. It explicitly does not prove object-lock immutability, cross-region recovery, production RTO/RPO, or signer recovery.

## Secret rotation

Inventory status is currently `not-configured`; no secret values are stored in the repository.

Review status or create an operator plan:

```bash
node scripts/security-rotation.mjs status
node scripts/security-rotation.mjs plan --secret-id <inventory-id> --grace-seconds 300
```

Rotation execution requires a named operator, an inventory entry, a caller-owned file with restrictive permissions, and explicit acknowledgement. Creating a new version and revoking the old version are separate actions. Emergency rotation additionally requires incident linkage and a reason.

The tool does not automatically approve break-glass access, reload dependent services, isolate production, declare incidents, or bypass a grace period.

## SEO and crawler regression

Targets are configured in `security-platform/seo-targets.json` and remain pending Website-owner acceptance.

```bash
node scripts/security-seo-monitor.mjs regression \
  --config security-platform/seo-targets.json \
  --evidence evidence/security-platform/<seo-evidence>.json

node scripts/security-seo-monitor.mjs scan-log \
  --input /operator-controlled/access-log \
  --evidence evidence/security-platform/<crawler-evidence>.json
```

The probe checks HTTP status, robots directives, Sitemap, Canonical, JSON-LD, hreflang, favicon, environment indexability, and internal-path leakage. Network failure is recorded as failure.

## Read-only cluster verification

After a separately approved deployment, run:

```bash
node scripts/security-integration.mjs cluster \
  --namespace <explicit-namespace> \
  --environment <expected-environment>
```

This mode is read-only. It checks environment binding, default-deny policy, pod readiness, and whether an operator has deliberately activated a backup schedule. It does not mutate, isolate, revoke, roll back, or promote anything.

## Production blockers

Production remains blocked on external inputs and direct evidence, including:

- production infrastructure and deployment authority;
- workload identity, CA, mTLS issuance, rotation, and revocation;
- production secret manager and named owners;
- immutable/offline storage and restore drills;
- secure artifact signer and production signing approval;
- DNS, TLS, WAF/CDN, monitoring, incident contact, and on-call staffing;
- external security testing and legal disclosure review.
