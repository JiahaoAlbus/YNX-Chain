import test from 'node:test';
import assert from 'node:assert/strict';
import {p256} from '@noble/curves/nist.js';
import {createAuthorizationRejection,createCallbackURL,encodeRequestDeepLink,parseAuthorizationCallbackURL,parseWalletDeepLink,signAuthorization} from '@ynx-chain/wallet-auth';

const registry={
  'ynx-finance-v1':{
    requestingProduct:'finance',bundleId:'com.ynxweb4.finance',callbacks:['ynxfinance://wallet-auth/callback'],
    scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],maxScopes:4,
  },
};

function request(now=new Date()){
  const secret='2'.padStart(64,'0');
  const productDeviceSecret=Uint8Array.from({length:32},()=>2);
  return {
    request:{version:'1' as const,nonce:'a'.repeat(64),chainId:'ynx_6423-1' as const,requestingProduct:'finance',productClientId:'ynx-finance-v1',bundleId:'com.ynxweb4.finance',productDeviceAlgorithm:'p256-sha256' as const,productDeviceKey:Buffer.from(p256.getPublicKey(productDeviceSecret,true)).toString('base64url'),callback:'ynxfinance://wallet-auth/callback',scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Authorize Finance test only',issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+120_000).toISOString()},
    secret,
  };
}

test('Finance canonical authorization route is request-bearing and rejects a naked route',()=>{
  const now=new Date(),input=request(now),url=encodeRequestDeepLink(input.request);
  assert.match(url,/^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/);
  assert.equal(parseWalletDeepLink(url,'android',{now,registry}).request.nonce,input.request.nonce);
  assert.throws(()=>parseWalletDeepLink('ynxwallet://authorize','android',{now,registry}),/canonical request payload/);
});

test('Finance callback approval and rejection remain bound to one protected request',()=>{
  const now=new Date(),input=request(now);
  const approval=signAuthorization(input.request,{accountSecret:input.secret,issuedAt:new Date(now.getTime()+1_000).toISOString()});
  assert.equal(parseAuthorizationCallbackURL(createCallbackURL(approval),input.request,new Date(now.getTime()+2_000)).nonce,input.request.nonce);
  const rejection=createAuthorizationRejection(input.request,{decisionCode:'USER_REJECTED',rejectedAt:new Date(now.getTime()+1_000).toISOString()});
  const parsed=parseAuthorizationCallbackURL(createCallbackURL(rejection),input.request,new Date(now.getTime()+2_000));
  assert.equal('decision'in parsed&&parsed.decision,'rejected');
  assert.throws(()=>parseAuthorizationCallbackURL(createCallbackURL(approval),{...input.request,nonce:'b'.repeat(64)},new Date(now.getTime()+2_000)),/does not match the exact product request/);
});
