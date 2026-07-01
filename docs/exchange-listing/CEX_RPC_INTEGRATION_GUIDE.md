# CEX RPC Integration Guide

Required methods include health, latest block, chainId, balance, transaction, receipt, raw transaction broadcast, logs, and block by number/hash.

Verification command:

```bash
make exchange-integration-check
```

The check starts or reuses a local YNX Testnet endpoint and verifies RPC health, EVM chainId, block growth, deposit simulation through faucet funding, account balance query, withdrawal simulation through transfer, transaction lookup, receipt status, block query, and log query.
