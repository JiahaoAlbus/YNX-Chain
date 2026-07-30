# CURRENT STATE — Product 31 Governance

Updated: 2026-07-29T02:42:52Z

## Identity

- Product number: `31`
- Product name: `YNX Governance & Protocol Control`
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/31-governance`
- Branch: `codex/final-governance`
- Repository: `https://github.com/JiahaoAlbus/YNX-Chain.git`

## Git recovery snapshot

- Recovery basis local SHA: `cd328bd5817f32efba259e0ad8948f202ebaf654`
- Recovery basis remote SHA: `cd328bd5817f32efba259e0ad8948f202ebaf654`
- `origin/main` SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Branch versus `origin/main`: ahead `6`, behind `0`
- Dirty state at snapshot: clean
- Merge/rebase/cherry-pick state at snapshot: none
- Upstream: `origin/codex/final-governance`

The SHA above is the verified recovery basis represented by this document. The commit that contains an Agent Memory update necessarily advances the branch and must be read from Git history on the next recovery.

## Current phase

`INTEGRATE`

The governance implementation and local product gates are complete enough for integration-candidate handling. Shared Testnet acceptance, central dependency acceptance, production signer custody, public deployment, and website publication are not complete.

## Latest successful verification

- `bash ./scripts/verify/governance-check.sh` passed on the merged `origin/main` tree at recovery basis `cd328bd5817f32efba259e0ad8948f202ebaf654`.
- The check covers Go governance tests and vet, JSON validity, UI type-check, Vitest, production build, Playwright keyboard/390px/Arabic RTL browser test, npm vulnerability audit, forbidden-text scan, secret-pattern scan, and deterministic Go builds.
- Exact prior CI success: Governance Actions run `30416918267` on SHA `4e6c67488e81f5ec82995de81dd25a33861d7dc3`.
- Exact merged-SHA CI success: Governance Actions run `30417486460` on SHA `cd328bd5817f32efba259e0ad8948f202ebaf654`; governance verification and the four-validator Testnet lifecycle both completed successfully.

## Pull requests

- PR `#9`, `Governance: complete authoritative integration candidate`, merged into `main` on 2026-07-28. Its head was `89edb99d1ec0ee00d92dd0a0d965c6c88daba31d`.
- Current branch contains six commits beyond `origin/main`; a new PR is required after the current exact-SHA CI succeeds.

## Release and artifacts

- Existing prerelease: `governance-v0.3.0-integration.1`
- Release source commit: `340e6a8a3eecd973145677bde0879a918e3924ed`
- Release class: integration candidate / prerelease, not production
- Published artifacts include `ynx-governanced`, `ynx-governance-state`, SBOM, provenance, product release record, public metadata, third-party notices, and Go version records.
- Published asset digests are available from the GitHub release API. This release predates the current UI, gRPC, evidence, CI-portability, and central-preflight commits and must not be represented as the current branch release.

## Public deployment

- Canonical product route requested by metadata: `https://ynxweb4.com/governance`
- Verified public deployment at snapshot: `false`
- Public route observation: the URL redirects to `https://www.ynxweb4.com/governance` and returns HTTP 200, but serves the generic root shell with title `YNX Chain — Web4 Layer-1 Ecosystem` and root canonical `https://ynxweb4.com/`; Governance product-page acceptance failed.
- Verified public runtime SHA: none
- Website handoff/deployment acceptance: pending; machine evidence is `release/evidence/governance-public-route-probe-2026-07-29.json`.
- `huangjeo.com` is not a YNX product, docs, status, support, release, or canonical domain.

## Completed

- Bounded governance object, parameter, and role registries
- Proposal lifecycle with signed vote and delegation integrity
- Persistent timelock, upgrade, canary, rollback, emergency, conflict, appeal, and audit records
- Canonical Chain Core execution adapter and receipt reconciliation
- Read-only governance UI with 12 locale boundaries, Arabic RTL, keyboard support, and 390px gate
- Portable Playwright CI configuration and explicit Chromium installation
- Central `main` governance preflight integration merged back into the product branch
- Existing integration-candidate release with SBOM and provenance

## Remaining

- New PR for the six commits beyond `main` plus this recovery checkpoint, review, merge, and post-merge verification
- Acceptance by Products 12, 13, 15, 26, 29, and 30 using immutable evidence
- Shared Testnet Explorer, Monitor, Trust, Data Fabric, Security/SRE, and Integration proof
- Updated governance prerelease bound to the accepted final candidate SHA
- Public `/governance` route, status/support/security destinations, and website acceptance on `ynxweb4.com`
- Production signer custody and production deployment authorization

## Current risks

- The existing public prerelease is stale relative to the current branch and must remain labeled as an earlier integration candidate.
- The branch is not yet merged after the latest five product commits plus the main reconciliation merge.
- A concurrent local governance Testnet drill was observed using port `31656`; it was preserved and not terminated because it originated from another active MCP execution.
- `.ai-bridge/current-plan.md` contains stale Product 18 instructions and is not authoritative for Product 31.

## Evidence

- `release/governance/product-release.json`
- `release/governance/public-product-metadata.json`
- `release/integration/governance-contract.json`
- `docs/governance/FEATURE_COMPLETION_EVIDENCE.md`
- `docs/governance/EVIDENCE_INDEX.md`
- `docs/governance/RELEASE_NOTES.md`
- GitHub Actions runs `30416918267` and `30417486460`
- GitHub prerelease `governance-v0.3.0-integration.1`
