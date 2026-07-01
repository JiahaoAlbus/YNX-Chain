# API Reference

Core: `GET /health`, `GET /status`, `GET /blocks/latest`, `GET /txs/{hash}`, `GET /accounts/{address}`, `GET /validators`.

EVM JSON-RPC: `POST /evm` supports `eth_chainId`, `net_version`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_sendRawTransaction`, `eth_estimateGas`, `eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, and `eth_getBlockByHash` in local devnet form.

Products: `POST /faucet`, `POST /staking/stake`, `GET /resources/{address}`, `GET /trust/trace/{address}`, `POST /pay/intents`, `GET /ai/stream`, `POST /ide/compile`.

