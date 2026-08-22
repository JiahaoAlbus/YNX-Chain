# YNX Standard Wallet Runtime 1.1.0-p0.0

Exact install target: `@ynx-chain/wallet-auth@1.3.0` from the source-bound tarball recorded by the matching release evidence.

This is the shared Layer 1 runtime for Web extension, Android, iOS, macOS and Desktop. Gateway, Product Registry and Product Session are optional private-service layers and never create or remove EIP-1193 or WalletConnect authority.

## Platform entrypoints

- Web extension page world: import `installStandardWalletWebRuntime` from `@ynx-chain/wallet-auth/standard-wallet-web`. Supply the real HTTPS page scope, a stable extension UUID, protected origin permission storage and real Wallet callbacks. It announces EIP-6963, exposes EIP-1193, never overwrites MetaMask and never launches a scheme, iframe or blank tab.
- Android/iOS/macOS/Desktop: import `createStandardWalletNativeBridge` from `@ynx-chain/wallet-auth/standard-wallet-native`. Supply the exact platform, DApp origin, protected storage, event emitter and real Wallet callbacks. Accept and return newline-terminated canonical JSON-RPC 2.0 only.
- WalletConnect: import `createStandardWalletWalletConnectRuntime` and `createStandardWalletWalletConnectSessionStorageAdapter` from `@ynx-chain/wallet-auth/standard-wallet-walletconnect`. Construct one runtime per real relay topic, await `start()` before proposal or request handling, then route proposal approval to `approve`, visible rejection to `reject`, relay requests to `request`, and session termination to `disconnect`.

## Host-owned authority

Every platform must supply real wallet inventory and protected callbacks for `approveAccounts`, `signMessage`, `signTypedData` and `sendTransaction`. The package never accepts a private key and never fabricates an account, approval, signature, transaction hash or relay session.

Permission snapshots are origin-bound. WalletConnect snapshots are topic-bound canonical JSON and restore only when the protected account permission exactly matches. Explicit revoke, disconnect, mismatch or storage failure clears or refuses both permission and WalletConnect authority. Provider events are forwarded only from an active, approved session.

## Product-owner consumption

Web owners `calendar`, `card`, `creator-studio`, `developer`, `dex`, `exchange`, `finance`, `quant`, `shop`, `social` and `video` consume the Web entrypoint; `pay` and Wallet platform owners consume the native entrypoint. Each owner must bind its own source to the exact package tarball and execute the authoritative E2E plan. Product-specific callbacks and Product Session remain separate.

## Evidence boundary

The install harness proves that the packed artifact can be imported by an isolated consumer and that restart/revoke wiring is executable. It does not prove a real extension/native installation, secure-key signature, Testnet transaction, public runtime, external DApp connection, WalletConnect project ID or relay. Those gates stay false until direct installed or source-bound public evidence exists.
