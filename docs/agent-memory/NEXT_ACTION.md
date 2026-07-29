# Next Action

Updated: 2026-07-29T02:45:09Z

Inspect the versioned integration artifacts on the current remote branches for products 02 Wallet/Auth, 07 Exchange, 19 Oracle/Market Data, 26 Data Fabric, 27 DEX and 29 Integration. Identify directly evidenced accepted contract versions, registry revisions, terminal receipt schemas, correction/freshness semantics and event mappings that apply to `ynx-quant-lab-v1`.

Then, without modifying another product worktree:

1. compare those owner artifacts against `release/integration/ynx-quant-lab-contract.json`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` and `docs/integration/DEPENDENCY_ACCEPTANCE.md`;
2. update Quant-owned adapters, schemas, dependency acceptance and negative vectors only where an owner artifact is explicit and source-addressable;
3. keep each missing or ambiguous owner contract in fail-closed `pending` state with its exact source path/branch and required version field;
4. run `apps/quant-lab/scripts/validate-integration-package.py` and the targeted Quant adapter/mandate tests;
5. commit, push and verify Local SHA equals Remote SHA.

Do not invent an accepted contract, shared Testnet environment, terminal receipt or public deployment.
