import assert from "node:assert/strict";
import test from "node:test";
import {createECDH} from "node:crypto";
import {createProductSessionRequest,encodeProductSessionWalletURL,evmAddressFromYNX,parseProductSessionReturnURL,walletIdentity,type WalletConnectRequestReview} from "@ynx-chain/wallet-auth";
import {CENTRAL_BROWSER_ISSUER,CENTRAL_BROWSER_PURPOSE} from "@ynx-chain/wallet-auth/central-browser-session-contract";
import {createCentralBrowserSessionRegistry} from "@ynx-chain/wallet-auth/central-browser-session-registry";
import {PRODUCT_SESSION_REGISTRY} from "../protocol/registry";
import {reviewNativeSignIn,signNativeSignIn} from "./nativeSignIn";
const now=new Date("2026-10-01T00:00:00.000Z"),secret="1".padStart(64,"0"),identity=walletIdentity(secret);
function review(method:string,params:unknown[],origin:string):WalletConnectRequestReview{return {kind:"walletconnect_request_review",protocolVersion:2,topic:"a".repeat(64),requestId:1,sessionBinding:"b".repeat(64),chainId:"eip155:6423",account:evmAddressFromYNX(identity.account),peer:{publicKey:"c".repeat(64),metadata:{name:"Official unit fixture",description:"Public unit fixture",url:origin,icons:[]}},verification:{origin,validation:"UNKNOWN",verifyUrl:"",isScam:false},method,params,expirySource:"request",expiresAt:new Date(now.getTime()+60000).toISOString(),requiresUserApproval:true,requestDigest:"d".repeat(64)};}
function central(){const registry=createCentralBrowserSessionRegistry(PRODUCT_SESSION_REGISTRY),client=registry[0]!;return {version:1,issuer:CENTRAL_BROWSER_ISSUER,purpose:CENTRAL_BROWSER_PURPOSE,challengeId:"a".repeat(43),browserBinding:"b".repeat(64),nonce:"c".repeat(43),initiator:{clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:"d".repeat(43),codeChallenge:"e".repeat(43),codeChallengeMethod:"S256"},clients:registry.map(c=>({clientId:c.clientId,origin:c.origin,audience:c.audience,scopes:[...c.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId)),issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+60000).toISOString()};}
test("mobile central signer binds the native key to the approved namespace and asserts custody before and after signing",()=>{
  const r=review("ynx_requestCentralBrowserSignIn",[central()],CENTRAL_BROWSER_ISSUER),shown=reviewNativeSignIn(r,now);
  assert.equal(shown.kind,"central");assert.equal(shown.presentation.purpose,CENTRAL_BROWSER_PURPOSE);
  let assertions=0;const approval=signNativeSignIn(r,secret,()=>{assertions++},now) as {account:string};
  assert.equal(assertions,2);assert.equal(approval.account,identity.account);
  assert.throws(()=>signNativeSignIn(r,"2".padStart(64,"0"),()=>{},now),/approved session account/);
  assert.throws(()=>signNativeSignIn({...r,peer:{...r.peer,metadata:{...r.peer.metadata,url:"https://finance.ynxweb4.com"}}},secret,()=>{},now));
  assert.throws(()=>signNativeSignIn(r,secret,()=>{},new Date(r.expiresAt)),/expired/);
  let calls=0;assert.throws(()=>signNativeSignIn(r,secret,()=>{if(++calls===2)throw new Error("account generation changed")},now),/generation changed/);
});
test("mobile Product Session returns the complete verified native approval and cannot sign with another account",()=>{
  const device=createECDH("prime256v1");device.generateKeys();
  const request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:"creator-studio",platform:"web",deviceId:"native-mobile-unit-fixture",deviceKey:device.getPublicKey(null,"compressed").toString("base64url"),scopes:["creator:account"],purpose:"Sign in to Creator Studio.",nonce:"a".repeat(43),state:"b".repeat(43)},now);
  const r=review("ynx_requestProductSessionV2",[encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,request,now)],String(request.origin));
  const returned=signNativeSignIn(r,secret,()=>{},now) as {version:number;returnUrl:string};assert.equal(returned.version,2);
  const verified=parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,request,returned.returnUrl,now);assert.equal(verified.status,"ready");assert.equal((verified.approval as {account:string}).account,identity.account);
  assert.throws(()=>signNativeSignIn(r,"2".padStart(64,"0"),()=>{},now));
});

test('finite Finance Pair signs exactly the visible end and cancellation prevents return',()=>{
 const device=createECDH('prime256v1');device.setPrivateKey(Buffer.alloc(32,7));
 const request=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:'finance',platform:'web',deviceId:'finite-native-wc-fixture',deviceKey:device.getPublicKey(null,'compressed').toString('base64url'),scopes:['finance.profile.write'],purpose:'Review limited access',nonce:'n'.repeat(43),state:'s'.repeat(43),finiteServiceSeconds:7200},now);
 const r=review('ynx_requestProductSessionV2',[encodeProductSessionWalletURL(PRODUCT_SESSION_REGISTRY,request,now)],String(request.origin));
 const shown=reviewNativeSignIn(r,now);assert.equal(shown.kind,'product');if(shown.kind!=='product')throw Error('wrong kind');assert.deepEqual(shown.request.serviceConsent,request.serviceConsent);
 const signed=signNativeSignIn(r,secret,()=>{},now) as {returnUrl:string};const verified=parseProductSessionReturnURL(PRODUCT_SESSION_REGISTRY,request,signed.returnUrl,now);assert.deepEqual((verified.approval as any).serviceConsent,request.serviceConsent);assert.equal((verified.approval as any).expiresAt,request.expiresAt);
 assert.throws(()=>signNativeSignIn(r,secret,()=>{throw Error('cancelled')},now),/cancelled/);
 assert.throws(()=>signNativeSignIn(r,secret,()=>{},new Date(String(request.expiresAt))),/expired/);
});
