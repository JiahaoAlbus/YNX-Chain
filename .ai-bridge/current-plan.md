# Current Plan — YNX Data Fabric

Status: `ACTIVE`
Phase: `INTEGRATE`
Engineering Source Commit: `6fbe0d33f4b4de3237391646d582e79cfee30a3c`
Release Candidate: `ynx-data-fabric-6fbe0d33f4b4`

## Completed and protected

- Exact YNX 26 Worktree, `codex/final-data-fabric` Branch and `JiahaoAlbus/YNX-Chain` Remote were verified.
- Evidence manifests no longer reference nonexistent tests or assets; the machine path validator is part of Quality Gates.
- Reachable vulnerability `GO-2026-6061` was removed by upgrading `google.golang.org/grpc` from `v1.79.3` to `v1.82.1`.
- Current CI findings `GO-2026-6218`, `GO-2026-6091`, `GO-2026-6090`, `GO-2026-6089`, `GO-2026-5972` and `GO-2026-5026` were removed by upgrading Go to `1.25.13` and `golang.org/x/net` to `v0.55.0` with its minimum compatible `x/crypto`, `x/sys` and `x/text` set.
- Full repository tests, Data Fabric Race tests, Vet and `govulncheck` pass locally; reachable vulnerabilities are zero.
- The current Engineering Source Commit is protected on review Branch `codex/data-fabric-typescript-sdk-20260814`; GitHub Actions Run `31768273194` passed both Data Fabric jobs at descendant checkpoint `759eedcfd1d631596092277a4e7469b8a70592dd`.
- Source-only prerelease `data-fabric-v0.2.0-source-candidate` is published at checkpoint `8cbc3dba0cbd139a0ba6bf7ba716b406856b32f5`; all seven assets were downloaded and their SHA-256 values matched, including archive digest `83f7f9ab449a61dcc1fe4006889f230b0c662b4678d522b1f0e6499eb81df848`.
- Go and TypeScript SDKs now share an exact producer-delivery signature vector. The TypeScript SDK verifies event integrity, requires HTTPS outside loopback, binds canonical Product Session credentials, bounds responses and rejects response-shape drift.
- The published source-only prerelease predates this engineering commit and truthfully records `currentSourceIncluded=false`; it is recovery evidence, not a download for the current release candidate.
- Central integration, shared Testnet, staging, public deployment, hosted download and production signing remain false without direct receipts.

## Current slice

1. Preserve PR `#92` and the verified recovery bundle while the protected target awaits its configured required contexts.
2. Have repository policy owners remove or make runnable the six unrelated required contexts on `codex/final-data-fabric`; do not bypass them with force or administrator merge.
3. Submit the frozen contract and both SDK paths to Product 29 for central acceptance.
4. Resume shared-Testnet work only from accepted authorities and approved infrastructure.

## Exact next action

Resolve the protected-branch context configuration for PR `#92`, then merge through the required workflow and hand the exact frozen contract and test vectors to central integration. Keep shared-Testnet, staging and public states false until direct evidence exists.
