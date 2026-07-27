# YNX AI current plan

Status: active. Current phase: FREEZE.

Protected remote checkpoints:

- Branch: `codex/final-ai`
- Stable Gateway and Provider-error runtime: `2678a8b0cf3f9463ec7fc205caab486993bf5f18`
- Frozen Integration Contract and vectors: `b066b65aac8c8b197ab9b38659e937e73544daf1`
- Local and upstream SHA were equal after both pushes.

Verified in this session:

1. `go test ./internal/aigateway`
2. `go test -race ./internal/aigateway`
3. `go test ./internal/aigateway ./internal/aiproduct ./cmd/ynx-ai-gatewayd`
4. `node apps/ai/scripts/release-check.mjs`
5. Machine-readable contract, vectors, release, evidence and integration JSON parsing.
6. `git diff --check`

Current checkpoint slice:

1. Bind the frozen contract and Handoff to evidence checkpoint `b066b65aac8c8b197ab9b38659e937e73544daf1`.
2. Synchronize `.ai-bridge/full-goal-coverage.json` and recovery records with direct evidence.
3. Commit, push, verify local SHA equals upstream SHA and restore a clean worktree.

Exact next autonomous runtime priority:

1. Inspect existing product/context policy code.
2. Implement a canonical deny-by-default Product AI Registry for every applicable YNX product.
3. Validate workflow, allowed and forbidden context, data classes, size bounds, tools, approval, retention, Provider/model policy, budget and audit requirements at runtime.
4. Add adversarial tests for unknown products, cross-product private context, scope widening, indirect attachment/tool-output prompt injection and secret-bearing context.
5. Run package/race/release gates, review changes, commit, push and verify SHA equality.

Central Wallet acceptance, Provider credentials, staging/public deployment, Apple signing and shared Testnet evidence remain external or cross-owner inputs. They do not block autonomous Registry, security, migration, observability, capacity, supply-chain or evidence work.
