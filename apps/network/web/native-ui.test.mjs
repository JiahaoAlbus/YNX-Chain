// Controller protocol fixtures only. These cases do not establish native peer
// credentials, human approval, Wallet signatures, node execution or chain funds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,settle} from './test-support.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const ID='1'.repeat(32),OTHER='2'.repeat(32),CHAIN_RECORD='2'.repeat(24),HASH='a'.repeat(64);
const nodeCaps={install:false,start:true,stop:false,restart:false,visibleConsent:true,read:true,logs:true};
const partCaps={prepare:true,read:true,review:true,cancel:true,reconcile:true,submit:false,revoke:true,list:true};
const resourceCaps={read:true,meter:true,stop:true,review:true,cancelReview:true,productionDispatch:false};
const node=()=>({nodeId:'ordinary-node',stage:'installed',mode:'production',generation:'7',runId:'',processOwned:false,artifactSHA256:HASH,productionSupported:true});
const intent=()=>({managerId:'protocol-fixture',nodeId:'ordinary-node',action:'start',artifactSHA256:HASH,generation:'7'});
const entry=(state='PREPARED',id=ID)=>({id,state,intent:{request:{requestId:'local-fixture-correlation',owner:'0x'+'b'.repeat(40),action:'delegate'},generation:'1'},createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'});
const review=(e=entry())=>({version:'YNX-NETWORK-PARTICIPATION-REVIEW/v1',entry:e,authority:false,independentFinality:false,requiresWalletApproval:true,walletAdapterConfigured:true,originalEffectMayExist:false,conditionStatus:'CURRENT_RPC_REPORTED',canonicalAction:'AA==',displayOriginalMembers:[{original:'<script>not executable</script>'}]});
const response=payload=>({version:'YNX-NETWORK-LOCAL-IPC/v1',id:'fixture',code:'OK',peer:{uid:501,nativeIPCVerified:true,browserIdentityVerified:false},result:{payload}});
function setup(handler=()=>undefined,options={}){
 const calls=[];
 const native={available:true,ready:false,request:async(operation,payload)=>{calls.push({operation,payload});const given=await handler(operation,payload);if(given!==undefined)return given;switch(operation){case 'node_status':return response({code:'OK',node:node(),productionGrant:false,capabilities:{...nodeCaps}});case 'resource_status':case 'resource_meter':return response({code:'OK',productionEnabled:false,capabilities:{...resourceCaps},meter:{class:'CONTROLLED_SANDBOX',state:'disabled',activeWorkers:0,verifiedJobs:0,rewards:'NOT_AUTHORIZED'}});case 'participation_list':return response({code:'OK',entries:[],walletApproval:false,authority:false,capabilities:{...partCaps}});default:throw Object.assign(new Error('unconfigured fixture operation '+operation),{code:'FIXTURE_OPERATION_NOT_CONFIGURED',outcome:'NOT_SENT'});}}};
 const env=environment({native,...options});return {...env,calls,native,load:async()=>{native.ready=true;await env.window.NetworkOperations.refresh();await settle();}};
}
function fields(s,action='delegate'){
 const values={action,request:'local-fixture-correlation',owner:'0x'+'b'.repeat(40),target:action==='delegate'?'validator-original':action==='vote'?'proposal-original':CHAIN_RECORD,amount:'13',fee:'2',expires:new Date(Date.now()+300000).toISOString(),choice:'no'};
 for(const [name,value]of Object.entries(values))s.node('native-part-'+name).value=value;
}
async function select(s){s.node('native-part-id').value=ID;await s.emit('native-part-get-form','submit');await settle();}
async function doReview(s){s.emit('native-part-review','click');await settle();}

test('pending node start cancellation sends once while preserving the original busy request and readback requirement',async()=>{
 let finish,pending=false,cancels=0;const s=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:intent(),productionGrant:false}):op==='node_start'?(pending=true,new Promise(r=>{finish=r})):undefined);
 Object.defineProperty(s.native,'canCancelNodeStart',{get:()=>pending});s.native.cancelPendingNodeStart=()=>{cancels++;pending=false;return true};await s.load();await s.emit('native-node-start','click');s.emit('native-node-confirm','click');await settle();
 assert.equal(s.node('native-node-cancel-start-panel').hidden,false);assert.equal(s.node('native-node-cancel-start').hidden,false);assert.equal(s.node('native-node-cancel-start').disabled,false);const count=s.calls.length;
 s.emit('native-node-cancel-start','click');s.emit('native-node-cancel-start','click');assert.equal(cancels,1);assert.equal(s.calls.length,count);assert.match(s.node('native-node-cancel-start-note').textContent,/已请求取消启动/);assert.doesNotMatch(s.node('native-node-cancel-start-note').textContent,/已停止/);
 for(const id of ['native-node-start','native-node-stop','native-node-read','native-part-prepare','native-resource-review'])assert.equal(s.node(id).disabled,true,id);
 finish(response({code:'CANCELLED',node:null,productionGrant:false}));await settle();assert.equal(s.node('native-node-cancel-start').hidden,true);assert.equal(s.node('native-node-read').disabled,false);assert.match(s.node('native-node-operation-code').textContent,/CANCELLED/);assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.node('native-node-cancel-start-note').hidden,false);
 await s.emit('native-node-read','click');await settle();assert.equal(s.node('native-node-cancel-start-note').hidden,true);assert.equal(s.calls.filter(c=>c.operation==='node_start').length,1);assert.equal(s.calls.filter(c=>c.operation==='node_prepare').length,1);
});
test('pending node start cancellation false or throwing delivery never claims sent, completes early or retries UNKNOWN',async()=>{
 for(const throwing of [false,true]){let finish,pending=false,cancels=0;const s=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:intent(),productionGrant:false}):op==='node_start'?(pending=true,new Promise((_,reject)=>{finish=reject})):undefined);Object.defineProperty(s.native,'canCancelNodeStart',{get:()=>pending});s.native.cancelPendingNodeStart=()=>{cancels++;if(throwing)throw Error('PUBLIC TEST delivery uncertainty');return false};await s.load();await s.emit('native-node-start','click');s.emit('native-node-confirm','click');await settle();s.emit('native-node-cancel-start','click');s.emit('native-node-cancel-start','click');assert.equal(cancels,1);assert.match(s.node('native-node-cancel-start-note').textContent,/未能确认取消请求/);assert.equal(s.node('native-node-read').disabled,true);finish(Object.assign(new Error('cancel outcome unknown'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}));pending=false;await settle();assert.match(s.node('native-node-operation-code').textContent,/UNKNOWN/);assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.calls.filter(c=>c.operation==='node_start').length,1);assert.equal(s.calls.filter(c=>c.operation==='node_prepare').length,1);}
});
test('pending node start cancellation successful delivery still preserves UNKNOWN from the original Native Wait',async()=>{
 let finish,pending=false,cancels=0;const s=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:intent(),productionGrant:false}):op==='node_start'?(pending=true,new Promise((_,reject)=>{finish=reject})):undefined);Object.defineProperty(s.native,'canCancelNodeStart',{get:()=>pending});s.native.cancelPendingNodeStart=()=>{cancels++;pending=false;return true};await s.load();await s.emit('native-node-start','click');s.emit('native-node-confirm','click');await settle();s.emit('native-node-cancel-start','click');assert.equal(s.node('native-node-read').disabled,true);finish(Object.assign(new Error('original Native Wait cancelled'),{code:'NATIVE_REQUEST_CANCELLED',outcome:'UNKNOWN'}));await settle();assert.equal(cancels,1);assert.equal(s.node('native-node-operation-code').textContent,'UNKNOWN');assert.match(s.node('native-node-cancel-start-note').textContent,/已请求取消启动/);assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.node('native-node-read').disabled,false);assert.equal(s.calls.filter(c=>c.operation==='node_start').length,1);assert.equal(s.calls.filter(c=>c.operation==='node_prepare').length,1);
});
test('pending node start cancellation is unavailable for prepare, stop, legacy bridges and ordinary browsers',async()=>{
 const ordinary=environment();assert.equal(ordinary.node('native-node-cancel-start').hidden,true);assert.equal(ordinary.node('native-node-cancel-start').disabled,true);
 let finish;const preparing=setup(op=>op==='node_prepare'?new Promise(r=>{finish=r}):undefined);Object.defineProperty(preparing.native,'canCancelNodeStart',{get:()=>true});preparing.native.cancelPendingNodeStart=()=>{throw Error('must not cancel prepare')};await preparing.load();preparing.emit('native-node-start','click');await settle();assert.equal(preparing.node('native-node-cancel-start').hidden,true);preparing.emit('native-node-cancel-start','click');finish(response({code:'CANCELLED',node:null,productionGrant:false}));await settle();
 const stopping=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),stage:'running',processOwned:true},productionGrant:false,capabilities:{...nodeCaps,start:false,stop:true}}):op==='node_prepare'?response({code:'PREPARED',node:{...intent(),action:'stop'},productionGrant:false}):op==='node_stop'?new Promise(r=>{finish=r}):undefined);Object.defineProperty(stopping.native,'canCancelNodeStart',{get:()=>true});stopping.native.cancelPendingNodeStart=()=>{throw Error('must not cancel stop')};await stopping.load();await stopping.emit('native-node-stop','click');stopping.emit('native-node-confirm','click');await settle();assert.equal(stopping.node('native-node-cancel-start').hidden,true);stopping.emit('native-node-cancel-start','click');finish(response({code:'CANCELLED',node:null,productionGrant:false}));await settle();
 const legacy=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:intent(),productionGrant:false}):op==='node_start'?new Promise(r=>{finish=r}):undefined);await legacy.load();await legacy.emit('native-node-start','click');legacy.emit('native-node-confirm','click');await settle();assert.equal(legacy.node('native-node-cancel-start').hidden,true);finish(response({code:'CANCELLED',node:null,productionGrant:false}));await settle();
});
test('pending node start cancellation drops stale UI after session reset and preserves the new observation',async()=>{
 let finish,pending=false,cancels=0;const s=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:intent(),productionGrant:false}):op==='node_start'?(pending=true,new Promise(r=>{finish=r})):undefined);Object.defineProperty(s.native,'canCancelNodeStart',{get:()=>pending});s.native.cancelPendingNodeStart=()=>{cancels++;return true};await s.load();await s.emit('native-node-start','click');s.emit('native-node-confirm','click');await settle();s.emit('native-node-cancel-start','click');pending=false;s.native.ready=false;s.nativeState();await settle();assert.equal(s.node('native-node-cancel-start').hidden,true);assert.equal(s.node('native-node-cancel-start-note').hidden,true);s.emit('native-node-cancel-start','click');assert.equal(cancels,1);await s.load();finish(response({code:'CANCELLED',node:null,productionGrant:false}));await settle();assert.equal(s.node('native-node-cancel-start-note').hidden,true);assert.equal(s.node('native-node-stage').textContent,'已安装');assert.doesNotMatch(s.node('native-node-operation-code').textContent,/CANCELLED/);
});
test('pending node start cancellation messages stay explicit in twelve locales and Arabic RTL',()=>{
 const document={documentElement:{},readyState:'complete',querySelectorAll:()=>[],addEventListener(){}},window={document,localStorage:{getItem(){},setItem(){}}};runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window});
 const keys=['取消启动请求','已请求取消启动；结束后请读取节点状态。','未能确认取消请求；请等待原结果，再读取节点状态。'];
 for(const locale of window.NetworkI18n.locales){window.NetworkI18n.setLocale(locale);assert.equal(document.documentElement.dir,locale==='ar'?'rtl':'ltr');for(const key of keys){const translated=window.NetworkI18n.t(key);assert.equal(typeof translated,'string');assert.equal(translated.length>0,true);if(locale!=='zh-Hans')assert.notEqual(translated,key);if(!['zh-Hans','zh-Hant','ja'].includes(locale))assert.doesNotMatch(translated,/[\u3400-\u9fff]/u);}}
});

