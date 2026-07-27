# YNX Monitor Active Plan

Phase: PROTECT → FREEZE  
Goal state: Active  
Last updated: 2026-07-27

## Current protected working-tree slice

### Least-privilege RBAC and incident lifecycle

- Viewer, transitional Operator, Incident Commander, Backup/Recovery, and Security Reviewer.
- Permission-based server and UI gates with explicit capabilities in password and Wallet-backed sessions.
- Versioned incident lifecycle: `open → acknowledged → investigating → mitigated → recovery_verifying → resolved → postmortem_complete`.
- Ordered fail-closed transitions, owner assignment, append-first timeline, independent recovery verification, postmortem, restart persistence, HMAC tamper rejection, and authenticated evidence export.

### Typed backup, restore, and rollback evidence

- Backup artifacts record SHA-256, byte size, retention, storage, encryption, RPO/RTO targets, and source evidence.
- Restore drills record timing, observed RPO/RTO, integrity/application checks, failure details, and evidence.
- Security Reviewer verification must be independent from the registering or reporting actor.
- Accepted restore evidence requires a previously verified backup.
- Rollback proposals bind candidate and previous releases plus dry-run evidence.
- Monitor records `approved-not-executed`, `verified-not-executed`, or `rejected-not-executed`; it never executes recovery or infrastructure actions.
- The legacy evidence-only backup route remains for old clients and is never treated as a verified backup artifact.

### Managed browser harness

- Dedicated frontend/backend ports, isolated per-run state, and direct Playwright process ownership.
- Two abandoned managed-harness listeners were identified and safely terminated.
- Current desktop/mobile lifecycle suite passes without server reuse.

## Verification bound to the current working tree

- `cd apps/monitor && npm test` — 17/17 passed.
- `cd apps/monitor && npm run build` — passed.
- `cd apps/monitor && npm run test:e2e` — 8/8 passed.
- Contract and evidence JSON parsing — pending final verification.
- Final `show_changes` review — pending.

## Exact next engineering actions

1. Validate all machine-readable release, coverage, and integration files.
2. Rerun tests, production build, managed E2E, and applicable smoke/security checks against the final diff.
3. Review the complete diff with `show_changes` and fix any release-truth or compatibility defect.
4. Commit implementation and tests as the source checkpoint.
5. Bind evidence files to that exact source SHA in a separate evidence commit.
6. Push `codex/final-monitor`, establish upstream without force, and verify local/remote SHA equality.
7. Continue the highest-priority autonomous security/public-status slice; do not claim central integration, Testnet, public deployment, or real recovery execution.
