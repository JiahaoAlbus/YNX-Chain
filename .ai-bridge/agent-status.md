# Agent Status

- Integration baseline `8eb801f`, four-validator safety baseline `f03c93e`, State Sync runtime `913f207`, backup/restore/rollback replay `74fc8dc`, and machine-record binding `597ae52` are pushed.
- ABCI application version is 14; committed-state version remains 11.
- Current EVM implementation adds `eth_getBlockTransactionCountByNumber`, `eth_getBlockTransactionCountByHash`, `eth_getTransactionByBlockNumberAndIndex`, and `eth_getTransactionByBlockHashAndIndex` against validated CometBFT block/AppHash/DataHash/raw-transaction evidence.
- Missing/pending blocks and out-of-range indexes return JSON-RPC `null`; malformed hashes, block quantities, transaction indexes and parameter counts fail closed with `-32602`.
- Passed: focused gateway integration, full `internal/bftgateway`, race, `make bft-evm-receipt-check`, related gateway/chain/consensus tests, `make static-check`, `make no-placeholder-check`, and `make secret-scan`.
- The broad `go test ./cmd/... ./internal/...` gate is currently blocked by unrelated concurrent dirty work in `internal/indexer/indexer.go`; those changes were detected after this run began, preserved, and intentionally excluded from the EVM commit.
- Public four-validator BFT, current-source public deployment, production signing and remote recovery drill remain false.
