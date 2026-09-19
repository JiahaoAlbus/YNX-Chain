import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wallet=readFileSync(new URL('./wallet.ts',import.meta.url),'utf8');
test('mobile delegates parsing, verification and device proof to canonical Wallet Auth',()=>{
  for(const api of ['encodeRequestDeepLink','parseCallbackURL','requestDigest','signGatewayChallenge','verifyAuthorization'])assert.ok(wallet.includes(api),api);
  assert.equal(wallet.includes('function canonical'),false);
  assert.equal(wallet.includes('local session'),true,'failure copy must state that no local session is created');
});
