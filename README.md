# YNX Chain

YNX Chain is a new L1 chain project. This repository is for the chain, node, RPC, staking, resource economy, contracts, indexer, explorer services, AI gateway, Trust tracing, Pay backend, IDE backend, infra, deployment, and monitoring.

The website must live separately in `YNX-Chain-website`. Website dynamic data must come from real public APIs exposed by this repository or its deployments.

## Current Status

This repository currently contains the first local devnet foundation:

- A Go devnet node with real in-memory block production.
- HTTP APIs for health, status, blocks, faucet, transfer, staking, resource balances, Trust lot lineage, Pay intent creation, AI SSE streaming, and IDE source preflight.
- Network configuration for YNX Mainnet, YNX Testnet, and YNX Devnet chain IDs.
- Verification scripts and CI for the devnet.

It is not mainnet, not a deployed public testnet, and not production infrastructure yet. Do not market this code as a live mainnet.

## Chain IDs

The preferred IDs were checked against `chainid.network/chains.json` on 2026-06-30:

- YNX Mainnet: `6420` - free in the checked source.
- YNX Testnet: `6423` - free in the checked source.
- YNX Devnet: `6425` - free in the checked source.

Do not change or publish final chain IDs without rechecking EIP-155, ChainList, and chainid.network.

## Run A Local Devnet

```bash
go run ./cmd/ynx-chaind --http 127.0.0.1:6420 --block-interval 1s
```

Useful endpoints:

```bash
curl http://127.0.0.1:6420/health
curl http://127.0.0.1:6420/status
curl http://127.0.0.1:6420/blocks/latest
curl -X POST http://127.0.0.1:6420/faucet -d '{"address":"ynx_demo","amount":1000}'
curl -X POST http://127.0.0.1:6420/transfer -d '{"from":"ynx_demo","to":"ynx_receiver","amount":125}'
curl http://127.0.0.1:6420/resources/ynx_demo
curl http://127.0.0.1:6420/trust/trace/ynx_receiver
curl -N 'http://127.0.0.1:6420/ai/stream?session=demo&q=explain%20latest%20block'
```

## Verify

```bash
go test ./...
bash scripts/verify/devnet.sh
```

## Safety Rules

- No private keys, PEM files, RPC tokens, server passwords, or production secrets in code or docs.
- Mainnet, testnet, and devnet claims must be backed by live endpoints, deployment logs, test commands, explorer data, or commit hashes.
- AI actions that move value or grant permissions must require user confirmation, scoped permissions, limits, audit logs, and revocation.
- Trust tracing defaults to trace, label, explain, and export evidence. Freezing or rejecting funds requires explicit legal, merchant, contract, governance, or institutional rules.

