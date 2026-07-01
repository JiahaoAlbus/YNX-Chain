# api

`ynx-explorerd` is the real Explorer API service. It reads live chain state from RPC and indexed blocks/transactions from `ynx-indexerd`; it does not hardcode fake block, tx, validator, or TPS data.

Verify locally:

```bash
make explorer-check
```