test('native business UI keeps an ordinary browser NATIVE_REQUIRED despite HTTP self-status',async()=>{
 const s=environment();await settle();await s.window.NetworkOperations.refresh();
 for(const id of ['native-node-install','native-node-start','native-node-stop','native-node-restart','native-node-confirm','native-part-prepare','native-part-submit','native-resource-review','native-resource-stop'])assert.equal(s.node(id).disabled,true,id);
 assert.match(s.node('native-node-notice').textContent,/原生 App/);assert.match(s.node('native-node-operation-code').textContent,/NATIVE_REQUIRED/);
});

test('native business UI requires complete explicit caps and never promotes productionSupported false',async()=>{
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),productionSupported:false},productionGrant:false,capabilities:{...nodeCaps,install:true,stop:true,restart:true}}):undefined);await s.load();
 for(const id of ['native-node-install','native-node-start','native-node-stop','native-node-restart'])assert.equal(s.node(id).disabled,true,id);
 s.emit('native-node-start','click');await settle();assert.equal(s.calls.some(c=>c.operation==='node_prepare'),false);
 const missing=setup(op=>op==='node_status'?response({code:'OK',node:node(),productionGrant:false,capabilities:{start:true}}):undefined);await missing.load();assert.equal(missing.node('native-node-start').disabled,true);
});

test('native business UI consumes exact returned node intent and consumes its one confirmation attempt',async()=>{
 const s=setup((op,payload)=>op==='node_prepare'?response({code:'PREPARED',node:intent(),productionGrant:false}):op==='node_start'?response({code:'CANCELLED',node:null,productionGrant:false}):undefined);await s.load();
 await s.emit('native-node-start','click');await settle();assert.equal(s.node('native-node-intent-panel').hidden,false);
 s.emit('native-node-confirm','click');await settle();s.emit('native-node-confirm','click');await settle();
 const effects=s.calls.filter(c=>c.operation==='node_start');assert.equal(effects.length,1);assert.deepEqual(JSON.parse(JSON.stringify(effects[0].payload)),intent());assert.equal(Object.hasOwn(effects[0].payload,'allow'),false);assert.match(s.node('native-node-operation-code').textContent,/CANCELLED/);assert.equal(s.node('native-node-intent-panel').hidden,true);
});

test('native business UI rejects a swapped node intent and restart sends only the fixed empty operation',async()=>{
 const mismatch=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:{...intent(),generation:'8'},productionGrant:false}):undefined);await mismatch.load();await mismatch.emit('native-node-start','click');await settle();assert.equal(mismatch.node('native-node-intent-panel').hidden,true);mismatch.emit('native-node-confirm','click');assert.equal(mismatch.calls.some(c=>c.operation==='node_start'),false);
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),stage:'running',processOwned:true},productionGrant:false,capabilities:{...nodeCaps,start:false,stop:true,restart:true}}):op==='node_restart'?response({code:'CANCELLED',node:null,productionGrant:false}):undefined);await s.load();s.emit('native-node-restart','click');await settle();assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(c=>c.operation==='node_restart').payload)),{});assert.equal(s.calls.some(c=>c.operation==='node_prepare'),false);assert.match(s.node('native-node-operation-code').textContent,/CANCELLED/);
});

