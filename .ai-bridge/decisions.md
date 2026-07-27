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
- `eth_sendRawTransaction` accepts the canonical signed YNX envelope, a bounded chain-6423 EIP-155 legacy type `0x0` value transfer and a bounded EIP-2930 type `0x1` value transfer with an empty access list. Both Ethereum profiles require exact sender recovery, zero-based nonce and 21000-gas semantics. Non-empty access lists, contract creation, calldata and EIP-1559 type `0x2` fees remain unsupported and must not be claimed.
- Every ABCI-returned EVM receipt must pass canonical audit-hash and structural validation, then match CometBFT transaction hash, block height, sender, recipient and action evidence before a gateway returns it.
- Unrelated concurrent dirty work in `internal/indexer/indexer.go` was protected and excluded from the EVM slice staging and commit; it was reviewed, tested and committed separately as `bf08b68`.
- Indexer checkpoint and WAL files are local authority state and must fail closed on unsafe permissions, non-regular files, unknown fields, trailing data, block/transaction invariant mismatch, conflicting duplicate WAL records or caller-visible mutable aliases.
- Exact checkpoint/WAL overlap after an atomic checkpoint but before WAL deletion is a valid recovery window and must not be rejected when the block record is identical.
- Objective-state security scanning must not silently disappear when `rg` is absent; the portable `grep` fallback is part of the gate.
- Machine release, integration and coverage records bind to the latest runtime implementation commit, while a later documentation-only commit must not be misrepresented as a different deployed runtime.
