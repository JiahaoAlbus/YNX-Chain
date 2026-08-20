// @ts-nocheck -- exercises the runtime protocol package exactly as a product consumer does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {p256} from '@noble/curves/nist.js';
import {PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2,ProductSessionGatewayHttpHandler,createProductSessionReturnURL,createProductWalletConnection,signProductSessionApproval} from '@ynx-chain/wallet-auth';
import {financeProductSessionRegistry as registry} from './product-session-registry';

const secret=Buffer.alloc(32,29);
const key=Buffer.from(p256.getPublicKey(secret,true)).toString('base64url');
const token=(value:string)=>createHash('sha256').update(value).digest('base64url');
function storage(){const values=new Map<string,string>();return {securityLevel:'os-protected' as const,get:async(key:string)=>values.get(key)??null,set:async(key:string,value:string)=>{values.set(key,value)},remove:async(key:string)=>{values.delete(key)}}}

test('Finance invokes only the root factory and its exact Wallet/Auth v2 routes',async()=>{
  const handler=new ProductSessionGatewayHttpHandler(registry,()=>token('finance-v2-route'));
  const observed:string[]=[];const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const parsed=new URL(String(url));observed.push(`${parsed.origin}${parsed.pathname}`);
    const headers=init?.headers as Record<string,string>;
    const response=handler.handle({requestId:headers['x-request-id'],method:String(init?.method),path:parsed.pathname,contentType:headers['content-type'],body:String(init?.body),proofHeader:headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]??null,networkAvailable:true},new Date());
    return new Response(response.body,{status:response.status,headers:response.headers});
  };
  try{
    const connection=createProductWalletConnection({registry,productId:'finance',platform:'android',walletInstalled:async()=>true,schemeRegistered:async()=>true,gatewayTimeoutMs:5_000,storage:storage(),device:{id:'finance-test-device-001',key,sign:async({algorithm,deviceKey,payload}:{algorithm:string;deviceKey:string;payload:string})=>{
      assert.equal(algorithm,'p256-sha256');assert.equal(deviceKey,key);return Buffer.from(p256.sign(Buffer.from(payload,'base64url'),secret,{format:'der'})).toString('base64url');
    },scopes:['finance.ai.draft','finance.pay.read','finance.portfolio.read','finance.profile.write'],purpose:'Finance root factory route test'},scope:{},discoveryWaitMs:0,openWallet:async()=>({opened:true as const}),openTimeoutMs:1_000});
    const pending=await connection.beginYNX();assert.equal(pending.sessionState.status,'connecting');
    const at=new Date(pending.sessionState.request.issuedAt);const approval=signProductSessionApproval(registry,pending.sessionState.request,{accountSecret:'1'.padStart(64,'0'),scopes:pending.sessionState.request.scopes,expiresAt:new Date(at.getTime()+180_000).toISOString()},at);
    const callback=createProductSessionReturnURL(registry,pending.sessionState.request,{result:'approved',approval},at);
    const connected=await connection.handleReturn(callback);assert.equal(connected.sessionState.status,'connected');
    await connection.disconnect();
    assert.deepEqual(observed,[
      'https://wallet-auth.ynxweb4.com/v2/product-sessions/challenge',
      'https://wallet-auth.ynxweb4.com/v2/product-sessions/complete',
      'https://wallet-auth.ynxweb4.com/v2/product-sessions/introspect',
      'https://wallet-auth.ynxweb4.com/v2/product-sessions/revoke',
    ]);
  }finally{globalThis.fetch=originalFetch}
});
