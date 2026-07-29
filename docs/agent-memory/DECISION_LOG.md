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

## 2026-07-29 — Integrate Product 30 from the authoritative repository

- Decision: Merge the exact green Product 30 candidate from `JiahaoAlbus/YNX-Chain`; retain `JiahaoAlbus/YNX` only as documented legacy recovery material.
- Decision: Treat the independent Product 30 checkout as a registered separate Worktree even though it uses the same authoritative repository as Integration.
- Result: The scanner observes Local SHA = Remote SHA at `9c9931aa…` and reads Product 30's scoped evidence instead of another product's root evidence.

## 2026-07-29 — Eliminate global vector filename collision

- Decision: Preserve Integration's global `CROSS_PRODUCT_TEST_VECTORS.json` and move Resource Market's contract vectors to `RESOURCE_MARKET_CROSS_PRODUCT_TEST_VECTORS.json`.
- Reason: Two owners cannot safely use one global path with incompatible schemas.
- Verification: Targeted Resource Market test and the complete Integration preflight passed.

## 2026-07-29 — Do not auto-accept Product 30

- Decision: Keep Product 30 central acceptance null while its source coverage contains two non-terminal rows, even though its PR is green and its branch is merged into the Integration candidate.
- Reason: Code inclusion, owner completion and central acceptance are distinct evidence states.

## 2026-07-29 — Fail closed in the Product Release Matrix

- Decision: Generate `release/integration/PRODUCT_RELEASE_MATRIX.json` from direct branch, Worktree, coverage, CI, PR and artifact evidence.
- Decision: Require every exact-head workflow run to be terminal and successful; one successful workflow cannot make the whole exact head green.
- Decision: Classify unproven test, CI, clean-tree or evidence states as `HOLD_FOR_RECOVERY`, even when historical evidence suggests high maturity.
- Result: The first authoritative snapshot reports 0 Public-Testnet-ready, 1 Source-Release-ready and 35 Hold-for-Recovery products without inflating readiness.
