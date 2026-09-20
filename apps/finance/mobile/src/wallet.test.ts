import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
const completion=readFileSync(new URL('./wallet-completion.ts',import.meta.url),'utf8');
test('mobile delegates approval and device proof to the current package root and fails closed on endpoint authority',()=>{
  for(const api of ['encodeRequestDeepLink'])assert.ok(wallet.includes(api),api);
  for(const api of ['parseCallbackURL','parseCentralWalletSession','requestDigest','signGatewayChallenge','verifyAuthorization','verifyGatewayCompletion'])assert.ok(completion.includes(api),api);
  assert.ok(wallet.includes("from '@ynx-chain/wallet-auth'"));
  assert.ok(wallet.includes('assertFinanceConsumerContract'));
  assert.ok(wallet.includes("String(manifest.walletGateway)+'/v1/wallet/sessions/complete'"));
  assert.equal(wallet.includes('EXPO_PUBLIC_YNX_FINANCE_WALLET_GATEWAY_URL'),false);
  assert.equal(wallet.includes('@ynx/dapp-connect-sdk'),false);
  assert.equal(wallet.includes('FinanceSecureDevice'),false);
  assert.equal(wallet.includes('function canonical'),false);
  assert.equal(completion.includes('local session'),true,'failure copy must state that no local session is created');
});
