# Standard Wallet connection lifecycle

Use `@ynx-chain/wallet-auth/standard-wallet-connection` and
`@ynx-chain/wallet-auth/wallet-provider-discovery` for a DApp's standard EVM
connection. This path works independently of Product Session registration and
Gateway availability. It neither creates a private product session nor proves
ownership to a product server. YNX Wallet itself retains its independent YNX
identity; a DApp may separately offer an explicit MetaMask EVM option.

```js
import { StandardWalletConnection } from "@ynx-chain/wallet-auth/standard-wallet-connection";
import { discoverWalletProviders } from "@ynx-chain/wallet-auth/wallet-provider-discovery";

const discovery = await discoverWalletProviders(window, 160);
// Obtain selectedKind from an explicit chooser, or the user's saved choice.
// Never fall back from one wallet to another when restoring that choice.
const candidate = selectedKind === "ynx-wallet" ? discovery.ynx
  : selectedKind === "metamask" ? discovery.metamask : null;
if (!candidate) throw new Error("Selected wallet is missing or ambiguous");
const wallet = new StandardWalletConnection({
  provider: candidate.provider,
  origin: location.origin,
  metadata: { name: "Your product", url: location.origin },
});
const unsubscribe = wallet.subscribe(({ event, value }) => {
  // Re-read wallet.current; events can clear it or change its account/network.
  renderConnection(wallet.current, { event, value });
});
const restored = await wallet.restore(); // eth_accounts, then eth_chainId
// null means no exposed account. This call never requests accounts or a switch.
renderConnection(restored);

// Only in the user's Connect button handler:
const approved = await wallet.connect();
// Require selectedChain === "0x1917" for YNX Testnet (decimal 6423).
// A different chain remains a wrong-network UI, not a fabricated successful switch.

// Only in the user's Revoke button handler:
const outcome = await wallet.revoke();
renderRevocation(outcome);

// Local disconnect, e.g. switching to another explicitly selected wallet:
wallet.disconnect();
unsubscribe();
```

Treat the example as separate UI handlers, not an automatic sequence. Subscribe
before establishing a connection. A provider announcement is an unverified
candidate, not an authenticated installation identity. Store only the selected
wallet kind for refresh; never restore authority from a persisted address alone.

`restore()` returns the current account/network snapshot or `null`. Invalid
responses, provider errors, and attempts superseded by a later connect/restore/
disconnect reject with `Eip1193ProviderError`. It does not silently switch chains,
choose another provider, approve permissions, or restore a Product Session.
Both connect and restore use the provider passed to the constructor.

`revoke()` returns `{status, permissionRevoked, locallyDisconnected, error?}`.
Its statuses are `revoked`, `unsupported`, `rejected`, `failed`, or `superseded`.
Only acknowledged `wallet_revokePermissions([{eth_accounts:{}}])` followed by
an empty `eth_accounts` readback confirms `permissionRevoked: true`. False means
unconfirmed, not proof that the remote permission remains. Error outcomes do
not manufacture successful logout; actual provider events may independently
clear the local snapshot. A later explicit connection intent supersedes an old
revocation completion. Concurrent calls for the same intent share one request.
JSON-RPC method-not-found becomes unsupported (4200); user rejection remains
4001. Local `disconnect()` sends no RPC and does not revoke remote permissions,
on-chain token allowances, private Product Sessions, or device grants.

On `accountsChanged`, rebind all account-specific reads and discard pending
results for the previous account. Empty accounts clear the local session. On
`chainChanged`, recheck 6423 before chain operations. On `disconnect`, clear
dependent UI. In addition to the SDK's internal attempt fencing, the DApp must
fence its own asynchronous balance/API/render requests when replacing a
connection object. No completion from an old object may replace the newly
selected wallet in the product UI.

`STANDARD_WALLET_METHODS` and the legacy session `approvedMethods` field describe
transport methods, not evidence that every method or transaction was approved.
Signing and sending remain separate provider requests with their own approval
and capability checks. A standard account is not a private service session,
native DEX action approval, Card application approval, or payment receipt.

For apps that bundle only the standard browser path, these local source files
form the entry closure. Use all files from one immutable commit:

- `src/standard-wallet-connection.js`
- `src/canonical.js` (its only local import; imports `@noble/hashes`)
- `src/wallet-provider-discovery.js` (standalone)

These three raw files are not a standalone browser bundle: `canonical.js`
imports `@noble/hashes/sha2.js` and `@noble/hashes/utils.js` at the package's
locked version. Resolve those dependencies with the product bundler, or use the
Wallet-delivered standalone ESM bundle and its dependency metafile. Do not copy
three files into public assets while leaving unresolved bare imports.

The root package export additionally loads cryptographic/private-session
modules; use the narrow subpaths for a plain browser standard-connection client.
Use the full package and `browser-product-session-v2.md` separately for private
product sessions, matching the Gateway's actual registry and HTTPS authority.
