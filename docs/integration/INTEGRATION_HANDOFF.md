# YNX Integration Handoff

Owner: `29-integration`  
Branch: `codex/final-integration`  
Source baseline: `562888318863435382d839958130246973dc1206`  
Lifecycle state: `ACTIVE`  
Current gate: `PROTECT`

## Purpose

This branch is the only central owner for protocol freeze, dependency acceptance, merge order, shared YNX Testnet acceptance and final public proof. It does not replace product owners or manufacture implementation evidence. It consumes exact branch commits and their source-bound contract, test, artifact and public records.

## Recovered state

- Workspace and branch matched the declared Integration worktree and final branch.
- The worktree was clean at takeover.
- The final branch initially had no upstream and no remote counterpart. A non-force push created `origin/codex/final-integration`.
- The branch was a direct ancestor of `origin/main` and had no unique commits. It was fast-forwarded by 20 commits to `562888318863435382d839958130246973dc1206`, then pushed after one bounded network retry.
- The inherited `.ai-bridge` plan belonged to 18 Docs/Compliance and is being replaced with Integration-specific state.
- The old product matrix covered 23 products and contained stale 2026-07-16 branch SHAs. It remains historical evidence and is not the current central authority.
- The original central-repository scan missed products in separate repositories. The registry and scanner now resolve Website from `JiahaoAlbus/YNX-Chain-website` and Security/SRE from `JiahaoAlbus/YNX`, including their exact synchronized branches and clean worktrees without recording absolute paths in the matrix.
- The first full Go run exposed umask-sensitive unsafe-permission fixtures and missing generated contract artifacts. The fixtures now explicitly create the unsafe mode, while Runtime permission checks remain unchanged; contract-dependent tests are preceded by the pinned Hardhat build.
- Main now locks Hardhat 3.11.1, `@nomicfoundation/hardhat-ethers` 4.0.15 and `adm-zip` 0.6.0. Full and production-only npm audits are clean, so the former time-bounded High-advisory exception is closed. Security/SRE acceptance remains an independent production-release gate.

## New central artifacts

- `release/integration/product-registry.json`: exact 01–36 owner, branch, phase and dependency registry.
- `release/integration/integration-contract.json`: authority, release-state vocabulary, asset and AI boundaries, conflict policy and required owner bundle.
- `scripts/ops/refresh-integration-acceptance.mjs`: read-only branch/worktree/evidence and optional GitHub evidence scanner.
- `scripts/verify/integration-acceptance-check.mjs`: fail-closed central matrix and contract validator.
- `release/integration/acceptance-matrix.json`: generated exact-ref acceptance inventory.
- `release/integration/github-evidence.json`: generated Actions, Release and Artifact inventory when GitHub is reachable.
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`: mandatory happy and fail-closed vectors.
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`: unique authority and dependency gate.
- `.ai-bridge/full-goal-coverage.json`: complete Integration coverage matrix.

## Acceptance input contract

Every product owner submits the declared final branch with:

1. exact source commit and synchronized remote branch;
2. clean registered worktree;
3. full-goal coverage;
4. product release record and public metadata;
5. product-specific integration contract;
6. Integration handoff, cross-product vectors and dependency acceptance;
7. test, migration, restore, security, artifact and public evidence appropriate to the product.

Product-owner state is never promoted automatically. Integration records an accepted source commit only after rerunning central checks and resolving authority conflicts.

## Immediate execution order

1. Generate the 01–36 local/remote/worktree/evidence matrix.
2. Validate the registry, contract, coverage and cross-product vectors.
3. Protect the scanner and first evidence snapshot with Commit and Push.
4. Review Phase 0 authority bundles in dependency order.
5. Keep dependent products fail-closed where Security/SRE or another authority is absent, while continuing autonomous contract and negative-vector work.

## Prohibited promotions

A candidate branch, Preview Release, test-signed build, simulator artifact, Website page or local smoke run cannot be represented as central integration, public runtime deployment, production signing, store release or Mainnet acceptance without direct evidence for that distinct state.
