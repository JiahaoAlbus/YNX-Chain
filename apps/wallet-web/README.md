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
On a second launch, malformed, extra-field, wrong-chain, missing-provider,
replaced-account, and provider-error session records are deleted. Switching
between YNX Wallet and MetaMask also invalidates the previous wallet session;
the user must explicitly connect again.
Every sign and transaction attempt independently rechecks both the exact chain
and the currently authorized provider accounts before invoking `personal_sign`
or `eth_sendTransaction`. This protects extension popups whose runtime proxy
cannot subscribe to injected-provider lifecycle events.
If that preflight proves an account change, wrong network, missing provider, or
standard provider disconnect, the UI deletes the remembered session and keeps
sign/transaction controls disabled until an explicit reconnect.

```sh
npm test
npm run build
npm run package
```

Build outputs are unsigned engineering artifacts. They are not installed,
production-signed, store-released, or publicly hosted by this package.
