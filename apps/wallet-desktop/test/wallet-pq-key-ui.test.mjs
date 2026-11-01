import test from 'node:test';
import assert from 'node:assert/strict';
import {createPQKeyPreparationUI} from '../src/wallet-pq-key-ui.mjs';
class Element{
 children=[];listeners={};disabled=false;open=false;
 append(...nodes){this.children.push(...nodes);}setAttribute(){}
 addEventListener(type,listener){this.listeners[type]=listener;}
 showModal(){this.open=true;}close(){this.open=false;}
 click(){this.listeners.click?.();}
}
function fixture(){
 const panel=new Element(),doc={querySelector:()=>panel,createElement:()=>new Element()};
 let state={account:'TEST-A',revision:1,locked:false,authenticating:false},generates=0,reads=0,reconciles=0;
 const api={generatePQKeys:async()=>{generates++;return {ok:true,value:{persisted:true,phase:'saved'}};},recoverPQKeys:async()=>{reads++;reconciles++;return {ok:true,value:{persisted:true,phase:'saved'}};}};
 const ui=createPQKeyPreparationUI({api,getKeyState:()=>state,document:doc});ui.render();
 const [title,help,prepare,check,result,dialog]=panel.children[0].children,[notice,confirm,cancel]=dialog.children;
 return {ui,api,prepare,check,result,dialog,confirm,cancel,policyCheck:panel.children[0].children[6],policyResult:panel.children[0].children[7],lock:()=>state={...state,revision:2,locked:true},counts:()=>({generates,reads,reconciles})};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('PQ preparation UI requires modal confirmation; cancel does not generate',async()=>{
 const f=fixture();f.prepare.click();assert.equal(f.dialog.open,true);assert.equal(f.counts().generates,0);
 f.cancel.click();assert.equal(f.dialog.open,false);assert.equal(f.counts().generates,0);
 f.prepare.click();f.confirm.click();await settled();assert.equal(f.counts().generates,1);assert.equal(f.prepare.disabled,true);assert.match(f.result.textContent,/尚非独立备份/);
});
test('PQ modal approval is invalidated by lock and cannot generate late',async()=>{
 const f=fixture();f.prepare.click();f.lock();f.ui.invalidate();f.confirm.click();await settled();
 assert.equal(f.dialog.open,false);assert.equal(f.counts().generates,0);assert.equal(f.prepare.disabled,true);
});
test('PQ original-result button reconciles unknown save without generating',async()=>{
 const f=fixture();f.check.click();await settled();assert.deepEqual(f.counts(),{generates:0,reads:1,reconciles:1});assert.equal(f.prepare.disabled,true);
});
test('PQ existing-record refusal points to original-result check, not a newly unknown key generation',async()=>{
 const f=fixture();f.api.generatePQKeys=async()=>({ok:false,error:{code:4100,data:{code:'PASSWORD_VAULT_PQ_ORIGINAL_EXISTS'}}});f.prepare.click();f.confirm.click();await settled();assert.match(f.result.textContent,/已有原密钥或原准备记录/);assert.equal(f.counts().reconciles,0);
});

const policyValue=()=>({account:'TEST-A',authorizationStatus:'active',ledgerNonce:'1',committedHeight:'2',executionHeight:'3',policyRevision:'1',readOnly:true,signingAuthorized:false});
test('normal policy button queries selected owner without key generation or approval modal',async()=>{
 const f=fixture();let reads=0;f.api.pqAccountAuthorization=async()=>{reads++;return {ok:true,value:policyValue()};};f.policyCheck.click();await settled();assert.equal(reads,1);assert.match(f.policyResult.textContent,/active/);assert.match(f.policyResult.textContent,/nonce: 1/);assert.equal(f.dialog.open,false);assert.equal(f.counts().generates,0);
});
test('normal policy UI discards late result on lock and invalidation',async()=>{
 const f=fixture();let release;f.api.pqAccountAuthorization=()=>new Promise(r=>release=r);f.policyCheck.click();f.lock();f.ui.invalidate();release({ok:true,value:policyValue()});await settled();assert.equal(f.policyResult.textContent,'');assert.equal(f.policyCheck.disabled,true);
});
test('normal policy UI retains unavailable instead of displaying legacy or accepting another owner',async()=>{
 for(const response of [{ok:false,error:{code:'AUTH_POLICY_SOURCE_UNAVAILABLE'}},{ok:true,value:{...policyValue(),account:'TEST-B'}},{ok:true,value:{...policyValue(),signingAuthorized:true}}]){
  const f=fixture();f.api.pqAccountAuthorization=async()=>response;f.policyCheck.click();await settled();assert.match(f.policyResult.textContent,/account state not inferred/);assert.equal(f.counts().generates,0);
 }
});
