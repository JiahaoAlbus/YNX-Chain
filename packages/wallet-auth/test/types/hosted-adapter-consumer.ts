import {createHostedWalletAdapter,type HostedWalletAdapter} from '@ynx-chain/wallet-auth/hosted-adapter';
import {ProductSessionControlNodeHost} from '../../src/product-session-control-node-host.js';
const adapter:HostedWalletAdapter=createHostedWalletAdapter({window,walletOrigin:'https://wallet.ynxweb4.com'});
const connected:boolean=adapter.connected;const result:Promise<unknown>=adapter.request({method:'eth_chainId'});void result;void connected;
const supports:true=ProductSessionControlNodeHost.businessRevalidationSupported;void supports;
// @ts-expect-error Hosted is a Web-only adapter with exact Wallet origin.
createHostedWalletAdapter({walletOrigin:'https://evil.test'});
