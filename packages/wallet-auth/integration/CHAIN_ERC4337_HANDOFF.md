# Chain Core ERC-4337 integration handoff

Wallet/Auth owns the account, Paymaster, Bundler adapter, schemas and vectors. Chain Core owns the public EVM runtime and JSON-RPC implementation. This handoff does not modify Chain Core.

## Current direct evidence

On 2026-07-22 the public endpoint returned chain ID `0x1917` and block `0x6bf29`. The exact v0.8 EntryPoint `eth_getCode` request returned JSON-RPC `-32601` with `method eth_getCode is not implemented by the local YNX devnet RPC`. Repository source confirms `internal/api/server.go` implements a bounded method/runtime subset and labels unsupported methods accordingly. Therefore Wallet must keep EntryPoint, Bundler, Paymaster and public sponsored receipt states false.

## Required merge contract

`chain-erc4337-requirements.json` is the machine-readable acceptance contract. Chain Core must provide standard deployed-bytecode/storage semantics, creation receipts, nested call/revert behavior, gas accounting and the listed JSON-RPC methods. A Bundler must then expose the five ERC-7769 methods against the deployed EntryPoint.

Acceptance requires a source-bound public evidence bundle containing EntryPoint/account/factory/Paymaster addresses and runtime hashes, deployment transaction receipts, `eth_getCode`, stake/deposit state, one zero-balance sponsored first action, one rejected replay, one emergency disable, Bundler lookup/receipt and Explorer URLs. Local Hardhat evidence cannot satisfy this gate.

## Wallet verification commands

```sh
npm run hardhat:test:wallet
npm --prefix packages/wallet-auth test
```

Public probing must use bounded retries and record timeout/error responses. Never supply deployer, policy-signer or operator secrets in chat or evidence files.
