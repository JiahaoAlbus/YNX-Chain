# Current Plan — YNX Data Fabric

Status: `ACTIVE`
Phase: `INTEGRATE`
Engineering Source Commit: `59c60864ac433bdf474ce16f9199533907017deb`
Release Candidate: `ynx-data-fabric-59c60864ac43`

## Completed and protected

- Exact YNX 26 Worktree, `codex/final-data-fabric` Branch and `JiahaoAlbus/YNX-Chain` Remote were verified.
- Evidence manifests no longer reference nonexistent tests or assets; the machine path validator is part of Quality Gates.
- Reachable vulnerability `GO-2026-6061` was removed by upgrading `google.golang.org/grpc` from `v1.79.3` to `v1.82.1`.
- Current CI findings `GO-2026-6218`, `GO-2026-6091`, `GO-2026-6090`, `GO-2026-6089`, `GO-2026-5972` and `GO-2026-5026` were removed by upgrading Go to `1.25.13` and `golang.org/x/net` to `v0.55.0` with its minimum compatible `x/crypto`, `x/sys` and `x/text` set.
- Full repository tests, Data Fabric Race tests, Vet and `govulncheck` pass locally; reachable vulnerabilities are zero.
- Same-product account isolation now covers events, Ledger, billing settlements, Saga coordinates and reconciliation; `fabric.audit.export` remains an explicit product-wide privileged scope.
- One hundred simultaneous local canonical account sessions each returned exactly their own event under the Go race detector. This is local API/Store isolation evidence, not Testnet or 1000-producer capacity evidence.
- Previous Engineering Source `962e2668fa666729f210990a7ad89e5ab5b66d6f` passed final-head Run `31771975186`; current-source remote CI is pending.
- Producer ingress now has a configurable nonblocking concurrency gate, explicit retryable `429 producer_backpressure`, retry-safe nonce handling and saturation metrics.
- A clean-source run released 1000 independently signed producers simultaneously through real loopback HTTP: 1000 committed, zero business errors, peak in-flight 64, p50/p95/p99 18.72/39.94/41.92 seconds, 23.37 events/s and Outbox depth 1000. The slow result is explicitly local file Store evidence, not production capacity.
- Source-only prerelease `data-fabric-v0.2.0-source-candidate` is published at checkpoint `8cbc3dba0cbd139a0ba6bf7ba716b406856b32f5`; all seven assets were downloaded and their SHA-256 values matched, including archive digest `83f7f9ab449a61dcc1fe4006889f230b0c662b4678d522b1f0e6499eb81df848`.
- Go and TypeScript SDKs now share an exact producer-delivery signature vector. The TypeScript SDK verifies event integrity, requires HTTPS outside loopback, binds canonical Product Session credentials, bounds responses and rejects response-shape drift.
- Optional Envelope v2 `chainCommitmentId` consumes frozen Chain Core source `0da66c319629a79613739df351b5000b85a1371a` / release `b481a46f6d77644d0dff13e3917a51f8503e88f4` as a read-only external reference and fails closed before storage.
- The published source-only prerelease predates this engineering commit and truthfully records `currentSourceIncluded=false`; it is recovery evidence, not a download for the current release candidate.
- Central integration, shared Testnet, staging, public deployment, hosted download and production signing remain false without direct receipts.

## Current slice

1. Bind the 1000-producer result to the current source, run quality gates, push PR `#92` and wait for both current-source checks.
2. Obtain the required independent approval and merge through protected-branch policy; do not bypass it with force or administrator merge.
3. Repeat 1000 producers on PostgreSQL plus JetStream and execute hotspot, restart, crash and long-replay drills.
4. Submit the frozen contract and both SDK paths to Product 29 for central acceptance.

## Exact next action

Verify and protect the source-bound 1000-producer slice, then continue PostgreSQL/JetStream hotspot and failure drills. Obtain independent approval before merging PR `#92`; keep shared-Testnet, staging and public states false until direct evidence exists.
