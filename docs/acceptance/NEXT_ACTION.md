# Next Action

Current implementation baseline: `d6505fb40988`.

Completed and protected local Testnet slices:

- four-validator identical genesis, fixed-height Block Hash/AppHash and 3/4 precommit;
- signed YNXT transfer, all-node account equality and replay rejection;
- one-validator stop, recovery, State Sync, backup, restore and rollback replay;
- committed EVM account, block, transaction, receipt, log, code and bounded call reads;
- durable Indexer checkpoint/WAL validation, atomic persistence, tamper rejection and restart recovery;
- bounded chain-6423 EIP-155 legacy type `0x0` value transfers (`5469ed2`);
- committed receipt audit validation and CometBFT evidence binding (`328ba67`);
- bounded EIP-2930 type `0x1` empty-access-list value transfers (`6959df9`);
- bounded EIP-1559 type `0x2` zero-base-fee value transfers (`d6505fb`).

Current single action: freeze and validate the machine-readable EIP-1559 contract and 56-vector evidence set against `d6505fb40988`, commit and push the evidence checkpoint, and preserve every unsupported release boolean as false.

Files in the current slice:

- `release/product-release.json` and `release/integration/chain-core-contract.json`;
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json` and `docs/integration/INTEGRATION_HANDOFF.md`;
- `FEATURE_COMPLETION_EVIDENCE.md`, `EVIDENCE_INDEX.md` and acceptance state;
- `.ai-bridge` plan, status, decisions, execution log and full-goal coverage;
- `scripts/verify/integration-contract-check.mjs`.

EIP-1559 compatibility profile:

- chain ID 6423 and transaction type `0x2`;
- empty access list, empty calldata, 20-byte recipient and no contract creation;
- exact gas limit 21000;
- compatibility `baseFeePerGas = 0` and no dynamic base-fee market;
- `0 < maxPriorityFeePerGas <= maxFeePerGas`;
- pre-execution affordability checked against `maxFeePerGas × 21000`;
- committed fee charged at effective price `maxPriorityFeePerGas`;
- dual Ethereum Keccak and CometBFT SHA-256 identities plus audited committed receipt evidence.

Validation commands:

- `make integration-contract-check`
- `make bft-evm-dynamic-fee-transfer-check`
- `make bft-evm-access-list-transfer-check`
- `make bft-evm-legacy-transfer-check`
- `make bft-evm-receipt-check`
- `go test -race ./internal/consensus ./internal/bftgateway`
- `go test ./cmd/... ./internal/...`
- `make static-check`
- `make objective-state-check`
- `make no-placeholder-check`
- `make secret-scan`

Completion standard:

- release record, integration contract v1.7.0, vectors, handoff and `.ai-bridge` bind to the same implementation baseline;
- vectors prove accepted type `0x2` behavior and reject invalid fee relations, insufficient maximum exposure, non-empty access lists, calldata, contract creation, wrong-chain, replay and unsupported typed envelopes;
- committed state remains v11, ABCI application version is 17 and State Sync snapshot format remains 1;
- the slice is committed, pushed, Local SHA equals Remote SHA and the worktree is clean.

Next runtime slice after this evidence checkpoint:

- exercise type `0x2` through the full local CometBFT broadcast, committed block lookup and audited receipt readback path;
- fail closed on any mismatch among Ethereum Keccak identity, CometBFT identity, block membership, receipt action, sender, recipient, gas and fee evidence;
- then add deterministic EVM fee-history and fee-suggestion reads only if they truthfully expose the frozen zero-base-fee model;
- preserve canonical YNX and bounded type `0x0`, `0x1`, `0x2` compatibility.

Explicitly not doing:

- no claim of a dynamic Ethereum base-fee market, general Ethereum execution, non-empty access lists, contract creation or calldata;
- no public deployment, production signing, Mainnet claim or public BFT cutover without direct evidence and authority;
- no changes to other product Worktrees or secrets.
