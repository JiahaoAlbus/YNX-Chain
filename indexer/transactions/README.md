# Indexer Transactions

`ynx-indexerd` extracts transactions from indexed blocks, stores them by hash, and serves `GET /txs` plus `GET /txs/{hash}` from the indexed database.
