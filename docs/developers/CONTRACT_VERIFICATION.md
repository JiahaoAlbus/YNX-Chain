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

The IDE compile and verify API is suitable for developer preflight and submission workflow testing. `GET /ide/compiler` exposes the pinned local compiler contract used in artifact metadata: Solidity `0.8.24`, wasm preference, optimizer enabled with `200` runs, config hash, artifact kind, compiler mode, verifier mode, and current limitations.

`POST /ide/compile`, `POST /ide/deploy`, `POST /ide/verify`, and `GET /contracts/{address}` include `artifactKind`, `compilerConfigHash`, compiler identity/version, source hash, bytecode hash, deployed bytecode hash, verifier mode, compiler execution status, deployed bytecode comparison status, and reproducibility status.

For temporary IDE snippets, artifact kind remains `source-analyzer-artifact`. For repository contract sources that exactly match a Hardhat artifact built with the pinned Solidity `0.8.24` config, artifact kind becomes `pinned-solc-bytecode-artifact` and verification can record `deployedBytecodeComparisonStatus=matched_local_deployed_bytecode_hash`. Production public proof still requires deployed bytecode from YNX Testnet and the real explorer or verifier URL.

## Repository Gate

```bash
make contract-tooling-check
```

This gate runs the pinned Hardhat build, then confirms the repository metadata, sample contracts, real Hardhat bytecode artifacts, Token List, DEX integration config, and docs use YNX Testnet chain ID `6423`, native currency `YNXT`, and explicit real-value environment variables.
