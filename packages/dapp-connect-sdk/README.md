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

`validateEndpointManifest` is deliberately only an interface until Integration
accepts and signs the public endpoint manifest. A caller must supply a signature
verifier, and invalid/expired/loopback/wrong-chain manifests cannot activate.

## Migration and artwork gates

Run `npm run scan:migration -- <product-path>` to flag release hazards such as
loopback endpoints, generic Device Proof messaging and local session fallback.
Run `npm run validate:artwork -- artwork.json` to check that each installable
product declares an independent vector, icon, splash, download cover and real
screenshots. This validates metadata only; it is not public release proof.
