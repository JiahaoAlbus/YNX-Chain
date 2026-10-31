# Chain Metadata

YNX Testnet uses EVM chain/network ID `6423` (`0x1917`) and native coin `YNXT` with 18 decimals.

Current reviewed Testnet RPC/Faucet locations:

- Unified EVM JSON-RPC and native REST host: `https://rpc-testnet.ynxweb4.com`
- Faucet: `https://faucet-testnet.ynxweb4.com`
- Explorer: `https://explorer.ynxweb4.com` (the separate `explorer-testnet` alias is not activated)

Existing compatible public endpoints (kept active during migration):

- EVM RPC: `https://evm.ynxweb4.com`
- REST status: `https://rpc.ynxweb4.com/status`
- Faucet: `https://faucet.ynxweb4.com`
- Explorer: `https://explorer.ynxweb4.com`
- Website: `https://www.ynxweb4.com`

Target Testnet aliases are defined in `chain-metadata/ynx-endpoint-migration.json`:

- unified EVM JSON-RPC and native REST host: `https://rpc-testnet.ynxweb4.com`
- standalone Faucet: `https://faucet-testnet.ynxweb4.com`
- evaluated Explorer alias: `https://explorer-testnet.ynxweb4.com`

The reviewed bundled endpoint authority currently selects the canonical RPC/Faucet aliases for its active profile, with an explicit expiry and fail-closed consumer check. This is sampled chain/build readiness, not continuous uptime or permission to activate the unverified Explorer alias. Consumers must not be switched merely because DNS exists. JSON-RPC compatibility is provided by serving the same service on both hostnames, not with an HTTP redirect.

The collision/registration snapshot in `chain-metadata/chainid-collision-evidence.json` is time-bounded. The refresh gate now requires exactly one official entry for chain ID `6423`, name `YNX Testnet` and short name `ynxtest`, and requires `_data/chains/eip155-6423.json` at the recorded registry commit to match the YNX identity. Any second match or changed identity fails closed. Refresh this evidence before changing public metadata; an upstream entry does not prove that a newly proposed endpoint is live.

YNX Mainnet remains disabled. `https://rpc-mainnet.ynxweb4.com` is only a reserved future hostname; no Mainnet chain ID, genesis, native currency, RPC endpoint or launch state is claimed by this metadata package.
