# Current Plan — YNX Data Fabric

Status: `ACTIVE`
Phase: `INTEGRATE`
Engineering Source Commit: `a0f92680d0df50ed131b5eb422a851f5874c9045`
Release Candidate: `ynx-data-fabric-a0f92680d0df`

## Completed and protected

- Exact YNX 26 Worktree, `codex/final-data-fabric` Branch and `JiahaoAlbus/YNX-Chain` Remote were verified.
- Evidence manifests no longer reference nonexistent tests or assets; the machine path validator is part of Quality Gates.
- Reachable vulnerability `GO-2026-6061` was removed by upgrading `google.golang.org/grpc` from `v1.79.3` to `v1.82.1`.
- Current CI findings `GO-2026-6218`, `GO-2026-6091`, `GO-2026-6090`, `GO-2026-6089`, `GO-2026-5972` and `GO-2026-5026` were removed by upgrading Go to `1.25.13` and `golang.org/x/net` to `v0.55.0` with its minimum compatible `x/crypto`, `x/sys` and `x/text` set.
- Full repository tests, Data Fabric Race tests, Vet and `govulncheck` pass locally; reachable vulnerabilities are zero.
- Same-product account isolation now covers events, Ledger, billing settlements, Saga coordinates and reconciliation; `fabric.audit.export` remains an explicit product-wide privileged scope.
- One hundred simultaneous local canonical account sessions each returned exactly their own event under the Go race detector. This is local API/Store isolation evidence, not Testnet or 1000-producer capacity evidence.
- Engineering-evidence Run `31786668608` produced exact-source PostgreSQL, consumer-crash and transport-backpressure evidence at `a0f92680d0df50ed131b5eb422a851f5874c9045`. Final evidence-head Run `31788198895` passed both jobs at `d0d7e4d6ce5bfbeeafcc21d3c9186aa6e52434dc`.
- Producer ingress now has a configurable nonblocking concurrency gate, explicit retryable `429 producer_backpressure`, retry-safe nonce handling and saturation metrics.
- A clean-source run released 1000 independently signed producers simultaneously through real loopback HTTP: 1000 committed, zero business errors, peak in-flight 64, p50/p95/p99 18.72/39.94/41.92 seconds, 23.37 events/s and Outbox depth 1000. The slow result is explicitly local file Store evidence, not production capacity.
- Exact-source Linux CI committed 10,000 PostgreSQL events with 90% ordered hotspot skew, rejected all 1,000 synchronized duplicates, restarted PostgreSQL with zero event loss, completed integrity recovery in 1,106.607 ms, applied 10,000 Analytics effects at 386.747 events/s and idempotently skipped all 10,000 on the second replay.
- The same job terminated a real consumer subprocess after its PostgreSQL Analytics fact and Inbox transaction committed but before JetStream ack. Redelivery observed the Inbox and did not reapply: one fact, one Inbox effect, zero pending acknowledgements, zero duplicate business effects.
- A 256-event PostgreSQL Outbox batch filled a 64 KiB JetStream after 18 acknowledgements. All 238 capacity rejections remained pending with zero DLQ entries; explicit expansion to 8 MiB published all 238 and ended with exactly 256 stream messages, zero duplicates and zero pending Outbox rows.
- Source-only prerelease `data-fabric-v0.2.0-source-candidate` is published at checkpoint `8cbc3dba0cbd139a0ba6bf7ba716b406856b32f5`; all seven assets were downloaded and their SHA-256 values matched, including archive digest `83f7f9ab449a61dcc1fe4006889f230b0c662b4678d522b1f0e6499eb81df848`.
- Go and TypeScript SDKs now share an exact producer-delivery signature vector. The TypeScript SDK verifies event integrity, requires HTTPS outside loopback, binds canonical Product Session credentials, bounds responses and rejects response-shape drift.
- Optional Envelope v2 `chainCommitmentId` consumes frozen Chain Core source `0da66c319629a79613739df351b5000b85a1371a` / release `b481a46f6d77644d0dff13e3917a51f8503e88f4` as a read-only external reference and fails closed before storage.
- The published source-only prerelease predates this engineering commit and truthfully records `currentSourceIncluded=false`; it is recovery evidence, not a download for the current release candidate.
- Central integration, shared Testnet, staging, public deployment, hosted download and production signing remain false without direct receipts.

## Current slice

1. Refresh and verify the complete recovery bundle at the final transport-backpressure checkpoint.
2. Obtain the required independent approval and merge through protected-branch policy; do not bypass it with force or administrator merge.
3. Repeat 1000 signed HTTP Producers across PostgreSQL plus JetStream and execute sustained hotspot, repeated consumer/process crash, broker partition/leader-loss and PostgreSQL replica-failover drills.
4. Submit the frozen contract and both SDK paths to Product 29 for central acceptance, then have Website publish the existing canonical metadata only after runtime, signer, immutable-hosting and Website receipts are available.

## Exact next action

Refresh recovery for the protected transport-backpressure slice, then continue PostgreSQL-plus-JetStream signed Producer, sustained-duration and replicated failure drills. Obtain independent approval before merging PR `#92`; keep shared-Testnet, staging, public, download and Website publication states false until direct receipts exist.
