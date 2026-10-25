import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import fixture from '../../../test/fixtures/pq-account-initial-public.json' with {type:'json'};
import {FileTransactionIntentStore} from '../../transaction-intent-store.mjs';
import {appendPQBroadcastActions} from '../../wallet-pq-broadcast-ui.mjs';
import {createPQTransactionSubmission} from './submission.mjs';
const member=Buffer.from(fixture.wire,'base64url'),account=fixture.expected.owner,hash=fixture.transportHash,networkId=fixture.expected.chainId;
function savedResponse(committed){
 const H=fixture.expected.executionHeight,v={type:'account_initial',status:committed?'committed':'unknown',committed,source:'comet-rpc',nativeTransactionHash:hash,abciTransactionHash:fixture.abciTransactionHash,wire:member.toString('base64'),executionHeight:committed?H:'0',amount:'0',fee:'0',nonce:committed?'1':'0',readbackUrl:'/transactions/pq/originals/'+hash};
 if(committed)Object.assign(v,{from:account,to:account,cometIndex:0,transaction:{hash,type:'account_initial',from:account,to:account,amount:0,fee:0,nonce:1,blockNumber:Number(H),timestamp:'2026-10-26T00:00:00Z',memo:'ynx-pq-account-initial-v1:'+member.toString('hex')}});else v.error='PUBLIC saved pending';
 const text=JSON.stringify(v).replace('"blockNumber":'+String(Number(H)),'"blockNumber":'+H);
 return{method:'POST',requestPath:'/accounts/'+account+'/authorization/register',status:committed?200:202,contentType:'application/json',cacheControl:'no-store',body:Buffer.from(text)};
}
for(const committed of [false,true])test(`saved Main initial ${committed?'inclusion':'UNKNOWN'} reopens through existing query UI without approval or POST`,async t=>{
 assert.equal(fixture.realAccount,false);assert.equal(fixture.SourceAdmission,false);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-public-initial-readonly-result-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const filePath=path.join(dir,'journal.json'),store=new FileTransactionIntentStore({filePath});
 // Seed the frozen Main controller's retained raw-result contract with PUBLIC
 // test bytes. This test executes no broadcast controller, grant or POST.
 await store.reserveOriginal(account,'pq-account-initial');store.capturePQAccountInitialMember(account,member,{expected:fixture.expected,operationId:'PUBLIC-original-sign-result'});await store.saveOriginal(account,hash,()=>{});await store.beginPQSubmission(account,hash,()=>{});await store.savePQAccountInitialSubmissionResult(account,hash,savedResponse(committed));
 const original=(await store.readPQOriginals(account,()=>{}))[0],cold=new FileTransactionIntentStore({filePath}),reads=[],forbidden=[];
 const no=name=>()=>{forbidden.push(name);throw Error('READONLY_ONLY')};
 const controller=createPQTransactionSubmission({intentStore:cold,networkId,transport:{async readOriginal(nativeHash){reads.push(nativeHash);return{status:202,text:JSON.stringify({status:'unknown',committed:false,source:'comet-rpc',nativeTransactionHash:nativeHash,executionHeight:'0',amount:'0',fee:'0',nonce:'0',readbackUrl:'/transactions/pq/originals/'+nativeHash,error:'PUBLIC later unknown'})}},submitTransfer:no('transferPOST'),submitTypedAction:no('typedPOST'),submitAccountInitial:no('initialPOST')},acquireOriginalWalletTransactionPermission:no('approval'),isOriginalWalletTransactionPermission:no('ordinary-brand')});
 const guard={account,assert(){},assertEffectCurrent(){},submit:no('effect')},elements=[],messages=[],results=[];let refreshes=0;
 const document={createElement(tag){return{tag,textContent:'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn}}}},record={account,hash,kind:'pq-account-initial',status:committed?'pq-inclusion-observed':'pq-submission-unknown'};
 appendPQBroadcastActions({row:{append:el=>elements.push(el)},record,api:{async queryPQSubmission(nativeHash){const value=await controller.reconcile(nativeHash,guard);results.push(value);return{ok:true,value}},preparePQBroadcast:no('broadcast-preview'),preparePQAccountInitialBroadcast:no('initial-preview')},getKeyState:()=>({account,locked:false,authenticating:false,revision:1}),isCurrent:()=>true,onResult:text=>messages.push(text),onRefresh:()=>{refreshes++},document});
 assert.equal(elements.length,1);await elements[0].listeners.click();await elements[0].listeners.click();assert.deepEqual(reads,[hash]);assert.deepEqual(forbidden,[]);assert.equal(refreshes,1);assert.match(messages[0],/Same submission read/);
 const view=results[0];assert.equal(view.kind,'pq-account-initial');assert.equal(view.hash,hash);assert.equal(view.status,committed?'inclusion-observed':'submission-unknown');for(const key of ['consensusFinality','canRetry','clearsOriginal'])assert.equal(view[key],false);for(const key of ['wire','initialBinding','request','sourceGrant'])assert.equal(key in view,false);
 const reopened=new FileTransactionIntentStore({filePath});assert.deepEqual(await reopened.readPQOriginals(account,()=>{}),[original]);assert.equal(original.initialBinding.executionHeight,fixture.expected.executionHeight);assert.equal(original.abciTransactionHash,fixture.abciTransactionHash);
 const saved=JSON.parse(await fs.readFile(filePath,'utf8')).pqProgress[0];assert.equal(saved.result.method,'POST');assert.equal(saved.result.requestPath,'/accounts/'+account+'/authorization/register');assert.equal(saved.nativeTransactionHash,hash);assert.equal(saved.abciTransactionHash,fixture.abciTransactionHash);assert.equal(saved.status,committed?'inclusion-observed':'submission-unknown');
});
