import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const source=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const wallet=source('src/wallet.ts');
const api=source('src/api.ts');
const manifest=source('contract/public-endpoint-manifest.json');

test('Exchange separates Standard Wallet from the accepted v2 root factory',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','WALLET_NOT_FOUND','CONNECTION_REVOKED','ensureYNXTestnet','createProductWalletConnection','PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN','exchangeProductSessionRegistry','PRIVATE_SERVICE_DEGRADED'])assert.ok(wallet.includes(marker),marker);
  for(const prohibited of ['createGatewayChallenge','createProductSessionProof','sessions/complete','sessions/introspect','wallet-auth.ynxweb4.com/v2','callback:capabilities','endpoint:'])assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.ok(wallet.includes('standard wallet connection remains available'));
});

test('Exchange source-pins the accepted Product Session v2 factory without asserting migration',()=>{
  const registry=source('src/product-session-registry.ts');
  for(const marker of ['203be5e108be468350591615a64d5d36ab87a8f1','productId:\'exchange\'','ynxexchange://wallet-auth/callback','https://exchange.ynxweb4.com'])assert.ok(registry.includes(marker),marker);
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
