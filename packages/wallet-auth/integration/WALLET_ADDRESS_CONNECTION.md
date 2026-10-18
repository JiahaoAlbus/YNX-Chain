# Normal first-party Wallet address connection

The public browser entry is `@ynx-chain/wallet-auth/walletconnect-dapp-connection`.

```js
import {createWalletAddressConnection} from '@ynx-chain/wallet-auth/walletconnect-dapp-connection';
const connection = createWalletAddressConnection();
connection.on('stage', event => showStage(event.stage));
connection.on('cancelUnconfirmed', event => preserveUnconfirmedCancellation(event));
const provider = await connection.connect({onURI: uri => showPairingURI(uri)});
const accounts = await provider.request({method: 'eth_accounts'});
const chainId = await provider.request({method: 'eth_chainId'});
// On explicit user cancellation: await connection.cancel();
// On explicit session disconnect: await connection.disconnect();
```

This reuses the existing SignClient, fixed project ID, per-origin storage,
single-flight, deadlines, cancellation and late-session retirement. No new
provider engine, relay transport, key store or authentication authority is
introduced. The factory fixes the exact origin `https://wallet.ynxweb4.com`,
chain `eip155:6423`, and remote methods `[]`. The session must contain precisely
one approved Testnet account and no remote methods. Account/chain reads
(`eth_accounts`, `eth_requestAccounts`, `eth_chainId`) are local reads of that
current approved session. They never create an approval or send RPC.

The URI must be shown for explicit Wallet pairing and normal session approval.
Before approval or after expiry/revocation/context loss, reads refuse. Restore
uses only the original encrypted SignClient session store, requires the same
strict session shape, and refuses ambiguous multiple sessions. Account and
chain events invalidate mismatched context. A late cancelled approval is
retired through the original client. Cleanup failure remains unconfirmed;
consumers must preserve that state and must not claim remote cancellation.
The existing provider `on`/`removeListener` APIs carry session events; the
connection also provides stage and cleanup events.

The factory accepts only `deadlineMs`, `now` and the existing `clientFactory`
test seam. Do not supply an alternate factory in normal product code. Origin,
methods, project ID and identity permissions cannot be overridden. Existing
other-origin method policies are unchanged. An address connection is not a
ProductSession, central sign-in, signature, transfer, Native admission or
permission to restore private Auth grants. All remote requests are refused.

Focused controls run through the existing `npm test` glob and original
`test:owned-interfaces` CI entry. Stand-in clients prove protocol/lifecycle
behavior only; actual relay pairing, installation and normal UI acceptance
remain separate gates for original App/GUI owners.
