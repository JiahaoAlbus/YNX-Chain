# YNX Hosted Wallet adapter v1 candidate

This is an explicit first-party adapter for registered YNX product HTTPS origins. It does not inject `window.ethereum` and is separate from extension EIP-6963 discovery and MetaMask.

Build output: `apps/wallet-web/dist/hosted/adapter.js`. A product must serve a reviewed copy from its own origin and import `createHostedWalletAdapter`. The Wallet page itself must be served at `https://wallet.ynxweb4.com/hosted/`. No product may move the signer page or vault onto its own origin.

```js
import { createHostedWalletAdapter } from "./adapter.js";
const wallet = createHostedWalletAdapter();
// Run in a direct user-click handler; browser popup permission is required.
const [account] = await wallet.connect();
const accounts = await wallet.request({ method: "eth_accounts" });
const chainId = await wallet.request({ method: "eth_chainId" });
```

`connect()` returns one lowercase EVM account only after visible Wallet approval. Zero balance is allowed. `request({method,params})` supports EIP-1193-compatible account, chain, read-only RPC, message/typed-data signing and native transfer methods subject to Wallet review. `wallet_switchEthereumChain` and `wallet_addEthereumChain` validate only the exact canonical YNX Testnet configuration before or after connection and return `null`; they do not grant an account. `ynx_requestProductSessionV2` takes one official `ynxwallet://authorize?...` URL and returns `{version:2,returnUrl}` only after separate password approval or rejection. The product must verify that return through the official SDK and Gateway; a normal account connection is not private-session authorization.

`restore()` returns the current live account if this adapter and popup are still connected; a new page instance returns `[]` and never silently regrants. `disconnect()` and `revoke()` clear this adapter's live channel. `detach()` also removes its message listener. `on(name, callback)` and `removeListener(name, callback)` support `connect`, `accountsChanged`, and `disconnect`. A closed/reloaded popup, expired channel, explicit rejection, or account switch disconnects; the user must reconnect and approve. Account switching occurs in the Wallet popup and invalidates the old grant.

The adapter opens `https://wallet.ynxweb4.com/hosted/#connect=<base64url JSON>` with `{version:1,origin,requestId,nonce,expiresAt,chainId:"0x1917"}`. The Wallet accepts only the vendored registry's EVM-compatible product `webOrigin`, then validates each message's exact opener/source/origin/requestId/nonce/messageId/expiry and one-use message ID. Responses use exact `postMessage` target origins. No secret enters the opener URL, URL fragment, log, or product bundle. The Wallet origin stores an AES-GCM/PBKDF2 encrypted vault in IndexedDB and verifies writes by readback. The client never receives a private key.

Errors are rejected Promises with stable `error.code`, including `HOSTED_POPUP_BLOCKED`, `HOSTED_POPUP_CLOSED`, `HOSTED_REQUEST_EXPIRED_OR_RELOADED`, `HOSTED_DISCONNECTED`, `USER_REJECTED`, and exact signer/RPC validation codes. Finance should clear its own connected state on `accountsChanged([])` or `disconnect`, and must not treat an opened popup or `eth_chainId` as connected.

This is a source candidate until the product has imported the adapter, the exact Wallet page and Service Worker are deployed together, and public cross-origin callback verification passes. Local browser fixtures do not establish public deployment or Gateway availability.
