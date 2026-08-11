import assert from "node:assert/strict";
import test from "node:test";
import { createCallbackURL, createGatewayChallenge, encodeRequestDeepLink, parseWalletDeepLink, registryParserBinding, signAuthorization, verifyCentralWalletSession } from "@ynx-chain/wallet-auth";
import { beginWalletSignIn, finishWalletSignIn, MERCHANT_REGISTRY } from "../src/auth.js";

const records=new Map();
globalThis.sessionStorage={getItem:key=>records.get(key)??null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};

test("canonical Wallet approval and product-device proof create only a short merchant session",async t=>{
  records.clear();
  const now=new Date("2026-07-18T12:00:00.000Z");
  const link=beginWalletSignIn("mrc_truth123",now);
  const request=parseWalletDeepLink(link,"android",{now,registry:registryParserBinding(MERCHANT_REGISTRY)}).request;
  assert.equal(request.productClientId,"ynx-merchant-console-v1");
  assert.deepEqual(request.scopes,["account:read","merchant:session:create"]);
  const approval=signAuthorization(request,{accountSecret:"0".repeat(63)+"1",issuedAt:now.toISOString()});
  const challenge=createGatewayChallenge(approval,{challenge:"gateway_merchant_challenge_1234567890",expiresAt:new Date(now.getTime()+120_000).toISOString()},now);
  const calls=[];
  const verifiedSession=verifyCentralWalletSession({registryEntry:MERCHANT_REGISTRY,authorizationRequest:request,walletApproval:approval,gatewayCompletion:(await import("@ynx-chain/wallet-auth")).signGatewayChallenge(challenge,JSON.parse(records.get("ynx-merchant-wallet-auth-v1")).deviceSecret)},now);
  const productSession={...verifiedSession,requestingProduct:request.requestingProduct,productDeviceKey:request.productDeviceKey};
  assert.equal(productSession.requestingProduct,MERCHANT_REGISTRY.requestingProduct);
  assert.equal(productSession.productClientId,MERCHANT_REGISTRY.productClientId);
  assert.equal(productSession.bundleId,MERCHANT_REGISTRY.bundleId);
  assert.equal(productSession.productDeviceKey,request.productDeviceKey);
  assert.deepEqual(productSession.scopes,[...MERCHANT_REGISTRY.scopes]);
  globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body),headers:init.headers});if(url.endsWith("/v1/wallet/sessions/complete"))return new Response(JSON.stringify({ok:true,result:productSession}),{status:200,headers:{"Content-Type":"application/json"}});return new Response(JSON.stringify({token:"mcs_test.token",role:"viewer",account:approval.account,merchant:{id:"mrc_truth123"}}),{status:201,headers:{"Content-Type":"application/json"}})};
  const result=await finishWalletSignIn(createCallbackURL(approval),"https://gateway.example",now);
  assert.equal(result.role,"viewer");
  assert.equal(calls.length,2);
  assert.equal(calls[1].body.merchantId,"mrc_truth123");
  assert.equal(calls[0].body.walletApproval.account,approval.account);
  assert.match(calls[1].headers["X-YNX-Product-Session-Proof"],/^[A-Za-z0-9_-]+$/);
  assert.equal(records.size,0,"device secret and request are consumed");
});

test("cross-product callback and scope escalation fail closed",()=>{
  records.clear();
  const now=new Date("2026-07-18T12:00:00.000Z");
  const link=beginWalletSignIn("mrc_truth123",now);
  const request=parseWalletDeepLink(link,"android",{now,registry:registryParserBinding(MERCHANT_REGISTRY)}).request;
  assert.throws(()=>parseWalletDeepLink(encodeRequestDeepLink({...request,scopes:["account:read","card:controls:write"]}),"android",{now,registry:registryParserBinding(MERCHANT_REGISTRY)}),/scope/i);
  assert.throws(()=>parseWalletDeepLink(encodeRequestDeepLink({...request,callback:"ynxcard://wallet-auth/callback"}),"android",{now,registry:registryParserBinding(MERCHANT_REGISTRY)}),/callback/i);
});
