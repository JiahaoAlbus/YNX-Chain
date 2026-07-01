# Contract Verification

YNX Chain contract verification must be evidence based. A contract is not considered verified until source code, compiler settings, constructor arguments, deployed bytecode, transaction hash, and explorer visibility all match on YNX Testnet.

## Required Inputs

- `YNX_EVM_RPC_URL`
- `YNX_CONTRACT_VERIFIER_URL`
- `YNX_CONTRACT_VERIFIER_API_KEY`
- deployed contract address
- deployment transaction hash
- compiler version `0.8.24`
- optimizer enabled with `200` runs
- constructor arguments

## Hardhat Path

```bash
npm run hardhat:build
npm run hardhat:deploy:ynx-testnet
```

After deployment, submit the source and constructor arguments to the YNX verifier service. The verifier must read bytecode from the real EVM RPC endpoint and reject mismatched compiler settings.

## Foundry Path

```bash
forge verify-contract \
  --chain 6423 \
  --verifier-url "$YNX_CONTRACT_VERIFIER_URL" \
  --etherscan-api-key "$YNX_CONTRACT_VERIFIER_API_KEY" \
  "$DEPLOYED_CONTRACT_ADDRESS" \
  contracts/tokens/SampleYNXTCompatibleERC20.sol:SampleYNXTCompatibleERC20
```

## IDE Path

The IDE compile and verify API is suitable for developer preflight and submission workflow testing. Public proof still requires deployed bytecode from YNX Testnet and the real explorer or verifier URL.

## Repository Gate

```bash
make contract-tooling-check
```

This gate confirms the repository metadata, sample contracts, Token List, DEX integration config, and docs use YNX Testnet chain ID `6423`, native currency `YNXT`, and explicit real-value environment variables.
