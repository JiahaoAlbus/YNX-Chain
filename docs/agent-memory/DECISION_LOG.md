# Decision Log

## 2026-07-29 — Recover from live evidence

- Decision: Treat Fable5, MCP 29, the exact Worktree, Git and GitHub evidence as authority; do not use prior chat summaries as engineering state.
- Evidence: Worktree, Branch and Remote matched product 29.

## 2026-07-29 — Preserve generated Dirty Changes

- Decision: Keep and validate the existing acceptance-matrix refresh instead of discarding it.
- Reason: The change was reproducible generated evidence reflecting newer owner branches and concurrent Worktree state.
- Result: Matrix and GitHub snapshot were committed and pushed at `20191a3e…`.

## 2026-07-29 — Fail closed on central acceptance

- Decision: Keep every `acceptedSourceCommit` null until explicit owner tests, central vectors, artifact checks and dependency acceptance pass.
- Result: Central acceptance remains zero; candidate states are not promoted.

## 2026-07-29 — Classify transient network failures honestly

- Decision: Treat npm/GitHub TLS timeouts as execution-infrastructure incidents when bounded retry succeeds or partial availability is directly recorded.
- Result: No false `externalBlocked` product state was created.

## 2026-07-29 — Derive product coverage from the matrix

- Decision: Replace hardcoded product coverage assumptions with acceptance-matrix-derived status, evidence paths, blockers and next actions.
- Reason: The historical generator falsely described Security/SRE product 30 as unobserved even though its separate repository and final branch were registered and scanned.

## 2026-07-29 — Separate public metadata from deployment claims

- Decision: Use `ynxweb4.com` for canonical and support links while retaining `websitePublished=false` and `deployedPublic=false` until direct deployment evidence exists.
- Reason: Metadata readiness is not Website deployment.

## 2026-07-29 — Stabilize npm audit gates

- Decision: Run policy mutation self-tests entirely offline with deterministic audit fixtures, while keeping the real full and production-only npm audits as independent Registry-backed checks.
- Decision: Retry only recognized transient network failures a bounded three times; never retry or suppress vulnerability, policy, invalid-JSON or persistent infrastructure failures.
- Reason: A negative policy self-test must test policy logic, not Registry availability.

## 2026-07-29 — Require real PR CI

- Decision: Do not claim branch CI when the workflow only runs on `main` or pull requests targeting `main`.
- Next consequence: Open a real PR and bind CI results to its exact head SHA.
