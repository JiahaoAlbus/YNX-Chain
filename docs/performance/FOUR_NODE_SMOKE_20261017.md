# First real four-validator local transaction result

Date: 2026-10-17, Asia/Shanghai. Runtime source: `2ee001fe6e48342109adf993dfbf51f7810f410c`; fee-journal core: `50385dc72b2c58154d6d35c766f994ebd6f20c00`.

**32 signed native business transfers completed actual four-validator consensus and local durable-state verification.** All four stopped nodes have byte-identical height-12 state. This is a bounded small-load result: the first-stage sustained 1,000 TPS and 10-minute stability targets remain unverified.

## Configuration and measurement

- Apple M4, 10 logical CPUs, 24 GiB RAM; Go 1.25.7 darwin/arm64; CometBFT v0.38.23.
- Four equal-power validators and four persistent socket-ABCI applications, each `GOMAXPROCS=1`, nice 10. All P2P/RPC/ABCI listeners bind `127.0.0.1`.
- 32 new temporary senders, one valid signed transfer per sender, 1 YNXT amount plus the existing 1 YNXT fee. No real accounts or existing databases were used.
- Four workers cover complete submit-and-observe lifetimes. The workload is closed-loop; it does not offer a fixed high arrival rate or establish saturation capacity.
- Retained local config: proposal 750 ms, prevote/precommit 350 ms, commit timeout 500 ms. No consensus safety threshold or verification step was removed.
- Fresh slot granted by Root; the old pre-reboot slot was returned unused. No build/download occurred in the actual window.
- Run began 2026-10-17 15:30:53.560 Shanghai time. Workload observation was 15:31:00.197–15:31:09.498, **9.301293875 seconds**. Total runner time was 16.101 seconds including startup and cleanup.

All rate rows below use that same complete workload observation/drain window, excluding fixture/startup. Equal counts do not collapse the separate checks into one metric.

| Stage | Count | Count / full observation second |
| --- | ---: | ---: |
| RPC submission started | 32 | 3.4404 |
| CheckTx accepted | 32 | 3.4404 |
| Code-zero transaction included with verified Merkle proof | 32 | 3.4404 |
| Weighted signed commit verified | 32 | 3.4404 |
| Final submission with local persisted state/fee/nonce readback | 32 | 3.4404 |

| Client-observed latency | P50 ms | P95 ms | P99 ms | Samples |
| --- | ---: | ---: | ---: | ---: |
| CheckTx response | 4.328 | 72.273 | 80.576 | 32 |
| Effective inclusion | 1,001.983 | 1,522.901 | 1,904.633 | 32 |
| Final confirmation including durable readback | 1,003.816 | 1,526.535 | 1,905.906 | 32 |

This small-load observation meets P95 <= 3 seconds at the stated load. No such latency result is established at 1,000 TPS. Polling interval was 100 ms; latency includes polling, RPC and verification/readback overhead.

Rejected transactions, execution failures, submission UNKNOWN, timeouts, unsubmitted transactions and observation-verification failures were all **0**. The raw report also retains **332** observation errors. Every one is a `tx_query` RPC "not found" while waiting for inclusion; none is hidden or counted as a successful transaction. Confirmed transactions appeared at block heights 4–12. Empty blocks and votes contribute no effective TPS.

## Signature, persistence and replay evidence

The client checks raw transaction/hash identity, weighted Ed25519 commit signatures, validator/genesis binding and transaction Merkle proofs. Final submission additionally requires a full validation of that endpoint's persisted state plus the matching native fee record and sender nonce. The same-height signed Header.AppHash authenticates preceding state; the current disk readback is separate evidence.

After normal shutdown, all four files were height 12 with 32 fee events, AppHash `fac616921305b172cf366ead4646878f07f6102a029613e23f883e81a4bb3152`, 44,376 bytes each and SHA-256 `c85f4b95e513035e7d78cfff47aad0dfe6628f8fa14b16de689a6e5e373bccdb`.

An offline opt-in test opened each stopped blockstore read-only, revalidated the actual stored signatures for blocks 2–12 against the local genesis, checked the signed prior-state AppHashes and re-executed all 32 real block transactions in order. Each complete replayed state equals its durable snapshot. The evidence includes the public signed block payloads for independent inspection. This was offline replay, not a new network run or a four-node crash/restart drill.

The separate application crash test covers abrupt process exit after FinalizeBlock versus after durable Commit, with recovery and replay rejection. Multi-node fault/restart recovery remains a later scheduled gate.

## Cleanup and host resources

Runner PID 61218 and fixture/client/eight node processes terminated normally with exit 0. No SIGKILL was needed; normal cleanup took **107 ms**. Every recorded child process group disappeared. Fresh post-run PID existence checks found the runner and all children gone, and all 12 local ports could be bound again. Heavy usage was returned to Root immediately at terminal completion.

The original schema-1 launcher sampled child RSS at a peak of 345,718,784 bytes (329.7 MiB); controller RSS was separately observed once at 87,120 KiB. It did not record a continuous whole-control-group RSS peak. Test data/output peak during the window was 1,880,064 bytes (1.79 MiB), within the 128 MiB limit.

Root reported a concurrent `CreateProcess Resource temporarily unavailable (os error35)` at approximately 07:31 UTC. Root reported that no process was created by that failed call. The causal relationship to this run is unproven; the successful transaction result and child memory/data caps do not establish whole-host resource usability. A post-stop snapshot showed 1,011 system processes and 759 current-UID processes, with limits 6,000 total / 4,000 per UID; these are post-stop values, not historical peak evidence.

The next launcher version adds control RSS, a 9 long-lived-child cap and sampled 320-thread-row stop condition. It is a diagnostic/protection change; neither the new live guard behavior nor resolution of Root's host error has been established by this completed run. Any next network run needs a fresh Root slot and actual host headroom.

## Reproduction and next action

The runtime command was the prebuilt [local window runner](LOCAL_FOUR_VALIDATOR_SMOKE.md), with `--execute`, 32 transactions and the exact binary paths/digests in [the complete evidence JSON](evidence/four-node-smoke-20261017.json). The raw local window remains under `artifacts/chain-network-performance/window-E5Y0G2/`; consensus private keys remain only in that isolated ignored directory and are not part of the report.

Offline replay command from the performance worktree:

```sh
env GOMAXPROCS=1 \
  YNX_CHAIN_STOPPED_WINDOW="$PWD/artifacts/chain-network-performance/window-E5Y0G2" \
  nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-client \
  -run '^TestStoppedNetworkReplay$' -count=1 -v -timeout=45s
```

The replay output uses exclusive creation. Existing proof files must be retained; do not overwrite or re-run uncertain writes blindly.

Next: measure and guard process/thread headroom, then separate bounded transaction submission from confirmation observation so the offered rate is explicit instead of limited by four complete round trips. Preserve every proof/durability check and independent nonce handling. Root will schedule the next small comparison before increasing transaction count, rate or duration. History/account scaling and whole-state persistence cost still need measurement before a 10-minute 1,000 TPS qualification.
