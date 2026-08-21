import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const html=await readFile(new URL('web/index.html',base),'utf8');
const js=await readFile(new URL('web/app.js',base),'utf8');
const css=await readFile(new URL('web/styles.css',base),'utf8');
const wallet=await readFile(new URL('mobile/src/wallet.ts',base),'utf8');
const manifest=await readFile(new URL('mobile/contract/public-endpoint-manifest.json',base),'utf8');
const webWallet=await readFile(new URL('web/wallet-connect-entry.js',base),'utf8');
const webVerifier=await readFile(new URL('web/verify-wallet-connect.mjs',base),'utf8');
const {createStandardWalletConnectState,reduceStandardWalletConnectState,STANDARD_WALLET_RPC_PROBE,STANDARD_WALLET_RPC_PROBE_TRANSPORT}=await import(new URL('../web/node_modules/@ynx-chain/wallet-auth/src/standard-wallet-connect-state.js',import.meta.url));

test('product states its non-bank and non-custodial boundary',()=>{
  for(const phrase of ['No custody','bank account','No fiat conversion inferred','Finance cannot freeze assets']) assert.ok(html.includes(phrase),phrase);
  assert.ok(js.includes('This is not a bank statement'));
  for(const disclosure of ['Counterparty','Custody','Contract','Principal-loss risk','Fee','Liquidity risk','Jurisdiction risk','Signature boundary']) assert.ok(html.includes(disclosure),disclosure);
  for(const prohibited of ['APY 8%','Guaranteed return','Visa card balance']) assert.equal(html.includes(prohibited),false);
});

test('wallet preserves Standard Wallet and consumes the accepted Product Session root and canonical authorization builder',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','@ynx-chain/wallet-auth','createProductWalletConnection','PRODUCT_SESSION_UNAVAILABLE','WALLET_NOT_FOUND']) assert.ok(wallet.includes(marker),marker);
  for(const required of ['encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY']) assert.ok(wallet.includes(required),required);
  for(const prohibited of ['createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','gatewayEndpoint','deviceSecret']) assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.equal(/Linking\.openURL\(\s*['"`]ynxwallet:\/\/authorize/.test(wallet),false);
  assert.ok(js.includes('API_UNAVAILABLE'));
  assert.equal(js.includes('Bearer '),false,'legacy browser bearer session must be absent');
  assert.ok(manifest.includes('1.0.0-p0.2'));
  assert.ok(manifest.includes('"finance":{"status":"PENDING"'));
});

test('responsive and accessibility contracts exist',()=>{
  assert.ok(html.includes('class="skip"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(css.includes('@media(max-width:720px)'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes('#002FA7'));
});

test('Web Wallet connection consumes the v2 provider-only launcher without custom-scheme navigation',()=>{
  for(const marker of ['launchWebAuthorization','@ynx-chain/wallet-auth/src/authorize-launcher.js','standard-wallet-connect-state.js','createStandardWalletConnectState','reduceStandardWalletConnectState','eth_accounts','eth_requestAccounts','eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain','YNX_CHAIN_HEX'])assert.ok(webWallet.includes(marker),marker);
  for(const forbidden of ['ynxwallet:','iframe','window.open','location.assign','location.href='])assert.equal(webWallet.includes(forbidden),false,forbidden);
  assert.equal(/fetch\s*\(\s*[`'"]https:\/\/rpc\.ynxweb4\.com\/evm/.test(webWallet),false,'direct browser RPC probing cannot gate provider connection');
  assert.ok(webVerifier.includes('EIP-6963/EIP-1193 provider-only'));
  assert.ok(html.includes('wallet-options'));
  assert.ok(html.includes('Download YNX Wallet'));
  assert.ok(html.includes('Use MetaMask'));
});

test('shared provider connection state keeps a selected approved 0x1917 Wallet connected when an accepted RPC probe degrades',()=>{
  const account='0x1234567890abcdef1234567890abcdef12345678';
  let value=createStandardWalletConnectState();
  value=reduceStandardWalletConnectState(value,{type:'BEGIN',pendingIntent:'financeconnectintent_20260821'});
  value=reduceStandardWalletConnectState(value,{type:'PROVIDER_SELECTED',providerKind:'metamask'});
  value=reduceStandardWalletConnectState(value,{type:'ACCOUNT_APPROVED',account});
  value=reduceStandardWalletConnectState(value,{type:'CHAIN_CONFIRMED',chainId:'0x1917'});
  assert.equal(value.status,'connected');
  assert.equal(value.chooserOpen,false);
  assert.equal(value.pendingIntent,null);
  assert.throws(()=>reduceStandardWalletConnectState(value,{type:'RPC_PROBE_DEGRADED',probeTransport:'direct-browser-rpc-fetch',code:'RPC_UNAVAILABLE'}),{code:'UNSAFE_BROWSER_RPC_PROBE'});
  value=reduceStandardWalletConnectState(value,{type:'RPC_PROBE_DEGRADED',probeTransport:STANDARD_WALLET_RPC_PROBE_TRANSPORT,code:'RPC_UNAVAILABLE'});
  assert.equal(value.status,'connected');
  assert.equal(value.account,account);
  assert.equal(value.chainId,'0x1917');
  assert.equal(value.rpcProbe,STANDARD_WALLET_RPC_PROBE.DEGRADED);
  assert.equal(value.chooserOpen,false);
});
