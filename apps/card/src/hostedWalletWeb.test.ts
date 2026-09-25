import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createCardHostedWalletController} from "./hostedWalletWeb";
import {discoverWalletProviders,peekExactYNXProvider} from "./standardWalletSdk";
import type {HostedWalletAdapter} from "../vendor/hosted-wallet-adapter-19d8a9a2.js";

const account="0x"+"a".repeat(40);
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(options:{chain?:string;onConnect?:()=>Promise<readonly string[]>}={}){
  const listeners=new Map<string,Set<(...args:readonly unknown[])=>void>>();
  const approval=deferred<readonly string[]>();let opens=0,disconnects=0,restores=0;
  const adapter:HostedWalletAdapter={
    connect:()=>{opens++;return options.onConnect?.()??approval.promise;},
    request:async input=>input.method==="eth_chainId"?(options.chain??"0x1917"):null,
    restore:async()=>{restores++;return [];},
    disconnect:async()=>{disconnects++;},revoke:async()=>{},detach:async()=>{},
    on:(name,listener)=>{const list=listeners.get(name)??new Set();list.add(listener);listeners.set(name,list);},
    removeListener:(name,listener)=>listeners.get(name)?.delete(listener),connected:false,account:null,
  };
  const states=[] as string[];
  const controller=createCardHostedWalletController({window:{} as Window,adapterFactory:()=>adapter,onState:state=>states.push(state.status)});
  const emit=(name:string,value?:unknown)=>{for(const listener of listeners.get(name)??[])listener(value);};
  return {adapter,controller,approval,emit,states,get opens(){return opens},get disconnects(){return disconnects},get restores(){return restores}};
}

test("Card vendors the byte-identical accepted Wallet-owned adapter, not a Card signer",()=>{
  const bytes=readFileSync(new URL("../vendor/hosted-wallet-adapter-19d8a9a2.js",import.meta.url));
  assert.equal(bytes.length,11468);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"96da4fe51649b237fa26efa7253a6efc9f6695a35c588ba192f03e0bec7d2126");
});
test("official popup opens synchronously in the click stack; only approval and exact chain admit an account",async()=>{
  const h=harness();const pending=h.controller.connect();assert.equal(h.opens,1);assert.equal(h.controller.getState().status,"connecting");
  h.emit("accountsChanged",[account]);assert.equal(h.controller.getState().account,null);
  h.approval.resolve([account]);assert.deepEqual(await pending,{status:"connected",account,chainId:"0x1917",error:null});
  assert.equal(h.restores,0);
});
test("rejection after adapter empty-account event stays rejection and cannot connect",async()=>{
  const h=harness();const pending=h.controller.connect();h.emit("accountsChanged",[]);
  h.approval.reject(Object.assign(new Error("declined"),{code:"USER_REJECTED"}));
  const result=await pending;assert.equal(result.status,"rejected");assert.equal(result.error,"USER_REJECTED");assert.equal(result.account,null);
});
test("blocked and closed popups fail without account; a fresh explicit Retry opens once",async()=>{
  let attempts=0;const h=harness({onConnect:()=>{attempts++;if(attempts===1)throw Object.assign(new Error("blocked"),{code:"HOSTED_POPUP_BLOCKED"});if(attempts===2)return Promise.reject(Object.assign(new Error("closed"),{code:"HOSTED_POPUP_CLOSED"}));return Promise.resolve([account]);}});
  assert.equal((await h.controller.connect()).error,"HOSTED_POPUP_BLOCKED");assert.equal((await h.controller.connect()).error,"HOSTED_POPUP_CLOSED");
  assert.equal((await h.controller.connect()).status,"connected");assert.equal(h.opens,3);assert.equal(h.states.filter(value=>value==="connected").length,1);
});
test("disconnect cancels pending approval immediately and discards late success",async()=>{
  const h=harness();const pending=h.controller.connect();const disconnected=await h.controller.disconnect();
  assert.equal(disconnected.status,"disconnected");assert.equal((await pending).status,"disconnected");
  h.approval.resolve([account]);await tick();assert.equal(h.controller.getState().status,"disconnected");assert.equal(h.states.filter(value=>value==="connected").length,0);
});
test("account, chain and provider changes invalidate the approved subject",async()=>{
  for(const [event,value,error] of [["accountsChanged",["0x"+"b".repeat(40)],"HOSTED_ACCOUNT_CHANGED"],["chainChanged","0x1","WRONG_NETWORK"],["disconnect",undefined,"HOSTED_DISCONNECTED"]] as const){
    const h=harness({onConnect:async()=>[account]});assert.equal((await h.controller.connect()).status,"connected");
    h.emit(event,value);assert.equal(h.controller.getState().account,null);assert.equal(h.controller.getState().error,error);
  }
});
test("switch-account opens a new Wallet-owned popup synchronously and never reuses approval",async()=>{
  const h=harness({onConnect:async()=>[account]});await h.controller.connect();
  const switched=h.controller.switchAccount();assert.equal(h.opens,2);assert.equal((await switched).status,"connected");
  assert.ok(h.disconnects>=1);
});
test("refresh creates no hosted account from local state, and exact YNX cache never selects MetaMask",async()=>{
  const h=harness();const newPage=harness();assert.equal(newPage.controller.getState().status,"disconnected");assert.equal(newPage.restores,0);
  const ynx={isYNXWallet:true,isMetaMask:false,providerInfo:{rdns:"com.ynx.wallet"},request:async()=>"0x1917"};
  const metamask={isMetaMask:true,isYNXWallet:false,providerInfo:{rdns:"io.metamask"},request:async()=>"0x1917"};
  const scope={ethereum:{providers:[ynx,metamask]}};
  await discoverWalletProviders(scope,0);assert.equal(peekExactYNXProvider(scope),ynx);assert.notEqual(peekExactYNXProvider(scope),metamask);
  assert.equal(peekExactYNXProvider({ethereum:metamask}),null);
  await h.controller.disconnect();
});
