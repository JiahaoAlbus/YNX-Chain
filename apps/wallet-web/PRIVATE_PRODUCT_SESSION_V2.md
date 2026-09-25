# Wallet Web private Product Session v2 transport

This extension transports the official `@ynx-chain/wallet-auth` Product Session v2 request and return. It does not create a separate authorization format. The Card reviewed registry is vendored as `vendor/product-session-registry-b754ffc42.json` (SHA-256 `d0300caa389cf30026483e66bbf719dd0e6d0d98d907e3ee21729c962fd87ed8`), including `card:finance:share`. The SDK package is the reviewed 1.2.0 `09e36b150` artifact (SHA-256 `0a6f6cb58261f5844d8cbdd858fbdc173c62d5bca3924a0a9646009af13bdeef`).

The page discovers YNX Wallet through EIP-6963 (`com.ynx.wallet`). After the official browser client has created and stored a pending request with `client.beginExplicit()`, the consumer takes `result.route.url`, which is the SDK's `ynxwallet://authorize?request=...` URL. It passes that URL as data to either `provider.requestProductSessionV2(url)` or `provider.request({method:"ynx_requestProductSessionV2",params:[url]})`. The consumer must not navigate to the scheme. The method returns `{version:2,returnUrl}`. The consumer passes `returnUrl` to the *same* official client with `client.handleReturn(returnUrl)` and treats the session as connected only after the SDK completes its Gateway challenge, completion, and fresh introspection. A signed return URL by itself is not an active session.

The minimum consumer integration is:

```js
const pending = await selected.client.beginExplicit();
const provider = selectedYNXProviderFromEIP6963();
if (pending.status !== "connecting" || pending.route?.status !== "ready" || !provider) throw Error("PRIVATE_TRANSPORT_UNAVAILABLE");
const response = await provider.requestProductSessionV2(pending.route.url);
if (response?.version !== 2 || typeof response.returnUrl !== "string") throw Error("PRIVATE_RETURN_INVALID");
const settled = await selected.client.handleReturn(response.returnUrl);
// Check the SDK state and fresh Gateway introspection before private API use.
```

For Card, the precise integration point is `apps/card/src/providerSessionWeb.ts` at its current `CARD_WEB_PRIVATE_TRANSPORT_UNAVAILABLE` branch. Finance should adapt its own browser session consumer in its authorized worktree. Neither consumer should replace the official SDK, change registry scopes, or infer private approval from `eth_accounts`.

The extension accepts only the SDK's registered Web request for the actual browser sender origin and top-level document. The official request includes product, client, application, callback, device key, scopes, purpose, nonce, state, and expiry. The extension shows the registry product name and every requested scope, requires an explicit decision and local vault password, and signs with the official SDK. A rejection returns the official `{version:2,returnUrl}` rejection. The extension never navigates to the callback or scheme. It does not require or grant an EIP-1193 `eth_accounts` connection, so MetaMask and standard YNX account permissions stay independent.

The page-to-extension transport uses the existing `YNX_PAGE_REQUEST_V1`/`YNX_DAPP_REQUEST_V1` document-bound bridge with a distinct private method. The browser sender tab, frame, document ID, origin, content document nonce, browser context, account revision, request ID, and deadline are checked before and after review and signing. The SDK verifies the request and signed return; the extension session storage remembers each official request digest until its expiry, including across service-worker restarts. The approval window is in-memory only and cannot be resumed by another document or worker instance. Document reload/navigation, account replacement, permission revocation, tab switch, timeout, and orphaned approval fail closed.

After a reload, `client.restore()` may expose the original pending SDK request. Re-presenting that same URL returns `PRIVATE_REQUEST_REPLAYED`; no second signature is made. The consumer should show Retry and call `client.beginExplicit()` to replace the pending request with a fresh nonce/state, then call the private method for the new route. The original pending request is retained by the SDK until this explicit retry. A rejected return should still be passed to `client.handleReturn(returnUrl)` so the SDK clears the matching pending request. If the extension is missing, the method is unavailable and the consumer remains disconnected or in Guest / Try mode.

Consumer errors fall into three groups: availability (`PRIVATE_TRANSPORT_UNAVAILABLE`, `RUNTIME_UNAVAILABLE`), stale pending request (`PRIVATE_REQUEST_REPLAYED`, `PRIVATE_APPROVAL_EXPIRED`, `BRIDGE_TIMEOUT`, `DOCUMENT_CHANGED`, `PRIVATE_TAB_CHANGED`, `PROVIDER_ACCOUNT_CHANGED`), and invalid or unsafe request (`PRIVATE_REQUEST_INVALID`, `PRIVATE_ORIGIN_MISMATCH`, `PRIVATE_REPLAY_UNAVAILABLE`, plus the SDK's registry, binding, signature, and expiry errors). Only an explicit fresh `beginExplicit()` retries the second group. The third group stays disconnected and requires repair or a corrected registered request.

Local Chrome for Testing and Edge tests use a browser-intercepted Card origin and a disposable encrypted vault. They prove extension transport, review, signed/rejected return, replay refusal, and reload recovery with a fresh request. They do not exercise the public Wallet Gateway, complete a Product Session, authorize Card/Finance, deploy an extension, or prove a live provider response. Those states remain `NOT_VERIFIED` until direct evidence exists.
