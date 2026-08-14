# Current Plan — YNX Data Fabric

Status: `ACTIVE`
Phase: `INTEGRATE`
Engineering Source Commit: `8ee6d8f37ce945111ba76ddc2466c06164a6c4e8`
Release Candidate: `ynx-data-fabric-8ee6d8f37ce9`

## Completed and protected

- Exact YNX 26 Worktree, `codex/final-data-fabric` Branch and `JiahaoAlbus/YNX-Chain` Remote were verified.
- Evidence manifests no longer reference nonexistent tests or assets; the machine path validator is part of Quality Gates.
- Reachable vulnerability `GO-2026-6061` was removed by upgrading `google.golang.org/grpc` from `v1.79.3` to `v1.82.1`.
- Current CI findings `GO-2026-6218`, `GO-2026-6091`, `GO-2026-6090`, `GO-2026-6089`, `GO-2026-5972` and `GO-2026-5026` were removed by upgrading Go to `1.25.13` and `golang.org/x/net` to `v0.55.0` with its minimum compatible `x/crypto`, `x/sys` and `x/text` set.
- Full repository tests, Data Fabric Race tests, Vet and `govulncheck` pass locally; reachable vulnerabilities are zero.
- Same-product account isolation now covers events, Ledger, billing settlements, Saga coordinates and reconciliation; `fabric.audit.export` remains an explicit product-wide privileged scope.
- One hundred simultaneous local canonical account sessions each returned exactly their own event under the Go race detector. This is local API/Store isolation evidence, not Testnet or 1000-producer capacity evidence.
- Engineering-evidence Run `31791152026` produced exact-source 1000 signed Producer PostgreSQL-to-JetStream evidence together with restart/replay, consumer-crash and transport-backpressure evidence at `8ee6d8f37ce945111ba76ddc2466c06164a6c4e8`; final evidence-head Run `31793195539` passed both jobs at `8b405e4e9dd221b48099a55899a63adf885b9725`.
- Producer ingress now has a configurable nonblocking concurrency gate, explicit retryable `429 producer_backpressure`, retry-safe nonce handling and saturation metrics.
- A clean-source run released 1000 independently signed producers simultaneously through real loopback HTTP: 1000 committed, zero business errors, peak in-flight 64, p50/p95/p99 18.72/39.94/41.92 seconds, 23.37 events/s and Outbox depth 1000. The slow result is explicitly local file Store evidence, not production capacity.
- Exact-source Linux CI committed 10,000 PostgreSQL events with 90% ordered hotspot skew, rejected all 1,000 synchronized duplicates, restarted PostgreSQL with zero event loss, completed integrity recovery in 851.920 ms, applied 10,000 Analytics effects at 387.932 events/s and idempotently skipped all 10,000 on the second replay.
- The same CI released 1000 independently signed Producers through real loopback HTTP into PostgreSQL, held peak in-flight at 64, committed 1000 with zero business errors after 3688 safe backpressure retries, published all 1000 Outbox rows to JetStream, and ended with Outbox 0 and Stream 1000 at 129.489 events/s.
- The same job terminated a real consumer subprocess after its PostgreSQL Analytics fact and Inbox transaction committed but before JetStream ack. Redelivery observed the Inbox and did not reapply: one fact, one Inbox effect, zero pending acknowledgements, zero duplicate business effects.
- A 256-event PostgreSQL Outbox batch filled a 64 KiB JetStream after 18 acknowledgements. All 238 capacity rejections remained pending with zero DLQ entries; explicit expansion to 8 MiB published all 238 and ended with exactly 256 stream messages, zero duplicates and zero pending Outbox rows.
- Source-only prerelease `data-fabric-v0.2.0-source-candidate` is published at checkpoint `8cbc3dba0cbd139a0ba6bf7ba716b406856b32f5`; all seven assets were downloaded and their SHA-256 values matched, including archive digest `83f7f9ab449a61dcc1fe4006889f230b0c662b4678d522b1f0e6499eb81df848`.
- Go and TypeScript SDKs now share an exact producer-delivery signature vector. The TypeScript SDK verifies event integrity, requires HTTPS outside loopback, binds canonical Product Session credentials, bounds responses and rejects response-shape drift.
- Optional Envelope v2 `chainCommitmentId` consumes frozen Chain Core contract v1.21.0 / implementation `9468a771b46f50e0e12b7567d7aa51a2f95b4e36` / contract `cefb37144517e8f44fd9d0b41119bb5754bdb55d` from the SHA-256-verified v21 bundle as a read-only external reference and fails closed before storage; candidate runtime identity evidence does not establish deployment.
- The published source-only prerelease predates this engineering commit and truthfully records `currentSourceIncluded=false`; it is recovery evidence, not a download for the current release candidate.
- Central integration, shared Testnet, staging, public deployment, hosted download and production signing remain false without direct receipts.

## Current slice

1. Bind the final CI receipt and refresh the complete recovery bundle.
2. Obtain the required independent approval and merge through protected-branch policy; do not bypass it with force or administrator merge.
3. Execute sustained hotspot, repeated consumer/process crash, broker partition/leader-loss and PostgreSQL replica-failover drills on replicated infrastructure.
4. Submit the frozen contract and both SDK paths to Product 29 for central acceptance, then have Website publish the existing canonical metadata only after runtime, signer, immutable-hosting and Website receipts are available.

## Exact next action

Bind the final evidence-head CI receipt, refresh recovery, then continue sustained-duration and replicated failure drills. Obtain independent approval before merging PR `#92`; keep shared-Testnet, staging, public, download and Website publication states false until direct receipts exist.
