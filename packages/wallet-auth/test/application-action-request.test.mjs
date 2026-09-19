import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJSON } from "../src/canonical.js";
import { walletIdentity } from "../src/crypto.js";
import { createSignedApplicationAction } from "../src/application-action.js";
import {
  createApplicationActionRequest, parseApplicationActionRequest, applicationActionRequestDigest,
  encodeApplicationActionWalletURL, parseApplicationActionWalletURL,
  createApplicationActionReturnURL, parseApplicationActionReturnURL,
} from "../src/application-action-request.js";
const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url)));
const secret = "0".repeat(63) + "1", account = walletIdentity(secret).account;
const now = new Date("2026-09-12T10:00:00.000Z");
const payload = { poolId: "dex_ynxt_usdt", assetIn: "YNXT", amountIn: 10, minAmountOut: 1, deadlineUnix: Math.floor(now.getTime()/1000) + 600 };
const input = { productId: "dex", platform: "web", account, action: "dex_swap_exact_input", payload, nonce: 1, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "s".repeat(32) };
const make = (delta={}) => createApplicationActionRequest(registry, {...input,...delta}, now);
const enc = value => Buffer.from(typeof value === "string" ? value : canonicalJSON(value)).toString("base64url");
const route = value => `ynxwallet://application-action?request=${enc(value)}`;
const signedFor = request => createSignedApplicationAction({accountSecret:secret,action:request.action,payload:request.payload,nonce:request.nonce}).payload;

test("explicit DEX request and single result work across all registered platform bindings", () => {
  for (const platform of ["web","android","ios","macos","windows","linux"]) {
    const request=make({platform});
    assert.equal(request.applicationId, platform === "web" ? "com.ynxweb4.dex.web" : "com.ynxweb4.dex");
    assert.equal(Date.parse(request.expiresAt)-Date.parse(request.issuedAt),300000);
    const url=encodeApplicationActionWalletURL(registry,request,now);
    assert.deepEqual(parseApplicationActionWalletURL(registry,url,now),request);
    const signed=signedFor(request), target=createApplicationActionReturnURL(registry,request,{status:"approved",signed},now);
    assert.deepEqual([...new URL(target).searchParams.keys()],["applicationActionResult"]);
    const result=parseApplicationActionReturnURL(registry,target,request,now);
    assert.equal(result.signed,signed); assert.equal(result.kind,"application-action");
    assert.equal(result.requestDigest,applicationActionRequestDigest(request));
    assert.equal(result.status,"approved");
  }
});

test("registered source and callback fields cannot be caller supplied or moved across products/platforms",()=>{
  assert.throws(()=>make({callback:"evil://cb"}));
  assert.throws(()=>make({productId:"finance"}));
  for(const delta of [{origin:"https://evil.example"},{callback:"ynxfinance://wallet-auth/callback"},{applicationId:"com.ynxweb4.finance"},{platform:"android"},{chainId:"ynx_1-1"},{version:"2"},{callback:make().callback+"?a=1"}]){
    assert.throws(()=>parseApplicationActionRequest(registry,{...make(),...delta},now));
  }
  const webOnly=structuredClone(registry); const dex=webOnly.products.find(p=>p.productId==="dex");
  dex.platforms=["web"];dex.nativeCallback=null;dex.legacyCallbacks=[];
  assert.throws(()=>createApplicationActionRequest(webOnly,{...input,platform:"android"},now));
});

test("requests are detached frozen snapshots and accessor inputs never become reviewed payloads",()=>{
  const copy=structuredClone(payload), request=make({payload:copy}); copy.amountIn=999;
  assert.equal(request.payload.amountIn,10);assert.ok(Object.isFrozen(request.payload));assert.ok(Object.isFrozen(request));
  let reads=0; const accessor={...input}; Object.defineProperty(accessor,"account",{enumerable:true,get(){reads++;return account;}});
  assert.throws(()=>createApplicationActionRequest(registry,accessor,now));assert.equal(reads,0);
  const p={...payload};Object.defineProperty(p,"amountIn",{enumerable:true,get(){reads++;return 10;}});
  assert.throws(()=>make({payload:p})); assert.equal(reads,0);
  const decision={reason:"USER_REJECTED"};Object.defineProperty(decision,"status",{enumerable:true,get(){reads++;return "rejected";}});
  assert.throws(()=>createApplicationActionReturnURL(registry,request,decision,now));assert.equal(reads,0);
});

