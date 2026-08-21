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
  for(const marker of ['launchWebAuthorization','@ynx-chain/wallet-auth/src/authorize-launcher.js','eth_requestAccounts','eth_chainId','YNX_CHAIN_HEX'])assert.ok(webWallet.includes(marker),marker);
  for(const forbidden of ['ynxwallet:','iframe','window.open','location.assign','location.href='])assert.equal(webWallet.includes(forbidden),false,forbidden);
  assert.ok(webVerifier.includes('EIP-6963/EIP-1193 provider-only'));
  assert.ok(html.includes('wallet-options'));
  assert.ok(html.includes('Download YNX Wallet'));
  assert.ok(html.includes('Use MetaMask'));
});
