# Documentation and Compliance Recovery Audit

| Metadata | Value |
| --- | --- |
| Version | 0.2.0 |
| Effective date | 2026-07-25 |
| Source commit reviewed | `c8c4ff7263e50afc4c731dac8157aa85e02232dc` |
| Product release | YNX Testnet documentation and public disclosure candidate 0.2.0 |
| Last reviewed | 2026-07-25 |
| Status | Recovery inventory current; candidate only; not public-release evidence. |

## Scope

This record identifies the recovered baseline for the YNX technical whitepaper,
economic disclosures, compliance preparation, brand entity, public content, and
website handoff. It records facts observed directly from Git and the local
workspace. Unknown or unavailable evidence remains explicitly unverified.

## Current 2026-07-25 recovery snapshot

The assigned worktree is on `codex/final-docs-compliance` at
`c8c4ff7263e50afc4c731dac8157aa85e02232dc`, matching its remote after a bounded
fetch. The three pre-existing untracked recovery areas—`release/conflict-report.json`,
`release/evidence/public-url-probe-2026-07-25.json`, and `release/facts/`—were
preserved and reviewed rather than cleaned or replaced.

The current scan covered local and remote branches, tags, reflog, registered
worktrees, GitHub Actions, releases, artifacts, sibling dirty changes, AI-bridge
handoffs, background processes and bounded public endpoint observations. The
machine-readable inventory is `release/recovery-inventory-2026-07-25.json`.

Key current findings:

- the documentation branch contains five later commits than the original recovery
  baseline, while public tags, releases and downloadable artifacts remain dated no
  later than 2026-07-19 or 2026-07-18;
- no current documentation-branch GitHub Actions run, documentation release or
  documentation artifact was observed;
- Tokenomics, Wallet/Auth, Oracle, Bridge, Data Fabric and Security/SRE contain
  protected owner-worktree changes, and Music and Quant have local-ahead commits;
- Chain Core's structured handoff explicitly keeps public deployment, production
  signing and public BFT cutover false without direct evidence;
- the active workstation network resolved canonical YNX names through the
  `198.18.0.0/15` benchmark range, so endpoint observations are not independent
  direct-public proof;
- through that bounded path, the www site, App Gateway and Faucet returned HTTP 200,
  while the canonical root, Explorer and EVM RPC hit TLS connection timeouts; and
- the mixed results prove neither portfolio-wide availability nor a portfolio-wide
  outage and do not establish deployment of this documentation package.

The recovered fact package initially contained missing schemas, missing evidence and
supersession records, a dangling FAQ Claim ID, missing locale files, symbolic
`git:HEAD` source identities and an unstructured smoke fixture. Version 0.2.0 retains
the fixture as superseded history, binds records to an exact source commit, adds the
missing records and 12 locale files, and enforces the result through
`scripts/verify/public-disclosure-gate.mjs`.

## Original 2026-07-22 recovered repository state

| Evidence area | Observed state | Classification |
| --- | --- | --- |
| Canonical repository | `JiahaoAlbus/YNX-Chain` | Verified from Git remote |
| Baseline commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` | Verified locally and at `origin/main` after fetch |
| Assigned branch | `codex/final-docs-compliance` | Created locally from current `origin/main`; no prior matching local or remote ref was found |
| Assigned worktree | `18-docs-compliance` | Recreated through `git worktree add`; no existing directory was overwritten |
| Dirty changes at recovery | None in the recreated worktree | Verified by `git status --short --branch` |
| Existing documentation | Architecture, API, bridge, compliance, custody, DeFi, deployment, developer, ecosystem, exchange, grants, mainnet-readiness, operations, public-proof, security, stablecoin, testnet, and a minimal whitepaper | Verified by repository inventory |
| Existing whitepaper depth | Three short paragraphs | Verified from `docs/whitepaper/YNX_CHAIN_WHITEPAPER.md`; insufficient for the requested public technical whitepaper |
| Git tags | Browser/Search, Finance, Mail/Calendar preview, and Wallet engineering-evidence tags | Verified locally after tag fetch |
| GitHub releases | Four prereleases matching those preview/evidence tags | Verified with GitHub CLI on 2026-07-22 |
| GitHub Actions | Not verified after two bounded attempts | GitHub API TLS handshake timed out again; no CI conclusion inferred |
| Background product processes | Wallet Android build, Cloud tests, local PostgreSQL and unrelated product-owner activity were observed; no owned process was modified | Process inventory only; not product completion evidence |
| Public endpoints | Intermittent: AI health returned HTTP 200 and build `02f4ccd8770c`; REST and Trust each returned one HTTP 200 but timed out on confirmation; most other domains timed out | Partial operator-network observation; not broad independent public proof and not this documentation source |
| Server access | Deployment env and host-key approval files are absent in this worktree | Direct SSH/server audit cannot be run safely from this worktree; historical operator evidence remains non-current |
| Local artifacts | Documentation metadata, npm/Go inventories and local benchmark evidence now exist under `release/` | Local candidate evidence only; no hosted/downloaded/signed artifact |

## Recovered sibling product branches

The repository has newer product-specific branches for Wallet/Auth, Developer,
DEX, Exchange, Explorer/Monitor, Finance, Pay, Trust/Resource, AI, Browser/Search,
Cloud/Docs, Mail/Calendar, Music, Shop, Social, and Video. The final-owner worktrees
also advanced after the initial scan: Chain Core `e2c7c3d` (six local commits
ahead of its remote and clean), Wallet/Auth `ca2e2f4` (pushed and clean), Quant
`7e69393` (twelve local commits ahead plus newer dirty work), Tokenomics
`3643964` (pushed and clean), Oracle/Market Data `3bad8b3` (pushed with an
untracked app), Bridge `c71d2d9` (pushed and clean), DEX `16f5f8c` (pushed plus
substantial dirty work), and Governance `4b010b9` (pushed and clean). Data Fabric
remains at the baseline with a large uncommitted implementation owned by its
worktree. Their product claims
must not be copied into public documentation until each claim is tied to the
relevant source commit and direct test, artifact, deployment, or public evidence.
Those branches remain owned by their respective product worktrees.

The initial exact-commit checks at older Tokenomics, Chain Core and Bridge
commits remain valid only for those commits. They do not prove the newer owner
heads. This package records the newer heads and preserves dirty work; final claim
reconciliation must use accepted, committed source without modifying owner trees.

## Initial gap finding

The recovered repository is a useful engineering baseline but does not yet prove
completion of the founder-level documentation release. In particular, the
requested detailed specifications, tokenomics and fee disclosures, legal gap
analyses, evidence index, claims matrix, press and brand package, search-content
cluster, structured-data handoff, release records, capacity plan, unit economics,
migration and observability records, and one-time operator input request are not
all present under their required names or at the required evidence depth.

No absent item may be represented as implemented, deployed, signed, released, or
legally approved. The completion audit must distinguish all release-state
booleans and preserve Testnet, preview, test-signed, unsigned, and production
classes.

## Change log

- 0.2.0 (2026-07-25): Re-scanned all recovery surfaces, preserved concurrent dirty work, recorded mixed component endpoint evidence, completed the authoritative fact package and added a fail-closed public disclosure gate.
- 0.1.1 (2026-07-22): Re-scanned current owner worktrees, processes, releases,
  CI availability, local artifacts, server-input boundary and public endpoints.
- 0.1.0 (2026-07-22): Recorded initial worktree, ref, documentation, tag, release,
  sibling-branch, and evidence-gap recovery findings.
