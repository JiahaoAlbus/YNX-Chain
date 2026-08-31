# YNX Wallet Web and browser companions

This product-owned surface exercises a real EIP-1193 wallet without storing keys,
seed material, bearer tokens, balances, users, or transactions. It consumes the
frozen YNX Testnet identity (`6423`, `0x1917`) and does not define a Wallet/Auth
protocol.

Locale and theme are the only preferences restored across launches. They are
stored in one versioned, expiring, non-sensitive record with a monotonic
revision. Invalid JSON, unknown fields, expired records, and stale cross-window
updates fail closed to English and the system theme, remove the rejected record,
and surface a visible error. Accounts, provider authority, signatures, and
transactions are never included in this preference record.

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
Each bundle declares two HTTPS-only, top-level `document_start` content scripts:
the isolated transport and the main-world EIP-6963/EIP-1193 provider. This makes
YNX discoverable to external HTTPS DApps without a top-level custom-scheme
navigation, while the provider remains transport-only and is never web
accessible as a standalone resource. The extension keeps `activeTab` solely as
a constrained fallback for popup-originated actions. HTTP, file, browser
internal, subframe, and unsupported-tab contexts are excluded; fallback
injection failures return `ACTIVE_TAB_REQUIRED`. The persistent DApp permission
is exactly `https://*/*`; extension CSP still allows network connections only to
the frozen `https://evm.ynxweb4.com` RPC authority.
The same action is keyboard-accessible through `Ctrl+Shift+Y` (macOS
`MacCtrl+Shift+Y`). This command grants no durable site permission: closing the
browser or navigating the tab requires a new explicit action before injection.
On every extension service-worker start, migration v3 removes historical HTTP
and localhost origin grants, unregisters every old dynamic content script, and
clears extension alarms when that API was historically available. It then
rechecks that the exact HTTPS DApp permission remains. The migration writes only its non-sensitive report in extension-local
storage; it never reads or deletes account/session state. Any cleanup or report
failure blocks discovery and all wallet requests with `MIGRATION_INCOMPLETE`
before provider injection or sensitive work.

Add-chain, switch-network, and transaction controls remain disabled until the
current page has obtained a fresh, exact `eth_chainId = 0x1917` response from
the frozen RPC endpoint. Offline, malformed, or wrong-chain responses revoke
that readiness immediately; add/switch do not call a wallet until the RPC
preflight succeeds, and every mutation still rechecks the chain afterward.

The PWA caches only its same-origin shell. Navigations use a network-first
offline fallback, static assets never receive HTML as a substitute, and RPC
POSTs plus external Wallet download routes remain network-only. Returning from
offline mode never restores chain authority from cache: a fresh live `0x1917`
RPC response is still required.
Its standalone manifest declares explicit 192px and 512px PNG icons plus a
dedicated 512px maskable icon, all proportionally derived from the checked-in
1254px transparent YNX logo. The icon alpha bounds stay inside the maskable
safe zone, and all icon bytes are part of the versioned shell integrity map.
The build also freezes SHA-256 digests for every cached shell asset. Cache v5
serves only current-cache bytes matching those digests, rejects and deletes
tampered entries, and removes only obsolete `ynx-wallet-web-v*` caches without
touching unrelated products. Missing current bytes fail closed with HTTP 503;
an older cache can never become a wallet connection or chain-authority source.

The extension popup provider uses the same fail-closed operations over its
`YNX_WALLET_REQUEST` runtime channel. Add-chain must be followed by switch and
an exact `eth_chainId` proof; wrong-chain results are rejected. A disconnected
runtime cannot restore local session metadata, and reconnect requires a fresh
switch, chain proof, and account approval.
Discovery also fails closed: migration/runtime errors and malformed responses
clear stale provider state, invalidate the remembered session, keep the two
official fallback routes available, and surface the bounded error code instead
of pretending that no wallet is installed. The YNX APK fallback was directly
observed as an HTTP 200 Android package and independently verified as a v2
testnet-preview signature; this does not make the Web/extension ZIPs hosted or
production-signed.

The official Wallet release registry currently declares only that Android API
24+ APK. Windows x64/arm64, macOS x64/arm64, Linux x64/arm64, Chrome/Edge and
Firefox extension packages, and a downloadable PWA package have no declared
official candidate URL, so the UI exposes them only as disabled, unavailable
choices. It never guesses a filename or converts the live `/dapp/wallet` status
page into a package claim. The Android artifact uses the persistent testnet
release key and therefore remains explicitly non-production-signed. Its download
control is bound to a visible description containing the verified byte count,
complete SHA-256, signing class, and `productionSigned=false` boundary.
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

Sensitive DApp requests consume the Core Wallet/Auth central registry during
the build. The current `ynx-wallet-v1` registration is pending review, disabled,
and has no registered HTTPS callback, so the companion returns
`CANONICAL_AUTH_UNAVAILABLE` before requesting accounts, signatures, or
transactions from a wallet backend. Request IDs are consumed once in bounded
session storage, deadlines and exact parameter shapes are enforced, and account,
signature, and transaction-hash results are never synthesized. Enabling a
registration alone does not bypass this gate: a verified canonical context is
still required.

```sh
npm test
npm run build
YNX_WALLET_WEB_SOURCE_COMMIT=<full-40-character-reviewed-commit> npm run package
```

Release packaging fails closed when the source identity is missing, abbreviated,
malformed, or unavailable in the repository. Every packaged target must contain
the same exact source commit in `build-identity.json`; there is no
`uncommitted-source-tree` packaging fallback.

Build outputs are unsigned engineering artifacts. They are not installed,
production-signed, store-released, or publicly hosted by this package.