test('native business UI prepares real Request fields for delegate unbond withdraw and vote without a codec',async()=>{
 for(const action of ['delegate','unbond','withdraw','vote']){
  const s=setup((op,payload)=>op==='participation_prepare'?response({code:'UNSUPPORTED',entry:{...entry('UNSUPPORTED'),intent:{request:payload,generation:'1'},blockedReason:'original Wallet publisher absent'},walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();fields(s,action);await s.emit('native-part-form','submit');await settle();const request=s.calls.find(c=>c.operation==='participation_prepare').payload;
  assert.equal(request.action,action);assert.equal(request.requestId,'local-fixture-correlation');assert.equal(Object.hasOwn(request,'mainReviewId'),false);assert.equal(Object.hasOwn(request,'canonicalPayload'),false);assert.equal(Object.hasOwn(request,'allow'),false);
  if(action==='unbond')assert.equal(request.delegationId,CHAIN_RECORD);
  if(action==='withdraw'){assert.equal(request.unbondingId,CHAIN_RECORD);assert.equal(Object.hasOwn(request,'amountYnxt'),false);}if(action==='vote'){assert.equal(request.proposal,'proposal-original');assert.equal(request.choice,'no');assert.equal(Object.hasOwn(request,'amountYnxt'),false);}assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-original').textContent,/original Wallet publisher absent/);
 }
});

test('native business UI validates amount expiry and original target before native preparation',async()=>{
 const s=setup();await s.load();fields(s);s.node('native-part-amount').value='0';await s.emit('native-part-form','submit');await settle();assert.equal(s.calls.some(c=>c.operation==='participation_prepare'),false);
 fields(s,'unbond');s.node('native-part-target').value='invented-id';await s.emit('native-part-form','submit');await settle();assert.equal(s.calls.some(c=>c.operation==='participation_prepare'),false);
 fields(s);s.node('native-part-expires').value=new Date(Date.now()+3600000).toISOString();await s.emit('native-part-form','submit');await settle();assert.equal(s.calls.some(c=>c.operation==='participation_prepare'),false);
});

test('native business UI binds review to original ID and never treats an adapter or raw members as approval',async()=>{
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:{...review(),walletAdapterConfigured:false},walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-original').textContent,/<script>not executable<\/script>/);s.emit('native-part-submit','click');await settle();assert.equal(s.calls.some(c=>c.operation==='participation_submit'),false);
 const swapped=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(entry('PREPARED',OTHER)),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);await swapped.load();await select(swapped);await doReview(swapped);assert.equal(swapped.node('native-part-submit').disabled,true);
});

test('participation review refuses a same-ID response whose immutable intent changed',async()=>{
 const original=entry(),changed={...entry(),intent:{...entry().intent,request:{...entry().intent.request,owner:'0x'+'c'.repeat(40)}}};
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:original,walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',entry:changed,review:review(changed),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);
 await s.load();await select(s);await doReview(s);
 assert.equal(s.node('native-part-submit').disabled,true);
 assert.equal(s.node('native-part-operation-code').textContent,'NATIVE_RESPONSE_INVALID');
 s.emit('native-part-submit','click');await settle();assert.equal(s.calls.some(c=>c.operation==='participation_submit'),false);
});

test('participation submit preserves UNKNOWN when a same-ID reply changes immutable intent',async()=>{
 const original=entry(),changed={...entry('RPC_REPORTED_COMMITTED'),intent:{...entry().intent,request:{...entry().intent.request,owner:'0x'+'c'.repeat(40)}}};
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:original,walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(original),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_submit'?response({code:'OK',entry:changed,walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);
 await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);
 s.emit('native-part-submit','click');await settle();
 assert.equal(s.node('native-part-operation-code').textContent,'UNKNOWN');
 assert.equal(s.node('native-part-submit').disabled,true);
 assert.equal(s.calls.filter(c=>c.operation==='participation_submit').length,1);
});

test('participation review ignores JSON key order but refuses a replaced original binding',async()=>{
 const binding={bytes:'1',sha3_512:'a'.repeat(128),sha512:'b'.repeat(128)};
 const original={...entry(),binding},same={...original,intent:{generation:'1',request:{action:'delegate',owner:'0x'+'b'.repeat(40),requestId:'local-fixture-correlation'}}};
 for(const replaced of [false,true]){
  const observed=replaced?{...same,binding:{...binding,sha512:'c'.repeat(128)}}:same;
  const s=setup(op=>op==='participation_get'?response({code:'OK',entry:original,walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(observed),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);
  await s.load();await select(s);await doReview(s);
  assert.equal(s.node('native-part-submit').disabled,replaced);
  if(replaced)assert.equal(s.node('native-part-operation-code').textContent,'NATIVE_RESPONSE_INVALID');
 }
});

test('participation changed identity preserves only the previous read for the same original ID',async()=>{
 const original=entry(),changed={...entry(),intent:{...entry().intent,request:{...entry().intent.request,owner:'0x'+'c'.repeat(40)}}};
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:original,walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',entry:changed,review:review(changed),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);
 await s.load();await select(s);await doReview(s);
 assert.equal(s.node('native-part-operation-code').textContent,'NATIVE_RESPONSE_INVALID');
 assert.equal(s.node('native-part-get').disabled,false);
 for(const id of ['native-part-prepare','native-part-review','native-part-cancel','native-part-reconcile','native-part-submit','native-part-revoke'])assert.equal(s.node(id).disabled,true,id);
 await s.emit('native-part-get-form','submit');await settle();
 const reads=s.calls.filter(call=>call.operation==='participation_get');
 assert.equal(reads.length,2);assert.equal(reads[1].payload.id,ID);
 assert.equal(s.calls.some(call=>call.operation==='participation_submit'),false);
});

test('participation original identity fence survives altered rereads, other IDs and refresh until exact recovery',async t=>{
 for(const field of ['intent','binding'])await t.test(field,async()=>{
  const binding={bytes:'1',sha3_512:'a'.repeat(128),sha512:'b'.repeat(128)},original={...entry(),binding};
  const changed=field==='intent'?{...original,intent:{...original.intent,request:{...original.intent.request,owner:'0x'+'c'.repeat(40)}}}:{...original,binding:{...binding,sha512:'c'.repeat(128)}};
  let current=original,reviewEntry=changed;
  const reply=record=>response({code:'OK',entry:record,walletApproval:false,authority:false,capabilities:{...partCaps,submit:true}});
  const s=setup((op,payload)=>op==='participation_get'?reply(payload.id===OTHER?entry('PREPARED',OTHER):current):op==='participation_review'?response({code:'OK',entry:reviewEntry,review:review(reviewEntry),walletApproval:false,authority:false,capabilities:{...partCaps,submit:true}}):undefined);
  const effectsOff=()=>{for(const id of ['native-part-prepare','native-part-review','native-part-cancel','native-part-reconcile','native-part-submit','native-part-revoke'])assert.equal(s.node(id).disabled,true,id);};
  await s.load();await select(s);await doReview(s);effectsOff();
  current=changed;await s.emit('native-part-get-form','submit');await settle();
  assert.equal(s.node('native-part-operation-code').textContent,'NATIVE_RESPONSE_INVALID');effectsOff();
  current=null;await s.emit('native-part-get-form','submit');await settle();
  assert.equal(s.node('native-part-operation-code').textContent,'NATIVE_RESPONSE_INVALID');effectsOff();
  s.node('native-part-id').value=OTHER;await s.emit('native-part-get-form','submit');await settle();effectsOff();
  await s.load();effectsOff();s.window.NetworkOperations.reset();await s.load();effectsOff();
  current=original;reviewEntry=original;s.node('native-part-id').value=ID;await s.emit('native-part-get-form','submit');await settle();
  assert.equal(s.node('native-part-operation-code').textContent,'OK');await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);
  assert.equal(s.calls.some(call=>call.operation==='participation_submit'),false);
 });
});

test('native business UI UNKNOWN submit is never resent even after another current review',async()=>{
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_submit'?Promise.reject(Object.assign(new Error('transport timed out after post'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):op==='participation_reconcile'?response({code:'UNKNOWN',entry:entry('UNKNOWN'),walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);s.emit('native-part-submit','click');await settle();assert.match(s.node('native-part-operation-code').textContent,/UNKNOWN/);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,true);s.emit('native-part-submit','click');await settle();assert.equal(s.calls.filter(c=>c.operation==='participation_submit').length,1);s.emit('native-part-reconcile','click');await settle();assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(c=>c.operation==='participation_reconcile').payload)),{id:ID});
});

test('native participation recovery uses the original 32-hex local operation and replaces UNKNOWN only with a bound durable outcome',async t=>{
 for(const [outcome,chainStatus,label] of [
  ['RPC_REPORTED_COMMITTED','committed','来源报告已记录，尚未独立验证。'],
  ['RPC_REPORTED_REJECTED','rejected','来源报告已拒绝，尚未独立验证。'],
  ['DENIED',null,'本次操作未获批准。']
 ]){
  await t.test(outcome,async()=>{
   const id=ID,otherId=OTHER,nativeHash='0x'+HASH;
   const binding={bytes:'1',sha3_512:'a'.repeat(128),sha512:'b'.repeat(128)};
   const prepared={...entry('PREPARED',id),binding};
   const unknown={...prepared,state:'UNKNOWN',publishAttemptedAt:'2026-11-01T00:00:01Z'};
   const wallet={operationId:id,intent:binding,state:chainStatus?'submitted':'denied',...(chainStatus?{nativeHash}:{})};
   const observation=chainStatus?{status:chainStatus,nativeHash,executionHeight:'9',source:'comet-rpc',wireBinding:binding,effectsBinding:binding,independentFinality:false}:null;
   const resolved={...unknown,state:outcome,updatedAt:'2026-11-01T00:00:02Z',walletResult:wallet,...(observation?{observation}:{})};
   const payload=(value,code='OK')=>response({code,entry:value,walletApproval:false,authority:false,capabilities:{
    ...partCaps,submit:value?.state==='PREPARED',reconcile:value?.state==='UNKNOWN'
   }});
   let stored=prepared,readback=resolved,readbackCode='OK';
   const s=setup((operation,body)=>{
    if(operation==='participation_list')return response({code:'OK',walletApproval:false,authority:false,capabilities:{...partCaps},entries:[
     {id,requestId:prepared.intent.request.requestId,action:'delegate',state:stored.state,createdAt:stored.createdAt,updatedAt:stored.updatedAt}
    ]});
    if(operation==='participation_get'){assert.equal(body.id,id);return payload(stored);}
    if(operation==='participation_review'){assert.equal(body.id,id);return response({code:'OK',walletApproval:false,authority:false,capabilities:{...partCaps,submit:true},review:review(prepared)});}
    if(operation==='participation_submit'){
     assert.equal(body.id,id);stored=unknown;
     throw Object.assign(new Error('fixture acknowledgement lost after post'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'});
    }
    if(operation==='participation_reconcile'){assert.equal(body.id,id);return payload(readback,readbackCode);}
   });
   await s.load();
   assert.equal(s.node('native-part-records').children.length,1,'real generated local ID must be listed');
   s.node('native-part-records').children[0].emit('click');await settle();
   assert.equal(s.node('native-part-entry-id').textContent,id);
   await doReview(s);
   assert.equal(s.node('native-part-submit').disabled,false);
   s.emit('native-part-submit','click');await settle();
   assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');

   const reread=async()=>{await s.load();s.node('native-part-id').value=id;await s.emit('native-part-get-form','submit');await settle();};
   for(const code of ['UNAVAILABLE','CANCELLED']){
    await reread();
    readback=null;readbackCode=code;
    s.emit('native-part-reconcile','click');await settle();
    assert.equal(s.node('native-part-operation-code').textContent,code);
    assert.equal(s.node('native-part-entry-id').textContent,id);
    assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');
    assert.equal(s.node('native-part-submit').disabled,true);
   }
   readbackCode='OK';
   await reread();
   readback={...resolved,id:otherId};
   s.emit('native-part-reconcile','click');await settle();
   assert.equal(s.node('native-part-operation-code').textContent,'NATIVE_RESPONSE_INVALID');
   assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');

   await reread();
   const replacementBinding={...binding,sha512:'c'.repeat(128)};
   readback={...resolved,binding:replacementBinding,walletResult:{...wallet,intent:replacementBinding}};
   s.emit('native-part-reconcile','click');await settle();
   assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');

   await reread();
   readback=prepared;
   s.emit('native-part-reconcile','click');await settle();
   assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');
   assert.equal(s.node('native-part-submit').disabled,true);

   await reread();
   readback={...resolved,walletResult:{...wallet,operationId:otherId}};
   s.emit('native-part-reconcile','click');await settle();
   assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');
   if(observation){
    await reread();
    readback={...resolved,observation:{...observation,independentFinality:true}};
    s.emit('native-part-reconcile','click');await settle();
    assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');
   }

   if(outcome==='DENIED'){stored=resolved;await reread();}
   else{
    await reread();
    readback=resolved;
    s.emit('native-part-reconcile','click');await settle();
   }
   assert.equal(s.node('native-part-entry-id').textContent,id);
   assert.equal(s.node('native-part-entry-state').textContent,label);
   assert.match(s.node('native-part-records').textContent,new RegExp(label));
   const raw=JSON.parse(s.node('native-part-original').textContent);
   assert.deepEqual(raw.walletResult,wallet);
   if(observation)assert.deepEqual(raw.observation,observation);
   assert.equal(s.node('native-part-reconcile').disabled,true);
   assert.equal(s.node('native-part-submit').disabled,true);
   s.emit('native-part-submit','click');await settle();
   assert.equal(s.calls.filter(call=>call.operation==='participation_submit').length,1);
  });
 }
});

test('native business UI changed session suppresses late entries and stale native effects',async()=>{
 let finish;const s=setup(op=>op==='participation_prepare'?new Promise(resolve=>{finish=resolve}):undefined);await s.load();fields(s);s.emit('native-part-form','submit');await settle();s.native.ready=false;s.nativeState();finish(response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}));await settle();assert.equal(s.node('native-part-entry-panel').hidden,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.node('native-part-records').children.length,0);
});

test('native business UI unsigned resource preview remains non-authoritative and forged consent fails closed',async()=>{
 let forged=false;const s=setup(op=>op==='resource_review'?response({code:'UNSIGNED_PREVIEW_ONLY',authority:false,productionEnabled:false,consentProduced:forged,previewBytes:'128',previewSHA256:HASH,capabilities:{...resourceCaps,review:false}}):op==='resource_review_cancel'?response({code:'RETIRED',authority:false,productionEnabled:false,consentProduced:false,physicalComplete:true,capabilities:{...resourceCaps,review:false,cancelReview:false}}):undefined);await s.load();s.emit('native-resource-review','click');await settle();assert.equal(s.node('native-resource-preview-sha').textContent,HASH);assert.equal(s.node('native-resource-review').disabled,true);assert.match(s.node('native-resource-original').textContent,/"consentProduced": false/);s.emit('native-resource-cancel','click');await settle();assert.equal(s.node('native-resource-preview-sha').textContent,'—');forged=true;await s.load();s.emit('native-resource-review','click');await settle();assert.equal(s.node('native-resource-preview-sha').textContent,'—');assert.equal(s.node('native-resource-stop').disabled,true);assert.match(s.node('native-resource-operation-code').textContent,/NATIVE_RESPONSE_INVALID/);
});

test('native business UI resource preview cancellation distinguishes pending cleanup from release with prior failure',async()=>{
 const catalog=readFileSync(new URL('./i18n.js',import.meta.url),'utf8');
 const pendingKey='正在释放本机资源',releasedKey='已释放本机资源，保留前次错误。';
 let cancellations=0;
 const lifecycle=(code,physicalComplete,cancelReview,preview={})=>response({
  code,physicalComplete,authority:false,productionEnabled:false,consentProduced:false,
  capabilities:{...resourceCaps,review:false,cancelReview},...preview
 });
 const s=setup(op=>{
  if(op==='resource_review')return lifecycle('UNSIGNED_PREVIEW_ONLY',false,true,{previewBytes:'128',previewSHA256:HASH});
  if(op==='resource_review_cancel'){
   return ++cancellations===1?lifecycle('CLEANUP_PENDING',false,true):lifecycle('RETIRED_WITH_PRIOR_FAILURE',true,false);
  }
 },{source:catalog+'\n'+readFileSync(new URL('./app.js',import.meta.url),'utf8')});
 await s.load();
 s.emit('native-resource-review','click');await settle();
 assert.equal(s.node('native-resource-preview-sha').textContent,HASH);
 assert.equal(s.node('native-resource-review').disabled,true);
 assert.equal(s.node('native-resource-cancel').disabled,false);

 function verifyOutcome(code,key,physicalComplete){
  const I=s.window.NetworkI18n;
  I.setLocale('zh-Hans');s.client.rerenderLocale();
  assert.equal(s.node('native-resource-operation').textContent,key);
  assert.equal(s.node('native-resource-code').textContent,key);
  assert.equal(s.node('native-resource-operation-code').textContent,code);
  assert.equal(s.node('native-resource-preview-sha').textContent,'—');
  const original=s.node('native-resource-original').textContent;
  const detail=JSON.parse(original);
  assert.equal(detail.code,code);
  assert.equal(detail.physicalComplete,physicalComplete);
  assert.equal(detail.consentProduced,false);
  assert.equal(detail.authority,false);
  assert.equal(detail.productionEnabled,false);
  for(const locale of I.locales){
   I.setLocale(locale);s.client.rerenderLocale();
   const translated=I.t(key);
   assert.equal(s.node('native-resource-operation').textContent,translated,locale);
   assert.equal(s.node('native-resource-code').textContent,translated,locale);
   assert.equal(s.node('native-resource-original').textContent,original,locale);
   if(!['zh-Hans','zh-Hant','ja'].includes(locale))assert.doesNotMatch(translated,/[\u3400-\u9fff]/u,locale);
  }
 }
 s.emit('native-resource-cancel','click');await settle();
 verifyOutcome('CLEANUP_PENDING',pendingKey,false);
 assert.equal(s.node('native-resource-cancel').disabled,false);
 assert.equal(cancellations,1);
 s.emit('native-resource-cancel','click');await settle();
 verifyOutcome('RETIRED_WITH_PRIOR_FAILURE',releasedKey,true);
 assert.equal(s.node('native-resource-cancel').disabled,true);
 assert.equal(s.node('native-resource-review').disabled,true);
 s.emit('native-resource-cancel','click');await settle();
 assert.equal(cancellations,2);
 assert.deepEqual(s.calls.filter(call=>call.operation.startsWith('resource_')).map(call=>call.operation),
  ['resource_status','resource_review','resource_review_cancel','resource_review_cancel']);
});

test('native business UI preserves journal cursor UNKNOWN rows and never invents persistent history',async()=>{
 let page=0;const cursor='original-opaque-cursor';const s=setup((op,payload)=>op==='participation_list'?response({code:'OK',authority:false,walletApproval:false,entries:[{id:page++?OTHER:ID,requestId:'local-fixture-correlation',action:'withdraw',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}],...(page===1?{nextCursor:cursor}:{}),capabilities:{...partCaps}}):undefined);await s.load();assert.equal(s.node('native-part-records').children.length,1);assert.match(s.node('native-part-records').children[0].textContent,/结果未确定/);s.emit('native-part-next','click');await settle();assert.equal(s.node('native-part-records').children.length,2);assert.deepEqual(JSON.parse(JSON.stringify(s.calls.filter(c=>c.operation==='participation_list')[1].payload)),{cursor,limit:20});assert.equal(s.node('native-part-next').disabled,true);
});

test('a changed participation history snapshot requires an explicit fresh list without losing the original UNKNOWN ID',async()=>{
 const cursor='original-journal-snapshot';
 const original={id:ID,requestId:'local-fixture-correlation',action:'delegate',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
 let lists=0;
 const s=setup((operation,payload)=>{
  if(operation==='participation_get'){
   assert.equal(payload.id,ID);
   return response({code:'OK',entry:entry('UNKNOWN'),authority:false,walletApproval:false,capabilities:{...partCaps}});
  }
  if(operation!=='participation_list')return;
  const base={authority:false,walletApproval:false,capabilities:{...partCaps}};
  if(++lists===1)return response({...base,code:'OK',entries:[original],nextCursor:cursor});
  if(lists===2){
   assert.deepEqual(JSON.parse(JSON.stringify(payload)),{cursor,limit:20});
   return response({...base,code:'CONFLICT',entries:[]});
  }
  assert.deepEqual(JSON.parse(JSON.stringify(payload)),{limit:20});
  return response({...base,code:'OK',entries:[original,{...original,id:OTHER,requestId:'new-local-request'}]});
 });
 await s.load();
 assert.match(s.node('native-part-records').textContent,/结果未确定/);
 await s.emit('native-part-next','click');await settle();
 assert.equal(lists,2);
 assert.equal(s.node('native-part-records').children.length,0,'conflicting snapshot still showed old rows');
 assert.equal(s.node('native-part-next').disabled,true);
 assert.equal(s.node('native-part-list').disabled,false);
 assert.equal(s.node('native-part-get').disabled,false);
 assert.equal(s.node('native-part-operation-code').textContent,'CONFLICT');
 assert.match(s.node('native-part-operation').textContent,/手动刷新/);
 await select(s);
 assert.equal(s.node('native-part-entry-id').textContent,ID);
 assert.match(s.node('native-part-entry-state').textContent,/结果未确定/);
 assert.equal(s.node('native-part-submit').disabled,true);
 await s.emit('native-part-list','click');await settle();
 assert.equal(s.node('native-part-records').children.length,2);
 assert.equal(lists,3);
 assert.equal(s.calls.some(call=>['participation_prepare','participation_submit'].includes(call.operation)),false);
});

test('a failed participation history continuation clears the page and its cursor atomically',async t=>{
 const old={id:ID,requestId:'original-reference',action:'unbond',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
 const next={...old,id:OTHER};
 for(const [failure,code] of [['unavailable','UNAVAILABLE'],['transport','NATIVE_UNAVAILABLE'],['duplicate','NATIVE_RESPONSE_INVALID']])await t.test(failure,async()=>{
  let lists=0;
  const s=setup(operation=>{
   if(operation!=='participation_list')return;
   const base={authority:false,walletApproval:false,capabilities:{...partCaps}};
   if(++lists===1)return response({...base,code:'OK',entries:[old],nextCursor:'original-cursor'});
   if(failure==='transport')throw Object.assign(new Error('original helper unavailable'),{code,outcome:'NOT_SENT'});
   if(failure==='unavailable')return response({...base,code,entries:[],capabilities:Object.fromEntries(Object.keys(partCaps).map(key=>[key,false]))});
   return response({...base,code:'OK',entries:[next,next]});
  });
  await s.load();await s.emit('native-part-next','click');await settle();
  assert.equal(s.node('native-part-records').children.length,0,'failed continuation partially published its page');
  assert.equal(s.node('native-part-next').disabled,true);
  assert.equal(s.node('native-part-operation-code').textContent,code);
  assert.equal(s.node('native-part-submit').disabled,true);
  assert.equal(lists,2);
 });
});

test('native business UI resource read failure leaves independent owned-node stop available',async()=>{
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),productionSupported:false,stage:'running',processOwned:true},productionGrant:false,capabilities:{...nodeCaps,start:false,stop:true}}):op==='resource_status'?Promise.reject(Object.assign(new Error('resource owner unavailable'),{code:'RESOURCE_UNAVAILABLE',outcome:'NOT_SENT'})):undefined);await s.load();assert.equal(s.node('native-node-stop').disabled,false);assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.node('native-resource-stop').disabled,true);assert.match(s.node('native-resource-operation-code').textContent,/RESOURCE_UNAVAILABLE/);
});

