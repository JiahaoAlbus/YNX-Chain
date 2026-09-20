import test from 'node:test';
import assert from 'node:assert/strict';
import {p256} from '@noble/curves/nist.js';
import {
  centralDeviceBinding, createCallbackURL, signAuthorization,
  verifyCentralWalletSession, walletIdentity, type AuthorizationRequest, type CentralWalletSession,
} from '@ynx-chain/wallet-auth';
import {completeWalletSession, type WalletCompletionDependencies} from './wallet-completion';

const now=new Date('2026-09-20T08:30:00.000Z');
const encodeBase64url=(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64url');
const deviceSecret=encodeBase64url(Uint8Array.from({length:32},(_,index)=>index===31?7:0));
const deviceKey=encodeBase64url(p256.getPublicKey(Uint8Array.from({length:32},(_,index)=>index===31?7:0),true));
const accountSecret='00'.repeat(31)+'09';
const request:AuthorizationRequest={version:'2',nonce:'request_nonce_abcdefghijklmnopqrstuvwxyz',chainId:'ynx_6423-1',requestingProduct:'finance',productClientId:'ynx-finance-v1',bundleId:'com.ynxweb4.finance',productDeviceAlgorithm:'p256-sha256',productDeviceKey:deviceKey,origin:'https://finance.ynxweb4.com',callback:'ynxfinance://wallet-auth/callback',scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Read verified YNXT and Pay evidence and manage this device’s private Finance plan. Finance cannot sign or move assets.',issuedAt:'2026-09-20T08:29:00.000Z',expiresAt:'2026-09-20T08:34:00.000Z'};
const approval=signAuthorization(request,{accountSecret,issuedAt:'2026-09-20T08:29:30.000Z'});
const callback=createCallbackURL(approval);

type Mutation=(session:CentralWalletSession)=>Record<string,unknown>;
function fixture(mutate:Mutation=(session)=>session){
  let pending:string|null=JSON.stringify(request),deletions=0,posts=0;
  const deps:WalletCompletionDependencies={
    now,gatewayURL:'https://wallet-auth.ynxweb4.com/v1/wallet/sessions/complete',
    getPending:async()=>pending,
    deletePending:async()=>{pending=null;deletions+=1},
    getDevice:async()=>({secret:deviceSecret,key:deviceKey}),
    randomNonce:async()=>'gateway_nonce_abcdefghijklmnopqrstuvwxyz',
    post:async(_url,body)=>{
      posts+=1;
      const input=JSON.parse(body);
      const registryEntry={schemaVersion:3 as const,productClientId:request.productClientId,requestingProduct:request.requestingProduct,bundleId:request.bundleId,callbacks:[request.callback],origins:[request.origin],scopes:request.scopes,maxScopes:request.scopes.length,productDeviceAlgorithms:[request.productDeviceAlgorithm]};
      const session=verifyCentralWalletSession({registryEntry,authorizationRequest:input.authorizationRequest,walletApproval:input.walletApproval,gatewayCompletion:input.gatewayCompletion},now);
      return {ok:true,status:200,json:async()=>({ok:true,result:mutate(session)})};
    },
  };
  return {deps,state:()=>({pending,deletions,posts})};
}
function rebound(session:CentralWalletSession,patch:Record<string,unknown>){const next={...session,...patch};return {...next,deviceBinding:centralDeviceBinding(next,next.account as string)}}

test('verified Gateway session consumes pending only after exact approval binding',async()=>{
  const f=fixture(),session=await completeWalletSession(callback,f.deps);
  assert.equal(session.account,approval.account);
  assert.deepEqual(f.state(),{pending:null,deletions:1,posts:1});
});

test('Gateway binding drift rejects and preserves recoverable pending approval',async(t)=>{
  const otherAccount=walletIdentity('00'.repeat(31)+'0b').account;
  const otherDeviceKey=encodeBase64url(p256.getPublicKey(Uint8Array.from({length:32},(_,index)=>index===31?13:0),true));
  const mutations:[string,Mutation][]=[
    ['account',session=>rebound(session,{account:otherAccount})],
    ['origin',session=>rebound(session,{origin:'https://other.ynxweb4.com'})],
    ['requestDigest',session=>({...session,requestDigest:'0'.repeat(64)})],
    ['scopes',session=>({...session,scopes:['finance.ai.draft']})],
    ['expiresAt',session=>({...session,expiresAt:'2026-09-20T08:31:00.000Z'})],
    ['productDeviceKey',session=>rebound(session,{productDeviceKey:otherDeviceKey})],
  ];
  for(const [name,mutate] of mutations)await t.test(name,async()=>{
    const f=fixture(mutate);
    await assert.rejects(()=>completeWalletSession(callback,f.deps),/binding mismatch/);
    assert.equal(f.state().deletions,0);
    assert.equal(f.state().pending,JSON.stringify(request));
  });
});
