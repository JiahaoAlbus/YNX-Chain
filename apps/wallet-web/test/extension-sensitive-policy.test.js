import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {deriveCoreWalletAuthBinding,requireCanonicalAuthorizationContext} from "../src/core-auth-consumer.js";
import {SENSITIVE_REPLAY_KEY,consumeSensitiveRequest,parseSensitiveRequest,validateSensitiveResult} from "../src/extension-sensitive-policy.js";

const ID="ynx-11111111-1111-4111-8111-111111111111",ACCOUNT="0x1111111111111111111111111111111111111111",deadline=Date.now()+18000;
const message=(method,params)=>({requestId:ID,deadlineAt:deadline,method,params});
const memoryStorage=()=>{const state={};return{state,async get(key){return{[key]:state[key]}},async set(value){Object.assign(state,value)}}};

test("build consumes the frozen Core registry and keeps Wallet Web authorization unavailable",async()=>{
  const registry=JSON.parse(await readFile(new URL("../../../packages/wallet-auth/central-registry.json",import.meta.url),"utf8")),binding=deriveCoreWalletAuthBinding(registry);
  assert.equal(binding.productClientId,"ynx-wallet-v1");assert.equal(binding.enabled,false);assert.deepEqual(binding.webCallbacks,[]);
  assert.throws(()=>requireCanonicalAuthorizationContext(binding,null),error=>error.code==="CANONICAL_AUTH_UNAVAILABLE");
});

test("sensitive request parser binds exact method parameters, account and deadline",()=>{
  assert.deepEqual(parseSensitiveRequest(message("eth_requestAccounts",[])),{method:"eth_requestAccounts",expectedAccount:null});
  assert.equal(parseSensitiveRequest(message("personal_sign",["0x00",ACCOUNT])).expectedAccount,ACCOUNT);
  assert.equal(parseSensitiveRequest(message("eth_sendTransaction",[{from:ACCOUNT,to:ACCOUNT,value:"0x0",data:"0x"}])).expectedAccount,ACCOUNT);
  for(const invalid of [message("eth_requestAccounts",[1]),message("personal_sign",["hello",ACCOUNT]),message("eth_sendTransaction",[{from:ACCOUNT,to:ACCOUNT,value:"0x00",data:"0x"}]),{...message("personal_sign",["0x00",ACCOUNT]),deadlineAt:Date.now()-1}])assert.throws(()=>parseSensitiveRequest(invalid));
});

test("sensitive request IDs are consumed once in bounded session storage",async()=>{
  const storage=memoryStorage(),request=message("personal_sign",["0x00",ACCOUNT]);
  await consumeSensitiveRequest(storage,request);assert.equal(storage.state[SENSITIVE_REPLAY_KEY].length,1);
  await assert.rejects(()=>consumeSensitiveRequest(storage,request),error=>error.code==="REQUEST_REPLAYED");
});

test("sensitive results never accept fabricated accounts, signatures or transaction hashes",()=>{
  assert.deepEqual(validateSensitiveResult("eth_requestAccounts",[ACCOUNT]),[ACCOUNT]);
  assert.throws(()=>validateSensitiveResult("eth_requestAccounts",[]),error=>error.code==="INVALID_ACCOUNT");
  assert.throws(()=>validateSensitiveResult("personal_sign","0x1234"),error=>error.code==="INVALID_SIGNATURE");
  assert.throws(()=>validateSensitiveResult("eth_sendTransaction","0x1234"),error=>error.code==="INVALID_TRANSACTION_HASH");
});

test("service worker consumes replay state and Core authorization before a wallet backend call",async()=>{
  const worker=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"),guard=worker.indexOf("consumeSensitiveRequest"),backend=worker.indexOf("executeInTab(tabId,origin,\"any\",input)");
  assert.ok(guard>0&&backend>guard);assert.match(worker,/requireCanonicalAuthorizationContext\(CORE_WALLET_AUTH_BINDING,null\)/);
});