// Existing typed owned-process fixture: observation/capability DATA only, never
// a claim that this test owns a real process or may approve its stop operation.
const ownedStopObservation=()=>response({code:'OK',node:{...node(),productionSupported:false,stage:'running',processOwned:true},productionGrant:false,capabilities:{...nodeCaps,start:false,stop:true}});

test('readable service status UI localizes main node and resource codes while exact diagnostics stay folded DATA',async()=>{
 const s=setup(op=>op==='node_status'?actualBfaGUINodeResponse():op==='resource_status'?response({code:'UNSUPPORTED',productionEnabled:false,capabilities:Object.fromEntries(Object.keys(resourceCaps).map(k=>[k,false]))}):op==='participation_list'?response({code:'NOT_SUPPLIED',entries:[],authority:false,walletApproval:false,capabilities:Object.fromEntries(Object.keys(partCaps).map(k=>[k,false]))}):undefined);
 await s.load();
 assert.equal(s.node('local-node-code').textContent,'当前版本不支持此操作。');
 assert.equal(s.node('resource-code').textContent,'当前版本不支持此操作。');
 assert.equal(s.node('native-resource-code').textContent,'当前版本不支持此操作。');
 assert.equal(s.node('native-node-operation').textContent,'本机响应已收到。');
 assert.equal(s.node('native-node-operation-code').textContent,'OK');
 assert.equal(s.node('native-resource-operation-code').textContent,'UNSUPPORTED');
 assert.equal(s.node('native-part-operation-code').textContent,'NOT_SUPPLIED');
 assert.doesNotMatch(s.node('native-part-notice').textContent,/NOT_SUPPLIED/);
 assert.match(s.node('native-node-status-original').textContent,/"productionSupported": false/);
 const document={documentElement:{},querySelectorAll:()=>[]},localeWindow={document};runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window:localeWindow});s.window.NetworkI18n=localeWindow.NetworkI18n;
 for(const locale of s.window.NetworkI18n.locales){s.window.NetworkI18n.setLocale(locale);s.client.rerenderLocale();assert.equal(s.node('local-node-code').textContent,s.window.NetworkI18n.t('当前版本不支持此操作。'),locale);assert.equal(s.node('native-node-operation').textContent,s.window.NetworkI18n.t('本机响应已收到。'),locale);assert.equal(s.node('native-resource-operation-code').textContent,'UNSUPPORTED');assert.equal(document.documentElement.dir,locale==='ar'?'rtl':'ltr');}
 for(const id of ['native-node-start','native-node-stop','native-part-submit','native-resource-review'])assert.equal(s.node(id).disabled,true,id);
});

test('readable service status UI preserves unknown record and exact first cause without calling them successful',async()=>{
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:{...entry('FUTURE_STATE'),blockedReason:'SOURCE_EXACT_FIRST_CAUSE'},walletApproval:false,capabilities:{...partCaps,submit:false}}):undefined);
 await s.load();await select(s);
 assert.equal(s.node('native-part-entry-state').textContent,'状态未识别，请查看原始报告。');
 assert.equal(s.node('native-part-blocked').textContent,'本次请求未完成，请查看详细报告。');
 assert.match(s.node('native-part-original').textContent,/FUTURE_STATE/);assert.match(s.node('native-part-original').textContent,/SOURCE_EXACT_FIRST_CAUSE/);
 assert.equal(s.node('native-part-records').children[0].textContent.includes('FUTURE_STATE'),false);
 assert.equal(s.node('native-part-submit').disabled,true);
});

test('readable service status mappings have twelve translated catalogs and never inherit an object property as a status',async()=>{
 const s=setup();await s.load();
 const document={documentElement:{},querySelectorAll:()=>[]},window={document};runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window});
 const source=readFileSync(new URL('./app.js',import.meta.url),'utf8').split('const textBindings')[0];
 const keys=[...new Set([...source.matchAll(/'([^']*?[\u3400-\u9fff][^']*?)'/gu)].map(m=>m[1]))];
 for(const locale of window.NetworkI18n.locales){window.NetworkI18n.setLocale(locale);for(const key of keys){const value=window.NetworkI18n.t(key,{status:'RAW_ORIGINAL_STATUS'});assert.ok(value,locale+' '+key);if(!['zh-Hans','zh-Hant','ja'].includes(locale))assert.doesNotMatch(value,/[\u3400-\u9fff]/u,locale+' '+key);}assert.equal(window.NetworkI18n.t('来源报告：{status}',{status:'RAW_ORIGINAL_STATUS'}).includes('RAW_ORIGINAL_STATUS'),true);}
 for(const code of ['constructor','__proto__','toString','FUTURE_GREEN'])assert.equal(s.window.NetworkOperations.statusKey(code),'状态未识别，请查看原始报告。',code);
});

test('readable service status helper self-check keeps transport codes and first cause in its original disclosure',async()=>{
 const s=environment();await settle();await settle();assert.equal(s.node('native-state').textContent,'不可用');assert.match(s.node('native-raw').textContent,/NATIVE_UNAVAILABLE/);
 s.manual('/api/native-status');const job=s.emit('native-refresh','click');s.take('/api/native-status').resolve({error:'EXACT_PUBLIC_TEST_TRANSPORT_CAUSE'},503);await job;
 assert.equal(s.node('native-state').textContent,'不可用');assert.match(s.node('native-raw').textContent,/EXACT_PUBLIC_TEST_TRANSPORT_CAUSE/);
 assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);
});

