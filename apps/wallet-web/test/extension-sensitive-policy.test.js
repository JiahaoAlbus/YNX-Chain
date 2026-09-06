import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {createHash} from "node:crypto";
import {deriveWalletWebCompanionBinding,requireCanonicalAuthorizationContext} from "../src/core-auth-consumer.js";
import {SensitiveAuthorizationGuard,SENSITIVE_REPLAY_KEY,consumeSensitiveRequest,deriveScopedSensitiveRequestId,parseSensitiveRequest,validateSensitiveResult} from "../src/extension-sensitive-policy.js";

const ID="ynx-11111111-1111-4111-8111-111111111111",ACCOUNT="0x1111111111111111111111111111111111111111",deadline=Date.now()+18000;
const message=(method,params)=>({requestId:ID,deadlineAt:deadline,method,params});
const memoryStorage=()=>{const state={};return{state,async get(key){return{[key]:state[key]}},async set(value){Object.assign(state,value)}}};

test("build consumes exact Core Web companion authority while public Gateway remains closed",()=>{
  const contract=JSON.parse(execFileSync("git",["show","39c80021b87730a20569b61f6ccd3f80092523c4:release/integration/wallet-auth-web-companion-registry-contract.json"],{encoding:"utf8"}));
  const binding=deriveWalletWebCompanionBinding(contract,{coreCommit:"39c80021b87730a20569b61f6ccd3f80092523c4"});
  assert.equal(binding.productClientId,"ynx-wallet-web-companion-v1");assert.equal(binding.enabled,true);
  assert.deepEqual(binding.webCallbacks,["https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback"]);
  assert.equal(binding.publicGatewayRegistryReady,false);assert.equal(binding.trustedRuntimeAvailable,false);
  assert.throws(()=>requireCanonicalAuthorizationContext(binding,null),error=>error.code==="CANONICAL_AUTH_UNAVAILABLE");
});

test("sensitive request parser binds exact method parameters, account and deadline",()=>{
  assert.deepEqual(parseSensitiveRequest(message("eth_requestAccounts",[])),{method:"eth_requestAccounts",expectedAccount:null});
  assert.deepEqual(parseSensitiveRequest(message("wallet_requestPermissions",[{eth_accounts:{}}])),{method:"wallet_requestPermissions",expectedAccount:null});
  assert.equal(parseSensitiveRequest(message("personal_sign",["0x00",ACCOUNT])).expectedAccount,ACCOUNT);
  assert.equal(parseSensitiveRequest(message("eth_signTypedData_v4",[ACCOUNT,JSON.stringify({domain:{},types:{},primaryType:"Mail",message:{}})])).expectedAccount,ACCOUNT);
  assert.equal(parseSensitiveRequest(message("eth_sendTransaction",[{from:ACCOUNT,to:ACCOUNT,value:"0x0",data:"0x"}])).expectedAccount,ACCOUNT);
  for(const invalid of [message("eth_requestAccounts",[1]),message("personal_sign",["hello",ACCOUNT]),message("eth_sendTransaction",[{from:ACCOUNT,to:ACCOUNT,value:"0x00",data:"0x"}]),{...message("personal_sign",["0x00",ACCOUNT]),deadlineAt:Date.now()-1}])assert.throws(()=>parseSensitiveRequest(invalid));
});

test("sensitive request IDs are consumed once in bounded session storage",async()=>{
  const storage=memoryStorage(),request=message("personal_sign",["0x00",ACCOUNT]);
  await consumeSensitiveRequest(storage,request);assert.equal(storage.state[SENSITIVE_REPLAY_KEY].length,1);
  await assert.rejects(()=>consumeSensitiveRequest(storage,request),error=>error.code==="REQUEST_REPLAYED");
});

test("concurrent duplicate sensitive requests cannot race the replay write",async()=>{
  const storage=memoryStorage(),request=message("personal_sign",["0x00",ACCOUNT]),results=await Promise.allSettled([consumeSensitiveRequest(storage,request),consumeSensitiveRequest(storage,request)]);
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal(results.find(result=>result.status==="rejected").reason.code,"REQUEST_REPLAYED");assert.equal(storage.state[SENSITIVE_REPLAY_KEY].length,1);
});

