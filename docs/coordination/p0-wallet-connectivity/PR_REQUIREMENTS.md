# P0 Pull Request Requirements

Every P0 PR must target `codex/final-integration` and include:

```text
Campaign: P0-WALLET-CONNECTIVITY-2026-08
Owner:
Task ID:
Paths changed:
Contracts consumed:
Contracts proposed:
Depends on:
Source commit:
Tests:
Artifacts:
Migration:
Rollback:
Public claim:
Remaining blockers:
```

Reject a PR that changes another owner's locked path, activates a non-accepted
contract, hard-codes RPC or Gateway values, ships localhost or relative API
paths, removes security tests, copies shared wallet logic, or substitutes docs
for runtime evidence.
