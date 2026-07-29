# YNX 29 Current State

Updated: `2026-07-29T02:44:44Z`

## Identity

- Product: `29 — YNX Integration / Founder Control`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/29-integration`
- Branch: `codex/final-integration`
- Repository: `JiahaoAlbus/YNX-Chain`
- Remote: `https://github.com/JiahaoAlbus/YNX-Chain.git`
- Protected source SHA: `20191a3e7f561882b7393686fc0ea39d7a08a5ed`
- Protected remote SHA: `20191a3e7f561882b7393686fc0ea39d7a08a5ed`
- `origin/main` SHA observed after fetch: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Ahead / behind at protected checkpoint: `0 / 0`
- Current dirty state: yes — Integration-owned coverage, release, metadata, handoff, test receipt and recovery-memory changes are under review; no unknown change is being discarded.

## Phase and truth boundary

- Lifecycle: `ACTIVE`
- Gate: `PROTECT`
- `implementedLocal`: true
- `testedLocal`: true for protected source `20191a3e…`
- `integratedCentral`: false
- `testnetVerified`: false
- `deployedPublic`: false
- `releasePublished`: false
- `downloadHosted`: false
- `productionSigned`: false
- `mainnetReleased`: false

## Latest successful tests

Exact clean protected source `20191a3e…` passed:

- `node scripts/ops/refresh-integration-acceptance.mjs --self-test`
- `node scripts/verify/integration-acceptance-check.mjs --self-test`
- `node scripts/verify/integration-acceptance-check.mjs`
- `make integration-protect-preflight`
  - Integration acceptance
  - pinned contract tooling / Hardhat selector generation
  - npm audit policy and negative self-test
  - `go test ./...`
  - no-placeholder scan
  - secret scan
  - `go vet` and shell/Node syntax checks

Durable receipt: `release/integration/evidence/protect-preflight-20191a3e.json`.

## GitHub

- Open or closed PR for `codex/final-integration`: none observed through the GitHub connector.
- Branch Actions run for protected source: none observed.
- Reason: `.github/workflows/ci.yml` currently runs only on `main` pushes and pull requests targeting `main`.
- Repository-wide evidence snapshot at `2026-07-29T02:28:01Z`: 200 runs returned, 121 successful; 98 active artifacts returned; release query unavailable after bounded TLS timeout retries.
- Integration Release: not published.

## Central acceptance snapshot

`release/integration/acceptance-matrix.json` at protected source recorded:

- 36 products registered locally and remotely
- 36 registered final Worktrees
- 34 synchronized branches
- 18 clean and 18 dirty Worktrees during the concurrent scan
- 3 `implementedLocal` candidates
- 33 `inProgress`
- 0 centrally accepted products

The matrix is a point-in-time inventory. Concurrent product-owner work remains protected and is not silently normalized by Integration.

## Public and website state

- Official domain: `https://ynxweb4.com`
- Intended Integration route: `https://ynxweb4.com/integration`
- Website handoff metadata exists locally.
- Integration route deployment has not been directly verified and must remain `websitePublished=false`.
- Existing public YNX endpoints must not be counted as the new accepted chain while their observed identity differs from the frozen YNX Testnet identity.
- No `huangjeo.com` misuse was found in the Integration Worktree; valid MCP subdomains remain outside this correction rule.

## Completed in current recovery

- Verified MCP 29, Worktree, Branch and repository identity against Fable5.
- Audited Git Root, Remote, branch/upstream, Worktrees, status, tags, stash, reflog, submodules and LFS.
- Preserved and pushed the generated central matrix and GitHub evidence at `20191a3e…`.
- Re-ran the full Integration protection gate on that exact clean commit.
- Corrected the coverage generator so product coverage is derived from the current acceptance matrix, including the separate Security/SRE repository.
- Added a fail-closed coverage-generator self-test for missing, duplicate or incomplete 01–36 product rows and placed it in the protection gate.
- Made npm policy self-tests deterministic and offline while retaining a separate real Registry audit with bounded transient-network retry.
- Bound `testedLocal` only to direct exact-commit evidence.
- Normalized Integration public metadata to `ynxweb4.com` without claiming deployment.

## Remaining highest-priority work

1. Validate and protect the current Integration-owned recovery/evidence slice.
2. Open a real pull request to `main` so CI runs against the final Integration branch.
3. Resolve any PR CI failures without weakening gates.
4. Review Phase 0 owner bundles in dependency order and record explicit central decisions; never auto-promote matrix candidates.
5. Close Security/SRE autonomous coverage before production-class acceptance.
6. Execute cross-product vectors only after authority freeze and dependency acceptance.
7. Verify shared Public Testnet, artifacts, releases, website consumption and public routes with direct source-bound evidence.

## Current risks

- Many owner Worktrees are concurrently dirty or moving; every central decision must pin an exact stable source commit.
- GitHub release evidence was temporarily unavailable in the generated snapshot because of a TLS handshake timeout.
- There is no Integration PR/CI run yet.
- No central product acceptance, shared Testnet acceptance or public Integration deployment has been proven.
