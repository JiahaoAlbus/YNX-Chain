import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
const base=process.env.PUBLIC_NATIVE_PARENT?pathToFileURL(process.env.PUBLIC_NATIVE_PARENT+'/'):new URL('../src/',import.meta.url);
const {setWalletCopy}=await import(new URL('wallet-locale.mjs',base));
const helper=process.env.PUBLIC_ATTEMPT_UI?pathToFileURL(process.env.PUBLIC_ATTEMPT_UI):new URL('../src/transfer-attempt-ui.mjs',import.meta.url);
const text=readFileSync(helper,'utf8');
const context={setWalletCopy};
runInNewContext(text.replace(/^import .*;$/mg,'').replace('export function ','function ')+'\nthis.make=createTransferAttemptUI;',context);
const account='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const record=(extra={})=>({account,attempt:2,stage:'submitting',state:'result-unconfirmed',code:'EXTERNAL_OUTCOME_UNKNOWN',updatedAt:50,...extra});
function fixture(request){
 let actor=account,calls=0;
 const node={hidden:true,textContent:''};
 const ui=context.make({node,getAccount:()=>actor,request:value=>{calls++;return request(value);}});
 return{ui,node,switch:value=>actor=value,calls:()=>calls};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
for(const state of ['result-unconfirmed','submitted','rejected-before-submission']){
 for(const failure of ['throw','error']){
  test('R65 known '+state+' survives same-account refresh '+failure,async()=>{
   const f=fixture(async()=>{if(failure==='throw')throw Error('PUBLIC_IPC_READ_FAILED');return{ok:false,error:{code:'PUBLIC_READ_FAILED'}};});
   f.ui.receive(record({state}));const before=f.node.textContent;
   await f.ui.refresh();
   assert.equal(f.node.hidden,false,'a failed read must not erase known transfer progress');
   assert.equal(f.node.textContent,before);assert.equal(f.calls(),1);
  });
 }
}
test('R65 pending same-account snapshot keeps visible unknown, then older snapshot cannot roll it back',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.ui.receive(record());const before=f.node.textContent;
 const work=f.ui.refresh();assert.equal(f.node.textContent,before);assert.equal(f.node.hidden,false);
 pending.resolve({ok:true,value:[record({attempt:1,state:'in-progress',code:null})]});await work;
 assert.equal(f.node.textContent,before);
});
test('R65 empty or malformed read is not authority to erase the last known attempt',async()=>{
 for(const value of [[],null,[{account,attempt:-1}],{}]){
  const f=fixture(async()=>({ok:true,value}));f.ui.receive(record());const before=f.node.textContent;
  await f.ui.refresh();assert.equal(f.node.textContent,before);assert.equal(f.node.hidden,false);
 }
});
test('R65 newer valid snapshot replaces old known progress',async()=>{
 const f=fixture(async()=>({ok:true,value:[record({attempt:3,state:'submitted',code:null,updatedAt:70})]}));
 f.ui.receive(record());await f.ui.refresh();
 assert.match(f.node.textContent,/submitted/);assert.doesNotMatch(f.node.textContent,/EXTERNAL_OUTCOME_UNKNOWN/);
});
test('R65 event during snapshot owns view and cannot be overwritten by late old read',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.ui.receive(record());
 const work=f.ui.refresh();f.ui.receive(record({attempt:3,state:'submitted',code:null,updatedAt:70}));const current=f.node.textContent;
 pending.resolve({ok:true,value:[record()]});await work;
 assert.equal(f.node.textContent,current);
});
test('R65 actor switch clears immediately; late foreign response/event stays hidden',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.ui.receive(record());
 f.switch(other);const work=f.ui.refresh();
 assert.equal(f.node.hidden,true);assert.equal(f.node.textContent,'');
 pending.resolve({ok:true,value:[record()]});await work;f.ui.receive(record());
 assert.equal(f.node.hidden,true);assert.equal(f.node.textContent,'');
});
test('R65 no selected actor clears without a read',async()=>{
 const f=fixture(async()=>{throw Error('PUBLIC_MUST_NOT_READ');});f.ui.receive(record());f.switch(null);
 await f.ui.refresh();assert.equal(f.node.hidden,true);assert.equal(f.node.textContent,'');assert.equal(f.calls(),0);
});
test('R65 actual renderer refreshes attempt projection during same-account account render',()=>{
 const renderer=readFileSync(new URL('renderer.js',base),'utf8'),a=renderer.indexOf('function renderAccount('),b=renderer.indexOf('\nfunction ',a+1);
 const caller=renderer.slice(a,b);
 const selected=caller.indexOf('activeAccount = status?.account ?? null');assert.ok(selected>=0);
 assert.match(caller.slice(selected),/if\(typeof transferAttemptUI!=="undefined"\)void transferAttemptUI\.refresh\(\);/);
});
