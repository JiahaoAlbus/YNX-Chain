import {WALLETCONNECT_SESSION_METHODS} from '@ynx-chain/wallet-auth';
import {CENTRAL_BROWSER_RPC_METHOD,parseCentralBrowserSignInChallenge,centralBrowserConsentSignBytes,type CentralBrowserChallenge} from '@ynx-chain/wallet-auth/central-browser-session-contract';
import {createCentralBrowserSessionRegistry} from '@ynx-chain/wallet-auth/central-browser-session-registry';
type SessionMethod=typeof WALLETCONNECT_SESSION_METHODS[number];
const product:SessionMethod='ynx_requestProductSessionV2';
const central:SessionMethod=CENTRAL_BROWSER_RPC_METHOD;
// @ts-expect-error Approval methods remain an exact closed supported set.
const unsupported:SessionMethod='ynx_signEverything';
const registry=createCentralBrowserSessionRegistry({});
const challenge:CentralBrowserChallenge=parseCentralBrowserSignInChallenge({},registry,{peerOrigin:'https://wallet-auth.ynxweb4.com'});
const message:string=centralBrowserConsentSignBytes(challenge,'ynx1qa','02');
void [product,central,unsupported,message];
