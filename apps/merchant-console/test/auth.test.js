import assert from "node:assert/strict";
import test from "node:test";
import { createCallbackURL, createGatewayChallenge, encodeRequestDeepLink, parseWalletDeepLink, registryParserBinding, signAuthorization, verifyGatewayCompletion } from "@ynx-chain/wallet-auth";
import { beginWalletSignIn, connectStandardWallet, finishWalletSignIn, launchMerchantWalletSignIn, MERCHANT_REGISTRY, privateServiceDegraded, WALLET_INSTALL_OPTIONS } from "../src/auth.js";

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
  globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});if(url.endsWith("/challenges"))return new Response(JSON.stringify(challenge),{status:200,headers:{"Content-Type":"application/json"}});return new Response(JSON.stringify({token:"mcs_test.token",role:"viewer",account:approval.account,merchant:{id:"mrc_truth123"}}),{status:201,headers:{"Content-Type":"application/json"}})};
  const result=await finishWalletSignIn(createCallbackURL(approval),"https://gateway.example",now);
  assert.equal(result.role,"viewer");
  assert.equal(calls.length,2);
  assert.equal(calls[1].body.merchantId,"mrc_truth123");
  assert.equal(verifyGatewayCompletion(calls[1].body.completion,approval,now).account,approval.account);
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

test("controlled Merchant launcher keeps the top-level page in place",async()=>{
  records.clear();
  const frame={style:{},setAttribute(){},remove(){this.removed=true}};
  const document={visibilityState:"visible",body:{appendChild(value){assert.equal(value,frame)}},createElement(){return frame},addEventListener(){},removeEventListener(){}};
  const window={addEventListener(){},removeEventListener(){}};
  const topLevel={href:"https://pay.ynxweb4.com/merchant/"};
  const result=await launchMerchantWalletSignIn("mrc_truth123",{now:new Date("2026-07-18T12:00:00.000Z"),document,window,timeoutMs:1,location:topLevel});
  assert.equal(result.status,"timeout");
  assert.equal(topLevel.href,"https://pay.ynxweb4.com/merchant/");
  assert.equal(frame.removed,true);
  assert.ok(result.fallbackActions.some(action=>action.id==="official-ynx-wallet-download"));
  assert.ok(result.fallbackActions.some(action=>action.id==="standard-metamask"));
});

test("standard connection prefers announced YNX Wallet and switches to YNX Testnet",async()=>{
  const calls=[];
  const ynxProvider={request:async request=>{calls.push(request);if(request.method==="eth_requestAccounts")return ["0x1111111111111111111111111111111111111111"];if(request.method==="eth_chainId")return calls.filter(value=>value.method==="eth_chainId").length<=2?"0x1":"0x1917";if(request.method==="wallet_switchEthereumChain")return null;throw new Error(`unexpected ${request.method}`)}};
  const metaMaskProvider={request:async()=>{throw new Error("MetaMask must not be selected while YNX Wallet is announced")}};
  const listeners=new Map();
  const windowLike={
    addEventListener:(name,listener)=>listeners.set(name,listener),
    removeEventListener:name=>listeners.delete(name),
    dispatchEvent:event=>{if(event.type==="eip6963:requestProvider"){listeners.get("eip6963:announceProvider")?.({detail:{info:{uuid:"metamask",name:"MetaMask",rdns:"io.metamask"},provider:metaMaskProvider}});listeners.get("eip6963:announceProvider")?.({detail:{info:{uuid:"ynx",name:"YNX Wallet",rdns:"com.ynx.wallet"},provider:ynxProvider}})}},
  };
  const result=await connectStandardWallet({windowLike,timeoutMs:0,network:{rpcUrl:"https://evm.ynxweb4.com",explorerUrl:"https://explorer.ynxweb4.com"}});
  assert.equal(result.state,"STANDARD_CONNECTED");
  assert.equal(result.account,"0x1111111111111111111111111111111111111111");
  assert.equal(result.chainId,"0x1917");
  assert.equal(result.providerInfo.name,"YNX Wallet");
  assert.equal(calls.some(value=>value.method==="wallet_switchEthereumChain"),true);
});

test("missing provider returns real install choices and no fabricated connection",async()=>{
  const listeners=new Map();
  const windowLike={addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:name=>listeners.delete(name),dispatchEvent:()=>{}};
  await assert.rejects(()=>connectStandardWallet({windowLike,timeoutMs:0}),error=>error.code==="WALLET_NOT_FOUND"&&error.details.installOptions.ynx===WALLET_INSTALL_OPTIONS.ynx&&error.details.installOptions.metamask===WALLET_INSTALL_OPTIONS.metamask);
});

test("private service degradation preserves an established standard connection",()=>{
  const state=privateServiceDegraded(Object.assign(new Error("gateway unavailable"),{status:503}),{account:"0x2222222222222222222222222222222222222222"});
  assert.equal(state.standardConnection,"STANDARD_CONNECTED");
  assert.equal(state.account,"0x2222222222222222222222222222222222222222");
  assert.equal(state.privateService.state,"PRIVATE_SERVICE_DEGRADED");
  assert.equal(state.privateService.code,"PRODUCT_SESSION_GATEWAY_UNREACHABLE");
});
