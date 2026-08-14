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

Discovery renders one unambiguous path: a detected YNX provider gets the direct
Open YNX Wallet action; without YNX, the UI shows both the current YNX website
download URL and MetaMask. An injected MetaMask connects through EIP-1193, while
an absent MetaMask routes to its verified official download page. These external
routes do not change this package's `downloadHosted=false` release state.

Extension package identity is deliberately fail-closed. The unsigned Chromium
bundle declares Chrome/Edge 120 as its minimum runtime, but has no manifest
`key` or `update_url`; consequently a stable Chrome/Edge extension ID, hosted
upgrade, and store-managed uninstall are not claimed. Firefox declares the
stable development add-on ID `wallet-testnet@ynxweb4.com` and Firefox 128 as
its minimum runtime, but remains unsigned and not store-released. Both bundles
link only to the public project homepage; that link is not a hosted download.

The PWA caches only its same-origin shell. Navigations use a network-first
offline fallback, static assets never receive HTML as a substitute, and RPC
POSTs plus external Wallet download routes remain network-only. Returning from
offline mode never restores chain authority from cache: a fresh live `0x1917`
RPC response is still required.

The extension popup provider uses the same fail-closed operations over its
`YNX_WALLET_REQUEST` runtime channel. Add-chain must be followed by switch and
an exact `eth_chainId` proof; wrong-chain results are rejected. A disconnected
runtime cannot restore local session metadata, and reconnect requires a fresh
switch, chain proof, and account approval.
Extension signing and transaction calls also perform the live chain/account
preflight through that runtime channel. A replaced account prevents the
sensitive call entirely; provider code `4001` remains a real user rejection and
is never converted into a signature, transaction hash, or disconnected claim.

The MV3 companion injects a transport-only EIP-1193 provider into the DApp's
main world at `document_start`. Its isolated-world bridge accepts only exact
HTTP(S) origins, the originating window, UUID request IDs, array parameters,
and an explicit method allowlist. Runtime requests are rebound to the sender's
top-level tab and origin, time out closed, and never manufacture accounts,
signatures, transactions, or chain responses. Account, chain, and disconnect
events cross the same origin-bound channel.

The service worker independently verifies the authoritative RPC before every
add/switch mutation. Its 12-second transport deadline is shorter than the
18-second page bridge deadline; both layers fail closed. Runtime requests carry
an origin-bound absolute deadline that is checked again after RPC verification
and before invoking the real wallet backend, preventing a late RPC response
from mutating chain state after the DApp has already timed out. Add/switch input
must exactly match the frozen YNX Testnet metadata.

```sh
npm test
npm run build
npm run package
```

Build outputs are unsigned engineering artifacts. They are not installed,
production-signed, store-released, or publicly hosted by this package.
