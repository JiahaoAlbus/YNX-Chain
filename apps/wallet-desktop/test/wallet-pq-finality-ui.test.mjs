import test from 'node:test';
import assert from 'node:assert/strict';
import {appendPQFinalityActions} from '../src/wallet-pq-finality-ui.mjs';
const account='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),record={kind:'pq-transfer',account,hash,status:'pq-submission-unknown'};
const value=()=>({account,hash,nativeTransactionHash:hash,status:'pending',rawStored:true,consensusFinality:false,independentFinality:false,canRetry:false,clearsOriginal:false});
const restored=(heldLocally=false)=>({account,hash,records:[],unreadable:0,heldLocally,consensusFinality:false,independentFinality:false,canRetry:false,clearsOriginal:false});
function fixture(withVerification=false,selectedRecord=record){
 let state={account,revision:1,locked:false},attached=true,reply=async method=>({ok:true,value:method==='restore'?restored():value()});const calls=[],messages=[],row={children:[],append(n){this.children.push(n);}},document={createElement(){return {hidden:false,disabled:false,addEventListener(t,fn){this[t]=fn;}};}},api=Object.fromEntries([['collectPQFinalityEvidence','collect'],['restorePQFinalityEvidence','restore'],['savePQFinalityEvidence','save']].map(([name,method])=>[name,async h=>{calls.push([method,h]);return reply(method);} ]));
 if(withVerification)api.verifyPQFinalityEvidence=async h=>{calls.push(['verify',h]);return reply('verify');};
 appendPQFinalityActions({row,record:selectedRecord,api,getKeyState:()=>state,isCurrent:()=>attached,onResult:m=>messages.push(m),document});
 return {buttons:row.children,calls,messages,change:s=>{state={...state,...s};},detach:()=>{attached=false;},reply:fn=>{reply=fn;}};
}
test('only explicit readonly actions are offered and successful collection never claims verified finality or sends',async()=>{
 const f=fixture();assert.equal(f.buttons.length,3);assert.equal(f.buttons[2].hidden,true);assert.equal(f.calls.length,0);await f.buttons[0].click();assert.deepEqual(f.calls,[['collect',hash]]);assert.match(f.messages.at(-1),/not independently verified/);assert.equal(f.buttons[2].hidden,true);
});
test('typed evidence offers only read/restore/save and binds distinct observed Member versus journal hashes',async()=>{
 const typed={...record,kind:'pq-typed-action',operationId:'typed-evidence-ui'},memberHash='0x'+'3'.repeat(64),f=fixture(true,typed);
 assert.equal(f.buttons.length,3);
 f.reply(async()=>({ok:true,value:{...value(),kind:typed.kind,operationId:typed.operationId,transportHash:hash,memberHash,observedNativeTransactionHash:memberHash}}));
 await f.buttons[0].click();assert.deepEqual(f.calls,[['collect',hash]]);assert.match(f.messages.at(-1),/not independently verified/);
 assert.equal(f.buttons.some(b=>b.textContent.includes('Check proof with original Host')),false);
});
test('typed collection rejects a substituted observed Member without enabling any verification or send',async()=>{
 const typed={...record,kind:'pq-typed-action',operationId:'typed-evidence-ui'},f=fixture(true,typed);
 f.reply(async()=>({ok:true,value:{...value(),kind:typed.kind,operationId:typed.operationId,transportHash:hash,memberHash:'0x'+'3'.repeat(64),observedNativeTransactionHash:hash}}));
 await f.buttons[0].click();assert.match(f.messages.at(-1),/unbound/);assert.equal(f.calls.length,1);assert.equal(f.buttons.length,3);
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
test('normal Host action reports missing source without presenting a verified result or silently retrying',async()=>{
 const f=fixture(true);assert.equal(f.buttons.length,4);f.reply(async()=>({ok:false,error:{code:'PQ_HOST_SOURCE_NOT_SUPPLIED'}}));await f.buttons[3].click();assert.match(f.messages.at(-1),/verification unavailable/);assert.equal(f.buttons[3].disabled,true);await f.buttons[3].click();assert.deepEqual(f.calls,[['verify',hash]]);
});
test('same-original verification DATA is never painted as finality or a send',async()=>{
 const f=fixture(true);f.reply(async()=>({ok:true,value:{account,hash,status:'verifier-result-data',rawStored:true,consensusFinality:false,independentFinality:false,canRetry:false,clearsOriginal:false}}));await f.buttons[3].click();assert.match(f.messages.at(-1),/not independently verified/);assert.deepEqual(f.calls,[['verify',hash]]);
});
test('explicit verifier error is displayed distinctly without declaring transaction failure or authorizing retry',async()=>{
 const f=fixture(true);f.reply(async()=>({ok:true,value:{account,hash,status:'verifier-error-data',rawStored:true,consensusFinality:false,independentFinality:false,canRetry:false,clearsOriginal:false}}));await f.buttons[3].click();assert.match(f.messages.at(-1),/Proof verification returned an error/);assert.match(f.messages.at(-1),/does not establish transaction failure/);assert.deepEqual(f.calls,[['verify',hash]]);
});
test('cold recovery distinguishes bound verifier errors, incomplete runs and unverified evidence without querying again',async()=>{
 const f=fixture(true);f.reply(async()=>({ok:true,value:{...restored(),records:[{...value(),nativeGrant:false,status:'verifier-error-data'},{...value(),nativeGrant:false,status:'verifier-incomplete'},{status:'evidence-unverified'}]}}));await f.buttons[1].click();
 assert.match(f.messages.at(-1),/Saved verifier errors: 1/);assert.match(f.messages.at(-1),/Incomplete verifier runs: 1/);assert.match(f.messages.at(-1),/Unverified local records: 1/);assert.match(f.messages.at(-1),/not independently verified/);assert.deepEqual(f.calls,[['restore',hash]]);
});
test('foreign or permission-inflated cold verifier records are unverified warnings, not trusted saved outcomes',async()=>{
 for(const change of [{hash:'0x'+'3'.repeat(64)},{account:'0x'+'4'.repeat(40)},{canRetry:true},{nativeGrant:true}]){const f=fixture(true);f.reply(async()=>({ok:true,value:{...restored(),records:[{...value(),status:'verifier-error-data',nativeGrant:false,...change}]}}));await f.buttons[1].click();assert.doesNotMatch(f.messages.at(-1),/Saved verifier errors: 1/);assert.match(f.messages.at(-1),/Unverified local records: 1/);assert.deepEqual(f.calls,[['restore',hash]]);}
});
