# Chain Core ERC-4337 integration handoff

Wallet/Auth owns the account, Paymaster, Bundler adapter, schemas and vectors. Chain Core owns the public EVM runtime and JSON-RPC implementation. This handoff does not modify Chain Core.

## Current direct evidence

On 2026-08-13 the public endpoint returned chain ID `0x1917` and block `0xf37a4` (997284). The first exact v0.8 EntryPoint `eth_getCode` request timed out; one bounded retry returned JSON-RPC `-32601` with `method eth_getCode is not implemented by the local YNX devnet RPC`. Therefore Wallet must keep EntryPoint, Bundler, Paymaster and public sponsored receipt states false.

Wallet source `80291d53893aa6735d401c692a786fbcdbca8424` adds a local cross-response verifier that binds the exact submitted PackedUserOperation to Bundler lookup, UserOperation receipt and inclusion transaction evidence. It rejects operation/hash/EntryPoint/transaction/Paymaster substitution, missing finality and fake success with stable fail-closed errors. This verifier reduces provider-substitution risk but does not prove that any public provider, EntryPoint, Paymaster, balance, transaction or receipt exists.

Wallet source `2a19cb153952c7e3e1e253fea39186e2ebff194b` adds the explicit, bounded public readiness probe. Its 2026-08-13 run verified RPC chain ID 6423, but the only repository-discovered Bundler candidate (`https://bundler.ynxweb4.com/rpc`, present only in a Wallet UI test fixture) returned HTTP 404 with Vercel `DEPLOYMENT_NOT_FOUND` for both chain ID and supported EntryPoints. No authoritative public EntryPoint address/runtime hash is frozen, so the probe did not guess a test address or call `eth_getCode`. It exited 2 and kept every public ERC-4337 state false. Chain Core and Integration must supply the exact address/hash and a real Bundler endpoint before rerunning.

## Required merge contract

`chain-erc4337-requirements.json` is the machine-readable acceptance contract. Chain Core must provide standard deployed-bytecode/storage semantics, creation receipts, nested call/revert behavior, gas accounting and the listed JSON-RPC methods. A Bundler must then expose the five ERC-7769 methods against the deployed EntryPoint.

Acceptance requires a source-bound public evidence bundle containing EntryPoint/account/factory/Paymaster addresses and runtime hashes, deployment transaction receipts, `eth_getCode`, stake/deposit state, one zero-balance sponsored first action, one rejected replay, one emergency disable, Bundler lookup/receipt and Explorer URLs. Local Hardhat evidence cannot satisfy this gate.

## Wallet verification commands

```sh
npm run hardhat:test:wallet
npm --prefix packages/wallet-auth test
```

Public probing must use bounded retries and record timeout/error responses. Never supply deployer, policy-signer or operator secrets in chat or evidence files.

The readiness probe is invoked with `YNX_WALLET_ERC4337_PUBLIC_PROBE=1 npm --prefix packages/wallet-auth run probe:public-erc4337`. It accepts endpoint/address/hash configuration only; it accepts no deployer, Paymaster policy, authentication or signing secret. Exit code 2 means not ready and must never be translated into deployment success.
