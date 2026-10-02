import assert from "node:assert/strict";
import test from "node:test";
import {p256} from "@noble/curves/nist.js";
import registry from "../vendor/product-session-registry-123016847.json" with {type:"json"};
import {createProductSessionRequest,encodeProductSessionWalletURL,parseProductSessionReturnURL} from "@ynx-chain/wallet-auth";
import {PRIVATE_REPLAY_KEY,consumePrivateReplay,parsePrivateRequest,privateReplayKey,rejectPrivateReturn,signPrivateReturn} from "../src/extension-product-session-v2.js";

const at=new Date("2026-09-25T04:00:00.000Z"),origin="https://card.ynxweb4.com",secret="1".padStart(64,"0");
const deviceKey=Buffer.from(p256.getPublicKey(Buffer.alloc(32,0x42),true)).toString("base64url");
const input={productId:"card",platform:"web",deviceId:`web_${"a".repeat(43)}`,deviceKey,scopes:["account:read","card:application:write","card:controls:write"],purpose:"Approve Card TEST access.",nonce:"b".repeat(43),state:"c".repeat(43)};
const request=createProductSessionRequest(registry,input,at),url=encodeProductSessionWalletURL(registry,request,at);

test("official Card v2 request stays bound to exact browser origin and signed return",()=>{
  assert.deepEqual(parsePrivateRequest([url],origin,at),request);
  assert.throws(()=>parsePrivateRequest([url],"https://finance.ynxweb4.com",at),{code:"PRIVATE_ORIGIN_MISMATCH"});
  assert.throws(()=>parsePrivateRequest([url,"extra"],origin,at),{code:"PRIVATE_REQUEST_INVALID"});
  const signed=signPrivateReturn(request,secret,new Date(at.getTime()+1000));
  assert.equal(signed.version,2);
  assert.equal(parseProductSessionReturnURL(registry,request,signed.returnUrl,new Date(at.getTime()+1000)).status,"ready");
  assert.equal(parseProductSessionReturnURL(registry,request,rejectPrivateReturn(request,new Date(at.getTime()+1000)).returnUrl,new Date(at.getTime()+1000)).status,"user-rejected");
});

test("private replay ledger rejects same pending request across worker instances and permits a fresh SDK request",async()=>{
  const state={};const storage={async get(key){return {[key]:state[key]}},async set(value){Object.assign(state,value)}};
  const key=privateReplayKey(request,at),expiry=Date.parse(request.expiresAt);
  await consumePrivateReplay(storage,key,expiry,at.getTime());
  await assert.rejects(()=>consumePrivateReplay(storage,key,expiry,at.getTime()+1000),{code:"PRIVATE_REQUEST_REPLAYED"});
  assert.equal(state[PRIVATE_REPLAY_KEY].length,1);
  const fresh=createProductSessionRequest(registry,{...input,nonce:"d".repeat(43),state:"e".repeat(43)},at);
  await consumePrivateReplay(storage,privateReplayKey(fresh,at),Date.parse(fresh.expiresAt),at.getTime()+1000);
  assert.equal(state[PRIVATE_REPLAY_KEY].length,2);
});


test("Quant record approval grants only freshly requested read scope",()=>{
  const request=createProductSessionRequest(registry,{...input,productId:"quant",scopes:["quant:records:read"],purpose:"Read my Quant records"},at);
  const origin="https://quant.ynxweb4.com",url=encodeProductSessionWalletURL(registry,request,at);
  assert.deepEqual(parsePrivateRequest([url],origin,at).scopes,["quant:records:read"]);
  const result=signPrivateReturn(request,secret,new Date(at.getTime()+1000));
  const parsed=parseProductSessionReturnURL(registry,request,result.returnUrl,new Date(at.getTime()+1000));
  assert.deepEqual(parsed.approval.scopes,["quant:records:read"]);
  const old=createProductSessionRequest(registry,{...input,productId:"quant",scopes:["quant:account"]},at);
  const oldResult=signPrivateReturn(old,secret,new Date(at.getTime()+1000));
  assert.deepEqual(parseProductSessionReturnURL(registry,old,oldResult.returnUrl,new Date(at.getTime()+1000)).approval.scopes,["quant:account"]);
});


test("removed Card Finance sharing scope remains rejected by current registry",()=>{
  assert.throws(()=>createProductSessionRequest(registry,{...input,scopes:["account:read","card:finance:share"]},at),{code:"SCOPE_WIDENING"});
});

test('Paper workspace requires its exact fresh Quant scope and supports explicit rejection',()=>{
  const request=createProductSessionRequest(registry,{...input,productId:'quant',scopes:['quant:paper:workspace'],purpose:'Simulated Paper workspace, no real money.'},at);
  const url=encodeProductSessionWalletURL(registry,request,at),now=new Date(at.getTime()+1000);
  assert.deepEqual(parsePrivateRequest([url],'https://quant.ynxweb4.com',at).scopes,['quant:paper:workspace']);
  assert.throws(()=>parsePrivateRequest([url],'https://finance.ynxweb4.com',at),{code:'PRIVATE_ORIGIN_MISMATCH'});
  const signed=signPrivateReturn(request,secret,now);
  assert.deepEqual(parseProductSessionReturnURL(registry,request,signed.returnUrl,now).approval.scopes,['quant:paper:workspace']);
  assert.equal(parseProductSessionReturnURL(registry,request,rejectPrivateReturn(request,now).returnUrl,now).status,'user-rejected');
});
test('finite private signing requires exact displayed consent and preserves signed service deadline',()=>{
  const r=createProductSessionRequest(registry,{...input,productId:'finance',scopes:['finance.profile.write'],finiteServiceSeconds:7200},at),now=new Date(at.getTime()+1000);
  assert.throws(()=>signPrivateReturn(r,secret,now));
  assert.throws(()=>signPrivateReturn(r,secret,now,{...r.serviceConsent,durationSeconds:3600}));
  const result=signPrivateReturn(r,secret,now,r.serviceConsent);
  assert.deepEqual(parseProductSessionReturnURL(registry,r,result.returnUrl,now).approval.serviceConsent,r.serviceConsent);
});
