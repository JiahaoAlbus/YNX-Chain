import test from 'node:test';
import assert from 'node:assert/strict';
import {p256} from '@noble/curves/nist.js';
import {createAuthorizationRejection,createCallbackURL,encodeRequestDeepLink,parseAuthorizationCallbackURL,parseWalletDeepLink,signAuthorization} from '@ynx-chain/wallet-auth';

const registry={
  'ynx-exchange-v1':{
    requestingProduct:'exchange',bundleId:'com.ynxweb4.exchange',callbacks:['ynxexchange://wallet-auth/callback'],
    scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],maxScopes:5,
  },
};

function request(now=new Date()){
  const secret='2'.padStart(64,'0'),productDeviceSecret=Uint8Array.from({length:32},()=>2);
  return {request:{version:'1' as const,nonce:'a'.repeat(64),chainId:'ynx_6423-1' as const,requestingProduct:'exchange',productClientId:'ynx-exchange-v1',bundleId:'com.ynxweb4.exchange',productDeviceAlgorithm:'p256-sha256' as const,productDeviceKey:Buffer.from(p256.getPublicKey(productDeviceSecret,true)).toString('base64url'),callback:'ynxexchange://wallet-auth/callback',scopes:['exchange:ai','exchange:deposit','exchange:read','exchange:trade','exchange:withdrawal-review'],purpose:'Authorize Exchange test only',issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+120_000).toISOString()},secret};
}

test('Exchange canonical authorization requires a package-built request payload',()=>{
  const now=new Date(),input=request(now),url=encodeRequestDeepLink(input.request);
  assert.match(url,/^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/);
  assert.equal(parseWalletDeepLink(url,'android',{now,registry}).request.nonce,input.request.nonce);
  assert.throws(()=>parseWalletDeepLink('ynxwallet://authorize','android',{now,registry}),/canonical request payload/);
});

test('Exchange callback approval, rejection, and mismatch stay bound to the same request',()=>{
  const now=new Date(),input=request(now);
  const approval=signAuthorization(input.request,{accountSecret:input.secret,issuedAt:new Date(now.getTime()+1_000).toISOString()});
  assert.equal(parseAuthorizationCallbackURL(createCallbackURL(approval),input.request,new Date(now.getTime()+2_000)).nonce,input.request.nonce);
  const rejection=createAuthorizationRejection(input.request,{decisionCode:'USER_REJECTED',rejectedAt:new Date(now.getTime()+1_000).toISOString()});
  const parsed=parseAuthorizationCallbackURL(createCallbackURL(rejection),input.request,new Date(now.getTime()+2_000));
  assert.equal('decision'in parsed&&parsed.decision,'rejected');
  assert.throws(()=>parseAuthorizationCallbackURL(createCallbackURL(approval),{...input.request,nonce:'b'.repeat(64)},new Date(now.getTime()+2_000)),/does not match the exact product request/);
});
