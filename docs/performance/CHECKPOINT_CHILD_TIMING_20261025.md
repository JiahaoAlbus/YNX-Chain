# Actual checkpoint encoding and durable-storage children

Recovered original run40101270671 placed all maintenance spikes above5ms at heights18/34, matching the16-block checkpoint replacement interval. Its `journal_maintenance` timer combined checkpoint encoding, writing, file sync, rename and directory sync, so its0.22ms delta encoder measurement could not describe full encoding cost.

Commit diagnostics now expose optional `checkpointStagesNs`: `encode`, `prepare_file`, `write`, `file_sync`, `close_file`, `rename`, `directory_sync` and `identity`. These children remain inside the original `journal_maintenance` timer and must not be added again. No checkpoint means no child map. Each attempt owns its maps; caller mutation and following append commits cannot carry stale observations forward. The complete node-log parser validates exact child keys, safe nonnegative integers, block-journal storage and child sum bounded by the maintenance parent; aggregation stays separate from parent totals.

The original encoder visitor owns the payload buffer synchronously. Timing starts before encoding and ends at visitor entry; the write callback is excluded from encoding time. File.Sync and Close retain their original order and both execute before errors.Join, including when Sync fails. Original fault checkpoints, rename, directory sync, writer poisoning and recovery order stay in place. Default-disabled diagnostics perform no new clock read or OS operation.

Actual non-race Mac16,10 / Go1.25.7 darwin/arm64 / GOMAXPROCS1, using the hash-pinned retained real1024-transfer history:

| Measurement | Time |
|---|---:|
| Complete checkpoint maintenance | 9.902209ms |
| Encoding627,462 payload bytes | 1.129625ms |
| Prepare file | 0.099291ms |
| Write | 0.480417ms |
| File sync | 4.673208ms |
| Close | 0.005042ms |
| Rename | 0.151750ms |
| Directory sync | 3.338166ms |
| Identity read | 0.012625ms |

This is one real isolated disk checkpoint, not a distribution or network benchmark. It identifies synchronization as the larger cost in this sample; larger histories, Linux storage and four-node scheduling still require measurement. Race runs prove correctness and deliberately do not supply performance comparisons.

The application test executes18 real signed business blocks on diagnostic and control applications, triggers the checkpoint and next append, compares exact durable bytes and reopens the persisted state. It checks no child map on ordinary appends, complete positive child durations only at replacement, no double counting and owned diagnostic copies. Actual compaction-synced/renamed error injections retain original first cause, reject reuse of poisoned writers, publish no pending state and reopen to the previous committed state. The existing six abrupt-exit17 cases now execute with timing enabled and verify recovery/nonce protection. The original CI storage step also runs the CommitTiming tests.

New tests first failed for missing diagnostic fields and unsupported decoder children. Local focused/race tests and the10 parser tests then passed. Raw commands/results/hashes and the retained1024 sample are indexed in `evidence/checkpoint-child-timing-local-20261025.json`; ordinary Linux CI40111618531 completed SUCCESS on frozen SOURCEd24e97b8d3373e294a9d7992e07b4ef532bd6dcf. Its actual retained1024 checkpoint measured2.575091ms maintenance: encode1.252364ms, prepare0.051886ms, write0.619982ms, file_sync0.471314ms, close0.006460ms, rename0.025347ms, directory_sync0.132045ms and identity0.003936ms. Different host/storage conditions prevent interpreting the Mac/Linux samples as an optimization comparison. No throughput or BFT finality improvement is claimed by this instrumentation.
