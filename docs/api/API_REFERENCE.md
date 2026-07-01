# API Reference

Core: `GET /health`, `GET /status`, `GET /metrics`, `GET /blocks/latest`, `GET /txs/{hash}`, `GET /accounts/{address}`, `GET /validators`.

EVM JSON-RPC: `POST /evm` supports `eth_chainId`, `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, and `eth_getBlockByHash` in local devnet form.

Products:

- `POST /faucet`
- `POST /staking/stake`
- `GET /resources/{address}`
- `GET /resource-market/quote`
- `GET /resource-market/analytics`
- `POST /resource-market/delegations`
- `GET /resource-market/delegations/{address}`
- `POST /resource-market/rent`
- `GET /resource-market/income/{address}`
- `GET /trust/trace/{address}`
- `POST /trust/labels`
- `POST /trust/evidence`
- `GET /trust/evidence/{id}`
- `GET /trust/evidence/{id}.pdf`
- `POST /pay/intents`
- `GET /pay/intents/{id}`
- `POST /pay/invoices`
- `GET /pay/invoices/{id}`
- `POST /pay/refunds`
- `POST /pay/webhook-signatures`
- `GET /ai/stream`
- `POST /ide/compile`
- `POST /ide/deploy`
- `POST /ide/verify`
- `GET /contracts/{address}`

Verification:

```bash
make smoke-test
```

The smoke test exercises RPC health, EVM chainId, block growth, faucet, transfer lookup, AI streaming, Trust label/evidence/PDF export, Pay intent/invoice/refund/webhook signature, resource quote/delegation/rental/income/analytics, IDE deploy, contract verification, monitoring, and package lists. It returns non-zero on failure.
