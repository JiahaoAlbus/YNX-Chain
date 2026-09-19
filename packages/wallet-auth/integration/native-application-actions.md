# Native DEX action approval

The native application-action API supports the four existing Core actions:
`dex_swap_exact_input`, `dex_swap_exact_output`, `dex_liquidity_add`, and
`dex_liquidity_remove`. Their wire authority is Core commit
`28d30b4b9ac983811f1e6a87f7620ec3bf3f8316`. It does not enable EVM contract
execution or provide a Card application approval. A product session and a
standard provider account are not approvals for these actions.

The product prepares a request from a current native ledger snapshot and an
explicitly reviewed quote. `/v1/native-snapshot?account=...` returns decimal
strings; convert them only when the value fits a positive safe integer. Never
round a large amount/nonce or put a decimal string in a signed JSON integer
field. Native YNXT is counted in whole YNXT; another asset uses its own base
units. EVM balances remain wei. The Wallet does not silently convert units.

```js
import {
  createApplicationActionRequest, encodeApplicationActionWalletURL,
  parseApplicationActionReturnURL, applicationActionHash,
} from "@ynx-chain/wallet-auth";

// expectedAccount is the selected canonical ynx1 account. Its actual key
// ownership is checked against the returned Core signature, not this request.
const request = createApplicationActionRequest(registry, {
  productId: "dex", platform: "web", account: expectedAccount,
  action: "dex_swap_exact_input",
  payload: { poolId, assetIn, amountIn, minAmountOut, deadlineUnix },
  nonce: nextNativeNonce,
  requestId: crypto.randomUUID(), state: randomBase64urlState,
});
// Persist the exact request in the product before exposing this user-click URL.
const url = encodeApplicationActionWalletURL(registry, request);

// The registered callback route distinguishes applicationActionResult from a
// Product Session callback. Pass the whole URL and exact protected request.
const result = parseApplicationActionReturnURL(registry, location.href, request);
if (result.status === "approved") {
  const signedBytes = result.signed;
  const transactionHash = applicationActionHash(signedBytes);
  // After the product's explicit submission step, POST these original bytes
  // to the Core route for this pool/action. Do not reorder or re-sign them.
}
```

`randomBase64urlState` is a fresh 32–128-character random base64url value, not a
reused session token. Request IDs are lowercase UUIDv4. Request expiry is at
most300 seconds and the business deadline must still be in the future when
approved. Platform, product, origin, application and callback are derived from
the registry and strictly checked. Wallet URI is
`ynxwallet://application-action?request=...`; there is no arbitrary callback URL
parameter and no fallback to a legacy scheme.

The native Wallet reviews the account, claimed product origin, action, fee,
nonce, pool, amounts, limits, deadline and return route. It explicitly describes
the origin as unverified: a native URI is not proof that a particular DApp sent
it. Approval uses the existing protected account-key access and OS
authentication. Lock, background, account change and storage failure cancel
the request. The Wallet persists replay consumption before signing and keeps
the exact completed return for explicit retry after a callback failure.

The on-chain signature binds the actual Core account, action, payload, nonce,
chain6423 and fee1 YNXT. Core sign JSON follows Go struct order, SHA256,
compressed secp256k1 public key and low-S DER signature. The outer request
digest/state correlate the return; they are not part of Core's signature and
must not be presented as authenticated DApp origin or private-session proof.
The return parser verifies the signature and its account/action/payload/nonce
against the original request. It never accepts a signature merely because it
has the right hexadecimal shape.

Core submission routes are `/dex/pools/{id}/swaps/exact-input`,
`/swaps/exact-output`, `/liquidity/add`, and `/liquidity/remove` under the same
pool prefix. Preserve the raw signed JSON and its hash for idempotent retry.
On a lost response, query `/v1/native-transactions/{hash}` before resending the
same bytes. Confirm the returned transaction account/action/pool/amounts and
receipt against the request. A signature, a successful app return, or a pending
transaction is not a completed swap, payment or consensus finality.

MetaMask cannot sign these native application actions through its standard
`eth_sendTransaction` API. Its separate EVM path stays subject to the actual
deployed Core capability. This SDK implementation and native source entry do
not establish that a user's installed Wallet already contains this feature;
release and installed-client checks remain separate.

