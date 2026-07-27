# YNX Monitor Decisions

## 2026-07-27 — Permission-based RBAC

Decision: Sensitive Monitor operations are authorized by explicit permissions, not by checking a single `operator` role name.

Rationale: The product goal requires separate Viewer, Operator, Incident Commander, Backup/Recovery, and Security Reviewer boundaries. Permission checks make least privilege testable and allow central Wallet/Auth to assign scoped roles without changing route code.

Compatibility: `operator` remains temporarily mapped to all current permissions so existing deployments are not locked out. It is a migration role, not the preferred role for new assignments.

## 2026-07-27 — Independent recovery verification

Decision: Incident Commander manages the incident through mitigation and starts recovery verification, but Backup/Recovery must verify recovery with direct evidence before the incident can become resolved.

Rationale: The same actor that coordinates mitigation should not be able to self-certify recovery. This creates a concrete separation-of-duties gate without giving Monitor infrastructure credentials.

## 2026-07-27 — Versioned fail-closed incident lifecycle

Decision: Incident state follows `open → acknowledged → investigating → mitigated → recovery_verifying → resolved → postmortem_complete`. Invalid jumps return conflict, repeated target-state actions are idempotent, and every changed transition appends timeline and audit evidence.

Rationale: Free-form status mutation is ambiguous, difficult to recover, and easy to misrepresent. A versioned state machine makes restart, migration, testing, and cross-product integration deterministic.

## 2026-07-27 — Health is process-scoped

Decision: `/health` reports only Monitor control-plane and state readiness. It does not aggregate or imply ecosystem health. `/version` leaves commit and release null until real identities are injected.

Rationale: A static HTTP 200 must never be described as chain, Oracle, Quant, provider, Testnet, or public health.

## 2026-07-27 — Rollback remains non-executing

Decision: Monitor may record a rollback proposal after explicit approval but cannot execute rollback.

Rationale: Infrastructure execution belongs to the central Security/SRE/Release owner. Monitor must not gain deployment credentials or create a hidden control path.

## 2026-07-27 — Managed E2E process ownership

Decision: Playwright must directly manage dedicated frontend and backend Node processes with isolated ports and a per-run HMAC state file. It must not reuse unknown existing servers.

Rationale: Reusing stale servers produced non-reproducible results, while changing integrity keys against shared state correctly caused fail-closed startup. Isolation preserves security and test repeatability without deleting state.

## 2026-07-27 — Truthful release state

Decision: Local tests and build set only `implementedLocal` and `testedLocal`. Central integration, staging, public deployment, hosted download, production signing, and store release remain false until direct evidence exists. A command interrupted by connector 502 has no result and cannot be reported as pass or fail.

## 2026-07-27 — Independent recovery evidence

Decision: Backup/Recovery may register backup artifacts, report restore drills, and propose rollback, but Security Reviewer must independently verify backup, restore, and rollback evidence. The same actor cannot create and verify the same record, even through the transitional broad Operator role.

Rationale: Role permissions alone do not prevent self-certification when a compatibility role has both capabilities. Actor-level separation closes that bypass while preserving migration compatibility.

## 2026-07-27 — Verified evidence is not execution

Decision: Backup, restore, and rollback records describe evidence and review outcomes only. A local verified record never means a backup was created, a restore ran, or rollback executed. Rollback terminal states remain `verified-not-executed` or `rejected-not-executed`.

Rationale: Monitor has no infrastructure credentials or asset authority. Execution belongs to the central Security/SRE/Release owner and requires separately accepted manifests and drills.

## 2026-07-27 — Evidence-only compatibility route

Decision: `/ops/backup-records` remains available for existing clients, but its records are untyped compatibility evidence and cannot satisfy verified backup or restore gates. New consumers must use `/ops/backups` and the versioned verification routes.

Rationale: Preserving old clients must not promote incomplete data into release-grade recovery truth.
