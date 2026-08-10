# YNX Exchange recovery audit

Audit time: 2026-07-22 Asia/Shanghai

## Recovered baseline

- Final worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/07-exchange`
- Final branch: `codex/final-exchange`
- Recovery source: `/Users/huangjiahao/Desktop/YNX Chain Exchange`
- Most complete local source commit at recovery time: `22604af0717a19b5f8aa9223685c3ad3f049941a`
- Current Exchange runtime evidence commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`
- Remote Exchange baseline: `5d95046a92e01c7c5d00306cf8e78a1b9002a08a`
- Relationship: local source is exactly one commit ahead of the remote baseline; the remote baseline is the parent of the recovered local commit.
- Central Wallet/Auth source recorded by the recovered handoff: `da82c8b07b72b615ccb24b86a2a7ac66ee85b4d8`.

The requested final worktree did not exist at the start of this audit. It was created as a new worktree and branch at the most complete local source commit. No reset, clean, checkout-overwrite, force push, or source-worktree mutation was used.

## Uncommitted recovery

The source worktree contained three untracked truth records:

- `apps/exchange/mobile/product-release.json`
- `apps/exchange/product-release.json`
- `apps/quant-lab/product-release.json` (reclassified in the final worktree as
  `evidence/dependencies/quant-lab-historical-release.json`; this is historical
  dependency evidence, not Exchange-owned Quant Lab release authority)

They were restored into this final worktree. Source-only ignored screenshots and generated native artifacts remain preserved in the source worktree until their hashes, generating commit, and reproducibility can be revalidated; their existence alone is not treated as final release evidence.

## Recovery sources inspected

- Local and remote Exchange branches and commit graph
- Git worktree registrations
- Git reflog entries covering the Exchange source and final-worktree creation period
- Source worktree dirty state
- Existing handoff, release records, tests, workflows, browser/native evidence paths, package manifests, SBOMs, and integration requests
- Running processes matching Exchange/YNX/build-server terms

GitHub Actions runs, release assets, hosted artifacts, servers, and public endpoints are not yet proven by this local audit. Their states remain false or unverified in release records until direct remote evidence is collected.

## Preservation boundary

Only this final worktree and `codex/final-exchange` are writable for this goal. Other YNX product worktrees are evidence and integration sources only. Cross-product changes must be delivered as manifests, schemas, patches, or handoffs.
