# Decision Log

## 2026-08-01 — Measure Fable5 completion from evidence gates

- Decision: Publish an evidence-weighted completion audit derived from the 36-product release matrix, capability matrices and registered E2E vectors.
- Result: Current Testnet-goal completion is 252/501 gate units (50.3%) and status remains `ACTIVE`.
- Boundary: Documentation coverage is not runtime proof; public operator tests are not automatically per-product shared-Testnet acceptance.

## 2026-08-01 — Add required capability matrices fail closed

- Decision: Generate AI capability, stablecoin price/reserve, asset security traceability and ecosystem function matrices for all 36 products.
- Decision: Classify YNXT as a Testnet native asset, not a stablecoin; retain YUSD as a Testnet candidate with no production reserve/redemption claim.
- Decision: Prohibit AI from signing, paying, trading, withdrawing, changing ownership/permissions or deciding consensus, oracle truth or bridge finality.

## 2026-08-01 — Bind the controller scanner to the active release train

- Decision: Retain Product 29's canonical branch while scanning `codex/integration-pay-acceptance-v2` through an explicit `controllerBranch` field.
- Reason: The active integration work must be measured without rewriting the product registry's historical branch identity.

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

## 2026-07-29 — Accept Product 30 source centrally

- Decision: Accept Product 30 only at synchronized owner SHA `4277317bb4999ac4edfbc321590b54d95e1839f9`, contained by Integration merge `3ee6477d82ecffea954387ce88135793bddb1271`.
- Evidence: Owner coverage has zero open rows; exact-head CI is terminal and green; 179/179 security tests and the complete Integration protection preflight pass in the merged tree.
- Decision: Store the decision and central test receipt separately, and make the generator invalidate acceptance if source SHA, merge ancestry, worktree cleanliness, CI or receipt drifts.
- Boundary: `integratedCentral=true` does not set shared Testnet, staging, public, hosted artifact, production signing, store or Mainnet states.

## 2026-07-29 — Separate source readiness from public readiness

- Decision: Keep Product 30 classified `READY_FOR_SOURCE_RELEASE` after central acceptance because its explicit production/public blockers and absent shared-Testnet proof remain true.
- Result: The authoritative snapshot reports 0 Public-Testnet-ready, 2 Source-Release-ready and 34 Hold-for-Recovery products.

## 2026-07-29 — Reaccept Product 30 after its source-candidate release

- Decision: Replace the prior central acceptance with exact owner SHA `e670749b83a1b40d09ed717eb3515d539c005c49`, contained by Integration merge `a472d588b4f037c57db6d7941b1b37572f91d114`.
- Evidence: 9 exact-head workflow runs succeeded; the central merged tree passed 179/179 security tests and the full Integration preflight.
- Decision: Set only Product 30 `releasePublished=true` and `artifactHosted=true` from a non-draft GitHub prerelease plus a matching registered download URL and digest. Keep production/public states false.

## 2026-07-29 — Freeze the current release train as unsafe to merge

- Decision: Do not merge PRs #7, #11, #13, #14 or #15 while they conflict with `main`.
- Decision: Do not merge clean PR #16 or #17 without independent review and a protected base branch; draft state is also retained.
- Evidence: `release/integration/RELEASE_TRAIN_AUDIT.json`.
- Next: Push and protect the Integration checkpoint, then recover Phase 0 Product 01 before refreshing the audit.
