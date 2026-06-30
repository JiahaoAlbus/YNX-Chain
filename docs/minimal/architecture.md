# YNX Chain Architecture Baseline

YNX Chain is scoped as an L1, not an L2, appchain, sidechain, or website-only shell.

## Repository Boundary

`YNX-Chain` owns:

- chain node
- consensus and block production
- execution and account state
- RPC and public APIs
- staking and resource economy
- system contracts and app contracts
- indexer and explorer services
- AI gateway
- Trust tracing
- Pay backend
- IDE backend
- infra, deploy, monitoring, backup, and verification scripts

`YNX-Chain-website` owns:

- official public website
- brand and content
- ecosystem and investor entry points
- documentation entry points
- public status presentation

The website must not contain private keys, chain logic, fake dynamic data, or hardcoded metrics. It should read chain status from public APIs exposed by this repository.

## First Devnet Slice

The current code provides a local devnet with:

- genesis block
- periodic block production
- optional JSON state snapshots for local restart persistence
- native YNX balances
- faucet minting
- native transfers
- validator fee collection
- staking to increase resource limits
- bandwidth, compute, AI Credit, and Trust Credit accounting
- lot lineage for minted funds
- pro-rata movement of lot balances on transfer
- Pay intent creation
- AI SSE streaming with request-scoped sessions
- IDE source preflight endpoint
- Explorer summary, account, validator, and recent transaction read endpoints

This is enough to start wiring explorer, website status, wallet demo, and public API contracts. It is not enough to claim production readiness.

## Next Required Slices

1. Durable database storage beyond local JSON snapshots.
2. Real consensus and validator networking.
3. EVM-compatible execution or a clearly chosen execution engine.
4. Signed transactions and account key management.
5. Indexer database.
6. Explorer frontend.
7. Faucet abuse controls.
8. Pinned Solidity compiler service.
9. Production AI gateway provider isolation and audit logs.
10. Trust report export in JSON and PDF.
11. Systemd, nginx, monitoring, log rotation, backup, and deployment playbooks.
