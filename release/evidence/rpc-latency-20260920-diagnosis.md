# Weekly v3 RPC checkpoint latency diagnosis and candidate

Owner: NETWORK task `01a0b8cc-8ea5-7db3-87f6-27f5cabf51be`.
Branch: `codex/weekly-v3-rpc-latency-20260920`.
Base: `2ab479f8cc09ad3fc123363c1e0e36f182997f4c`.
Only Core periodic checkpoint persistence, its tests and bounded read-only
diagnostics are changed. Finance, Wallet, shared endpoint authority, PR #169,
genesis, chain configuration, admission rules and balances are not changed.

## Observed live baseline (2026-09-20 UTC)

Both `rpc-testnet.ynxweb4.com` and `rpc.ynxweb4.com` resolve directly to
`43.153.202.237`. No CDN hop was observed. Caddy terminates TLS and both RPC
routes reverse-proxy to `127.0.0.1:6420`; the canonical route has zero retries,
3-second dial timeout and 15-second response-header timeout. The legacy route
retains its existing compatibility handlers. No DNS/proxy configuration changed.

Read-only SSH at 15:13 UTC found Core PID `2209167`, active, zero restarts;
installed binary SHA-256
`e7713e026e87d877951fb0e769e60e2fd6260bc70804a98e4523f52b2a2087b8`, matching
the existing source `8a2cc428a20ddc06e9f95232a4e1d9a3bc238f68` deployment.
Snapshot size was approximately 518 MiB, RSS approximately 2.96 GB and available
memory approximately 24 GB; short vmstat samples showed snapshot disk writes
and up to 20% I/O wait, not memory exhaustion. Long-lived process / zero restarts
does not support a process cold-start explanation for repeated spikes.

At 15:22 UTC, Caddy PID `1432803` was active with zero restarts. Config hashes:

- `/etc/caddy/Caddyfile`: `c9f18ca97f865efce1472b6fd99df5875cad9bba057c8f35abddedfa3f7c54c9`
- `/etc/caddy/ynx-chain.caddy`: `d49d787bd2085fa6b6a247b67cdfb561e0bb0847aabd6b163160e826b42ce28c`
- `/etc/caddy/conf.d/ynx-testnet-aliases.caddy`: `e1fc0953f0f3431e78e60e6770f36f3f76eeed082c60d27f688a0eb59521da7e`

## Reproduction, not an availability claim

Each origin has three independent simulated clients, three rounds, fresh and
keepalive HTTP/1.1 modes, health/chainId/blockNumber/one pre-existing receipt.
Maximum public concurrency is six; loopback concurrency is three. No retries,
transaction submissions or Faucet admissions. Latencies include cold/error samples.

| Sample | Count | Errors | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Public aliases combined | 144 | 0 | 665.53 ms | 6738.60 ms | 7106.99 ms |
| Same live node, direct loopback | 72 | 0 | 1.71 ms | 6738.71 ms | 6893.06 ms |

Raw per-method/per-origin/mode and timing evidence:
`rpc-latency-20260920-public-before.json` and
`rpc-latency-20260920-loopback-before.json`. HTTPS uses certificate validation;
the explicit loopback `http://127.0.0.1:6420` sample has no TLS, regardless of
the original generic protocol label in that captured result.
Keepalive also hit a 6.04-second public chainId read and a 6.74-second loopback
receipt read. Thus connection reuse reduces setup overhead but does not remove
the node-side delay. Separate curl loopback reads had health at 0.4–0.5 ms while
blockNumber took 6.471/7.037 seconds, bypassing Caddy and the WAN entirely.

## Cause and narrowly scoped fix

