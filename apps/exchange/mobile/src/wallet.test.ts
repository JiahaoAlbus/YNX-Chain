import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const source=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8');
const wallet=source('src/wallet.ts');
const api=source('src/api.ts');
const manifest=source('contract/public-endpoint-manifest.json');

test('Exchange consumes the accepted standard Wallet SDK and classifies connection errors',()=>{
  for(const marker of ['@ynx/dapp-connect-sdk','StandardWalletConnection','WALLET_NOT_FOUND','CONNECTION_REVOKED','ensureYNXTestnet'])assert.ok(wallet.includes(marker),marker);
  for(const prohibited of ['createGatewayChallenge','createProductSessionProof','sessions/complete','sessions/introspect','p256','SecureStore','Linking.openURL'])assert.equal(wallet.includes(prohibited),false,prohibited);
});

test('Exchange bundles the accepted endpoint contract and keeps its product API pending',()=>{
  for(const marker of ['1.0.0-p0.2','3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5','fa0ffd9bbbcc831438078be8e19cebff51b07e5e','"exchange":{"status":"PENDING"'])assert.ok(manifest.includes(marker),marker);
  assert.ok(wallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(api.includes('API_UNAVAILABLE: Exchange product API is PENDING'));
  assert.equal(api.includes('https://exchange.ynxweb4.com'),false);
  assert.equal(api.includes('EXPO_PUBLIC_YNX_EXCHANGE'),false);
});
