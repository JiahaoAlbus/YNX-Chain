# Chain performance: first bounded application measurement

Date: 2026-10-17, Asia/Shanghai.

The first change reduces native-transfer state-copy allocation by **22.6%** and improves measured validation/proposal/execution stage totals. It does **not** establish a sustained network TPS improvement: complete application-pipeline throughput medians were 1,127.7 before and 1,099.5 after, with variable durable-commit time on a shared machine.

## Source and execution identity

- Base: `3a49306956eef0f5933714760f4cc34a7f93c584`, from the clean existing `01-chain-core` checkout / `codex/dex-consensus-v13`.
- Performance branch: `codex/chain-performance-20261017`.
- Isolated workspace: `/Users/huangjiahao/.codex/worktrees/chain-performance-20261017/YNX Chain`.
- Main checkout `d33a6c790ec26223394810ff48da92b404526136` lacks newer core consensus functionality and was not used as the performance source. Its dirty Faucet/deployment files were preserved.
- Exact changed-source and retained test-binary SHA-256 values, all six comparison runs and stage percentiles: [evidence JSON](evidence/abci-transfer-20261017.json).

There are two distinct runtime paths in this source:

1. `cmd/ynx-chaind/main.go` starts `internal/chain/devnet.go:StartWithPause`, with a default 2-second ticker calling `ProduceBlock`. The deployment script configures a primary and replicated followers. This is a devnet producer path.
2. CometBFT v0.38.23 connects over socket ABCI to `cmd/ynx-abci/main.go`, which opens `NewPersistentApplication`. Its processing path is `CheckTx`, `PrepareProposal`, `ProcessProposal`, `FinalizeBlock`, then durable `Commit` in `internal/consensus/application.go`.

The measurement below calls the **real application methods directly**, retaining signature verification, state transition, fee audit, state hashing, file sync, rename and directory sync. It does not exercise RPC, the CometBFT mempool, proposal propagation or voting. Repository cutover documentation states only local fixture/dry-run evidence; this work did not inspect or modify the live network and does not establish which runtime is publicly authoritative today.

## Workload and measurement boundaries

- Apple M4, 10 logical CPUs, 24 GiB RAM; Go 1.25.7 darwin/arm64.
- `GOMAXPROCS=2`, build `-p 1`, process nice 10. Other work was active on the same host and disk.
- 256 freshly seeded local-only accounts; 64 independent sending accounts; 64 signed native transfers per block; 16 blocks; **1,024 valid transfers per run**.
- Amount 1 YNXT plus the existing 1 YNXT fee; each sender submits only its next committed nonce. No fake signatures or omitted verification.
- Three comparison runs per version. Baseline windows: 0.928, 0.898, 0.908 seconds; candidate: 0.959, 0.836, 0.931 seconds. These are short probes, not sustained load tests. Candidate runs preceded the three comparison baseline runs; ordering was not randomized.
- Signing, fixture setup and post-run restart assertions are excluded from pipeline timing and recorded separately. Direct method calls are sequential with no arrival-rate scheduling.
- New local migration, snapshots, CPU/heap profiles and test binaries are under the ignored `artifacts/chain-performance-20261017/` directory. No existing chain DB or real user account was used. Output footprint was about 61 MiB.

Each of the six comparison runs recorded offered 1,024, application CheckTx accepted 1,024, successful execution 1,024, failures 0, rejections 0 and persisted fee events 1,024. These counts are **application test counts**, not network transaction acceptance or finality counts.

| Required network metric | Status |
| --- | --- |
| RPC submission / reception TPS | Unmeasured |
| Valid transaction inclusion TPS | Unmeasured |
| Inclusion latency P50/P95/P99 | Unmeasured |
| BFT finality latency P50/P95/P99 | Unmeasured |
| Sustained >=1,000 / 3,000–5,000 / 10,000+ TPS | Unverified |

## Measured result

Totals are the median of three per-run totals, in milliseconds, over 1,024 transactions / 16 blocks.

| Stage | Before | After | Change |
| --- | ---: | ---: | ---: |
| CheckTx | 204.38 | 176.73 | -13.5% |
| PrepareProposal | 158.73 | 130.02 | -18.1% |
| ProcessProposal | 156.45 | 128.60 | -17.8% |
| FinalizeBlock | 196.89 | 168.87 | -14.2% |
| Durable Commit | 189.63 | 232.83 | +22.8% |
| Allocated bytes | 1,181,627,304 | 914,803,128 | -22.6% |
| Application pipeline tx/s | 1,127.71 | 1,099.53 | -2.5% |

