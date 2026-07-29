# YNX 18 Current State

Updated: 2026-07-29T10:57:38+08:00

## Identity

- Product: 18 — YNX Whitepaper / Compliance / Brand
- Worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/18-docs-compliance`
- Branch: `codex/final-docs-compliance`
- Repository: `JiahaoAlbus/YNX-Chain`
- Checkpoint source SHA: `7b386fc4ea7be4d25bf9217f6242d6da17a6f6f9`
- Remote checkpoint SHA: `7b386fc4ea7be4d25bf9217f6242d6da17a6f6f9`
- Main SHA: `0ad0aaec7a96f1efcb871247cc9e0161ba6a01cc`
- Branch/upstream at checkpoint: 0 ahead / 0 behind
- Branch/main at checkpoint: 10 ahead / 47 behind
- Dirty state at checkpoint source: false
- Current phase: PUBLIC
- Goal status: Active

## Latest successful tests

- `make document-metadata-check`
- `make docs-release-package-check`
- `make docs-compliance-check`
- `make public-disclosure-check`
- `make full-goal-coverage-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make static-check`
- `make objective-state-check`
- exact committed-source package verification

## CI, artifact and release truth

- Implementation candidate: `e36832d5be0c498d8a2f27869f8d70fc112e9442`
- Evidence-binding checkpoint: `7b386fc4ea7be4d25bf9217f6242d6da17a6f6f9`
- Latest CI: docs-compliance run `30417883673`, success for `7b386fc4`
- Latest CI artifact: `8710800710`, unexpired through 2026-08-28
- CI artifact digest: `sha256:bfae2f1499cd21d5bbe281c83bf1b38f266de723fc5d63ed1bbe9a9c38374780`
- Exact local package for checkpoint: `ynx-website-content-7b386fc4ea7b.zip`
- Exact local package bytes: 277,728
- Exact local package SHA-256: `cec892bd19d823d8459d47e8b7350f3b29a90af8645ef60b1cfaf9a6d544d70a`
- Product-specific GitHub Release: none
- Current-source PR: none
- Latest historical merged PR from this branch: #6

## Public deployment

- Official product domain: `https://ynxweb4.com`
- Authority route: `/what-is-ynx-chain`, HTTP 200 through the `www` redirect target
- Public manifest source: `601d13bd677729ff59819ea70076a7de461328f2`
- Public hosted archive: 136,954 bytes, SHA-256 `37cefdeeda4d8c600ccd3e8c6bd8147156a803b6a1129e9486d81cb118583d75`
- Public archive verification: downloaded bytes and SHA-256 match the manifest
- Public archive state: hosted, immutable, unsigned candidate
- Newer `e36832d` candidate: not Website-accepted, not publicly hosted, not production signed
- Public SEO defect: `/what-is-ynx-chain` emits conflicting root and route canonical links

## Completed

- Recovered and verified the correct worktree, branch and remote.
- Protected all existing commits and found no stash or incorrect-domain reference.
- Closed the partial staking metadata slice.
- Expanded the high-authority metadata inventory to fourteen documents.
- Added staking disclosure to deterministic Website packaging and package verification.
- Bound exact implementation, CI, artifact, integration and Website Handoff evidence.
- Upgraded the integration contract and test vectors to `0.1.1-candidate`.
- Recorded fresh public route/archive evidence and the duplicate-canonical defect.

## Remaining

- Normalize Trading Core / UltraLiquidity / FairFlow.
- Normalize Wallet/Auth mandate, Bridge/Oracle/Data Fabric, Quant, Trust and Product Architecture documents.
- Obtain YNX 28 canonical correction and newer-candidate Website acceptance evidence.
- Resolve branch/main compatibility through YNX 29 without a broad unreviewed merge.
- Obtain named legal, economic, security, privacy and independent reviews.
- Obtain production signing evidence if approved.

## Current risks

- Branch is 47 commits behind `origin/main`; silent merge could overwrite other product work.
- Duplicate canonical tags can weaken indexing and answer-engine authority.
- Accepted public release states must not be copied onto the newer candidate.
- Staking, liquid staking, rewards, slashing and Safety Module remain non-activated disclosures.

## Evidence

- `release/evidence/document-metadata-2026-07-29.json`
- `release/evidence/website-public-audit-2026-07-29.json`
- `docs/public/WEBSITE_INTEGRATION_HANDOFF.md`
- `docs/integration/INTEGRATION_HANDOFF.md`
- `release/integration/docs-compliance-brand-contract.json`
- `.ai-bridge/full-goal-coverage.json`

This file describes the clean source checkpoint immediately before the recovery-record commit that contains it. The enclosing commit is a successor recovery record and does not retroactively change the recorded source evidence.
