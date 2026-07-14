# CEX RPC Integration Guide

YNX Testnet uses chain/network ID `6423` (`0x1917`) and native coin `YNXT` with 18 decimals. Integrators must validate `eth_chainId`, `net_version`, height growth, release identity, and Explorer/indexer lag before enabling deposits or withdrawals.

The candidate contract covers `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionCount`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`, `eth_getBlockByHash`, bounded `eth_getLogs`, and signed native transfer broadcast. The exact capability/status matrix is generated as `rpc-capabilities.json`; integrations must not assume methods omitted from that matrix.

`eth_sendRawTransaction` does not accept standard Ethereum RLP. It accepts `0x`-hex canonical `ynx-native-json-envelope-v1` bytes. The equivalent REST route is `POST /transactions/broadcast` with the canonical JSON envelope and `Content-Type: application/json`. The envelope binds version, chain ID, transfer type, canonical sender/recipient, amount, fixed fee, nonce, compressed secp256k1 public key, and DER signature. Exact replay returns the same hash without a second mutation; a different transaction using an accepted nonce is rejected.

Verification command:

```bash
make exchange-integration-check
```

The check starts an isolated persistent YNX Testnet node, funds only a deterministic test depositor, submits the committed signed deposit/withdrawal vectors, waits for two fixture confirmations, and verifies balances, nonces, receipts, logs, exact historical blocks, replay behavior, invalid raw input rejection, dual-address identity, and restart persistence. It does not prove production custody, public deployment, BFT finality, exchange approval, or listing.
