# Getting Started

Run `make devnet`, then use `http://127.0.0.1:6420` for REST and `/evm` for JSON-RPC.

Reviewer quickstart:

```bash
make developer-quickstart-check
```

The check starts or reuses a local YNX Testnet endpoint, requests faucet YNXT, compiles a Solidity sample through the IDE API, deploys and verifies the contract, calls Trust, Resource Market quote/delegation/rental/income/analytics and Pay sample APIs, and checks the JavaScript and Python SDK entrypoints.
