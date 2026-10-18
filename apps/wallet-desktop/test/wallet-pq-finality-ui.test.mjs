import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPQFinalityActions} from '../src/wallet-pq-finality-ui.mjs';
const account='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),record={kind:'pq-transfer',account,hash,status:'pq-submission-unknown'};
const value=()=>({account,hash,nativeTransactionHash:hash,status:'pending',rawStored:true,consensusFinality:false,independentFinality:false,canRetry:false,clearsOriginal:false});
const restored=(heldLocally=false)=>({account,hash,records:[],unreadable:0,heldLocally,consensusFinality:false,independentFinality:false,canRetry:false,clearsOriginal:false});
function fixture(){
 let state={account,revision:1,locked:false},attached=true,reply=async method=>({ok:true,value:method==='restore'?restored():value()});const calls=[],messages=[],row={children:[],append(n){this.children.push(n);}},document={createElement(){return {hidden:false,disabled:false,addEventListener(t,fn){this[t]=fn;}};}},api=Object.fromEntries([['collectPQFinalityEvidence','collect'],['restorePQFinalityEvidence','restore'],['savePQFinalityEvidence','save']].map(([name,method])=>[name,async h=>{calls.push([method,h]);return reply(method);} ]));
 appendPQFinalityActions({row,record,api,getKeyState:()=>state,isCurrent:()=>attached,onResult:m=>messages.push(m),document});
 return {buttons:row.children,calls,messages,change:s=>{state={...state,...s};},detach:()=>{attached=false;},reply:fn=>{reply=fn;}};
}
test('only explicit readonly actions are offered and successful collection never claims verified finality or sends',async()=>{
 const f=fixture();assert.equal(f.buttons.length,3);assert.equal(f.buttons[2].hidden,true);assert.equal(f.calls.length,0);await f.buttons[0].click();assert.deepEqual(f.calls,[['collect',hash]]);assert.match(f.messages.at(-1),/not independently verified/);assert.equal(f.buttons[2].hidden,true);
});
test('duplicate pending collection is single flight; lost acknowledgement requires an explicit local restore before another query',async()=>{
 const f=fixture();let release;f.reply(()=>new Promise((_,reject)=>{release=reject;}));const work=f.buttons[0].click();await f.buttons[0].click();assert.equal(f.calls.length,1);release(Error('PUBLIC lost acknowledgement'));await work;await f.buttons[0].click();assert.equal(f.calls.length,1);assert.equal(f.buttons[0].disabled,true);
 f.reply(async()=>({ok:true,value:restored()}));await f.buttons[1].click();assert.equal(f.buttons[0].disabled,false);assert.deepEqual(f.calls,[['collect',hash],['restore',hash]]);
});
test('only bound restore can expose a same-original local save, never a generic error from another account debt',async()=>{
 const f=fixture();f.reply(async()=>({ok:false,error:{code:'PQ_FINALITY_EVIDENCE_UNCONFIRMED'}}));await f.buttons[0].click();assert.equal(f.buttons[2].hidden,true);await f.buttons[2].click();assert.equal(f.calls.length,1);
 f.reply(async()=>({ok:true,value:restored(true)}));await f.buttons[1].click();assert.equal(f.buttons[2].hidden,false);assert.equal(f.buttons[0].disabled,true);f.reply(async()=>({ok:true,value:value()}));await f.buttons[2].click();assert.equal(f.buttons[2].hidden,true);assert.deepEqual(f.calls.map(x=>x[0]),['collect','restore','save']);
});
test('lock, account revision and detached rows cannot publish late evidence results or start another action',async()=>{
 for(const mode of ['lock','account','revision','detach']){const f=fixture();let release;f.reply(()=>new Promise(resolve=>{release=resolve;}));const work=f.buttons[0].click();if(mode==='lock')f.change({locked:true});if(mode==='account')f.change({account:'0x'+'3'.repeat(40)});if(mode==='revision')f.change({revision:2});if(mode==='detach')f.detach();release({ok:true,value:value()});await work;assert.equal(f.messages.length,0);if(mode!=='revision'){await f.buttons[1].click();assert.equal(f.calls.length,1);}}
});
test('foreign hashes and inflated finality/clearing/retry flags cannot be painted as valid evidence',async()=>{
 for(const change of [{hash:'0x'+'4'.repeat(64)},{consensusFinality:true},{independentFinality:true},{canRetry:true},{clearsOriginal:true},{rawStored:'true'}]){const f=fixture();f.reply(async()=>({ok:true,value:{...value(),...change}}));await f.buttons[0].click();assert.match(f.messages.at(-1),/unbound/);assert.equal(f.buttons[0].disabled,true);}
});
test('unavailable collector with empty native observation retains journal hash binding and never becomes not-found success',async()=>{
 const f=fixture();f.reply(async()=>({ok:true,value:{...value(),status:'unavailable',executionHeight:'0',nativeTransactionHash:''}}));await f.buttons[0].click();assert.match(f.messages.at(-1),/not independently verified/);assert.doesNotMatch(f.messages.at(-1),/transaction confirmed/);
});
