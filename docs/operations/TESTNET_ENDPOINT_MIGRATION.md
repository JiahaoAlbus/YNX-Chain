# Testnet endpoint migration

This migration preserves the existing YNX Testnet: EVM chain ID `6423` (`0x1917`), native asset `YNXT`, genesis, block history, balances, validators and contract addresses do not change.

## Target and compatibility

- Target RPC host: `https://rpc-testnet.ynxweb4.com`
- Existing compatible RPC hosts: `https://rpc.ynxweb4.com` and `https://evm.ynxweb4.com`
- Target Faucet host: `https://faucet-testnet.ynxweb4.com`
- Existing compatible Faucet host: `https://faucet.ynxweb4.com`
- Explorer target under evaluation: `https://explorer-testnet.ynxweb4.com`; existing history links remain on `https://explorer.ynxweb4.com`
- Reserved future Mainnet hostname: `https://rpc-mainnet.ynxweb4.com`; Mainnet is disabled and has no assigned chain ID in this repository.

The deployment package adds Testnet aliases to the existing reverse-proxy services. It does not redirect JSON-RPC, create a chain, alter state, or publish Mainnet. Faucet aliases share the same process, durable admission database, funding account and quota state.

## Activation gate

1. Preserve the current ingress files and the deployed release identity.
2. Point the new Testnet DNS records at the existing controlled ingress, not a generic website deployment.
3. Generate and validate the deployment package with `YNX_MAINNET_ENABLED=false`.
4. Verify TLS, JSON-RPC POST, REST paths, CORS and any required WebSocket path separately.
5. Run `node scripts/verify/testnet-endpoint-migration-check.mjs --live`.
6. Only after that check succeeds, migrate individual consumers and set the corresponding `publicVerified` field in `chain-metadata/ynx-endpoint-migration.json` in a reviewed commit.

The live check compares the new and old RPCs at one confirmed height: chain ID, network ID, block hash and transaction list, plus balance, nonce and code for the configured proof address. It also compares Faucet health and, once enabled, Explorer identity. A local/config-only pass is not public verification.

## Rollback

Restore the backed-up ingress configuration, reload the proxy, and return DNS to the previous target. Keep the legacy hostnames and consumer defaults active. Do not delete Faucet admission data, chain data, indexes, blocks or contracts. If the aliases are unhealthy, leave all `publicVerified` fields false and do not migrate clients.

## External inputs still required

- Authority to change DNS for the three Testnet aliases.
- Authority to install/reload the controlled ingress configuration and issue certificates.
- Confirmation of whether the Explorer alias should be activated after RPC and Faucet, or remain only a reserved candidate.
