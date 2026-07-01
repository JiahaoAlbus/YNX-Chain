# Hardhat Quickstart

YNX Chain ships a root Hardhat 3 project for contract teams that need a standard EVM toolchain before public testnet deployment.

## Network

- Network: YNX Testnet
- Chain ID: 6423
- Native currency: YNXT
- RPC env: `YNX_EVM_RPC_URL`
- Deployment key env: `DEPLOYER_PRIVATE_KEY`

The root `hardhat.config.ts` reads the RPC URL and deployer key through Hardhat config variables. It must not fall back to a public dummy RPC or a generated private key. It also sets `preferWasm: true` for Solidity so builds do not depend on a host-specific native `solc` binary.

## Install

```bash
npm install
```

## Build

```bash
npm run hardhat:build
```

## Deploy Sample Contracts

Use a funded deployer account from the YNX Testnet faucet, then run:

```bash
export YNX_EVM_RPC_URL="https://real-evm-rpc-host"
export DEPLOYER_PRIVATE_KEY="secure-real-deployer-private-key"
npm run hardhat:deploy:ynx-testnet
```

The deploy script publishes:

- `SampleYNXTCompatibleERC20`
- `SampleYNXTCompatibleERC721`
- `YnxResourceMarketEscrow`

The command prints a JSON object with the deployed addresses. Add those addresses to the Token List or DEX config only after the transactions are visible through the real explorer and verifier.

## Review Gate

```bash
make contract-tooling-check
```

This checks that Hardhat, Foundry, Token List, DEX config, contracts, and developer documents use YNX Testnet chain ID `6423` and native currency `YNXT` consistently.
