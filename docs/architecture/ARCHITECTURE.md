# Architecture

YNX Chain uses a pragmatic local Go devnet for verifiable development and a deployment package shaped for a mature EVM-compatible L1 stack.

The production target is Cosmos SDK / CometBFT plus EVM-compatible JSON-RPC. This repository currently proves the API, resource, Pay, Trust, AI streaming, and deployment-contract surfaces without claiming mainnet-grade consensus.

Grant reviewers can run `make smoke-test` to verify block growth, faucet, transfer, Trust trace, Pay intent, AI streaming, and EVM chainId.

