# YNX Standard Wallet Runtime 1.0.0-p0.0

Package checkpoint: `@ynx-chain/wallet-auth@1.2.0`.

This package is the shared Layer 1 runtime. It is independent of Gateway, Product Registry and Product Session. A private-service or browser RPC probe failure may be surfaced as degraded but cannot revoke, hide, reopen or synthesize the selected provider and approved account.

## Imports

- Shared/Electron/React Native: `@ynx-chain/wallet-auth/standard-wallet-runtime`
- Browser injection: `@ynx-chain/wallet-auth/standard-wallet-web`
- Android/iOS/macOS/Desktop canonical JSON bridge: `@ynx-chain/wallet-auth/standard-wallet-native`

The package exports EIP-1193 permission routing, YNX `0x1917` chain add/switch, `personal_sign`, EIP-712, Testnet transaction submission routing, provider events, durable origin-scoped restart/revoke, WalletConnect session adapter and platform storage adapter.

## Browser installation

Call `installStandardWalletWebRuntime` in the page execution world. The runtime derives the exact HTTPS origin from `scope.location.origin`, restores protected permissions, announces `YNX Wallet` through EIP-6963 and responds to every `eip6963:requestProvider` event. Legacy `window.ethereum` is installed only when the slot is empty; an existing MetaMask or other wallet is never overwritten.

Identity is exact:

- `name = YNX Wallet`
- `rdns = com.ynx.wallet`
- `isYNXWallet = true`
- `isMetaMask = false`

`uninstall()` removes only listeners and the legacy slot owned by this installation. It does not revoke durable account permission; explicit `wallet_revokePermissions` or `disconnect()` does.

## Platform callbacks

Every host must supply its own real Wallet inventory, protected storage and visible user-confirmation boundaries:

- `approveAccounts`
- `signMessage`
- `signTypedData`
- `sendTransaction`
- optional read-only `rpcTransport`

The JS runtime never accepts or stores a private key. It never manufactures an account, signature, transaction hash or WalletConnect authority. Platform callbacks must return only results produced by the platform Wallet's secure keystore/signing/submission path.

Use `createStandardWalletPermissionStorageAdapter` with platform-protected `getItem`, `setItem` and `removeItem` operations. Android/iOS/macOS/Desktop can consume `createStandardWalletNativeBridge`; requests and responses are newline-terminated canonical JSON-RPC 2.0 and events are emitted as `ynx_walletEvent` notifications.

## Lifecycle

1. Create the Web installation, platform runtime or native bridge.
2. Await `start()` before accepting DApp requests.
3. Forward requests only through `provider.request`, `runtime.request` or `bridge.handle`.
4. Await account replacement, chain notification, disconnect and revoke operations.
5. Preserve `connect`, `accountsChanged`, `chainChanged`, `disconnect` and `message` events.
6. Treat Product Session/RPC probe failure as private-service degradation only.

The WalletConnect adapter validates the `eip155:6423` namespace and routes through the same permission engine. A real WalletConnect completion still requires a platform-owned project ID, relay, pairing, visible approval/rejection, restart and user-confirmed signing/Testnet-send evidence.

## Evidence boundary

`npm run verify:installed-standard-wallet-runtime` builds the package, installs the resulting tarball into an isolated external consumer and executes Web/native/WalletConnect API wiring. Its deterministic accounts, signatures and transaction hash are conformance callback data only. The harness is not proof of a real installed wallet, secure-key operation, public runtime, external DApp success or WalletConnect relay.

The authoritative direct E2E requirements remain `release/integration/wallet-standard-wallet-e2e-execution-plan-p0-20260822.json`. All direct installed/public flags remain false until that evidence envelope is complete.
