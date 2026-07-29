# Next Action

Implement and verify a reproducible Indexer restart-and-reorg recovery drill.

1. Inspect the current Indexer persistence, canonical-chain selection and rollback paths without modifying other product worktrees.
2. Add a focused verification script that starts the disposable local Testnet, indexes a canonical sequence, persists a checkpoint, restarts the Indexer, introduces the repository-supported fork/reorg condition, and proves rollback plus canonical re-indexing.
3. Assert no duplicate transactions, no orphaned canonical records, correct indexed height, deterministic restart state and truthful health/metrics.
4. Add targeted Go tests for the discovered failure boundary.
5. Run Indexer/Explorer targeted tests, Race tests and disposable Testnet smoke.
6. Commit and push the runtime slice, bind its SHA into product release metadata and integration vectors, then verify Local SHA equals Remote SHA.

Do not claim central integration, public deployment or production release while completing this action.
