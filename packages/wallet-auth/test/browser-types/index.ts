import * as WalletAuth from '../../src/index.js';
void WalletAuth;
// Browser entry must not bring Node globals into a DOM-only consumer.
// @ts-expect-error Node-only Buffer must not enter the browser root.
Buffer;
// @ts-expect-error Node-only process must not enter the browser root.
process;

// Public normal address-only entry remains browser-only and fixes its scope.
import {createWalletAddressConnection, type WalletConnectProvider} from '@ynx-chain/wallet-auth/walletconnect-dapp-connection';
const addressConnection=createWalletAddressConnection({deadlineMs:30000});
addressConnection.connect({onURI(uri){const pairing:string=uri;void pairing;}}).then(async provider=>{
 const accounts:string[]=await provider.request({method:'eth_accounts'});
 const chain:'0x1917'=await provider.request({method:'eth_chainId'});
 const typed:WalletConnectProvider=provider;void accounts;void chain;void typed;
});
// @ts-expect-error Normal factory never accepts another origin.
createWalletAddressConnection({origin:'https://social.ynxweb4.com'});
// @ts-expect-error Normal factory never accepts any remote method grant.
createWalletAddressConnection({methods:['personal_sign']});