test("only exact Core actions, canonical accounts, safe integers and bounded identifiers are accepted",()=>{
  for(const delta of [{action:"transfer"},{action:"dex_swap"},{account:"0x"+"1".repeat(40)},{account:account.slice(0,-1)+"x"},{nonce:0},{nonce:-1},{nonce:1.5},{nonce:Number.MAX_SAFE_INTEGER+1},{requestId:input.requestId.toUpperCase()},{requestId:"a".repeat(32)},{state:"x".repeat(31)},{state:"x".repeat(129)}])assert.throws(()=>make(delta));
  for(const p of [{...payload,amountIn:0},{...payload,amountIn:"10"},{...payload,extra:1},{...payload,poolId:"x".repeat(20000)},{...payload,assetIn:"ynxt"},{...payload,deadlineUnix:Math.floor(now.getTime()/1000)}])assert.throws(()=>make({payload:p}));
  const cases={dex_swap_exact_output:{poolId:payload.poolId,assetOut:"usdt",amountOut:4,maxAmountIn:10,deadlineUnix:payload.deadlineUnix},dex_liquidity_add:{poolId:payload.poolId,amount0:3,amount1:4,minShares:1,deadlineUnix:payload.deadlineUnix},dex_liquidity_remove:{poolId:payload.poolId,shares:3,minAmount0:0,minAmount1:0,deadlineUnix:payload.deadlineUnix}};
  for(const [action,payload]of Object.entries(cases)){const r=make({action,payload});const u=createApplicationActionReturnURL(registry,r,{status:"approved",signed:signedFor(r)},now);assert.equal(parseApplicationActionReturnURL(registry,u,r,now).status,"approved");}
});

test("expiry, future issuance, invalid clocks and noncanonical timestamps fail closed",()=>{
  const request=make();
  for(const delta of [{issuedAt:new Date(now.getTime()+1).toISOString()},{expiresAt:new Date(now.getTime()+300001).toISOString()},{expiresAt:now.toISOString()},{issuedAt:"2026-09-12T10:00:00Z"},{expiresAt:"bad"}])assert.throws(()=>parseApplicationActionRequest(registry,{...request,...delta},now));
  assert.throws(()=>parseApplicationActionRequest(registry,request,new Date(NaN)));
  assert.throws(()=>parseApplicationActionRequest(registry,request,new Date(request.expiresAt)));
});

test("route parsing rejects normalizing URL tricks, duplicate fields, invalid UTF8 and noncanonical base64url",()=>{
  const r=make(),good=route(r);
  for(const u of [good+"#x",good+"&request="+enc(r),good+"&other=1",good.replace("application-action?","application-action:9?"),good.replace("ynxwallet:","YNXWALLET:"),good.replace("?request=","?%72equest="),good.replace("application-action?","authorize?"),good+"=",route(JSON.stringify(r)),route(canonicalJSON(r).replace('"version":"1"','"version":"1","version":"1"')),`ynxwallet://application-action?request=${Buffer.from([0xff]).toString("base64url")}`]) assert.throws(()=>parseApplicationActionWalletURL(registry,u,now),u.slice(0,80));
  const bytes=Buffer.from('"x"'), canonical=bytes.toString("base64url");
  assert.throws(()=>parseApplicationActionWalletURL(registry,`ynxwallet://application-action?request=${canonical.slice(0,-1)}R`,now));
});

test("approved result must bind exact pending request and exact signed business intent",()=>{
  const request=make(),signed=signedFor(request),good=createApplicationActionReturnURL(registry,request,{status:"approved",signed},now);
  for(const delta of [{nonce:2},{payload:{...payload,amountIn:11}},{account:walletIdentity("0".repeat(63)+"2").account}]){
    const other=make(delta);const bad=createSignedApplicationAction({accountSecret:delta.account?"0".repeat(63)+"2":secret,action:other.action,payload:other.payload,nonce:other.nonce}).payload;
    assert.throws(()=>createApplicationActionReturnURL(registry,request,{status:"approved",signed:bad},now));
  }
  for(const changed of [make({state:"t".repeat(32)}),make({requestId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}),make({platform:"android"})])assert.throws(()=>parseApplicationActionReturnURL(registry,good,changed,now));
  const result=JSON.parse(Buffer.from(new URL(good).searchParams.get("applicationActionResult"),"base64url"));
  for(const delta of [{state:"t".repeat(32)},{requestDigest:"0".repeat(64)},{kind:"product-session"},{version:"2"},{extra:true},{signed:JSON.parse(signed)}])assert.throws(()=>parseApplicationActionReturnURL(registry,`${request.callback}?applicationActionResult=${enc({...result,...delta})}`,request,now));
  assert.throws(()=>parseApplicationActionReturnURL(registry,good.replace("dex.ynxweb4.com","evil.example"),request,now));
  assert.throws(()=>parseApplicationActionReturnURL(registry,good+"&result=approved",request,now));
});

test("unsigned rejection has one explicit status and never contains signing authority",()=>{
  const r=make(),url=createApplicationActionReturnURL(registry,r,{status:"rejected",reason:"USER_REJECTED"},now);
  const result=parseApplicationActionReturnURL(registry,url,r,now);
  assert.equal(result.status,"rejected");assert.equal(result.reason,"USER_REJECTED");assert.equal(Object.hasOwn(result,"signed"),false);
  for(const decision of [{status:"rejected",reason:"OTHER"},{status:"approved",reason:"USER_REJECTED"},{status:"rejected",reason:"USER_REJECTED",signed:signedFor(r)}])assert.throws(()=>createApplicationActionReturnURL(registry,r,decision,now));
});
