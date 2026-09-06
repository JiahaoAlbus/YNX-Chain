import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import test from "node:test";
import {deriveWalletWebCompanionBinding} from "../src/core-auth-consumer.js";
import {createWalletWebCompanionLifecycle} from "../src/wallet-web-companion-lifecycle.js";

const callback="https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback";
const contract=JSON.parse(execFileSync("git",["show","39c80021b87730a20569b61f6ccd3f80092523c4:release/integration/wallet-auth-web-companion-registry-contract.json"],{encoding:"utf8"}));
const binding=(ready)=>deriveWalletWebCompanionBinding(contract,{publicGatewayRegistryReady:ready,trustedRuntimeAvailable:ready});

function client(states={}){
  const calls=[];
  return {calls,
    async beginDetected(automatic){calls.push(["beginDetected",automatic]);return states.begin||{status:"connecting",message:"Wallet approval is pending",route:{status:"ready",url:"ynxwallet://authorize?request=canonical"}}},
    async handleReturn(url){calls.push(["handleReturn",url]);return states.returned||{status:"connected",message:"Authoritative Product Session connected",session:{account:"must-not-leak"}}},
    async disconnect(){calls.push(["disconnect"]);return states.disconnect||{status:"disconnected",message:"Authoritative Product Session revoked and removed from secure storage"}},
    async restore(online){calls.push(["restore",online]);return states.restore||{status:"retry-required",message:"Stored Product Session is invalid; explicit Retry is required"}},
  };
}

test("public Web lifecycle remains fail closed while the 6441 Gateway registry is old",async()=>{
  const lifecycle=createWalletWebCompanionLifecycle({binding:binding(false)});
  for(const result of [await lifecycle.begin(),await lifecycle.handleReturn(`${callback}?result=rejected`),await lifecycle.disconnect(),await lifecycle.restart(true)]){
    assert.deepEqual({status:result.status,code:result.code,authoritative:result.authoritative,account:result.account,sign:result.sign,send:result.sendTransaction},{status:"network-unavailable",code:"CANONICAL_AUTH_UNAVAILABLE",authoritative:false,account:false,sign:false,send:false});
  }
  assert.equal(lifecycle.publicAuthAvailable,false);
});

test("begin delegates only to Core beginDetected and opens its canonical route",async()=>{
  const runtime=client(),opened=[];
  const lifecycle=createWalletWebCompanionLifecycle({binding:binding(true),client:runtime,open:async(url)=>opened.push(url)});
  const result=await lifecycle.begin();
  assert.equal(result.status,"connecting");assert.equal(result.authoritative,false);
  assert.deepEqual(runtime.calls,[["beginDetected",false]]);assert.deepEqual(opened,["ynxwallet://authorize?request=canonical"]);
});

test("return binds the exact HTTPS callback and never exposes account/sign/send authority",async()=>{
  const runtime=client(),lifecycle=createWalletWebCompanionLifecycle({binding:binding(true),client:runtime});
  const wrong=await lifecycle.handleReturn("https://evil.example/dapp/wallet/wallet-auth/callback?result=approved");
  assert.equal(wrong.authoritative,false);assert.equal(wrong.code,"CANONICAL_AUTH_UNAVAILABLE");assert.deepEqual(runtime.calls,[]);
  const approved=await lifecycle.handleReturn(`${callback}?result=approved&approval=x&nonce=x&state=x`);
  assert.equal(approved.status,"connected");assert.equal(approved.authoritative,true);
  assert.equal(approved.account,false);assert.equal(approved.sign,false);assert.equal(approved.sendTransaction,false);
  assert.equal(runtime.calls[0][0],"handleReturn");
});

test("reject, disconnect and restart preserve Core lifecycle outcomes without local resurrection",async()=>{
  const runtime=client({returned:{status:"disconnected",message:"Wallet approval was rejected; no session was created"}});
  const lifecycle=createWalletWebCompanionLifecycle({binding:binding(true),client:runtime});
  const rejected=await lifecycle.handleReturn(`${callback}?result=rejected&reason=user_rejected&nonce=x&state=x`);
  assert.equal(rejected.rejected,true);assert.equal(rejected.authoritative,false);
  assert.equal((await lifecycle.disconnect()).status,"disconnected");
  const restarted=await lifecycle.restart(false);
  assert.equal(restarted.status,"retry-required");assert.equal(restarted.authoritative,false);
  assert.deepEqual(runtime.calls.map(([method])=>method),["handleReturn","disconnect","restore"]);
  assert.deepEqual(runtime.calls.at(-1),["restore",false]);
});
