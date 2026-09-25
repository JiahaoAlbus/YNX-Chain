import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const source=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const wallet=source('src/wallet.ts');
const api=source('src/api.ts');
const manifest=source('contract/public-endpoint-manifest.json');

test('Exchange separates Standard Wallet from the accepted v2 root factory and canonical authorization',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','discoverEIP6963','connectMetaMaskWallet','WALLET_NOT_FOUND','CONNECTION_REVOKED','ensureYNXTestnet','createProductWalletConnection','PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN','exchangeProductSessionRegistry','PRIVATE_SERVICE_DEGRADED','encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY'])assert.ok(wallet.includes(marker),marker);
  for(const prohibited of ['createGatewayChallenge','createProductSessionProof','sessions/complete','sessions/introspect','wallet-auth.ynxweb4.com/v2','callback:capabilities','endpoint:'])assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.equal(/(?:Linking\.)?openURL\(\s*['"`]ynxwallet:\/\/authorize/.test(wallet),false,'a naked Wallet authorization route must never be opened');
  assert.ok(wallet.includes('standard wallet connection remains available'));
});

test('Exchange source-pins the accepted Product Session v3 factory without asserting migration',()=>{
  const registry=source('src/product-session-registry.ts');
  for(const marker of ['46386ae8eeaa7633923ae762a5a9634b5eac98d9','schemaVersion:3','productId:\'exchange\'','ynxexchange://wallet-auth/callback','https://exchange.ynxweb4.com'])assert.ok(registry.includes(marker),marker);
  assert.ok(wallet.includes("'exchange'"));
  assert.equal(wallet.includes('migrated-v2=true'),false);
});

test('Exchange bundles the accepted endpoint contract and keeps its product API pending',()=>{
  for(const marker of ['1.0.0-p0.2','3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5','fa0ffd9bbbcc831438078be8e19cebff51b07e5e','"exchange":{"status":"PENDING"'])assert.ok(manifest.includes(marker),marker);
  assert.ok(wallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(api.includes('API_UNAVAILABLE: Exchange product API is PENDING'));
  assert.equal(api.includes('https://exchange.ynxweb4.com'),false);
  assert.equal(api.includes('EXPO_PUBLIC_YNX_EXCHANGE'),false);
});