test("authorization guard rejects revoke-and-regrant, account replacement, origin change and deadline drift",async()=>{
  const origin="https://dapp.example",state={now:1,tab:{id:1,incognito:false,url:`${origin}/path`},account:{account:ACCOUNT},permission:{origin,account:ACCOUNT,chainId:"0x1917",grantedAt:1}},guard=new SensitiveAuthorizationGuard({getTab:async()=>state.tab,getAccount:async()=>state.account,getPermission:async()=>state.permission,now:()=>state.now});
  const capture=()=>guard.capture({origin,tabId:1,account:ACCOUNT,grantedAt:1,deadlineAt:100});
  const lease=capture();await guard.assert(lease);guard.invalidateOrigin(origin);await assert.rejects(guard.assert(lease),error=>error.code==="PERMISSION_REVOKED");
  const second=capture();guard.invalidateAll();await assert.rejects(guard.assert(second),error=>error.code==="PROVIDER_ACCOUNT_CHANGED");
  const third=capture();state.tab.url="https://other.example";await assert.rejects(guard.assert(third),error=>error.code==="ORIGIN_CHANGED");state.tab.url=origin;state.now=100;await assert.rejects(guard.assert(third),error=>error.code==="BRIDGE_EXPIRED");
});

test("sensitive results never accept fabricated accounts, signatures or transaction hashes",()=>{
  assert.deepEqual(validateSensitiveResult("eth_requestAccounts",[ACCOUNT]),[ACCOUNT]);
  assert.throws(()=>validateSensitiveResult("eth_requestAccounts",[]),error=>error.code==="INVALID_ACCOUNT");
  assert.throws(()=>validateSensitiveResult("personal_sign","0x1234"),error=>error.code==="INVALID_SIGNATURE");
  assert.throws(()=>validateSensitiveResult("eth_signTypedData_v4","0x1234"),error=>error.code==="INVALID_SIGNATURE");
  assert.throws(()=>validateSensitiveResult("eth_sendTransaction","0x1234"),error=>error.code==="INVALID_TRANSACTION_HASH");
});

test("document epochs survive origin return, tab reuse and a pending active-tab lookup",async()=>{
  const origin="https://dapp.example",guard=new SensitiveAuthorizationGuard({getTab:async id=>({id,incognito:false,url:origin}),getAccount:async()=>({account:ACCOUNT}),getPermission:async()=>({origin,account:ACCOUNT,chainId:"0x1917",grantedAt:1}),now:()=>1}),context={origin,tabId:1,deadlineAt:100};
  const pending=guard.capturePending(),old=guard.capture(context);guard.invalidateTab(1);
  assert.throws(()=>guard.bind(old,{account:ACCOUNT,grantedAt:1}),error=>error.code==="DOCUMENT_CHANGED");
  await assert.rejects(guard.assertDocument(pending(context)),error=>error.code==="DOCUMENT_CHANGED");
  const fresh=guard.bind(guard.capture(context),{account:ACCOUNT,grantedAt:1});guard.invalidateTab(2);await guard.assert(fresh);
  guard.invalidateTab(1);await assert.rejects(guard.assert(fresh),error=>error.code==="DOCUMENT_CHANGED");
});