test('independent observation UI resource-only failure preserves the unrelated owned stop observation',async()=>{
 let failed=false;
 const s=setup(op=>op==='node_status'?failed?Promise.reject(Object.assign(new Error('unrelated node read must not run'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'})):ownedStopObservation():op==='resource_status'&&failed?Promise.reject(Object.assign(new Error('resource unavailable'),{code:'RESOURCE_UNAVAILABLE',outcome:'NOT_SENT'})):undefined);
 await s.load();assert.equal(s.node('native-node-stop').disabled,false);const before=s.calls.length;failed=true;
 await s.emit('native-resource-read','click');await settle();
 assert.equal(s.node('native-node-stop').disabled,false);
 assert.deepEqual(s.calls.slice(before).map(c=>c.operation),['resource_status']);
 assert.equal(s.node('native-node-stage').textContent,'运行中');
 assert.equal(s.node('resource-state').textContent,'不可用');
 for(const id of ['resource-verified-jobs','resource-verified-bytes','resource-active-workers','native-resource-original'])assert.equal(s.node(id).textContent,'—',id);
 assert.equal(s.calls.some(c=>/^node_(prepare|install|start|stop|restart)$/.test(c.operation)),false);
});

test('independent observation UI node-only failure leaves resource DATA and selected UNKNOWN participation intact',async()=>{
 let failed=false;
 const s=setup(op=>op==='node_status'?failed?Promise.reject(Object.assign(new Error('node read unavailable'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'})):ownedStopObservation():op==='participation_get'?response({code:'OK',entry:entry('UNKNOWN'),walletApproval:false,capabilities:{...partCaps}}):undefined);
 await s.load();await select(s);const before=s.calls.length,original=s.node('native-resource-original').textContent;failed=true;
 await s.emit('native-node-read','click');await settle();
 assert.equal(s.node('native-part-entry-panel').hidden,false);
 assert.equal(s.node('native-part-entry-state').textContent,'结果未确定。');
 assert.equal(s.node('native-part-draft').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);
 assert.equal(s.node('native-resource-original').textContent,original);
 assert.equal(s.node('resource-verified-jobs').textContent,'0');
 assert.equal(s.node('native-resource-meter').disabled,false);
 assert.deepEqual(s.calls.slice(before).map(c=>c.operation),['node_status']);
 assert.equal(s.node('managed-node-state').textContent,'不可用');
});

test('independent observation UI bootstrap clears requested resource DATA in every locale and rejects a late prior session',async()=>{
 let attempts=0,finish;
 const s=setup(op=>op==='node_status'?attempts++===0?ownedStopObservation():new Promise(resolve=>{finish=resolve;}):undefined);
 await s.load();assert.equal(s.node('resource-verified-jobs').textContent,'0');const before=s.calls.length;
 const refresh=s.load();await settle();
 assert.equal(s.node('resource-verified-jobs').textContent,'—');
 assert.equal(s.node('native-resource-original').textContent,'—');
 const document={documentElement:{},querySelectorAll:()=>[]},localeWindow={document};
 runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window:localeWindow});s.window.NetworkI18n=localeWindow.NetworkI18n;
 for(const locale of s.window.NetworkI18n.locales){s.window.NetworkI18n.setLocale(locale);s.client.rerenderLocale();assert.equal(s.node('resource-state').textContent,s.window.NetworkI18n.t('正在读取'),locale);assert.equal(s.node('resource-capabilities-local').textContent,s.window.NetworkI18n.t('正在读取'),locale);assert.equal(document.documentElement.dir,locale==='ar'?'rtl':'ltr');}
 s.native.ready=false;s.nativeState();finish(ownedStopObservation());await refresh;
 for(const locale of s.window.NetworkI18n.locales){s.window.NetworkI18n.setLocale(locale);s.client.rerenderLocale();assert.equal(s.node('resource-state').textContent,s.window.NetworkI18n.t('尚未读取'),locale);for(const id of ['resource-verified-jobs','resource-verified-bytes','resource-active-workers','native-resource-original'])assert.equal(s.node(id).textContent,'—',locale+' '+id);}
 assert.deepEqual(s.calls.slice(before).map(c=>c.operation),['node_status']);
 for(const id of ['native-node-stop','native-part-submit','native-resource-stop'])assert.equal(s.node(id).disabled,true,id);
});

test('independent observation UI participation failure keeps owned stop and the original lost-prepare correlation',async()=>{
 let failed=false;
 const s=setup(op=>op==='node_status'?failed?Promise.reject(Object.assign(new Error('unrelated node read must not run'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'})):ownedStopObservation():op==='participation_prepare'?Promise.reject(Object.assign(new Error('original acknowledgement lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):op==='participation_list'&&failed?Promise.reject(Object.assign(new Error('participation reader unavailable'),{code:'PARTICIPATION_UNAVAILABLE',outcome:'NOT_SENT'})):undefined);
 await s.load();fields(s);await s.emit('native-part-form','submit');await settle();const before=s.calls.length;failed=true;
 await s.emit('native-part-read','click');await settle();
 assert.equal(s.node('native-node-stop').disabled,false);
 assert.deepEqual(s.calls.slice(before).map(c=>c.operation),['participation_list']);
 assert.match(s.node('native-part-recovery').textContent,/local-fixture-correlation/);
 assert.match(s.node('native-part-operation-code').textContent,/PARTICIPATION_UNAVAILABLE/);
 assert.equal(s.node('native-part-draft').disabled,true);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);
 assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);
 assert.equal(s.calls.some(c=>c.operation==='participation_submit'||c.operation==='node_stop'),false);
});

test('independent observation UI resource meter clears its pending DATA without enabling an effect during the single busy request',async()=>{
 let rejectMeter;
 const s=setup(op=>op==='node_status'?ownedStopObservation():op==='resource_meter'?new Promise((_,reject)=>{rejectMeter=reject;}):undefined);
 await s.load();assert.equal(s.node('native-node-stop').disabled,false);
 s.emit('native-resource-meter','click');await settle();
 assert.equal(s.node('resource-verified-jobs').textContent,'—');
 assert.equal(s.node('native-resource-original').textContent,'—');
 assert.equal(s.node('resource-state').textContent,'正在读取');
 assert.equal(s.node('native-node-stage').textContent,'运行中');
 assert.equal(s.node('native-node-stop').disabled,true);s.emit('native-node-stop','click');
 assert.equal(s.calls.some(c=>c.operation==='node_prepare'||c.operation==='node_stop'),false);
 rejectMeter(Object.assign(new Error('meter unavailable'),{code:'RESOURCE_UNAVAILABLE',outcome:'NOT_SENT'}));await settle();
 assert.equal(s.node('native-node-stop').disabled,false);
 assert.equal(s.node('resource-state').textContent,'不可用');assert.equal(s.node('resource-verified-jobs').textContent,'—');
 assert.equal(s.calls.filter(c=>c.operation==='node_status').length,1);
});

test('native business UI same-ID review with changed original intent cannot enable Wallet submission',async()=>{
 const changed={...entry(),intent:{...entry().intent,request:{...entry().intent.request,action:'withdraw',unbondingId:CHAIN_RECORD}}};
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(changed),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-operation-code').textContent,/NATIVE_RESPONSE_INVALID/);
});

test('native business UI editing a prepared draft invalidates selected review and effect controls',async()=>{
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);s.node('native-part-amount').value='21';s.emit('native-part-amount','input');assert.equal(s.node('native-part-entry-panel').hidden,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.calls.some(c=>c.operation==='participation_submit'),false);
});

test('native business UI vote navigation preserves each explicit choice without preparing an approval',async()=>{
 for(const choice of ['yes','no','abstain']){
  let click;const button={dataset:{participationAction:'vote',participationChoice:choice},addEventListener(type,fn){if(type==='click')click=fn;}};
  const s=setup((op,payload)=>op==='participation_prepare'?response({code:'UNSUPPORTED',entry:{...entry('UNSUPPORTED'),intent:{request:payload,generation:'1'}},walletApproval:false,capabilities:{...partCaps}}):undefined,{actionButtons:[button]});await s.load();fields(s);s.node('native-part-target').value='proposal-original';s.node('native-part-choice').value='yes';click();assert.equal(s.node('native-part-action').value,'vote');assert.equal(s.node('native-part-choice').value,choice);await s.emit('native-part-form','submit');await settle();const request=s.calls.find(c=>c.operation==='participation_prepare').payload;assert.equal(request.choice,choice);assert.equal(request.action,'vote');assert.equal(Object.hasOwn(request,'amountYnxt'),false);assert.equal(s.calls.some(c=>c.operation==='participation_submit'),false);
 }
});

test('native business UI journal refresh invalidates a prior per-entry Wallet review',async()=>{
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_list'?response({code:'OK',authority:false,walletApproval:false,entries:[{id:ID,requestId:'local-fixture-correlation',action:'delegate',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}],capabilities:{...partCaps,submit:true}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);s.emit('native-part-list','click');await settle();assert.equal(s.node('native-part-entry-panel').hidden,true);assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-records').children[0].textContent,/结果未确定/);
});

test('native business UI prepare UNKNOWN freezes original correlation and resolves an original alias without reprepare',async()=>{
 let originalRequest;const s=setup((op,payload)=>{
  if(op==='participation_prepare'){originalRequest=JSON.parse(JSON.stringify(payload));return Promise.reject(Object.assign(new Error('posted preparation ack lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}));}
  if(op==='participation_resolve')return response({code:'OK',entry:{...entry(),intent:{request:{...originalRequest,requestId:'first-original-correlation'},generation:'1'}},resolvedRequestId:payload.requestId,authority:false,walletApproval:false,capabilities:{...partCaps}});
 });await s.load();fields(s);await s.emit('native-part-form','submit');await settle();assert.match(s.node('native-part-recovery').textContent,/local-fixture-correlation/);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-draft').disabled,true);s.emit('native-part-draft','click');assert.equal(s.node('native-part-request').value,'local-fixture-correlation');await s.load();s.emit('native-part-form','submit');await settle();assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);s.emit('native-part-resolve','click');await settle();assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(c=>c.operation==='participation_resolve').payload)),{requestId:'local-fixture-correlation'});assert.equal(s.node('native-part-entry-id').textContent,ID);assert.match(s.node('native-part-original').textContent,/first-original-correlation/);assert.match(s.node('native-part-recovery').textContent,/与草稿不同/);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);
});

test('native business UI prepare UNKNOWN NOT_FOUND remains unknown and only retries the original read',async()=>{
 const s=setup((op,payload)=>op==='participation_prepare'?Promise.reject(Object.assign(new Error('ack lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):op==='participation_resolve'?response({code:'NOT_FOUND',entry:null,resolvedRequestId:payload.requestId,authority:false,walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();fields(s);await s.emit('native-part-form','submit');await settle();await s.load();for(let i=0;i<2;i++){s.emit('native-part-resolve','click');await settle();}assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);assert.equal(s.calls.filter(c=>c.operation==='participation_resolve').length,2);assert.match(s.node('native-part-operation-code').textContent,/UNKNOWN/);assert.equal(s.node('native-part-recovery').hidden,false);assert.equal(s.node('native-part-draft').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);
});

test('native business UI lost preparation is not guessed from duplicate history correlations or wrong resolve echo',async()=>{
 let saved;const s=setup((op,payload)=>{
  if(op==='participation_prepare'){saved=payload;return Promise.reject(Object.assign(new Error('ack lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}));}
  if(op==='participation_list')return response({code:'OK',entries:[ID,OTHER].map(id=>({id,requestId:'local-fixture-correlation',action:'delegate',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'})),authority:false,walletApproval:false,capabilities:{...partCaps}});
  if(op==='participation_resolve')return response({code:'OK',entry:{...entry(),intent:{request:saved,generation:'1'}},resolvedRequestId:'wrong-correlation',authority:false,walletApproval:false,capabilities:{...partCaps}});
 });await s.load();fields(s);await s.emit('native-part-form','submit');await settle();await s.load();assert.equal(s.node('native-part-records').children.length,2);assert.equal(s.calls.some(c=>c.operation==='participation_get'||c.operation==='participation_resolve'),false);assert.equal(s.node('native-part-entry-panel').hidden,true);s.emit('native-part-resolve','click');await settle();assert.equal(s.node('native-part-entry-panel').hidden,true);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-recovery').hidden,false);assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);
});

test('native business UI native readiness starts only the three observation reads, never an effect',async()=>{
 const s=setup();s.nativeState();await settle();assert.equal(s.calls.length,0);s.native.ready=true;s.nativeState();await settle();await settle();assert.deepEqual(s.calls.map(c=>c.operation),['node_status','resource_status','participation_list']);assert.equal(s.node('native-node-start').disabled,false);assert.equal(s.calls.some(c=>c.operation==='node_prepare'||c.operation==='participation_prepare'||c.operation==='participation_submit'||c.operation==='resource_review'),false);
});

test('native business UI surfaces actual unavailable service at the form instead of arming a blank capability',async()=>{
 const s=setup(op=>op==='participation_list'?response({code:'NOT_SUPPLIED',entries:[],walletApproval:false,authority:false,capabilities:Object.fromEntries(Object.keys(partCaps).map(k=>[k,false]))}):undefined);await s.load();assert.equal(s.node('native-part-operation-code').textContent,'NOT_SUPPLIED');assert.match(s.node('native-part-notice').textContent,/当前接口未提供/);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.node('native-part-records').children.length,0);
});

test('native business UI fixture mode cannot open install start or restart as production support',async()=>{
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),mode:'isolated-lifecycle-fixture',productionSupported:false},productionGrant:false,capabilities:{...nodeCaps,install:true,start:true,restart:true}}):undefined);await s.load();assert.equal(s.node('native-node-install').disabled,true);assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.node('native-node-restart').disabled,true);s.emit('native-node-start','click');await settle();assert.equal(s.calls.some(c=>c.operation==='node_prepare'),false);
});

// Exact read-only response captured from the original bfa GUI service by its
// normal NativeCLI. SHA256 a3d9d9f6046be3399d511278080a1f4befea96fb32e882f6acec58910e66f26b.
// Replaying this DTO only tests the controller contract; it establishes no
// runtime peer identity, WebKit bridge acceptance or visible-human approval.
const actualBfaGUINodeResponse=()=>JSON.parse("{\"version\":\"YNX-NETWORK-LOCAL-IPC/v1\",\"id\":\"native_bfa_gui_status\",\"code\":\"OK\",\"peer\":{\"uid\":501,\"gid\":20,\"pid\":17476,\"credentialSource\":\"darwin-LOCAL_PEERCRED-Xucred\",\"nativeIPCVerified\":true,\"browserIdentityVerified\":false},\"result\":{\"payload\":{\"capabilities\":{\"install\":false,\"start\":false,\"stop\":false,\"restart\":false,\"visibleConsent\":true,\"read\":true,\"logs\":false},\"code\":\"OK\",\"node\":{\"nodeId\":\"ordinary-node\",\"stage\":\"not_installed\",\"mode\":\"production\",\"generation\":\"0\",\"runId\":\"\",\"processOwned\":false,\"lastPid\":0,\"artifactSHA256\":\"\",\"firstCause\":\"\",\"lastExit\":\"\",\"productionSupported\":false,\"capacity\":{\"complete\":true,\"usedBytes\":\"738\",\"limitBytes\":\"67108864\",\"freeBytes\":\"3361509376\",\"enforcement\":\"preflight-and-isolated-fixture-monitor\"},\"diagnostics\":{\"code\":\"LOCAL_OBSERVATION_ONLY\",\"authority\":false,\"logs\":{\"code\":\"NOT_SUPPLIED\",\"runId\":\"\",\"authority\":false,\"stdout\":null,\"stderr\":null},\"synchronization\":{\"code\":\"NOT_SUPPLIED\",\"localHeight\":null,\"targetHeight\":null,\"catchingUp\":null},\"recovery\":{\"code\":\"IDLE\",\"autoRestart\":false,\"storedPIDIsControlHandle\":false,\"processOwned\":false,\"priorEffectUnknown\":false}}},\"productionGrant\":false}}}\n");

test('native business UI accepts the actual bfa GUI-service node response without a production grant',async()=>{
 const actual=actualBfaGUINodeResponse(),s=setup(op=>op==='node_status'?actual:undefined);
 await settle();await s.load();
 assert.equal(s.node('native-node-stage').textContent,'尚未安装');
 assert.match(s.node('native-node-status-original').textContent,/not_installed/);
 assert.equal(s.node('native-node-mode').textContent,'正式节点模式（未开放）');
 assert.match(s.node('native-node-status-original').textContent,/production/);
 assert.match(s.node('native-node-operation-code').textContent,/OK/);
 assert.doesNotMatch(s.node('native-node-operation-code').textContent,/NATIVE_RESPONSE_INVALID/);
 assert.match(s.node('native-node-notice').textContent,/原发布方工件/);
 for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
 assert.equal(actual.result.payload.node.generation,'0');
 assert.equal(actual.result.payload.node.artifactSHA256,'');
 assert.deepEqual(actual.result.payload.capabilities,{install:false,start:false,stop:false,restart:false,visibleConsent:true,read:true,logs:false});
 assert.deepEqual(s.calls.map(call=>call.operation),['node_status','resource_status','participation_list']);
 assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
});

test('node observation UI clears prior actual status while a replacement read is pending and after it fails',async()=>{
 let attempts=0,rejectRead;
 const s=setup(op=>op==='node_status'?attempts++===0?actualBfaGUINodeResponse():new Promise((_,reject)=>{rejectRead=reject;}):undefined);
 await settle();await s.load();
 assert.equal(s.node('managed-node-state').textContent,'尚未安装');
 assert.equal(s.node('local-node-bytes').textContent,'738 B');
 const refresh=s.load();await settle();
 assert.equal(s.node('local-node-bytes').textContent,'—');
 assert.equal(s.node('managed-node-state').textContent,'正在读取');
 for(const id of ['local-node-code','local-node-logs-state','local-node-stdout','local-node-stderr'])assert.equal(s.node(id).textContent,'—',id);
 rejectRead(Object.assign(new Error('replacement read unavailable'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'}));await refresh;
 assert.equal(s.node('managed-node-state').textContent,'不可用');
 assert.equal(s.node('local-node-code').textContent,'不可用');
 for(const id of ['local-node-bytes','local-node-logs-state','local-node-stdout','local-node-stderr'])assert.equal(s.node(id).textContent,'—',id);
 assert.equal(s.node('local-node-recovery').textContent,'不可用');
 assert.equal(s.node('native-node-status-original').textContent,'—');
 for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
 assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
});

test('node observation UI keeps cleared state across all locales and a late response after native disconnect',async()=>{
 let attempts=0,finish;
 const s=setup(op=>op==='node_status'?attempts++===0?actualBfaGUINodeResponse():new Promise(resolve=>{finish=resolve;}):undefined);
 await settle();await s.load();const refresh=s.load();await settle();
 const document={documentElement:{},querySelectorAll:()=>[]};
 const localeWindow={document};
 runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window:localeWindow});
 s.window.NetworkI18n=localeWindow.NetworkI18n;
 for(const locale of s.window.NetworkI18n.locales){
  s.window.NetworkI18n.setLocale(locale);s.client.rerenderLocale();
  assert.equal(s.node('managed-node-state').textContent,s.window.NetworkI18n.t('正在读取'),locale);
  assert.equal(s.node('local-node-bytes').textContent,'—',locale);
  assert.equal(document.documentElement.dir,locale==='ar'?'rtl':'ltr',locale);
 }
 s.native.ready=false;s.nativeState();
 finish(actualBfaGUINodeResponse());await refresh;
 for(const locale of s.window.NetworkI18n.locales){
  s.window.NetworkI18n.setLocale(locale);s.client.rerenderLocale();
  assert.equal(s.node('managed-node-state').textContent,s.window.NetworkI18n.t('尚未读取'),locale);
  for(const id of ['local-node-code','local-node-bytes','local-node-stdout','local-node-stderr'])assert.equal(s.node(id).textContent,'—',locale+' '+id);
 }
 assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
});

test('native business UI keeps strict node parsing around the actual bfa GUI-service response',async()=>{
 for(const change of [
  value=>{value.result.payload.productionGrant=true;},
  value=>{value.result.payload.node.generation=0;},
  value=>{value.result.payload.node.generation='00';},
  value=>{value.result.payload.node.generation='18446744073709551616';},
  value=>{value.result.payload.node.productionSupported=1;},
  value=>{value.result.payload.node.nodeId='validator';}
 ]){
  const actual=actualBfaGUINodeResponse();change(actual);const s=setup(op=>op==='node_status'?actual:undefined);await settle();await s.load();
  assert.match(s.node('native-node-operation-code').textContent,/NATIVE_RESPONSE_INVALID/);
  assert.equal(s.node('native-node-stage').textContent,'—');
  for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
  assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
 }
 const incomplete=actualBfaGUINodeResponse();delete incomplete.result.payload.capabilities.logs;const s=setup(op=>op==='node_status'?incomplete:undefined);await settle();await s.load();
 for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
});

function attachSynchronization(s,clock){const sandbox={window:{},URL,Date:class extends Date{static now(){return clock.now;}}};runInNewContext(readFileSync(new URL('./overview.js',import.meta.url),'utf8'),sandbox);s.window.NetworkOverview=sandbox.window.NetworkOverview;}
function nativeSyncNode(clock){const start=new Date(clock.now).toISOString(),end=new Date(clock.now+3000).toISOString();return {...node(),stage:'running',mode:'isolated-lifecycle-fixture',processOwned:true,productionSupported:false,runId:'owned-fixture-run',diagnostics:{code:'LOCAL_OBSERVATION_ONLY',authority:false,logs:{runId:'owned-fixture-run',stdout:null,stderr:null},recovery:{priorEffectUnknown:false},synchronization:{code:'ISOLATED_PROCESS_REPORTED',localHeight:'9007199254740993',targetHeight:null,catchingUp:false,source:'owned-process-unix-comet',updatedAt:start,expiresAt:end,runId:'owned-fixture-run',generation:'7',networkIdentity:{nativeChainId:'6423',nativeGenesisSHA256:HASH,cometChainId:'isolated-fixture',cometGenesisSHA256:'b'.repeat(64)},networkId32Observed:false,authority:false,isolatedFixture:true}}};}
const syncFields=['height','target','catching','source','updated','expires','run','generation'];
function assertSyncCleared(s){for(const field of syncFields)assert.equal(s.node('local-node-sync-'+field).textContent,'—',field);}
test('owned peer count appears on the node page with localized label and stale clearing',async()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(html,/<dt data-i18n="对等连接">对等连接<\/dt><dd id="local-node-sync-peers"[^>]+dir="ltr">—<\/dd>/u);
 const clock={now:Date.now()},n=nativeSyncNode(clock),sync=n.diagnostics.synchronization;
 const s=setup(op=>op==='node_status'?response({code:'OK',node:n,productionGrant:false,capabilities:{...nodeCaps,start:false,stop:false,restart:false}}):undefined);
 attachSynchronization(s,clock);await settle();
 const document={documentElement:{},querySelectorAll:()=>[]},localeWindow={document};
 runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window:localeWindow});
 const locale=localeWindow.NetworkI18n;s.window.NetworkI18n=locale;assert.equal(locale.locales.length,12);
 for(const tag of locale.locales){
  locale.setLocale(tag);assert.equal(document.documentElement.dir,tag==='ar'?'rtl':'ltr',tag);
  const label=locale.t('对等连接');assert.ok(label.length>0,tag);
  if(tag!=='zh-Hans')assert.notEqual(label,'对等连接',tag);
 }
 const count=()=>s.node('local-node-sync-peers').textContent;
 sync.peerCount='0';await s.load();assert.equal(count(),'0');
 sync.peerCount=null;await s.load();assert.equal(count(),'—');
 sync.peerCount='2';await s.load();assert.equal(count(),'2');
 sync.runId='other-run';await s.load();assert.equal(count(),'—');
 sync.runId=n.runId;await s.load();assert.equal(count(),'2');
 const calls=s.calls.length;clock.now+=3001;s.fireTimers();assert.equal(count(),'—');
 assert.equal(s.calls.length,calls);
 assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
});
test('owned synchronization UI displays an isolated observation then expires locally without another native call',async()=>{
 const clock={now:Date.now()},n=nativeSyncNode(clock);const s=setup(op=>op==='node_status'?response({code:'OK',node:n,productionGrant:false,capabilities:{...nodeCaps,start:false,stop:false,restart:false}}):undefined);attachSynchronization(s,clock);await settle();await s.load();
 assert.equal(s.node('local-node-sync').textContent,'本机隔离进程报告');assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');assert.equal(s.node('local-node-sync-target').textContent,'—');assert.equal(s.node('local-node-sync-updated').textContent,n.diagnostics.synchronization.updatedAt);assert.match(s.node('local-node-sync-catching').textContent,/进程报告未在追赶/);assert.match(s.node('local-node-sync-original').textContent,/"networkId32Observed": false/);assert.equal(s.node('native-node-mode').textContent,'隔离生命周期测试模式');
 const count=s.calls.length;clock.now+=3001;s.fireTimers();assert.equal(s.node('local-node-sync').textContent,'同步观测已过期');assertSyncCleared(s);assert.equal(s.calls.length,count);for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
});
test('owned synchronization UI clears on pending read, unavailable result, transport failure and native reset',async()=>{
 const clock={now:Date.now()};let value=nativeSyncNode(clock),pending=null,fail=false;const s=setup(op=>op==='node_status'?fail?Promise.reject(Object.assign(new Error('original native unavailable'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'})):pending?new Promise(resolve=>{pending.resolve=resolve;}):response({code:'OK',node:value,productionGrant:false,capabilities:{...nodeCaps,start:false}}):undefined);attachSynchronization(s,clock);await settle();await s.load();assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');
 pending={};const loading=s.load();await settle();assertSyncCleared(s);assert.equal(s.node('local-node-sync').textContent,'正在读取');pending.resolve(response({code:'UNAVAILABLE',node:null,productionGrant:false,capabilities:Object.fromEntries(Object.keys(nodeCaps).map(key=>[key,false]))}));await loading;pending=null;assertSyncCleared(s);assert.equal(s.node('local-node-sync').textContent,'同步观测不可用');
 await s.load();assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');fail=true;await s.load();assertSyncCleared(s);assert.match(s.node('native-node-operation-code').textContent,/NATIVE_UNAVAILABLE/);fail=false;await s.load();s.native.ready=false;s.nativeState();clock.now+=3001;s.fireTimers();assertSyncCleared(s);assert.equal(s.node('local-node-sync').textContent,'尚未读取');assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
});
test('owned synchronization UI gives each unavailable code a clear state and never derives sync from logs',async()=>{
 const clock={now:Date.now()};for(const [code,label]of [['NOT_SUPPLIED','当前接口未提供'],['NOT_RUNNING','本机节点未运行'],['EXPIRED','同步观测已过期'],['UNAVAILABLE','同步观测不可用']]){const n=nativeSyncNode(clock);n.diagnostics.logs.stdout={text:'synced=true height=99999999999999'};Object.assign(n.diagnostics.synchronization,{code,localHeight:null,targetHeight:null,catchingUp:null,source:null,updatedAt:null,expiresAt:null,runId:null,generation:null,networkIdentity:null,isolatedFixture:false});const s=setup(op=>op==='node_status'?response({code:'OK',node:n,productionGrant:false,capabilities:{...nodeCaps,start:false}}):undefined);attachSynchronization(s,clock);await settle();await s.load();assert.equal(s.node('local-node-sync').textContent,label);assertSyncCleared(s);assert.match(s.node('local-node-stdout').textContent,/synced=true/);}
});

test('owned lifecycle UI rereads a changed node once and drops stale synchronization while waiting',async()=>{
 const clock={now:Date.now()},running=nativeSyncNode(clock);
 const stopped={...running,stage:'stopped',processOwned:false,diagnostics:{...running.diagnostics,synchronization:{
  ...Object.fromEntries(Object.keys(running.diagnostics.synchronization).map(key=>[key,null])),
  code:'NOT_RUNNING',networkId32Observed:false,authority:false,isolatedFixture:false
 }}};
 let finishRead,reads=0;
 const caps={...nodeCaps,start:false,stop:true,restart:false},stopIntent={...intent(),action:'stop'};
 const status=(n,capabilities)=>response({code:'OK',node:n,capabilities,productionGrant:false});
 const s=setup(op=>{
  if(op==='node_status')return ++reads===1?status(running,caps):new Promise(resolve=>{finishRead=resolve;});
  if(op==='node_prepare')return response({code:'PREPARED',node:stopIntent,productionGrant:false});
  if(op==='node_stop')return response({code:'OK',node:null,productionGrant:false});
 });
 attachSynchronization(s,clock);
 const document={documentElement:{},querySelectorAll:()=>[]},locale={document};
 runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window:locale});
 s.window.NetworkI18n=locale.NetworkI18n;
 await s.load();
 assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');
 await s.emit('native-node-stop','click');s.emit('native-node-confirm','click');await settle();
 assert.equal(s.node('native-node-stage').textContent,'—');
 assertSyncCleared(s);
 assert.equal(s.node('local-node-sync').textContent,'正在读取');
 assert.equal(s.node('native-node-operation-code').textContent,'OK');
 assert.equal(reads,2);
 s.window.NetworkI18n.setLocale('ar');s.client.rerenderLocale();
 assert.equal(s.node('local-node-sync').textContent,s.window.NetworkI18n.t('正在读取'));
 finishRead(status(stopped,{...caps,stop:false}));await settle();
 assert.equal(s.node('native-node-stage').textContent,s.window.NetworkI18n.t('已停止'));
 assert.equal(s.node('local-node-sync').textContent,s.window.NetworkI18n.t('本机节点未运行'));
 assertSyncCleared(s);
 assert.equal(s.node('native-node-operation-code').textContent,'OK');
 assert.equal(s.calls.filter(call=>call.operation==='node_stop').length,1);
});

test('owned lifecycle UI rereads restart cancellation to distinguish an original run from an already stopped run',async()=>{
 for(const stopped of [false,true]){
  const clock={now:Date.now()},old={...node(),stage:'running',processOwned:true,runId:'old-run'};
  const caps={...nodeCaps,start:false,stop:true,restart:true};
  let reads=0;
  const s=setup(op=>{
   if(op==='node_status'){
    const stoppedRead=++reads>1&&stopped;
    return response({code:'OK',node:stoppedRead?{...old,stage:'stopped',processOwned:false}:old,
     capabilities:stoppedRead?{...caps,start:true,stop:false,restart:false}:caps,productionGrant:false});
   }
   if(op==='node_restart')return response({code:'CANCELLED',node:null,productionGrant:false});
  });
  attachSynchronization(s,clock);await s.load();
  s.emit('native-node-restart','click');await settle();
  assert.equal(reads,2);
  assert.equal(s.node('native-node-stage').textContent,stopped?'已停止':'运行中');
  assert.equal(s.node('native-node-operation-code').textContent,'CANCELLED');
  assert.equal(s.calls.filter(call=>call.operation==='node_restart').length,1);
  assert.equal(s.calls.some(call=>call.operation==='node_start'||call.operation==='node_stop'),false);
 }
});

test('owned lifecycle UI start UNKNOWN reads once and suppresses a result from a retired Native generation',async()=>{
 let reads=0,late;
 const s=setup(op=>{
  if(op==='node_status'){
   reads++;
   if(reads===2)return new Promise(resolve=>{late=resolve;});
   return response({code:'OK',node:{...node(),runId:reads===1?'initial-run':'new-generation'},capabilities:{...nodeCaps},productionGrant:false});
  }
  if(op==='node_prepare')return response({code:'PREPARED',node:intent(),productionGrant:false});
  if(op==='node_start')throw Object.assign(new Error('start acknowledgement lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'});
 });
 await s.load();await s.emit('native-node-start','click');s.emit('native-node-confirm','click');await settle();
 assert.equal(s.node('native-node-stage').textContent,'—');
 assert.equal(s.node('native-node-operation-code').textContent,'UNKNOWN');
 assert.equal(reads,2);
 s.native.ready=false;s.nativeState();await settle();
 await s.load();
 late(response({code:'OK',node:{...node(),stage:'running',processOwned:true,runId:'old-generation'},capabilities:{...nodeCaps,start:false},productionGrant:false}));await settle();
 assert.equal(s.node('native-node-run').textContent,'new-generation');
 assert.equal(s.node('native-node-stage').textContent,'已安装');
 assert.equal(s.calls.filter(call=>call.operation==='node_start').length,1);
});

test('owned lifecycle UI preserves a running observation when direct stop consent is cancelled or never sent',async()=>{
 for(const cancelled of [true,false]){
  const clock={now:Date.now()},running=nativeSyncNode(clock),caps={...nodeCaps,start:false,stop:true};
  const s=setup(op=>{
   if(op==='node_status')return response({code:'OK',node:running,capabilities:caps,productionGrant:false});
   if(op==='node_prepare')return response({code:'PREPARED',node:{...intent(),action:'stop'},productionGrant:false});
   if(op==='node_stop'){
    if(cancelled)return response({code:'CANCELLED',node:null,productionGrant:false});
    throw Object.assign(new Error('stop was not sent'),{code:'NATIVE_NOT_READY',outcome:'NOT_SENT'});
   }
  });
  attachSynchronization(s,clock);await s.load();
  await s.emit('native-node-stop','click');await s.emit('native-node-confirm','click');
  assert.equal(s.node('native-node-stage').textContent,'运行中');
  assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');
  assert.equal(s.node('native-node-operation-code').textContent,cancelled?'CANCELLED':'NATIVE_NOT_READY');
  assert.equal(s.calls.filter(call=>call.operation==='node_status').length,cancelled?2:1);
  assert.equal(s.calls.filter(call=>call.operation==='node_stop').length,1);
 }
});

test('governance proposal prefill preserves UNKNOWN Wallet records and lost preparation correlation',async()=>{
 for(const state of ['UNKNOWN','AWAITING_WALLET']){
  const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(state),walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();fields(s);await select(s);const calls=s.calls.length,target=s.node('native-part-target').value;
  assert.equal(s.window.NetworkOperations.selectProposal(HASH),false);assert.equal(s.node('native-part-target').value,target);assert.match(s.node('native-part-operation-code').textContent,/OK/);assert.equal(s.node('native-part-original-action').textContent,'委托');assert.equal(s.calls.length,calls);assert.equal(s.node('native-part-submit').disabled,true);
 }
 const s=setup(op=>op==='participation_prepare'?Promise.reject(Object.assign(new Error('preparation acknowledgement lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):undefined);await s.load();fields(s);await s.emit('native-part-form','submit');await settle();const request=s.node('native-part-request').value,target=s.node('native-part-target').value;
 assert.equal(s.window.NetworkOperations.selectProposal(HASH),false);assert.equal(s.node('native-part-request').value,request);assert.equal(s.node('native-part-target').value,target);assert.equal(s.node('native-part-recovery').hidden,false);assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);assert.equal(s.node('native-part-draft').disabled,true);
});

// No invented chain metrics: these cases use only unavailable report metadata
// to exercise the HTTP controller's transport/body lifecycle, never a live RPC.
const unavailableHomepageReport=()=>({classification:'RPC_ONLY',source:'https://rpc.ynxweb4.com',reports:Object.fromEntries(['status','latestBlock','validators'].map(name=>[name,{status:'unavailable',code:'RPC_UNAVAILABLE',source:'https://rpc.ynxweb4.com'}]))});
function expireHomepageRead(s){for(const timer of [...s.timers.values()])if(timer.ms===25000)timer.fn();}

test('homepage read deadline UI releases a stalled report, localizes failure and ignores its late 401 during a new read',async()=>{
 const s=environment();await settle();s.manual('/api/node-report');
 const job=s.emit('node-refresh','click'),late=s.take('/api/node-report');
 expireHomepageRead(s);await settle();
 assert.equal(s.node('node-refresh').disabled,false);assert.equal(s.node('overview-refresh').disabled,false);await job;
 assert.equal(late.options.signal.aborted,true);
 assert.equal(s.uiEvents.filter(e=>e.channel==='networkState').at(-1).value,'failed');
 assert.equal(s.uiEvents.filter(e=>e.channel==='node').at(-1).value,null);
 for(const name of ['status','latestBlock','validators'])assert.equal(s.node('node-'+name+'-raw').textContent,'');
 const document={documentElement:{},querySelectorAll:()=>[]},localeWindow={document};runInNewContext(readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),{window:localeWindow});s.window.NetworkI18n=localeWindow.NetworkI18n;
 for(const locale of s.window.NetworkI18n.locales){s.window.NetworkI18n.setLocale(locale);s.client.rerenderLocale();assert.equal(s.node('node-state').textContent,s.window.NetworkI18n.t('节点报告未完成 · {error}',{error:'NODE_REPORT_TIMEOUT'}),locale);assert.equal(document.documentElement.dir,locale==='ar'?'rtl':'ltr');}
 const fresh=s.emit('node-refresh','click'),currentRead=s.take('/api/node-report');
 late.resolve({error:'PAIRING_REQUIRED'},401);await settle();
 assert.equal(s.storage.has('ynxNetworkTicket'),true);assert.equal(currentRead.options.signal.aborted,false);
 assert.equal(s.node('node-refresh').disabled,true);
 currentRead.resolve(unavailableHomepageReport());await fresh;
 assert.equal(s.node('node-refresh').disabled,false);assert.equal(s.node('node-source').textContent,'https://rpc.ynxweb4.com');
 assert.equal(s.requests.length,0);assert.equal([...s.timers.values()].some(timer=>timer.ms===25000),false);
});

test('homepage read deadline UI bounds a stalled JSON body and prevents it replacing the next report',async()=>{
 let stalled=false,finishBody,bodySignal;
 const ok=body=>({ok:true,status:200,json:async()=>body});
 const s=environment({fetch:async(route,options)=>{
  if(route==='/api/status')return ok({paired:true,callerOsIdentityVerified:false});
  if(route==='/api/node-report'){if(stalled){bodySignal=options.signal;return {ok:true,status:200,json:()=>new Promise(resolve=>{finishBody=resolve;})};}return ok(unavailableHomepageReport());}
  if(route==='/api/native-status')return ok({native:null,browserIdentityVerified:false,code:'NATIVE_UNAVAILABLE'});
  if(route==='/api/receipts')return ok({classification:'historical-local-projection',authority:false,receipts:[]});
  throw Error('Unexpected fixture route '+route);
 }});await settle();stalled=true;
 const job=s.emit('node-refresh','click');await settle();expireHomepageRead(s);await settle();
 assert.equal(s.node('node-refresh').disabled,false);await job;assert.equal(bodySignal.aborted,true);
 stalled=false;await s.emit('node-refresh','click');const reportEvents=s.uiEvents.filter(e=>e.channel==='node').length;
 finishBody(unavailableHomepageReport());await settle();
 assert.equal(s.uiEvents.filter(e=>e.channel==='node').length,reportEvents);
 assert.equal(s.node('node-source').textContent,'https://rpc.ynxweb4.com');
 assert.equal([...s.timers.values()].some(timer=>timer.ms===25000),false);
});

test('homepage read deadline UI cancels replaced reads and cannot repaint a revoked session from late auth or timers',async()=>{
 const s=environment({intervals:true});await settle();s.manual('/api/node-report');
 const prior=s.emit('node-refresh','click'),late=s.take('/api/node-report');
 const fresh=s.emit('node-refresh','click'),active=s.take('/api/node-report');
 late.resolve({error:'PAIRING_REQUIRED'},401);await prior;await settle();
 assert.equal(s.storage.has('ynxNetworkTicket'),true);assert.equal(active.options.signal.aborted,false);
 s.tick();assert.equal(s.requests.length,0);
 active.resolve(unavailableHomepageReport());await fresh;
 const pendingRead=s.emit('node-refresh','click'),last=s.take('/api/node-report');
 const oldCallbacks=[...s.timers.values()].filter(timer=>timer.ms===25000).map(timer=>timer.fn);
 const revoke=s.emit('revoke','click');s.take('/api/revoke').resolve({revoked:true});await revoke;await settle();
 assert.equal(last.options.signal.aborted,true);assert.equal([...s.timers.values()].some(timer=>timer.ms===25000),false);
 for(const callback of oldCallbacks)callback();last.resolve({error:'PAIRING_REQUIRED'},401);await pendingRead;await settle();s.tick();
 assert.equal(s.storage.has('ynxNetworkTicket'),false);assert.equal(s.node('node-state').textContent,'配对后查询固定 RPC 源。');
 assert.equal(s.node('lookup-button').disabled,true);assert.equal(s.node('native-node-stop').disabled,true);assert.equal(s.requests.length,0);
});

test('ordinary node wizard explains missing release and keeps the artifact entry unavailable',async()=>{
 const notice='尚未提供签名的普通节点安装包。请在包含安装包的 Network 版本中重新检查。';
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),stage:'not_installed',artifactSHA256:'',productionSupported:false},productionGrant:false,capabilities:{...nodeCaps,start:false}}):undefined);
 assert.equal(s.node('native-node-wizard-next').textContent,'原生连接尚未就绪');
 await s.load();
 assert.equal(s.node('native-node-wizard-next').textContent,notice);
 assert.equal(s.node('native-node-artifact-field').hidden,true);
 assert.equal(s.node('native-node-install').disabled,true);
 assert.equal(s.node('native-node-read').disabled,false);
 assert.equal(s.calls.some(c=>c.operation==='node_prepare'),false);
 const unavailable=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),stage:'not_installed',artifactSHA256:''},productionGrant:false,capabilities:{...nodeCaps,visibleConsent:false,start:false}}):undefined);
 await unavailable.load();
 assert.equal(unavailable.node('native-node-wizard-next').textContent,'原生确认不可用。请重新打开已安装的 Network App，然后检查节点。');
 assert.equal(unavailable.node('native-node-artifact-field').hidden,true);
});

test('ordinary node wizard reads the result after effect and rejects edits to a prepared install digest',async()=>{
 let status={...node(),stage:'not_installed',artifactSHA256:''},nextReceipt='',prepareFinish;
 const s=setup((op,payload)=>{
  if(op==='node_status')return response({code:'OK',node:status,productionGrant:false,capabilities:{...nodeCaps,install:status.stage==='not_installed',start:status.stage==='installed'}});
  if(op==='node_prepare'){
   nextReceipt=payload.artifactSHA256;
   return new Promise(resolve=>{prepareFinish=()=>resolve(response({code:'PREPARED',node:{...intent(),action:payload.action,artifactSHA256:payload.artifactSHA256},productionGrant:false}));});
  }
  if(op==='node_install'){status={...status,stage:'installed',artifactSHA256:nextReceipt,generation:'8'};return response({code:'OK',node:null,productionGrant:false});}
 });
 await s.load();
 const input=s.node('native-node-artifact'),install=s.node('native-node-install');
 assert.equal(s.node('native-node-artifact-field').hidden,false);
 assert.equal(install.disabled,true);
 input.value=HASH;s.emit('native-node-artifact','input');
 assert.equal(install.disabled,false);
 let prepare=s.emit('native-node-install','click');await settle();
 input.value='c'.repeat(64);s.emit('native-node-artifact','input');prepareFinish();await prepare;
 assert.equal(s.node('native-node-intent-panel').hidden,true);
 assert.equal(s.node('native-node-confirm').disabled,true);
 assert.equal(s.calls.some(c=>c.operation==='node_install'),false);

 prepare=s.emit('native-node-install','click');await settle();prepareFinish();await prepare;
 assert.equal(s.node('native-node-intent-panel').hidden,false);
 assert.equal(s.node('native-node-wizard-next').textContent,'核对本次操作，再在原生窗口中确认。');
 input.value='d'.repeat(64);s.emit('native-node-artifact','input');
 assert.equal(s.node('native-node-intent-panel').hidden,true);
 assert.equal(s.node('native-node-confirm').disabled,true);

 prepare=s.emit('native-node-install','click');await settle();prepareFinish();await prepare;
 s.emit('native-node-confirm','click');await settle();
 assert.equal(s.calls.filter(c=>c.operation==='node_install').length,1);
 assert.equal(s.calls.find(c=>c.operation==='node_install').payload.artifactSHA256,'d'.repeat(64));
 assert.equal(s.calls.at(-1).operation,'node_status');
 assert.equal(s.node('native-node-stage').textContent,'已安装');
 assert.equal(s.node('native-node-artifact-field').hidden,true);
 assert.equal(s.node('native-node-start').disabled,false);
});
