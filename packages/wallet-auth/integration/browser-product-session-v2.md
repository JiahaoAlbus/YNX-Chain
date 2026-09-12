# Browser Product Session v2

`createBrowserProductSessionClient` creates a recoverable Web v2 client using a non-extractable WebCrypto P-256 signing key persisted by IndexedDB structured clone. It exports through the package root and `@ynx-chain/wallet-auth/product-session-browser`. The default environment is the current browser; `environment` and `clock` can be injected by tests.

```js
import {
  createBrowserProductSessionClient,
  ProductSessionGatewayFetchAdapter,
} from "@ynx-chain/wallet-auth";

const gateway = new ProductSessionGatewayFetchAdapter({
  endpoint: "https://wallet-auth.ynxweb4.com",
  fetch: globalThis.fetch.bind(globalThis),
  walletInstalled: detectYNXWalletInstalled,
  schemeRegistered: detectYNXWalletScheme,
  timeoutMs: 10000,
});
const adapter = await createBrowserProductSessionClient({
  registry,
  productId: "creator-studio",
  scopes: ["creator:account", "creator:publish", "creator:revenue"],
  purpose: "Sign in to Creator Studio with this account.",
  gateway,
});
const { client } = adapter;

// On initial load, re-introspect any saved session. A returned connecting state
// still requires the app's explicit Wallet-open UX and real user approval.
const restored = await client.restore();

// On an explicit Connect action, persist the pending request before opening
// the route through the product's Wallet coordinator / installed Wallet handoff.
const pending = await client.beginDetected();
if (pending.route?.status === "ready") openYNXWallet(pending.route.url);

// On /wallet-auth/callback, pass the complete URL; do not extract a session token.
const returned = await client.handleReturn(location.href);
if (returned.status === "connected") renderAccount(returned.session.account);

// Before each publishing operation, mint a fresh introspection proof. The API
// independently derives creator:publish from its own route and verifies v2.
const authorization = await adapter.createIntrospectionProof(["creator:publish"]);
await fetch("/api/publish", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-YNX-Product-Session-Proof-V2": authorization.proofHeader,
  },
  body: JSON.stringify(publishInput),
});

// Revoke remotely before presenting a successful disconnect. Offline failures
// retain the binding so Retry can reconcile revocation.
await client.disconnect();
adapter.close(); // Closes this tab's IndexedDB handle; does not delete/revoke.
```

Treat these snippets as lifecycle entry points, not a sequence to run on every page load. Installation/scheme detection and `openYNXWallet` remain product responsibilities; the adapter does not invent their availability or trigger an approval automatically. `device.sign` can also be supplied to the existing protocol proof helpers. `createIntrospectionProof` returns `{proof, proofHeader, requestId, body}`; `body` is the canonical Auth introspection body, not the product business request body. A successfully consumed proof cannot be reused after a network retry. The product API must bind Origin and exact product identity, choose required scopes, enforce business permissions, and use the official v2 introspection contract.

## Browsers with unknown native installation

A browser generally cannot reliably discover whether an OS URL handler is
installed. Do not hard-code successful installation probes or infer native
installation from an injected EVM provider. For an explicit user request to try
opening YNX Wallet, use the official client entry instead:

```js
// Called by an explicit Connect / Open YNX Wallet UI action.
const pending = await adapter.client.beginExplicit();
if (pending.status === "connecting" && pending.route?.status === "ready") {
  // Expose this exact SDK URL as an explicit user-click link/button. This is
  // especially useful when an async time/storage operation loses user activation.
  showOpenWalletLink(pending.route.url);
}
```

This method uses the actual Gateway clock, persists the exact pending request,
and returns `automatic: false` and `installation: "unverified"`. A ready route
means its request and registered URI are ready to try; it does not prove a
native application was installed or opened. The method neither probes the OS
nor navigates automatically. `prepareWalletAttempt` is the lower-level pure
route builder; products should use `beginExplicit` to preserve callback state.