The following are medians of the three **per-run** percentiles, not pooled percentiles. CheckTx has 1,024 samples per run; every block stage has only 16, so P95/P99 both select the maximum within a run.

| Stage | Before P50/P95/P99 ms | After P50/P95/P99 ms |
| --- | --- | --- |
| CheckTx | 0.166 / 0.324 / 0.457 | 0.145 / 0.290 / 0.368 |
| PrepareProposal | 9.669 / 13.541 / 13.541 | 8.108 / 8.776 / 8.776 |
| ProcessProposal | 9.648 / 10.977 / 10.977 | 7.951 / 8.786 / 8.786 |
| FinalizeBlock | 12.018 / 15.104 / 15.104 | 10.271 / 14.931 / 14.931 |
| Durable Commit | 11.600 / 16.596 / 16.596 | 13.463 / 23.307 / 23.307 |

An additional baseline profile attributed about 85.9% of allocated bytes to `cloneAccounts`, `cloneExecutionStateValue` and `Application.cloneExecutionState` (flat attribution summed without double-counting cumulative costs). Signature arithmetic remained a substantial CPU cost. The small copy optimization leaves that verification intact.

## Implementation and correctness

Native transfers now copy the account slice and only the unique sender, recipient and fee recipient `Lots` maps. They still copy fee history to keep successful branches independent, including when the input slice has spare capacity. Copying happens before either lot movement, preserving rollback when the amount movement or later fee movement fails. Application actions and Ethereum envelopes retain the full transaction-state clone. Persistent state format and hashing are unchanged.

Validation completed:

- Focused tests for signatures, canonical encoding, chain ID replay protection, durable restart, failed commit not advancing state, partial lot failure, fee-after-amount failure, receiver creation, aliased fee recipients and independent successful branches.
- Full `internal/consensus` package: PASS. The initial run lacked the generated `SampleEVMWriteCounter` fixture. Its existing 2,993-byte core-owner artifact was copied only after source identity and the registry's pinned deployed-bytecode hash were verified; this was not a fresh Solidity build. Artifact provenance and hash are in the evidence JSON.
- All 16 block AppHashes match between all six comparison runs; complete final `state.json` files are byte-identical. Final snapshot SHA-256: `ea203b08c94178ec0132b71f3ec16d731de8e44595f6fd742e331b41d80caf56`.
- Each performance run reopens persisted state, compares the complete state, checks sender/receiver balances and nonces, verifies fee count and rejects a committed nonce replay.

## Reproduction

Run from the performance workspace. The explicit opt-in keeps this workload out of ordinary tests. `YNX_CHAIN_PERF_DIR` must point to an isolated local test directory; its migration is created once without overwrite and each invocation creates a fresh run subdirectory.

```sh
env GOMAXPROCS=2 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 go test -p 1 ./internal/consensus \
  -run '^TestABCITransferPerformance$' -count=3 -v -timeout=45s

# Retained baseline binary: original application at the exact base + same probe.
env GOMAXPROCS=2 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/baseline.test \
  -test.run '^TestABCITransferPerformance$' -test.count=3 -test.v -test.timeout=45s

env GOMAXPROCS=2 nice -n 10 go test -p 1 ./internal/consensus -count=1 -timeout=90s
```

The base binary is a local reproduction aid. Its digest is in the receipt. To rebuild the baseline elsewhere, use the exact base checkout plus only `performance_test.go`, then use the same isolated migration. Full-suite reproduction also requires the pinned generated contract fixture described above.

## Next development step

Instrument durable Commit into validation/hash, JSON encoding, file write/sync and directory-sync spans in the opt-in probe; retain every durability boundary. The current measurements cannot separate filesystem latency from whole-state serialization. In parallel with that source-level work, replace repeated fee-history copying with an immutable append journal only after adding branch-order and mixed native/action/Ethereum/user-operation equivalence checks. Materialize the same ordered fee slice once at sealing; do not drop historical audit records.

After Root schedules a resource slot, add a bounded four-validator loopback runner based on `consensus-quorum-check.sh`: initially 32–64 signed transactions with one in-flight nonce per account, then separately record RPC acceptance, code-zero inclusion, quorum commit proof, client observation latency and restart state. Local lab timeouts (750/350/350/500 ms) differ from the production candidate generator's defaults and must be captured with the node configuration. Sustained 1,000 TPS qualification starts only after this real network measurement is trustworthy; 3,000–5,000 and 10,000+ remain later measured targets.
