import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {paymentIntent,paymentIntentDigest} from './walletAuth';
import {assertPayConsumerContract} from './endpoint-manifest';

test('Pay keeps payment quotes preview-bound while its product endpoint is pending',()=>{
  const intent=paymentIntent({requestId:'payment_request_abcdefghijklmnop',sessionBinding:'a'.repeat(64),invoiceId:'inv_'+'a'.repeat(20),centralInvoiceId:'abcdef0123456789abcdef01',merchantId:'mrc_'+'b'.repeat(20),merchantName:'Merchant',payoutAddress:'ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',amount:12,asset:'YNXT',fee:1,total:13,quoteIssuedAt:'2026-08-21T00:00:00.000Z',quoteExpiresAt:'2026-08-21T00:03:00.000Z',invoiceSignature:'c'.repeat(128)});
  assert.match(paymentIntentDigest(intent),/^[a-f0-9]{64}$/);
  const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
  assert.match(wallet,/productSessionUnavailable/);
  assert.match(wallet,/launchNativeAuthorization/);
  assert.match(wallet,/parseAuthorizationCallbackURL/);
  assert.match(wallet,/connectMetaMaskWallet/);
  assert.match(wallet,/PRIVATE_SERVICE_DEGRADED/);
  assert.doesNotMatch(wallet,/createGatewayChallenge|signGatewayChallenge|createProductSessionProof/);
  assert.doesNotMatch(wallet,/(?:Linking\.)?openURL\(\s*['"`]ynxwallet:\/\/authorize/);
});

test('Pay consumes the accepted bundled manifest and leaves its product endpoint unactivated',()=>{
  const manifest=assertPayConsumerContract();
  assert.equal(manifest.endpointStates.products.pay.status,'PENDING');
  assert.equal(manifest.integrity.payloadSha256,'3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5');
});