## Explicit Web launcher

`src/application-action-launcher.js` provides `createApplicationActionLauncher`
for the existing four DEX actions. It consumes the product's existing durable
pending journal; it does not introduce a second journal, sign a new request,
request provider permissions, or submit a transaction. Card uses its separate
application-approval protocol and must not be passed into this DEX launcher.

```js
const launcher = createApplicationActionLauncher(registry, {
  productId: "dex",
  // Resolve only after the journal's commit has completed. Reuse exactly the
  // original saved request; do not recreate its state, nonce or expiry here.
  loadPendingRequest: async () => {
    const account = selectedNativeAccount; // canonical ynx1, not an EVM 0x value
    const draft = await journal.read(account);
    return draft?.status === "pending" ? draft.request : null;
  },
  getActiveAccount: () => selectedNativeAccount,
});

// Run after the explicit review has saved the request, or to restore its UI.
// This reads storage only. It never automatically opens the Wallet.
const target = await launcher.prepare();
if (target.status === "ready") {
  openButton.disabled = false;
  downloadLink.href = target.downloadURL;
  openButton.onclick = event => {
    try { launcher.open(event, target.requestDigest); }
    catch (error) { showActionError(error); }
  };
} else {
  openButton.disabled = true;
  openButton.onclick = null;
}

// DEX already verifies AND consumes callbacks atomically in its journal. Use it
// directly, including for exact repeated returns after the request has expired.
const result = await journal.acceptReturn(selectedNativeAccount, location.href);
// Only now remove the callback query and show a separate explicit Submit step.
// An approved Wallet result is still not chain admission or a completed swap.
```

The synchronous `open` method requires a trusted, unmodified primary click and
active browser user activation while the native MouseEvent is being dispatched.
React consumers pass `event.nativeEvent` synchronously, never the synthetic
wrapper or an event saved for later. Pass the digest of the request displayed
in the current review; a later preparation cannot silently change that intent.
It rechecks the current registered Web origin, selected native account and
request expiry, then dispatches the canonical
`ynxwallet://application-action` URI with `Location.assign`. A fulfilled call
means only `launch-attempted`, with `installation: unknown`. No popup, iframe,
visibility timer, blur event, or injected EVM provider is installation proof.
Expose the official download link when the user cannot open the Wallet, while
retaining the original request. Do not automatically fall back or re-sign it.

Call `invalidate()` immediately on journal changes (including cross-tab
notifications), selected account/network changes, lock, disconnect, or abandoned
review. It cancels outstanding journal reads and prepared launch UI without
deleting durable state. Page hiding does the same automatically. Call
`dispose()` when unmounting. On return, the launcher reloads the current durable
request in its optional `handleReturn` helper and verifies a first, still-live
return. This helper does not persist or consume the result. DEX must not use it
as a gate before `journal.acceptReturn`: the journal correctly handles already
consumed identical results after expiry while rejecting expired first returns.
Bind journal commit notifications (including cross-tab broadcasts) to
`invalidate`; approved/rejected records must never be returned by the launch
request reader. The product retains responsibility for atomic journal writes,
multi-tab ownership, signature-result persistence and explicit chain submission.

The launcher does not establish an installed Wallet version or a successful
four-action device round trip. Those require the actual installed handler and
user-approved platform tests; source and browser transport tests alone cannot
close them.

### Explicit SDK import

Use `import { createApplicationActionLauncher } from "@ynx-chain/wallet-auth/application-action-launcher"`
for the Web action transport. The same function and the `ApplicationActionLauncher` /
`ApplicationActionLaunchTarget` types are also exported by the SDK root. The dedicated
browser consumer bundle is `application-action-launcher.mjs`; it is separate from
`product-session-browser.mjs` and does not change the private sign-in lifecycle.

Importing either SDK entry does not navigate. Call `prepare()` to read the committed
request, render its `requestDigest`, then call `open(event.nativeEvent, requestDigest)`
synchronously from the React click handler. Preserve the product journal's existing
atomic `acceptReturn` path; `handleReturn` is not a replacement or an additional gate.
