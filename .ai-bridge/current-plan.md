# Current Plan — YNX Data Fabric

Status: `ACTIVE`
Phase: `INTEGRATE`
Engineering Source Commit: `c134290a4800a30c2f1f5a57523adf1daea34ad3`
Release Candidate: `ynx-data-fabric-c134290a4800`

## Completed and protected

- Exact YNX 26 Worktree, `codex/final-data-fabric` Branch and `JiahaoAlbus/YNX-Chain` Remote were verified.
- Evidence manifests no longer reference nonexistent tests or assets; the machine path validator is part of Quality Gates.
- Reachable vulnerability `GO-2026-6061` was removed by upgrading `google.golang.org/grpc` from `v1.79.3` to `v1.82.1`.
- Current CI findings `GO-2026-6218`, `GO-2026-6091`, `GO-2026-6090`, `GO-2026-6089`, `GO-2026-5972` and `GO-2026-5026` were removed by upgrading Go to `1.25.13` and `golang.org/x/net` to `v0.55.0` with its minimum compatible `x/crypto`, `x/sys` and `x/text` set.
- Full repository tests, Data Fabric Race tests, Vet and `govulncheck` pass locally; reachable vulnerabilities are zero.
- Same-product account isolation now covers events, Ledger, billing settlements, Saga coordinates and reconciliation; `fabric.audit.export` remains an explicit product-wide privileged scope.
- One hundred simultaneous local canonical account sessions each returned exactly their own event under the Go race detector. This is local API/Store isolation evidence, not Testnet or 1000-producer capacity evidence.
- Engineering-evidence Run `31797308684` produced exact-source 1000 signed Producer PostgreSQL-to-JetStream evidence together with restart/replay, consumer-crash, transport-backpressure and three-replica JetStream stream-leader-loss evidence at `4bb2ddfb6337e44060f57adafc7ee1cc08faedbe`; final evidence-head Run `31799837096` passed both jobs at v24-bound head `54c8bc0e16a5a5b3bf6321d041f8b35fea871fbb`.
- Producer ingress now has a configurable nonblocking concurrency gate, explicit retryable `429 producer_backpressure`, retry-safe nonce handling and saturation metrics.
- A clean-source run released 1000 independently signed producers simultaneously through real loopback HTTP: 1000 committed, zero business errors, peak in-flight 64, p50/p95/p99 18.72/39.94/41.92 seconds, 23.37 events/s and Outbox depth 1000. The slow result is explicitly local file Store evidence, not production capacity.
- Exact-source Linux CI committed 10,000 PostgreSQL events with 90% ordered hotspot skew, rejected all 1,000 synchronized duplicates, restarted PostgreSQL with zero event loss, completed integrity recovery in 1120.679 ms, applied 10,000 Analytics effects at 316.163 events/s and idempotently skipped all 10,000 on the second replay.
- The same CI released 1000 independently signed Producers through real loopback HTTP into PostgreSQL, held peak in-flight at 64, committed 1000 with zero business errors after 4686 safe backpressure retries, published all 1000 Outbox rows to JetStream, and ended with Outbox 0 and Stream 1000 at 98.933 events/s.
- The same job terminated a real consumer subprocess after its PostgreSQL Analytics fact and Inbox transaction committed but before JetStream ack. Redelivery observed the Inbox and did not reapply: one fact, one Inbox effect, zero pending acknowledgements, zero duplicate business effects.
- A 256-event PostgreSQL Outbox batch filled a 64 KiB JetStream after 18 acknowledgements. All 238 capacity rejections remained pending with zero DLQ entries; explicit expansion to 8 MiB published all 238 and ended with exactly 256 stream messages, zero duplicates and zero pending Outbox rows.
- A three-process file-backed JetStream cluster with replicas=3 changed stream leader after 64 acknowledged events, acknowledged 64 more through the new leader, ended with Outbox 0 and Stream 128 without duplicates, restarted the stopped server and restored three current replicas. This is one bounded one-host loopback drill, not shared-Testnet availability proof.
- A second three-process drill forces every explicit and gossiped route through per-node TCP fault proxies, isolates the live stream leader with zero remaining routes, rejects and retains one isolated-side Outbox write, commits 64 rows through the surviving quorum, heals all routes and ends with three current replicas, Outbox 0, Stream 192 and zero duplicates. Race mode passed twice; exact-source Linux CI Run `31811137802` passed both jobs and its eleven-file artifact was downloaded and SHA-256 verified. This is not packet-loss, WAN, sustained-load, shared-Testnet or public availability proof.
- Exact-source Linux CI Run `31838660585` passed all three jobs at head `1216adcfd889af371f52c96dbb2d1d3112b291ea`, including PostgreSQL 17 asynchronous streaming catch-up, old-primary stop, manual standby promotion, writable recovery, 1,000-event/Outbox preservation, RPO zero, integrity validation and exactly-once replay. Both artifacts were downloaded; all 14 files were SHA-256 verified. CI connection/integrity-ready RTO was 1,141.703/1,418.547 ms. This is not automatic endpoint failover, fencing, synchronous quorum, multi-host/regional DR or public availability proof.
- Source-only prerelease `data-fabric-v0.2.0-source-candidate` is published at checkpoint `8cbc3dba0cbd139a0ba6bf7ba716b406856b32f5`; all seven assets were downloaded and their SHA-256 values matched, including archive digest `83f7f9ab449a61dcc1fe4006889f230b0c662b4678d522b1f0e6499eb81df848`.
- Go and TypeScript SDKs now share an exact producer-delivery signature vector. The TypeScript SDK verifies event integrity, requires HTTPS outside loopback, binds canonical Product Session credentials, bounds responses and rejects response-shape drift.
- Optional Envelope v2 `chainCommitmentId` consumes frozen Chain Core contract v1.31.0 / implementation `3af591a2fe110b953da6b109580738bf894a4852` / contract `ee45c0700179addadfe1b9c845d2b1b475eea12a` from the SHA-256-verified v31 bundle as a read-only external reference and fails closed before storage. Public semantics are unchanged; v31 adds an external monotonic validator SafetyRollbackAnchor with CAS-before-local-replace, exact readback and crash/snapshot-replay recovery. Production anchor authority, remote recovery drill and signer custody remain false/unprovided. The contract has 106 vectors and does not establish central integration or deployment.
- The published source-only prerelease predates this engineering commit and truthfully records `currentSourceIncluded=false`; it is recovery evidence, not a download for the current release candidate.
- PostgreSQL migration `0009_analytics_retention_sweeps` deletes only explicitly expired, payload-free `transient` and `operational` Analytics facts in one serializable transaction and appends bounded deletion counts under an idempotent audit ID. It never selects canonical events, Outbox, Inbox, Ledger, financial, audit-7y, or legal-hold records; cutoffs must be supplied by an approved caller and no scheduler or runtime deployment is claimed.
- Exact-source GitHub Actions run `33374309851` passed all six Data Fabric jobs for engineering source `c134290a4800a30c2f1f5a57523adf1daea34ad3` at binding head `f818ee876dbd7e20016f9363c09ef8e0a6fedeb3`, including complete Go/race/vet/release-truth, PostgreSQL live and failover, and reproducible-build gates.
- Central integration, shared Testnet, staging, public deployment, hosted download and production signing remain false without direct receipts.

## Current slice

1. Preserve the accepted `connectionEvents@1.0.0-p0.0` asynchronous runtime adapter; it must never gate standard Wallet connection, approval, signing, or transaction flows.
2. Wait for the P0-147 authoritative public endpoint plus runtime/service/rollback mapping before any deployment action; production mutation remains forbidden.
3. Obtain the required independent approval and merge through protected-branch policy; do not bypass it with force or administrator merge.
4. Execute sustained hotspot, repeated consumer/process crash, deployed network-partition and multi-host PostgreSQL failover/fencing drills only under their own bounded infrastructure authority.

## Exact next action

Obtain Integration review for the Wallet Connectivity candidate and a Data Fabric light lease. Keep the candidate out of the active Registry and all shared-Testnet, staging, public, download and Website publication states false until direct receipts exist.
