import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {paymentIntent,paymentIntentDigest} from './walletAuth';
import {assertPayConsumerContract} from './endpoint-manifest';
import {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE,STANDARD_WALLET_RPC_PROBE_TRANSPORT} from '../node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js';
import * as routerCoordinator from '@ynx-chain/wallet-auth/wallet-connection-coordinator';

test('Pay keeps payment quotes preview-bound while its product endpoint is pending',()=>{
  const intent=paymentIntent({requestId:'payment_request_abcdefghijklmnop',sessionBinding:'a'.repeat(64),invoiceId:'inv_'+'a'.repeat(20),centralInvoiceId:'abcdef0123456789abcdef01',merchantId:'mrc_'+'b'.repeat(20),merchantName:'Merchant',payoutAddress:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',amount:12,asset:'YNXT',fee:1,total:13,quoteIssuedAt:'2026-08-21T00:00:00.000Z',quoteExpiresAt:'2026-08-21T00:03:00.000Z',invoiceSignature:'c'.repeat(128)});
  assert.match(paymentIntentDigest(intent),/^[a-f0-9]{64}$/);
  const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
  assert.match(wallet,/productSessionUnavailable/);
  assert.match(wallet,/launchCanonicalAuthorization/);
  assert.match(wallet,/parseAuthorizationCallbackURL/);
  assert.match(wallet,/connectMetaMaskWallet/);
  assert.match(wallet,/discoverPayWalletProviders/);
  assert.match(wallet,/\[0,250,750,1500\]/);
  assert.match(wallet,/ethereum#initialized/);
  assert.match(wallet,/wallet_revokePermissions/);
  assert.match(wallet,/wallet_requestPermissions/);
  assert.match(wallet,/ACCOUNTS_CHANGED/);
  assert.match(wallet,/CHAIN_CHANGED/);
  assert.match(wallet,/PROVIDER_DISCONNECT/);
  assert.match(wallet,/isYNXWallet/);
  assert.match(wallet,/PRIVATE_SERVICE_DEGRADED/);
  assert.doesNotMatch(wallet,/createGatewayChallenge|signGatewayChallenge|createProductSessionProof/);
  assert.doesNotMatch(wallet,/(?:Linking\.)?openURL\(\s*['"`]ynxwallet:\/\/authorize/);
  assert.doesNotMatch(wallet,/(?:window\.open|<iframe|document\.location\s*=|location\.href\s*=).*ynxwallet:\/\/authorize/);
});

test('Pay renders distinct YNX Wallet and MetaMask connection details without browser launchers',()=>{
  const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  assert.match(app,/MetaMask fox logo/);
  assert.match(app,/YNX Wallet logo/);
  assert.match(app,/walletUICopy\[locale\]/);
  assert.match(app,/walletText\.detailsTitle/);
  assert.match(app,/walletText\.switchAccount/);
  assert.match(app,/walletText\.disconnect/);
  assert.doesNotMatch(app,/window\.open|ynxwallet:\/\/authorize/);
});

test('Pay consumes the accepted bundled manifest and leaves its product endpoint unactivated',()=>{
  const manifest=assertPayConsumerContract();
  assert.equal(manifest.endpointStates.products.pay.status,'PENDING');
  assert.equal(manifest.integrity.payloadSha256,'3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5');
});

test('accepted RPC probe degradation preserves a completed Pay Standard Wallet state',()=>{
  const account='0x1234567890abcdef1234567890abcdef12345678';let state=createStandardWalletConnectState();
  state=reduceStandardWalletConnectState(state,{type:'BEGIN',pendingIntent:'payconnectintent_20260821'});state=reduceStandardWalletConnectState(state,{type:'PROVIDER_SELECTED',providerKind:'metamask'});state=reduceStandardWalletConnectState(state,{type:'ACCOUNT_APPROVED',account});state=reduceStandardWalletConnectState(state,{type:'CHAIN_CONFIRMED',chainId:'0x1917'});
  assert.throws(()=>reduceStandardWalletConnectState(state,{type:'RPC_PROBE_DEGRADED',probeTransport:'direct-browser-rpc-fetch',code:'RPC_UNAVAILABLE'}),{code:'UNSAFE_BROWSER_RPC_PROBE'});
  state=reduceStandardWalletConnectState(state,{type:'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,code:'RPC_UNAVAILABLE'});
  assert.equal(state.status,'connected');assert.equal(state.rpcProbe,STANDARD_WALLET_RPC_PROBE.DEGRADED);assert.equal(state.account,account);assert.equal(state.chooserOpen,false);assert.equal(state.pendingIntent,null);
});

test('Pay rejects legacy chain configuration and pins the canonical YNX network',()=>{
  const manifest=assertPayConsumerContract();
  assert.equal(manifest.cosmosChainId,'ynx_6423-1');
  assert.equal(manifest.evmChainId,6423);
  assert.equal(manifest.evmChainHex,'0x1917');
  const runtime=[readFileSync(new URL('./wallet.ts',import.meta.url),'utf8'),readFileSync(new URL('./endpoint-manifest.ts',import.meta.url),'utf8'),readFileSync(new URL('./contract/public-endpoint-manifest.json',import.meta.url),'utf8')].join('\n');
  assert.doesNotMatch(runtime,/0x238e|ynx_9102|chainId\s*[:=]\s*9102/);
});

test('Pay Standard Wallet details, account switch, and disconnect remain reducer-bound',()=>{
  const first='0x1234567890abcdef1234567890abcdef12345678';const second='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';let state=createStandardWalletConnectState();
  state=reduceStandardWalletConnectState(state,{type:'BEGIN',pendingIntent:'paydetailsintent_20260831'});state=reduceStandardWalletConnectState(state,{type:'PROVIDER_SELECTED',providerKind:'ynx-wallet'});state=reduceStandardWalletConnectState(state,{type:'ACCOUNT_APPROVED',account:first});state=reduceStandardWalletConnectState(state,{type:'CHAIN_CONFIRMED',chainId:'0x1917'});
  state=reduceStandardWalletConnectState(state,{type:'OPEN_CHOOSER'});
  assert.equal(state.chooserMode,'connection-details');assert.deepEqual(state.chooserActions,['disconnect','switch-account','close']);
  state=reduceStandardWalletConnectState(state,{type:'DISCONNECT'});
  assert.equal(state.status,'disconnected');assert.equal(state.disconnectReason,'user-disconnect');
  state=reduceStandardWalletConnectState(state,{type:'RESTORE',providerKind:'metamask',accounts:[first],chainId:'0x1917'});state=reduceStandardWalletConnectState(state,{type:'ACCOUNTS_CHANGED',accounts:[second]});
  assert.equal(state.account,second);
  state=reduceStandardWalletConnectState(state,{type:'CHAIN_CHANGED',chainId:'0x1917'});
  assert.equal(state.status,'connected');assert.equal(state.providerKind,'metamask');
});

test('Pay consumes the public Router coordinator handoff without copying callback or opener logic',()=>{
  assert.equal(typeof routerCoordinator.WalletConnectionCoordinator,'function');
  assert.equal(routerCoordinator.WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED,'wallet-opened');
  const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
  assert.match(wallet,/@ynx-chain\/wallet-auth\/wallet-connection-coordinator/);
  assert.match(wallet,/23c21054d8c86f245b77bffb2d03cecd2b3f80cf/);
  assert.doesNotMatch(wallet,/wallet-connection-coordinator\.js/);
});

test('Pay provider discovery keeps each cold or second start free of stale providers',()=>{
  const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
  assert.doesNotMatch(wallet,/const discoveredProviders=/);
  assert.match(wallet,/const providers=new Map<EIP1193Provider,PayWalletProvider>\(\);/);
  assert.match(wallet,/rememberProvider\(providers,detail\.provider/);
  assert.match(wallet,/return \[\.\.\.providers\.values\(\)\]/);
});
