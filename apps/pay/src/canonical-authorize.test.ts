import assert from 'node:assert/strict';
import test from 'node:test';
import {p256} from '@noble/curves/nist.js';
import {createAuthorizationRejection,createCallbackURL,createCanonicalAuthorizeLaunch,launchCanonicalAuthorization,parseAuthorizationCallbackURL,parseWalletDeepLink,signAuthorization} from '@ynx-chain/wallet-auth';

const registry={
  'ynx-pay-v1':{
    requestingProduct:'pay',bundleId:'com.ynxweb4.pay',origins:['https://pay.ynxweb4.com'],callbacks:['ynxpay://wallet-auth/callback'],
    scopes:['account:read','pay:case:create','pay:route:select','pay:settlement:submit','pay:sponsorship:request'],maxScopes:5,
  },
};
function request(now=new Date()){
  const secret='3'.padStart(64,'0'),deviceSecret=Uint8Array.from({length:32},()=>3);
  return {request:{version:'1' as const,nonce:'c'.repeat(64),chainId:'ynx_6423-1' as const,requestingProduct:'pay',productClientId:'ynx-pay-v1',bundleId:'com.ynxweb4.pay',productDeviceAlgorithm:'p256-sha256' as const,productDeviceKey:Buffer.from(p256.getPublicKey(deviceSecret,true)).toString('base64url'),callback:'ynxpay://wallet-auth/callback',scopes:['account:read','pay:case:create','pay:route:select','pay:settlement:submit','pay:sponsorship:request'],purpose:'Authorize Pay test only',issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+120_000).toISOString()},secret};
}

test('Pay uses the accepted launcher to make a complete canonical authorization request',async()=>{
  const now=new Date(),input=request(now),launch=createCanonicalAuthorizeLaunch(input.request);
  assert.match(launch.uri,/^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/);
  assert.equal(parseWalletDeepLink(launch.uri,'android',{now,registry}).request.nonce,input.request.nonce);
  assert.throws(()=>parseWalletDeepLink('ynxwallet://authorize','android',{now,registry}),/canonical request payload/);
  const unavailable=await launchCanonicalAuthorization(input.request,{platform:'android',resolver:async()=>false});
  assert.equal(unavailable.status,'unsupported');
  assert.deepEqual(unavailable.fallbackActions.map(action=>action.id),['official-ynx-wallet-download','standard-metamask']);
});

test('Pay canonical callback approval, rejection, and mismatch remain bound to one request',()=>{
  const now=new Date(),input=request(now),approval=signAuthorization(input.request,{accountSecret:input.secret,issuedAt:new Date(now.getTime()+1_000).toISOString()});
  assert.equal(parseAuthorizationCallbackURL(createCallbackURL(approval),input.request,new Date(now.getTime()+2_000)).nonce,input.request.nonce);
  const rejection=createAuthorizationRejection(input.request,{decisionCode:'USER_REJECTED',rejectedAt:new Date(now.getTime()+1_000).toISOString()});
  assert.equal('decision'in parseAuthorizationCallbackURL(createCallbackURL(rejection),input.request,new Date(now.getTime()+2_000)),true);
  assert.throws(()=>parseAuthorizationCallbackURL(createCallbackURL(approval),{...input.request,nonce:'d'.repeat(64)},new Date(now.getTime()+2_000)),/does not match the exact product request/);
});
