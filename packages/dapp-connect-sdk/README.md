# YNX DApp Connect SDK — P0 Candidate

This package is a **consumer** of the accepted P0 Wallet Protocol, not a new
wallet, identity product, Gateway, or Product Session issuer. Its contract
reference is pinned in `integration/dapp-connect-sdk-candidate.json`.

## Connection model

`StandardWalletConnection` consumes a normal EIP-1193 provider. A first-party
YNX DApp may therefore connect YNX Wallet, MetaMask, or another approved EVM
wallet. An external EVM DApp may discover and use YNX Wallet via EIP-6963 or
WalletConnect without registering as a YNX Product. External applications only
receive the user-approved `0x…` EVM account; they never receive `ynx1…`.

```js
import {StandardWalletConnection} from "@ynx/dapp-connect-sdk";
const wallet = new StandardWalletConnection(window.ethereum);
const {account} = await wallet.connect();
```

Use `enhanceWithProductSession` only after a standard connection exists, and
only for private first-party routes. It returns `PRIVATE_SERVICE_DEGRADED` on a
Gateway/Product Session failure while retaining the standard wallet connection.
It never creates a local fallback session.

## Endpoint manifests

`validateEndpointManifest` requires a protected remote-signature verifier. For
the separately accepted bundled consumer contract, `loadBundledManifest`
instead verifies Integration's canonical SHA-256 payload, expiry, chain identity
and public HTTPS locations. A remote replacement still needs a protected
signature verifier; invalid, expired, loopback, wrong-chain, or hash-mismatched
manifests cannot activate.

## Migration and artwork gates

Run `npm run scan:migration -- <product-path>` to flag release hazards such as
loopback endpoints, generic Device Proof messaging and local session fallback.
Run `npm run validate:artwork -- artwork.json` to check that each installable
product declares an independent vector, icon, splash, download cover and real
screenshots. This validates metadata only; it is not public release proof.

## Unified consumer API and Compatibility Lab

`DAppConnectClient` is the one consumer API for discovery, normal wallet
connection, reconnect/disconnect, accounts, signing, transactions, wallet
permissions and assets, optional Product Session upgrade/revoke, endpoint
diagnostics, and platform-approved wallet opening. It never owns a private key.

`examples/index.mjs` includes nine executable recipes: plain EIP-1193,
WalletConnect, SIWE, first-party Product Session, external wallet to YNX,
YNX Wallet to an external EVM DApp, Faucet Deep Link, Gateway-down degradation,
and multi-wallet EIP-6963 selection. The Faucet example deliberately returns a
typed `FAUCET_DEEP_LINK_NOT_ACCEPTED` error until its separate deep-link
contract is accepted.

Run `npm run lab -- path/to/real-adapters.mjs` to execute the Compatibility Lab
against real adapters. A run without an adapter module reports explicit skips;
it never creates a simulated success. `npm run release:gate -- product-path manifest.json`
produces the migration scanner report and verifies an accepted bundled manifest
when one is supplied; remote-manifest replacement remains blocked without a
protected signer.
