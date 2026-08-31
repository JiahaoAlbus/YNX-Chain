# Finance Provider Discovery Consumption Checkpoint — 2026-08-31

## Scope

This checkpoint changes only `apps/finance/**`.  It packages the accepted
Standard Wallet Provider discovery and connection-state reducer for Finance
Web; it does not alter Wallet/Auth, Calendar, a gateway, or any deployment.

## Accepted dependency

| Field | Exact value |
| --- | --- |
| Wallet/Auth source | `98c6d5d784d212df8981a53b17118a511e246ad2` |
| Source tree | `51a60a362d4ad5dd748bcdefb101f71b1d9e0cee` |
| Evidence commit | `c3ab255c32bdeb9c8e056882c315f8ad43c29c7f` |
| Source blobs consumed | discovery `38198077220584668a94649c7f36d6881bfab6fb`; reducer `60879be26a4b4760dea53b38f76872045c421202`; canonical error type `812800168b53c8263b5427be4b7d4a5c51c8f898` |

`apps/finance/scripts/build-standard-wallet-runtime.mjs` rebuilds the browser
asset directly from those immutable Git objects.  It writes only the Finance
product asset `apps/finance/web/standard-wallet-runtime.js` and leaves the
shared package source untouched.

## Behaviour now covered by source tests

- Finance exposes distinct **Connect YNX Wallet** and **Connect MetaMask**
  actions; the default YNX action never substitutes an injected MetaMask
  provider.
- EIP-6963 plus legacy injected-provider discovery chooses only the requested
  provider identity; generic `window.ethereum` is not used as a connection
  provider.
- The selected provider must complete `wallet_switchEthereumChain`, optional
  `4902` `wallet_addEthereumChain`, a re-switch and `eth_chainId=0x1917`
  before `eth_requestAccounts`.
- Refresh uses `eth_accounts` and `eth_chainId`; account, chain and provider
  disconnect events are reduced by the accepted shared state machine.
- Product Session remains unavailable/degraded without clearing a successful
  Standard Wallet connection.  No direct browser RPC probe, custom-scheme
  navigation, iframe, `window.open`, account approval, signature or
  transaction is introduced.

## Rebuild and verification

```sh
cd apps/finance
npm run build:standard-wallet
npm test
npm run security
```

The generated runtime SHA-256 is recorded in the owning commit and must be
recomputed from the source-bound tree before any release candidate is signed.

## Frozen owner evidence

| Item | Exact value |
| --- | --- |
| Owner branch | `codex/final-finance-suite` |
| Source checkpoint | `77a801703415d444d62757860afd4d5a5c938b32` |
| Source tree | `7abaf622bf9482a2ee52a0b9c8e8970a0e25a08e` |
| Generated runtime | `apps/finance/web/standard-wallet-runtime.js`, 15,263 bytes, SHA-256 `3ef16fae6cdfd559a60464dcbb42ea55a87b826e88e6e44b5b358674909943a4` |
| Tests | `npm run build:standard-wallet`; `npm test` 21/21; `npm run security` passed across 283 text files |
| Transfer bundle | `/tmp/ynx-finance-suite-77a801703.bundle`, SHA-256 `b4a1bcc5dc0e92fa976ba9d3455574910b4922e576d837c52bccac2dccdf3595`, requires `0892cd45037dd158e92c041643e3352393fe85c4` |

## Truth boundary

This is source and local-test evidence only. `publicRuntimeBound`,
`installedBuildVerified`, `providerApprovalVerified`, `rejectVerified`,
`callbackVerified`, `refreshDisconnectVerified`, `ProductSessionV2`,
`signatureVerified`, `transactionVerified`, `ComputerControlVerified`, and
`deployedPublic` are all **false**.  A Finance-only deployment lease plus
direct public/installed lifecycle evidence is required before changing any of
those values.
