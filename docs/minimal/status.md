# Current Capability Status

Last updated: 2026-06-30

## Implemented Locally

- Local devnet node.
- In-memory block production.
- Optional local JSON state persistence with restart restore.
- HTTP health, status, block, transaction, faucet, transfer, staking, resources, Trust trace, Pay intent, AI stream, and IDE preflight APIs.
- Explorer-ready account, validator, recent transaction, and summary APIs.
- Chain ID configuration for mainnet, testnet, and devnet.
- Local verification script.

## Not Yet Implemented

- Public node deployment.
- Durable production database storage.
- Real validator network.
- Production consensus.
- EVM execution.
- MetaMask connection package.
- Contract deployment and verification.
- Explorer frontend.
- Website integration.
- Production faucet.
- Production AI gateway.
- Full Trust evidence exports.
- Pay merchant dashboard and webhooks.
- IDE compiler service with pinned compiler.
- Monitoring, nginx, systemd, log rotation, backup, and rollback.

## Truthful Public Wording

Allowed today:

- "YNX Chain has a local devnet foundation under active development."
- "The repository includes local APIs for block status, faucet, transfer, staking/resource, Trust trace, Pay intent, AI stream, and IDE preflight."
- "The local devnet can persist state across restarts when launched with `--data-dir`."
- "Explorer-facing read APIs exist for local devnet account, validator, recent transaction, and summary data."

Not allowed today:

- "YNX Mainnet is live."
- "YNX Testnet is public."
- "MetaMask users can connect to YNX Mainnet."
- "Explorer shows production transactions."
- "AI gateway is production-ready."
