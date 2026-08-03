# Bounded automation safety

YNX Monitor records approval evidence for a deliberately narrow operational action. It does not execute infrastructure commands.

## Policy boundary

- `YNX_MONITOR_AUTOMATION_TARGETS` is the comma-separated, deployment-owned allowlist. An empty list fails closed.
- The only accepted actions are `pause` and `resume`. There is no transfer, key, role, permission, deployment, rollback, or arbitrary-command action.
- A pause must be bounded to 1–900 seconds.
- Every proposal expires after five minutes and is persisted in the integrity-protected operational state.
- A `backup_recovery` operator proposes an action and a different `security_reviewer` approves or rejects it with evidence.
- An approved record remains `approved-not-executed`. Execution belongs to the central infrastructure owner.
- Resume is never inherited from a pause approval. It requires a new proposal linked to an approved pause and a fresh independent review.

## API lifecycle

1. Read `GET /ops/automation-policy` to inspect the allowlist and immutable boundaries.
2. Submit `POST /ops/automation-proposals` with evidence and the exact phrase `PROPOSE PAUSE <target>` or `PROPOSE RESUME <target>`.
3. Submit `POST /ops/automation-proposals/:id/review` from an independent reviewer with fresh evidence and the exact review phrase.
4. Export the proposal and `automation.propose` / `automation.review` audit records to the central owner’s change system.

The API exposes no execution route, cannot expand its own target allowlist, and cannot move assets.
