# YNX Wallet Web and browser companions

This product-owned surface exercises a real EIP-1193 wallet without storing keys,
seed material, bearer tokens, balances, users, or transactions. It consumes the
frozen YNX Testnet identity (`6423`, `0x1917`) and does not define a Wallet/Auth
protocol.

The PWA detects an injected YNX Wallet first. When one is present, the primary
action connects it directly. Otherwise the UI offers the official YNX Wallet
download and an explicit MetaMask path. The Chrome/Edge and Firefox companion
extensions run the same actions against the active tab's injected provider.

All add-chain, network-switch, and transaction operations first require a live
`eth_chainId` response from the configured authoritative RPC. An unavailable or
wrong network fails closed. A second launch restores only public account metadata
and only when the provider still reports YNX Testnet.

The UI keeps signing and transaction actions disabled until a real provider,
canonical account, and exact `0x1917` chain are present. Standard EIP-1193
`accountsChanged`, `chainChanged`, and `disconnect` events invalidate stale
public session metadata and return those actions to the fail-closed state.

```sh
npm test
npm run build
npm run package
```

Build outputs are unsigned engineering artifacts. They are not installed,
production-signed, store-released, or publicly hosted by this package.