Periodic block persistence held `Devnet.mu.RLock()` across full-history hashing,
encoding and fsync. A peer-observation writer waiting for this lock prevents
later RLocks from entering; even immutable chainId routing first checks the
native adapter under that state lock. This behavior matches the documented
[Go RWMutex writer-preference contract](https://pkg.go.dev/sync#RWMutex).
The previous concurrent-read test lacked a queued writer and missed this case.
A deterministic test with a stalled checkpoint writer failed before the change
with `peer writer waits for checkpoint I/O and therefore queues all later RPC reads`.

The candidate detaches typed mutable state and block headers/transaction graphs
under the state read lock, then seals and writes the detached snapshot outside
that lock. It preserves exact int64 values, nested state ownership, snapshot wire
format and all durability checks. The persistence mutex is acquired before
detaching and held through disk completion, in the existing state→persistence
lock order: a later mutation cannot be overwritten by the older detached snapshot.
No persistence-mutex holder reacquires the state lock.

Synchronous mutation paths still hold their existing state lock and wait for
durability. This fix does **not** claim elimination of latency during active
mutations or concurrent replication, nor reduction of full-history disk volume.
Detachment adds a block-header copy and deep copies mutable state; production
memory/latency must be measured before accepting the candidate publicly.

## Tests and evidence boundaries

- Before: new queued-writer regression failed (0.33 seconds).
- After: queued writer/read responsiveness; exact typed snapshot bytes and values
  above 2^53; nested account/transaction/log alias isolation; serialized later
  mutation/cold restart; existing durability/failure/replication suites pass.
- `go test -race ./internal/chain ./internal/api ./internal/faucet -count=1`:
  PASS (37.848s / 30.296s / 13.378s); `go vet` on those packages PASS.
- `node --test scripts/verify/rpc-read-latency.test.mjs`: 6/6 PASS, including
  allowlisted origins/read methods, malformed/incorrect results, hard deadline,
  bounded load and error-inclusive percentiles.
- Synthetic local 100000-block history, 3 rounds × 3 readers × 30 reads:
  270 observations, p50 47.542 microseconds, p95 115 microseconds,
  max 9.144667 milliseconds in the recorded race-enabled run. Local test only.
- A broad `go test ./...` initially failed on pre-existing duplicate command
  declarations under unchanged `apps/quant-lab/scripts` and missing generated
  Solidity fixture artifacts. It is not reported as a passing test command.
  After Hardhat compilation and selector metadata generation, contract tooling
  verification and the repository CI test target
  `go test ./cmd/... ./internal/... -count=1` both PASS. No unrelated source fix
  was made. Hardhat's cleanup removed eight tracked Finance artifacts in this
  isolated tree; all eight were restored byte-for-byte from this tree's clean
  baseline and the final diff contains no Finance changes.

## Exact remaining deployment / rollback operations (NOT EXECUTED)

1. Review the exact candidate commit and CI; build a Linux/amd64 candidate with
   bound source/release metadata and record artifact SHA. Obtain a fresh Central
   single-use Core deployment/rollback lease and authorized executor. Existing
   read-only SSH authorization does not authorize these operations.
2. Re-read live Core binary SHA/source, Caddy/Faucet identities, freeze ownership,
   current height/hash, receipt durability and balances. Abort on unexpected
   changes. Back up the **current** `8a2cc428...` binary (`e7713e...`) and exact
   service configuration as the new candidate's rollback anchor. The historical
   backup at `/var/backups/ynx-chain/core-release-20260920-8a2cc428` restores an
   older `4c17f2...` binary and is not the candidate's correct rollback target.
3. Under that separate lease, use the existing boundary-safe Core release flow
   to freeze admissions/block production, obtain a consistent checkpoint,
   replace only the Core binary, verify config/cold-load/readback, then clear
   only this release's owned pause markers. Do not change Caddy, Faucet, DNS,
   chain ID, genesis, user state, historic data or shared authority.
4. Re-run the identical bounded public and loopback read probes through several
   real checkpoints, record p50/p95/max/errors and RSS/disk activity, verify
   canonical/legacy chain 0x1917, progressing blocks and existing receipt/balance
   equality. No new funding or transaction is needed. Preserve all slow/error
   samples; do not mix before/after results.
5. If acceptance fails and the lease allows rollback, restore the newly backed-up
   `e7713e...` Core binary/config while keeping the **current live ledger**.
   Never restore an old ledger snapshot or erase admission state. Recheck runtime
   identity, block progress and exact historical receipts after rollback.

Candidate implemented/tested locally; candidate publicDeployed=false,
candidate publicVerified=false, performanceSLOVerified=false,
globalAvailabilityVerified=false, multiRegionVerified=false.
Mainnet/live/production approval remains false. No public write or deployment
has been performed by this task.
