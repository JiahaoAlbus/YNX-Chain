# Indexer Blocks

`ynx-indexerd` indexes blocks from the chain RPC through `GET /blocks/{height}` and stores them in its local index database.

Verification:

```bash
make indexer-check
```
