# API Reference

Core: `GET /health`, `GET /status`, `GET /metrics`, `GET /blocks/latest`, `GET /txs/{hash}`, `GET /accounts/{address}`, `GET /validators`.

EVM JSON-RPC: `POST /evm` supports `eth_chainId`, `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, and `eth_getBlockByHash` in local devnet form.

Indexer service: `ynx-indexerd` reads the chain RPC, persists indexed blocks and transactions, resumes from the last indexed height, and exposes `GET /health`, `GET /metrics`, `POST /sync`, `GET /blocks/latest`, `GET /blocks/{height}`, `GET /txs`, and `GET /txs/{hash}` on the indexer HTTP port.

Explorer service: `ynx-explorerd` reads both RPC and indexer sources and serves the reviewer-facing Explorer web/API surface. It exposes `GET /health`, `GET /metrics`, `GET /api/summary`, `GET /api/blocks/latest`, `GET /api/blocks/{height}`, `GET /api/txs`, `GET /api/txs/{hash}`, `GET /api/accounts/{address}`, `GET /api/tokens/YNXT`, `GET /api/validators`, `GET /api/resources/{address}`, `GET /api/resource-market/analytics`, `GET /api/fees/{hash}`, and `GET /api/search?q=...`. The web UI uses the same `/api/*` endpoints and the wallet metadata reports native currency `YNXT`.

Faucet service: `ynx-faucetd` is the public faucet backend. It requires `FAUCET_PRIVATE_KEY` from env, validates YNX/EVM addresses, enforces per IP/address rate limits, writes a JSONL request log, calls the chain RPC to fund YNXT, and exposes `GET /health`, `GET /metrics`, `POST /request`, and `POST /faucet`.

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

The smoke test exercises RPC health, EVM chainId, block growth, faucet funding, transfer lookup, AI streaming, Trust label/evidence/PDF export, Pay intent/invoice/refund/webhook signature, resource quote/delegation/rental/income/analytics, IDE deploy, contract verification, monitoring, indexer sync, Explorer API summary, public faucet daemon funding, and package lists. It returns non-zero on failure.