Keep a download/return option available if opening fails. Browser blur, a timer,
or a user's statement that Wallet is installed is not login evidence. Continue
through `handleReturn` and the real Gateway challenge/completion/introspection
before rendering a private session as connected. Keep the exact pending state
until that callback or an explicit new attempt, sign-out, expiry or rejection.
`restore()` retains its existing controlled detected-reconnect behavior and
does not silently call this explicit-open path. New attempts, Guest and
disconnect invalidate stale work rather than reopening an old request.

For Social, the registry's allowed scopes now additionally include
`social.contacts`, `social.messaging`, and `social.profile`. The ordinary
identity login still requests `['account:read', 'profile:link']`; requesting a
communication subset is a separate explicit approval. Registry `scopes` is an
allowlist, not an instruction to request every available permission.

The adapter runs only in a secure context whose exact `location.origin` matches the product registry's Web origin. Its fixed IndexedDB database contains separate device/state records keyed by the actual Gateway authority, chain, origin, product, client, application, callback and the exact sorted scope subset. Different authorities or scopes use different keys and session records; changing either requires a new explicit Wallet approval. Storage access only accepts this client's session, pending-request and callback keys.

The `gateway` must be an actual `ProductSessionGatewayFetchAdapter` from the same
SDK module instance. The SDK obtains the endpoint from internal adapter metadata,
not a caller-supplied authority string or an object that imitates its methods.
Endpoints are exact canonical HTTPS origins; paths, queries, fragments, explicit
ports and aliases are rejected instead of being truncated. Both version-two
device and state records bind the same authority as their namespace.

An authority change never introspects, completes, revokes or migrates an old
authority's stored session. Returning to the original authority can restore its
own version-two records. Legacy records without authority binding are preserved
but are not read, copied or deleted by this adapter. The upgrade therefore needs
a new explicit approval even at an unchanged endpoint when only legacy records
exist. Keep old-authority revocation/reconciliation with the original client;
do not route it through a redirect, combine independent Gateway state files, or
delete old keys to simulate a migration. Standard EVM connections are unaffected.

This storage boundary assumes the configured adapter and injected fetch
transport are trusted. It does not protect against a hostile same-origin script
that replaces methods, controls transport or invokes the signer itself.

The private key is generated with `extractable: false`; it is never exported as raw bytes or JWK. Only the public key is exported to produce the protocol's compressed P-256 identity. Initialization reads the structured-cloned key back, checks attributes, and verifies a fresh signature with the stored public key. Signing rechecks the persisted identity. Concurrent tabs atomically reuse the first committed identity. A missing key with surviving state, mismatched key pair, extractable replacement, wrong product binding or unusable IndexedDB fails closed; there is no plaintext or in-memory fallback. Clearing all site storage removes both keys and sessions and requires a new login. IndexedDB quota eviction/private-browsing policies may also remove data.

Capabilities are deliberately `securityLevel: "webcrypto-nonextractable"`, `osProtected: false`, and `hardwareBacked: false`. IndexedDB state is not claimed to be encrypted or protected from scripts executing in the same origin. Non-extractability blocks private-key export through WebCrypto; it does not prevent an XSS or compromised same-origin script from invoking the signer. The product must maintain its normal script/CSP and origin isolation protections. Browser profile/OS compromise is outside this assurance. Native platforms continue to require `hardware-backed` or `os-protected` storage; the browser level is accepted only with `platform: "web"`, a `device.sign` function, and no `device.secret` property.

Automated tests use real Node WebCrypto for key generation, structured cloning, signature verification, protocol completion, fresh API proofs, restart and revocation. The IndexedDB implementation in those tests is a narrow fake for transaction and error semantics. Real Chromium/WebKit/Firefox IndexedDB persistence, installed Wallet approval, correct product return and API binding remain separate browser acceptance gates.
