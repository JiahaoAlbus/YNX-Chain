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
function fixture(account='TEST-A'){
 const panel=new Element(),doc={querySelector:()=>panel,createElement:()=>new Element()};
 let state={account,revision:1,locked:false,authenticating:false},generates=0,reads=0,reconciles=0;
 const api={generatePQKeys:async()=>{generates++;return {ok:true,value:{persisted:true,phase:'saved'}};},recoverPQKeys:async()=>{reads++;reconciles++;return {ok:true,value:{persisted:true,phase:'saved'}};}};
 const ui=createPQKeyPreparationUI({api,getKeyState:()=>state,document:doc});ui.render();
 const [title,help,prepare,check,result,dialog]=panel.children[0].children,[notice,confirm,cancel]=dialog.children;
 return {ui,api,prepare,check,result,dialog,confirm,cancel,policyCheck:panel.children[0].children[6],policyResult:panel.children[0].children[7],publicRead:panel.children[0].children[8],publicResult:panel.children[0].children[9],publicDetails:panel.children[0].children[10],get publicJSON(){return panel.children[0].children[10]?.children[1];},lock:()=>state={...state,revision:2,locked:true},counts:()=>({generates,reads,reconciles})};
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
 const f=fixture();let reads=0;f.api.pqAccountAuthorization=async()=>{reads++;return {ok:true,value:policyValue()};};f.ui.render();f.policyCheck.click();await settled();assert.equal(reads,1);assert.match(f.policyResult.textContent,/active/);assert.match(f.policyResult.textContent,/nonce: 1/);assert.equal(f.dialog.open,false);assert.equal(f.counts().generates,0);
});
test('normal policy UI discards late result on lock and invalidation',async()=>{
 const f=fixture();let release;f.api.pqAccountAuthorization=()=>new Promise(r=>release=r);f.ui.render();f.policyCheck.click();f.lock();f.ui.invalidate();release({ok:true,value:policyValue()});await settled();assert.equal(f.policyResult.textContent,'');assert.equal(f.policyCheck.disabled,true);
});
test('normal policy UI retains unavailable instead of displaying legacy or accepting another owner',async()=>{
 for(const response of [{ok:false,error:{code:'AUTH_POLICY_SOURCE_UNAVAILABLE'}},{ok:true,value:{...policyValue(),account:'TEST-B'}},{ok:true,value:{...policyValue(),signingAuthorized:true}}]){
  const f=fixture();f.api.pqAccountAuthorization=async()=>response;f.ui.render();f.policyCheck.click();await settled();assert.match(f.policyResult.textContent,/account state not inferred/);assert.equal(f.counts().generates,0);
 }
});

const publicOwner='0x'+'11'.repeat(20);
const publicPacket=()=>({kind:'YNX_WALLET_PQ_PUBLIC_PROPOSAL/v1',protocolVersion:'YNX-BATCH/v0.1',suite:'ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512',networkId:'ab'.repeat(32),nativeChainId:'6423',owner:publicOwner,pkA:'cd'.repeat(2592),pkB:'ef'.repeat(64),publicBindingSHA256:'12'.repeat(32),chainRegistrationVerified:false,SourceAdmission:false,signed:false,broadcast:false,privateMaterialIncluded:false});
test('public proposal: normal button reads only existing public tuple and does not prepare keys',async()=>{
 const f=fixture(publicOwner);let calls=0,args;f.api.readPQPublicProposal=async(...a)=>{calls++;args=a;return {ok:true,value:publicPacket()};};f.ui.render();assert(f.publicRead);f.publicRead.click();await settled();assert.equal(calls,1);assert.deepEqual(args,[]);assert.deepEqual(JSON.parse(f.publicJSON.value),publicPacket());assert.equal(f.publicDetails.hidden,false);assert.match(f.publicResult.textContent,/registration not verified/);assert.deepEqual(f.counts(),{generates:0,reads:0,reconciles:0});assert.equal(f.dialog.open,false);
});
test('public proposal: extra private fields and authority claims never reach displayed JSON',async()=>{
 for(const delta of [{credential:'PUBLIC-sensitive-must-not-render'},{wire:'PUBLIC-sensitive-must-not-render'},{SourceAdmission:true},{owner:'0x'+'22'.repeat(20)},{pkA:'ff'}]){const f=fixture(publicOwner);f.api.readPQPublicProposal=async()=>({ok:true,value:{...publicPacket(),...delta}});f.ui.render();assert(f.publicRead);f.publicRead.click();await settled();assert.equal(f.publicJSON.value,'');assert.equal(f.publicDetails.hidden,true);assert.doesNotMatch(f.publicResult.textContent,/PUBLIC-sensitive/);assert.deepEqual(f.counts(),{generates:0,reads:0,reconciles:0});}
});
test('public proposal: pending read is single-flight and lock discards its late public result',async()=>{
 const f=fixture(publicOwner);let release,calls=0;f.api.readPQPublicProposal=()=>{calls++;return new Promise(r=>release=r);};f.ui.render();assert(f.publicRead);f.publicRead.click();f.publicRead.click();assert.equal(calls,1);f.lock();f.ui.invalidate();release({ok:true,value:publicPacket()});await settled();assert.equal(f.publicJSON.value,'');assert.equal(f.publicResult.textContent,'');assert.equal(f.publicDetails.hidden,true);assert.equal(f.publicRead.disabled,true);
});
test('public proposal: rendering a new locked generation clears an already shown tuple',async()=>{
 const f=fixture(publicOwner);f.api.readPQPublicProposal=async()=>({ok:true,value:publicPacket()});f.ui.render();assert(f.publicRead);f.publicRead.click();await settled();assert(f.publicJSON.value);f.lock();f.ui.render();assert.equal(f.publicJSON.value,'');assert.equal(f.publicDetails.hidden,true);assert.equal(f.publicRead.disabled,true);
});