test("standard provider consumes replay state without coupling to Core Product Session",async()=>{
  const worker=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"),guard=worker.indexOf("consumeSensitiveRequest"),provider=worker.indexOf("handleProviderMethod({tabId,origin");
  assert.ok(guard>0&&provider>guard);assert.doesNotMatch(worker,/requireCanonicalAuthorizationContext|CORE_WALLET_AUTH_BINDING/);assert.match(worker,/requestSignerReview/);assert.match(worker,/broadcastExtensionTransaction/);
});

test("scoped request IDs preserve all SHA-256 bits and bind domain, context, origin and exact external UUID",async()=>{
  const input={browserContext:"firefox-container-1",origin:"https://dapp.example",requestId:ID},actual=await deriveScopedSensitiveRequestId(input);
  const expected=`ynx-scope-v2-${createHash("sha256").update(JSON.stringify(["ynx-extension-sensitive-request-v2",input.browserContext,input.origin,ID])).digest("hex")}`;
  assert.equal(actual,expected);assert.match(actual,/^ynx-scope-v2-[0-9a-f]{64}$/u);assert.equal(await deriveScopedSensitiveRequestId({...input}),actual);
  for(const delta of[{browserContext:"firefox-container-2"},{browserContext:"firefox-default"},{browserContext:"chromium-default"},{origin:"https://other.example"},{requestId:"ynx-22222222-1111-4111-8111-111111111111"}])assert.notEqual(await deriveScopedSensitiveRequestId({...input,...delta}),actual);
  for(const delta of[{browserContext:undefined},{browserContext:"firefox-private"},{origin:"https://dapp.example/"},{requestId:actual},{requestId:ID.toUpperCase()},{requestId:"ynx-scope-v2-abcd"}])await assert.rejects(deriveScopedSensitiveRequestId({...input,...delta}));
});

test("scoped replay keeps same-scope once, cross-scope independence and the global capacity",async()=>{
  const storage=memoryStorage(),base={origin:"https://dapp.example",requestId:ID},idA=await deriveScopedSensitiveRequestId({...base,browserContext:"firefox-container-1"}),idB=await deriveScopedSensitiveRequestId({...base,browserContext:"firefox-container-2"});
  const a={requestId:idA,deadlineAt:100},b={requestId:idB,deadlineAt:100};await consumeSensitiveRequest(storage,a,1,{scopeBound:true});await consumeSensitiveRequest(storage,b,1,{scopeBound:true});
  await assert.rejects(consumeSensitiveRequest(storage,a,2,{scopeBound:true}),{code:"REQUEST_REPLAYED"});assert.equal(storage.state[SENSITIVE_REPLAY_KEY].length,2);
  storage.state[SENSITIVE_REPLAY_KEY]=Array.from({length:2048},(_,i)=>({requestId:`ynx-scope-v2-${i.toString(16).padStart(64,"0")}`,deadlineAt:100}));
  await assert.rejects(consumeSensitiveRequest(storage,a,2,{scopeBound:true}),{code:"REPLAY_CAPACITY"});assert.equal(storage.state[SENSITIVE_REPLAY_KEY].length,2048);
});

test("legacy unscoped UUID replay produces one uniform migration barrier until its original expiry",async()=>{
  const storage=memoryStorage(),legacy={requestId:ID,deadlineAt:100};storage.state[SENSITIVE_REPLAY_KEY]=[legacy];
  for(const context of["firefox-container-1","firefox-container-2","chromium-default"])for(const externalId of[ID,"ynx-22222222-1111-4111-8111-111111111111"]){const requestId=await deriveScopedSensitiveRequestId({browserContext:context,origin:"https://dapp.example",requestId:externalId});await assert.rejects(consumeSensitiveRequest(storage,{requestId,deadlineAt:200},99,{scopeBound:true}),{code:"REPLAY_SCOPE_MIGRATION_PENDING"})}
  assert.deepEqual(storage.state[SENSITIVE_REPLAY_KEY],[legacy]);const requestId=await deriveScopedSensitiveRequestId({browserContext:"firefox-default",origin:"https://dapp.example",requestId:ID});await consumeSensitiveRequest(storage,{requestId,deadlineAt:200},100,{scopeBound:true});assert.deepEqual(storage.state[SENSITIVE_REPLAY_KEY],[{requestId,deadlineAt:200}]);
});

test("vault recovery replay shares capacity but does not inherit the DApp scope migration barrier",async()=>{
  const storage=memoryStorage();storage.state[SENSITIVE_REPLAY_KEY]=[{requestId:ID,deadlineAt:100}];const recovery={requestId:"recovery-11111111-1111-4111-8111-111111111111",deadlineAt:100};await consumeSensitiveRequest(storage,recovery,1);await assert.rejects(consumeSensitiveRequest(storage,recovery,2),{code:"REQUEST_REPLAYED"});
  storage.state[SENSITIVE_REPLAY_KEY]=[recovery];const requestId=await deriveScopedSensitiveRequestId({browserContext:"firefox-default",origin:"https://dapp.example",requestId:ID});await consumeSensitiveRequest(storage,{requestId,deadlineAt:100},3,{scopeBound:true});assert.equal(storage.state[SENSITIVE_REPLAY_KEY].length,2);
});
