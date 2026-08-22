# YNX Integration Handoff

Owner: `29-integration`  
Branch: `codex/final-integration`  
Protected source baseline: `05652b201acf830495a8fb2fba5416e5f4ea9d8c`
Lifecycle state: `ACTIVE`  
Current gate: `INTEGRATE`

## Purpose

This branch is the only central owner for protocol freeze, dependency acceptance, merge order, shared YNX Testnet acceptance and final public proof. It does not replace product owners or manufacture implementation evidence. It consumes exact branch commits and their source-bound contract, test, artifact and public records.

## Recovered state

- Workspace and branch matched the declared Integration worktree and final branch.
- The worktree was clean at takeover.
- The final branch initially had no upstream and no remote counterpart. A non-force push created `origin/codex/final-integration`.
- The branch was a direct ancestor of `origin/main` and had no unique commits. It was fast-forwarded by 20 commits to `562888318863435382d839958130246973dc1206`, then pushed after one bounded network retry.
- The inherited `.ai-bridge` plan belonged to 18 Docs/Compliance and is being replaced with Integration-specific state.
- The old product matrix covered 23 products and contained stale 2026-07-16 branch SHAs. It remains historical evidence and is not the current central authority.
- The original central-repository scan missed products in separate repositories. The registry and scanner now resolve Website from `JiahaoAlbus/YNX-Chain-website` and Security/SRE from authoritative `JiahaoAlbus/YNX-Chain`, including exact synchronized branches and clean worktrees without recording absolute paths in the matrix. `JiahaoAlbus/YNX` remains legacy recovery material only.
- The first full Go run exposed umask-sensitive unsafe-permission fixtures and missing generated contract artifacts. The fixtures now explicitly create the unsafe mode, while Runtime permission checks remain unchanged; contract-dependent tests are preceded by the pinned Hardhat build.
- Main now locks Hardhat 3.11.1, `@nomicfoundation/hardhat-ethers` 4.0.15 and `adm-zip` 0.6.0. Full and production-only npm audits are clean, so the former time-bounded High-advisory exception is closed. Security/SRE acceptance remains an independent production-release gate.
- The 2026-07-29 recovery verified the configured MCP, exact Worktree, Branch, Chain repository Remote, Local/Remote SHA equality, tags, reflog, stash, LFS and registered 01–36 Worktrees from live Git state.
- Commit `d05ddf0a9d0d5a7b05b6c792eec547bfde06b215` protects the current central acceptance and GitHub evidence snapshot. The exact clean commit then passed `make integration-protect-preflight`.
- Draft PR `#17` now supplies exact-head Integration CI; the last protected head `7777942bb17a1e67483f5909287e79592ca0f1cf` passed every visible check.
- The coverage generator now consumes the generated acceptance matrix for every product, including the separate Security/SRE repository, instead of retaining the historical false claim that product 30 was unobserved.
- Coverage refresh now fails closed unless the matrix contains each product ID `01`–`36` exactly once; its negative self-test is part of `integration-protect-preflight`.
- npm policy mutation tests now run against deterministic offline audit fixtures. Real full and production-only Registry audits remain separate and use only bounded retry for recognized transient network failures.
- Product 30 final owner source `4277317bb4999ac4edfbc321590b54d95e1839f9` is contained by merge `3ee6477d82ecffea954387ce88135793bddb1271` and is centrally accepted through a fail-closed decision bound to clean synchronized refs, exact-head CI and 179/179 central-tree security tests.
- Product 17 final protected owner head `7c540b7f3f5872adbd8f65e4c8975eeac41c3a3f` is contained by merge `05652b201acf830495a8fb2fba5416e5f4ea9d8c`. Its frozen engineering source is `a377bef61a7082b5b1ae0ebd35d4b97846649b68`; the central merge passed the full Go suite, economics candidate gates, Data Fabric integrated gates, immutable Action-pin check and source-package digest verification.
- Seven products are now centrally source-accepted: 01 Chain Core, 02 Wallet/Auth, 17 Economics, 19 Oracle, 26 Data Fabric, 30 Security/SRE and 31 Governance. Shared Testnet, public runtime, production signing, stores and Mainnet remain false.

## New central artifacts

- `release/integration/product-registry.json`: exact 01–36 owner, branch, phase and dependency registry.
- `release/integration/integration-contract.json`: authority, release-state vocabulary, asset and AI boundaries, conflict policy and required owner bundle.
- `scripts/ops/refresh-integration-acceptance.mjs`: read-only branch/worktree/evidence and optional GitHub evidence scanner.
- `scripts/verify/integration-acceptance-check.mjs`: fail-closed central matrix and contract validator.
- `release/integration/acceptance-matrix.json`: generated exact-ref acceptance inventory.
- `release/integration/github-evidence.json`: generated Actions, Release and Artifact inventory when GitHub is reachable.
- `release/integration/central-acceptance-decisions.json`: explicit accepted owner SHAs and Integration merge bindings.
- `release/integration/evidence/product-30-central-acceptance-3ee6477d.json`: Product 30 exact CI, test, artifact and truth-state receipt.
- `release/integration/evidence/product-17-central-acceptance-05652b20.json`: Product 17 exact CI, merge ancestry, central tests, source-only release and truth-state receipt.
- `release/integration/PRODUCT_RELEASE_MATRIX.json`: authoritative 36-product state and readiness classification.
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

1. Protect the seven current central source acceptances with Commit, Push and exact-head PR `#17` CI.
2. Review Product 21 Bridge, the remaining Phase 0 authority, in its own Worktree without modifying accepted owner branches.
3. Continue the other 28 products one clean owner Worktree at a time in dependency order.
4. Execute the shared-Testnet cross-product, failure, recovery and attack vectors only after their required dependencies are accepted.
5. Keep every staging, public, hosted, signed, store and Mainnet state fail-closed until direct evidence exists.

## Prohibited promotions

A candidate branch, Preview Release, test-signed build, simulator artifact, Website page or local smoke run cannot be represented as central integration, public runtime deployment, production signing, store release or Mainnet acceptance without direct evidence for that distinct state.

P0 Wallet Protocol runtime remains publicly verified at source `49e30d99…` by evidence `b3077595…`; no runtime rollback occurred. Installed-client lease `…T101002Z` is closed at preflight with `NO_ELIGIBLE_SIGNED_INSTALLED_CLIENT`, Owner evidence `2d6c9aa3…` / blob `8974960c…`: only an ad-hoc localhost Edge shortcut and an Android emulator were present, with no native macOS Wallet or physical iOS target. No client flow or cleanup started. Standard wallet/account/sign/send/transaction, `integratedCentral`, Website publication, production signing, store and aggregate readiness remain false.
