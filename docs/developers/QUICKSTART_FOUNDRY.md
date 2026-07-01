# Foundry Quickstart

YNX Chain includes `foundry.toml` for teams that prefer Forge and Cast.

## Network

- Network: YNX Testnet
- Chain ID: 6423
- Native currency: YNXT
- RPC env: `YNX_EVM_RPC_URL`
- Verifier URL env: `YNX_CONTRACT_VERIFIER_URL`
- Verifier API key env: `YNX_CONTRACT_VERIFIER_API_KEY`

## Build

```bash
forge build
```

## Deploy ERC-20 Sample

```bash
export YNX_EVM_RPC_URL="https://real-evm-rpc-host"
export DEPLOYER_PRIVATE_KEY="secure-real-deployer-private-key"
forge create contracts/tokens/SampleYNXTCompatibleERC20.sol:SampleYNXTCompatibleERC20 \
  --rpc-url "$YNX_EVM_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --constructor-args 1000000000000000000000000
```

## Deploy ERC-721 Sample

```bash
forge create contracts/tokens/SampleYNXTCompatibleERC721.sol:SampleYNXTCompatibleERC721 \
  --rpc-url "$YNX_EVM_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --constructor-args "YNX Sample NFT" "YSN"
```

## Verify Tooling Metadata

```bash
make contract-tooling-check
```

This is a repository consistency gate. It does not replace `forge build`, live deployment, or explorer verification after real infrastructure is supplied.
