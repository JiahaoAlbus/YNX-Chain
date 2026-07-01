# DeFi Ecosystem Readiness

YNX Chain DeFi integrations must be reviewable before public submission and evidence based after deployment.

## Current Engineering Assets

- EVM network metadata: YNX Testnet, chain ID `6423`, native currency `YNXT`.
- Hardhat 3 config: `hardhat.config.ts`.
- Foundry config: `foundry.toml`.
- ERC-20 sample: `contracts/tokens/SampleYNXTCompatibleERC20.sol`.
- ERC-721 sample: `contracts/tokens/SampleYNXTCompatibleERC721.sol`.
- Native YNXT resource escrow sample: `contracts/resource-market/YnxResourceMarketEscrow.sol`.
- Token List shell: `token-lists/ynx-testnet.tokenlist.json`.
- DEX integration config: `dex/ynx-testnet.integration.json`.

## DEX Requirements Before Public Submission

- Real public EVM RPC URL in `YNX_EVM_RPC_URL`.
- Wrapped YNXT contract address in `WRAPPED_YNXT_ADDRESS`.
- DEX factory address in `DEX_FACTORY_ADDRESS`.
- DEX router address in `DEX_ROUTER_ADDRESS`.
- Multicall address in `MULTICALL_ADDRESS`.
- Indexer start block in `DEX_INDEXER_START_BLOCK`.
- Verifier URL in `YNX_CONTRACT_VERIFIER_URL`.
- Contract verification proof for wrapped YNXT, factory, router, and multicall.

## Token List Policy

The Token List must not list undeployed tokens. `token-lists/ynx-testnet.tokenlist.json` intentionally starts with an empty `tokens` array. Add entries only after:

- the token contract is deployed on YNX Testnet,
- the address is visible from the real EVM RPC,
- the source is verified,
- decimals and symbol are read from-chain,
- issuer approval is recorded when the issuer is not the YNX Chain team.

## Review Gate

```bash
make contract-tooling-check
```

The gate validates Hardhat, Foundry, Token List, DEX config, contracts, and docs for chain ID `6423`, native currency `YNXT`, and real-value environment variable wiring.
