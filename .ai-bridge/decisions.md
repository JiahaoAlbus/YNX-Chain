# Decisions

- The attached long-term Chain Core goal is authoritative and remains active until real Testnet and public evidence gates pass.
- Chain-owned protocol facts are frozen locally; Wallet/Auth scope names remain owned by Wallet/Auth and must not be invented in Chain Core.
- Product-level `deployedPublic` remains false because the current source commit is not the deployed public runtime.
- Existing public runtime evidence is preserved as a separate deployed baseline rather than relabeled as current source.
- CometBFT remains the safety baseline; StreamBFT stays a shadow candidate.
- ABCI State Sync accepts only format 1 snapshots bound to the trusted-height AppHash, migration anchor and strict v11 committed-state validation.
- Snapshot persistence must complete before in-memory state changes; persistence failure aborts without partial restore.
- Local backup/rollback evidence may use disposable validator keys, but no local drill may set remote or public recovery status true.
- EVM block transaction count and transaction-by-block-index methods are committed-state read compatibility backed by CometBFT evidence; they do not imply Ethereum execution equivalence.
- `eth_sendRawTransaction` currently accepts the canonical signed YNX native JSON envelope encoded as hex, not standard Ethereum RLP or EIP-1559 envelopes; release records must not claim native Ethereum raw transaction compatibility until implemented and proven.
- Unrelated concurrent dirty work in `internal/indexer/indexer.go` is protected and excluded from the EVM slice staging and commit.
