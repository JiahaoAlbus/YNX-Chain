# P0 Standard Wallet Request Router — Platform Handoff

Status: `SOURCE_ONLY_CANDIDATE`

This handoff is the shared Core/Auth authority for the standard Wallet layer. The exact implementation commit, tree, test counts, package archive digest and file hashes are frozen in the adjacent release evidence generated after this source commit.

## Boundary

- Standard Connection is EIP-1193/EIP-6963/WalletConnect authority for an exact approved `0x` account on YNX Testnet (`ynx_6423-1`, EVM `6423`, `0x1917`, `YNXT`).
- An external HTTPS DApp origin or WalletConnect topic does not require a YNX Product Registry entry.
- Product Session remains a separate optional private-service layer. Its outage may report `DEGRADED`; it cannot clear or create Standard Wallet authority.
- Discovery, provider detection, a local test callback or a Product Session is not proof of account approval, signature, transaction submission, platform consumption or public deployment.

## Package surface

Consume only the package-root exports from `@ynx-chain/wallet-auth`:

- `StandardWalletProviderEngine`
- `StandardWalletWalletConnectSessionAdapter`
- `InMemoryStandardWalletPermissionStorage` for tests only
- `StandardWalletPermissionStorage` TypeScript interface for platform storage adapters
- `serializeStandardWalletPermissionSnapshot` and `parseStandardWalletPermissionSnapshot` for canonical persisted bytes
- `standardWalletEip6963Announcement`

Do not copy the router, concatenate wallet URLs or add a Product Registry lookup to this path.

## Required platform callbacks

Construct one `StandardWalletProviderEngine` per exact DApp origin with:

- `walletAccounts`: the platform Wallet's real EVM account inventory. Never synthesize an account.
- `approveAccounts`: visible, user-controlled approval or rejection. Return only selected inventory accounts; rejection must reject or return no accounts.
- `permissionStorage`: protected, origin-keyed durable storage. Persist only canonical snapshot bytes. Storage read/write/clear failures must remain failures.
- `signMessage`: real secure signer for `personal_sign`; return only an exact 65-byte hex signature.
- `signTypedData`: real secure signer for validated EIP-712 input; return only an exact 65-byte hex signature.
- `sendTransaction`: real Wallet review/submission path; return only an exact 32-byte transaction hash after submission.
- `rpcTransport`: the platform's bounded YNX Testnet read transport.

Missing callbacks return typed unsupported/disconnected errors. Callback rejection maps to `4001`; unauthorized access maps to `4100`; an internal callback failure or invalid callback result never becomes a fabricated success.

## Lifecycle

1. Construct the provider with the exact origin and protected permission storage.
2. Await `restorePermissions()` before reporting restored account authority or announcing restored connection state.
3. Route EIP-1193 requests through `provider.request(...)` only.
4. Await `replaceWalletAccounts(...)`, `notifyChainChanged(...)` and `disconnect()`; these operations include durable authority changes.
5. Forward only the shared event model: `connect`, `accountsChanged`, `chainChanged`, `disconnect`, `message`.
6. On explicit `wallet_revokePermissions`, success means the exact-origin durable account authority was cleared. Restart must return no accounts.

Approval persistence, inventory replacement and revocation are serialized. A late approval cannot resurrect an account removed or revoked during the approval/persistence window.

## Request contract

Account/permission methods:

- `eth_accounts`
- `eth_requestAccounts`
- `wallet_getPermissions`
- `wallet_requestPermissions`
- `wallet_revokePermissions`

Privileged methods:

- `personal_sign`
- `eth_signTypedData_v4`
- `eth_sendTransaction`

The router rejects an unapproved account, wrong EIP-712/transaction chain, malformed EIP-712 type graph, malformed access list, oversized request, unsupported method and malformed callback output before authority can be reported.

WalletConnect approves only `eip155:6423`, the shared method allowlist and the shared event allowlist. It uses the same permission engine and has no Product Session dependency.

## Frozen conformance inputs

- `packages/wallet-auth/integration/standard-wallet-provider-v1.json`
- `packages/wallet-auth/testdata/standard-wallet-provider-conformance-v1.json`
- `packages/wallet-auth/test/standard-wallet-provider-engine.test.mjs`
- `packages/wallet-auth/test/standard-wallet-permission-persistence.test.mjs`

Platform owners must add direct device/browser/WalletConnect relay evidence. Until then, platform consumed, real external DApp, real signer/send, public, deployed and product migration gates remain false.
