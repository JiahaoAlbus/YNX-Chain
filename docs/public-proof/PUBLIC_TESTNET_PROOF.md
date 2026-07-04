# Public Testnet Proof

Do not fill this with synthetic evidence.

`make public-proof` must collect remote public endpoint evidence. It must not start a local testnet or reuse localhost smoke output as public proof.

The generated package is valid only when `tmp/packages/public-proof/final/manifest.json` has `validPublicProof: true`. If any remote check fails, the package is diagnostic only and must not be presented as completed proof.

Required after deployment: public website, explorer, RPC, EVM RPC, REST, gRPC host, faucet, docs, latest block endpoint, chainId endpoint, validator set, sample block hash, tx hash, deployed contract, faucet tx, Pay object, Trust trace, AI streaming proof, IDE deployment proof, commit hash, deployment timestamp, remote smoke output, known limits, rollback plan, and mainnet readiness state.
