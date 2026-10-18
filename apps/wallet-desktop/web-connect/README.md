# Existing Wallet first-party address connection

Normal publication target: `https://wallet.ynxweb4.com/connect/`. This is a
Wallet connection page, not a new product, identity issuer or signing service.
The original A alone builds and publishes it through the existing Wallet site.

The original SDK must formally supply its public
`@ynx-chain/wallet-auth/walletconnect-dapp-connection` subpath with
`createWalletAddressConnection()`. That factory fixes the official Wallet
origin, chain 6423 and empty required RPC method list. Its existing official
SignClient generates the real pairing URI. SDK 3.8 does not yet supply this
address-only public ABI and has a separately discovered clean-client dynamic
dependency import failure; do not bundle around it or hot-edit that package.
Consume the fixed formal SDK successor and its dependency closure first.

The SDK's declared local development tool is esbuild 0.25.9. After the original
build owner selects and installs that exact closure, the normal asset build is:

```sh
node apps/wallet-desktop/scripts/build-wallet-connection-page.mjs /absolute/new-output-directory
```

The output directory must not exist. The build preserves any partial failure
and never installs packages, falls back to an ambient compiler, copies SDK
internal modules, or contacts a Relay. Publish only the three built assets to
the existing route; preserve the existing site's other assets and delivery
records. `BUILD_RECEIPT.json` records their exact hashes and selected inputs.
Built assets are not deployed or connected evidence.

Normal use requires an explicit Connect click, real protocol-generated QR or
Open Wallet link, and explicit account permission review in the actual Wallet.
The page reads only the approved local session address and chain. It exposes
no provider request API, sign-in request, transaction or token operation.
Cancel removes the URI/link immediately and waits for the original work to
drain. Late results cannot be adopted. Disconnect is explicit; unknown remote
cleanup disables new attempts rather than silently replaying a write. Closing
the browser does not establish remote disconnection. No page state/URI/topic
or session is copied to another storage system.

Targeted tests are in the existing Desktop `npm test` wildcard entry:
`test/walletconnect-address-consumer.test.mjs` and
`test/walletconnect-address-page.test.mjs`. They use explicit public controlled
transport/DOM inputs. They do not establish a real Relay, QR proposal,
permission grant, deployment or installed App acceptance. After formal SDK
matching and normal publication, verify those through the actual page and
matching installed Wallet, separately from these controlled tests.
