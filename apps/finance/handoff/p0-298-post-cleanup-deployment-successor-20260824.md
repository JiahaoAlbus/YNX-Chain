# Finance P0-298 deployment successor

Status: source request only. It does not authorize SSH, deployment, rollback, service control, Wallet prompts, signing, or transactions.

The P0-297 direct zero-write terminal handoff states that P0-294 paths are absent, parents are restored, and the old Finance runtime remains active at PID `2241003` with `NRestarts=0`. Its Central release is still pending.

P0-298 uses a wholly new namespace and requires Central to freshly bind all live parent, runtime, service, HTTP, traversal, candidate, stdin, and literal-argv values. It must not infer write authority from P0-297.

The reviewed executor provides secret-safe post-cleanup diagnostics for `STAGING_BACKUP`, `ARCHIVE_EXTRACT`, `CANDIDATE_VERIFY`, `RELEASE_MATERIALIZE`, `SERVICE_USER_ACCESS`, and `PRE_SWITCH`. Every receipt is limited to phase, failure class, and exit status; cleanup/rollback runs before receipt emission.

If a mutable env/current/service action has begun, the executor performs one automatic signed rollback and validates the old runtime before emitting a failure receipt. Manual rollback is out of scope and needs a new Central lease.

Terminal semantics are deliberately split. Verified success retains the exact signed release container, candidate release, backup, executor, and signed lease as rollback material; `current` resolves to the candidate and its service/live gates match the terminal receipt, while pending and temporary paths are absent. Automatic rollback instead restores the signed old env/state/current/service, verifies the old live receipts, and removes only identity-bound P0-298 residues after substitution checks. Foreign objects remain untouched and cause fail-closed termination.
