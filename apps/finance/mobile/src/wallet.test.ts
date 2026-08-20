import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../contract/public-endpoint-manifest.json',import.meta.url),'utf8');

test('mobile consumes the accepted standard wallet SDK and never creates a device proof',()=>{
  assert.ok(wallet.includes("@ynx/dapp-connect-sdk"));
  assert.ok(wallet.includes('StandardWalletConnection'));
  for(const prohibited of ['p256','createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','encodeRequestDeepLink','SecureStore'])assert.equal(wallet.includes(prohibited),false,prohibited);
});

test('mobile bundles the accepted endpoint contract and fails closed for a pending Finance API',()=>{
  for(const marker of ['1.0.0-p0.2','3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5','fa0ffd9bbbcc831438078be8e19cebff51b07e5e','"finance":{"status":"PENDING"','"appGateway": {"status":"UNAVAILABLE"'])assert.ok(manifest.includes(marker),marker);
  assert.ok(wallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(wallet.includes('WALLET_NOT_FOUND'));
});
