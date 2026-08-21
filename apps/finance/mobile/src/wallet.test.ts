import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../contract/public-endpoint-manifest.json',import.meta.url),'utf8');
const walletAuth=readFileSync(new URL('../node_modules/@ynx-chain/wallet-auth/src/product-wallet-connection.js',import.meta.url),'utf8');

test('mobile preserves Standard Wallet and uses the accepted canonical authorization builder',()=>{
  assert.ok(wallet.includes("@ynx/dapp-connect-sdk"));
  assert.ok(wallet.includes('StandardWalletConnection'));
  for(const required of ["@ynx-chain/wallet-auth",'createProductWalletConnection','FinanceSecureDevice','PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN','PRIVATE_SERVICE_DEGRADED'])assert.ok(wallet.includes(required),required);
  assert.ok(walletAuth.includes('https://wallet-auth.ynxweb4.com'));
  for(const required of ['encodeRequestDeepLink','parseAuthorizationCallbackURL','CANONICAL_AUTHORIZATION_PENDING_KEY','restoreFinanceWalletAuthorization'])assert.ok(wallet.includes(required),required);
  for(const prohibited of ['createGatewayChallenge','signGatewayChallenge','createProductSessionProof','sessions/complete','gatewayEndpoint','https://rest.ynxweb4.com'])assert.equal(wallet.includes(prohibited),false,prohibited);
  assert.equal(/Linking\.openURL\(\s*['"`]ynxwallet:\/\/authorize/.test(wallet),false,'a naked Wallet authorization route must never be opened');
  assert.equal(wallet.includes('deviceSecret'),false,'a product-device private key must not enter Finance JavaScript');
});

test('mobile bundles the accepted endpoint contract and fails closed for a pending Finance API',()=>{
  for(const marker of ['1.0.0-p0.2','3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5','fa0ffd9bbbcc831438078be8e19cebff51b07e5e','"finance":{"status":"PENDING"','"appGateway": {"status":"UNAVAILABLE"'])assert.ok(manifest.includes(marker),marker);
  assert.ok(wallet.includes('PRODUCT_SESSION_UNAVAILABLE'));
  assert.ok(wallet.includes('WALLET_NOT_FOUND'));
});
