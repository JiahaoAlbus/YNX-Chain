import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {deriveWalletWebCompanionBinding,requireCanonicalAuthorizationContext} from "../src/core-auth-consumer.js";
import {SENSITIVE_REPLAY_KEY,consumeSensitiveRequest,parseSensitiveRequest,validateSensitiveResult} from "../src/extension-sensitive-policy.js";

const ID="ynx-11111111-1111-4111-8111-111111111111",ACCOUNT="0x1111111111111111111111111111111111111111",deadline=Date.now()+18000;
const message=(method,params)=>({requestId:ID,deadlineAt:deadline,method,params});
const memoryStorage=()=>{const state={};return{state,async get(key){return{[key]:state[key]}},async set(value){Object.assign(state,value)}}};

test("build consumes exact Core Web companion authority while public Gateway remains closed",()=>{
  const contract=JSON.parse(execFileSync("git",["show","39c80021b87730a20569b61f6ccd3f80092523c4:release/integration/wallet-auth-web-companion-registry-contract.json"],{encoding:"utf8"}));
  const binding=deriveWalletWebCompanionBinding(contract,{coreCommit:"39c80021b87730a20569b61f6ccd3f80092523c4"});
  assert.equal(binding.productClientId,"ynx-wallet-web-companion-v1");assert.equal(binding.enabled,true);
  assert.deepEqual(binding.webCallbacks,["https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback"]);
  assert.equal(binding.publicGatewayRegistryReady,false);assert.equal(binding.trustedRuntimeAvailable,false);
  assert.throws(()=>requireCanonicalAuthorizationContext(binding,null),error=>error.code==="CANONICAL_AUTH_REQUIRED");
});

test("sensitive request parser binds exact method parameters, account and deadline",()=>{
  assert.deepEqual(parseSensitiveRequest(message("eth_requestAccounts",[])),{method:"eth_requestAccounts",expectedAccount:null});
  assert.equal(parseSensitiveRequest(message("personal_sign",["0x00",ACCOUNT])).expectedAccount,ACCOUNT);
  assert.equal(parseSensitiveRequest(message("eth_sendTransaction",[{from:ACCOUNT,to:ACCOUNT,value:"0x0",data:"0x"}])).expectedAccount,ACCOUNT);
  assert.equal(parseSensitiveRequest(message("wallet_requestPermissions",[{eth_accounts:{}}])).method,"wallet_requestPermissions");
  assert.equal(parseSensitiveRequest(message("wallet_revokePermissions",[{eth_accounts:{}}])).method,"wallet_revokePermissions");
  assert.equal(parseSensitiveRequest(message("wallet_watchAsset",[{type:"ERC20",options:{address:ACCOUNT,symbol:"YNXT",decimals:18,image:"https://assets.example/ynxt.png"}}])).method,"wallet_watchAsset");
  assert.equal(parseSensitiveRequest(message("eth_signTypedData_v4",[ACCOUNT,JSON.stringify({types:{Mail:[{name:"contents",type:"string"}]},primaryType:"Mail",domain:{name:"YNX Testnet",chainId:"0x1917"},message:{contents:"hello"}})])).expectedAccount,ACCOUNT);
  for(const invalid of [message("eth_requestAccounts",[1]),message("personal_sign",["hello",ACCOUNT]),message("eth_sendTransaction",[{from:ACCOUNT,to:ACCOUNT,value:"0x00",data:"0x"}]),message("wallet_requestPermissions",[{eth_accounts:{},eth_sendTransaction:{}}]),message("wallet_watchAsset",[{type:"ERC20",options:{address:ACCOUNT,symbol:"YNXT",image:"http://assets.example/a.png"}}]),message("eth_signTypedData_v4",[ACCOUNT,JSON.stringify({types:{Mail:[{name:"contents",type:"string"}]},primaryType:"Mail",domain:{name:"YNX",chainId:"0x1"},message:{contents:"hello"}})]),{...message("personal_sign",["0x00",ACCOUNT]),deadlineAt:Date.now()-1}])assert.throws(()=>parseSensitiveRequest(invalid));
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
  assert.equal(validateSensitiveResult("eth_signTypedData_v4",`0x${"a".repeat(130)}`),`0x${"a".repeat(130)}`);
  assert.deepEqual(validateSensitiveResult("wallet_requestPermissions",[{parentCapability:"eth_accounts"}]),[{parentCapability:"eth_accounts"}]);
  assert.equal(validateSensitiveResult("wallet_revokePermissions",null),null);
  assert.equal(validateSensitiveResult("wallet_watchAsset",true),true);
});

test("service worker consumes replay state before a standard Wallet backend call without making Gateway authorization a prerequisite",async()=>{
  const worker=await readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"),guard=worker.indexOf("consumeSensitiveRequest"),backend=worker.indexOf("executeInTab(tabId,origin,\"any\",input)");
  assert.ok(guard>0&&backend>guard);assert.doesNotMatch(worker,/requireCanonicalAuthorizationContext/);
});
