// Controller protocol fixtures only. These cases do not establish native peer
// credentials, human approval, Wallet signatures, node execution or chain funds.
import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,settle} from './test-support.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const ID='1'.repeat(24),OTHER='2'.repeat(24),HASH='a'.repeat(64);
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
 const values={action,request:'local-fixture-correlation',owner:'0x'+'b'.repeat(40),target:action==='delegate'?'validator-original':action==='vote'?'proposal-original':OTHER,amount:'13',fee:'2',expires:new Date(Date.now()+300000).toISOString(),choice:'no'};
 for(const [name,value]of Object.entries(values))s.node('native-part-'+name).value=value;
}
async function select(s){s.node('native-part-id').value=ID;await s.emit('native-part-get-form','submit');await settle();}
async function doReview(s){s.emit('native-part-review','click');await settle();}

test('native business UI keeps an ordinary browser NATIVE_REQUIRED despite HTTP self-status',async()=>{
 const s=environment();await settle();await s.window.NetworkOperations.refresh();
 for(const id of ['native-node-install','native-node-start','native-node-stop','native-node-restart','native-node-confirm','native-part-prepare','native-part-submit','native-resource-review','native-resource-stop'])assert.equal(s.node(id).disabled,true,id);
 assert.match(s.node('native-node-notice').textContent,/原生 App/);assert.match(s.node('native-node-operation').textContent,/NATIVE_REQUIRED/);
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
 const effects=s.calls.filter(c=>c.operation==='node_start');assert.equal(effects.length,1);assert.deepEqual(JSON.parse(JSON.stringify(effects[0].payload)),intent());assert.equal(Object.hasOwn(effects[0].payload,'allow'),false);assert.match(s.node('native-node-operation').textContent,/CANCELLED/);assert.equal(s.node('native-node-intent-panel').hidden,true);
});

test('native business UI rejects a swapped node intent and restart sends only the fixed empty operation',async()=>{
 const mismatch=setup(op=>op==='node_prepare'?response({code:'PREPARED',node:{...intent(),generation:'8'},productionGrant:false}):undefined);await mismatch.load();await mismatch.emit('native-node-start','click');await settle();assert.equal(mismatch.node('native-node-intent-panel').hidden,true);mismatch.emit('native-node-confirm','click');assert.equal(mismatch.calls.some(c=>c.operation==='node_start'),false);
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),stage:'running',processOwned:true},productionGrant:false,capabilities:{...nodeCaps,start:false,stop:true,restart:true}}):op==='node_restart'?response({code:'CANCELLED',node:null,productionGrant:false}):undefined);await s.load();s.emit('native-node-restart','click');await settle();assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(c=>c.operation==='node_restart').payload)),{});assert.equal(s.calls.some(c=>c.operation==='node_prepare'),false);assert.match(s.node('native-node-operation').textContent,/CANCELLED/);
});

test('native business UI prepares real Request fields for delegate unbond withdraw and vote without a codec',async()=>{
 for(const action of ['delegate','unbond','withdraw','vote']){
  const s=setup((op,payload)=>op==='participation_prepare'?response({code:'UNSUPPORTED',entry:{...entry('UNSUPPORTED'),intent:{request:payload,generation:'1'},blockedReason:'original Wallet publisher absent'},walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();fields(s,action);await s.emit('native-part-form','submit');await settle();const request=s.calls.find(c=>c.operation==='participation_prepare').payload;
  assert.equal(request.action,action);assert.equal(request.requestId,'local-fixture-correlation');assert.equal(Object.hasOwn(request,'mainReviewId'),false);assert.equal(Object.hasOwn(request,'canonicalPayload'),false);assert.equal(Object.hasOwn(request,'allow'),false);
  if(action==='withdraw'){assert.equal(request.unbondingId,OTHER);assert.equal(Object.hasOwn(request,'amountYnxt'),false);}if(action==='vote'){assert.equal(request.proposal,'proposal-original');assert.equal(request.choice,'no');assert.equal(Object.hasOwn(request,'amountYnxt'),false);}assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-original').textContent,/original Wallet publisher absent/);
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

test('native business UI UNKNOWN submit is never resent even after another current review',async()=>{
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_submit'?Promise.reject(Object.assign(new Error('transport timed out after post'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):op==='participation_reconcile'?response({code:'UNKNOWN',entry:entry('UNKNOWN'),walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);s.emit('native-part-submit','click');await settle();assert.match(s.node('native-part-operation').textContent,/UNKNOWN/);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,true);s.emit('native-part-submit','click');await settle();assert.equal(s.calls.filter(c=>c.operation==='participation_submit').length,1);s.emit('native-part-reconcile','click');await settle();assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(c=>c.operation==='participation_reconcile').payload)),{id:ID});
});

test('native business UI changed session suppresses late entries and stale native effects',async()=>{
 let finish;const s=setup(op=>op==='participation_prepare'?new Promise(resolve=>{finish=resolve}):undefined);await s.load();fields(s);s.emit('native-part-form','submit');await settle();s.native.ready=false;s.nativeState();finish(response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}));await settle();assert.equal(s.node('native-part-entry-panel').hidden,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.node('native-part-records').children.length,0);
});

test('native business UI unsigned resource preview remains non-authoritative and forged consent fails closed',async()=>{
 let forged=false;const s=setup(op=>op==='resource_review'?response({code:'UNSIGNED_PREVIEW_ONLY',authority:false,productionEnabled:false,consentProduced:forged,previewBytes:'128',previewSHA256:HASH,capabilities:{...resourceCaps,review:false}}):op==='resource_review_cancel'?response({code:'RETIRED',authority:false,productionEnabled:false,consentProduced:false,physicalComplete:true,capabilities:{...resourceCaps,review:false,cancelReview:false}}):undefined);await s.load();s.emit('native-resource-review','click');await settle();assert.equal(s.node('native-resource-preview-sha').textContent,HASH);assert.equal(s.node('native-resource-review').disabled,true);assert.match(s.node('native-resource-original').textContent,/"consentProduced": false/);s.emit('native-resource-cancel','click');await settle();assert.equal(s.node('native-resource-preview-sha').textContent,'—');forged=true;await s.load();s.emit('native-resource-review','click');await settle();assert.equal(s.node('native-resource-preview-sha').textContent,'—');assert.equal(s.node('native-resource-stop').disabled,true);assert.match(s.node('native-resource-operation').textContent,/NATIVE_RESPONSE_INVALID/);
});

test('native business UI preserves journal cursor UNKNOWN rows and never invents persistent history',async()=>{
 let page=0;const cursor='original-opaque-cursor';const s=setup((op,payload)=>op==='participation_list'?response({code:'OK',authority:false,walletApproval:false,entries:[{id:page++?OTHER:ID,requestId:'local-fixture-correlation',action:'withdraw',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}],...(page===1?{nextCursor:cursor}:{}),capabilities:{...partCaps}}):undefined);await s.load();assert.equal(s.node('native-part-records').children.length,1);assert.match(s.node('native-part-records').children[0].textContent,/UNKNOWN/);s.emit('native-part-next','click');await settle();assert.equal(s.node('native-part-records').children.length,2);assert.deepEqual(JSON.parse(JSON.stringify(s.calls.filter(c=>c.operation==='participation_list')[1].payload)),{cursor,limit:20});assert.equal(s.node('native-part-next').disabled,true);
});

test('native business UI resource read failure leaves independent owned-node stop available',async()=>{
 const s=setup(op=>op==='node_status'?response({code:'OK',node:{...node(),productionSupported:false,stage:'running',processOwned:true},productionGrant:false,capabilities:{...nodeCaps,start:false,stop:true}}):op==='resource_status'?Promise.reject(Object.assign(new Error('resource owner unavailable'),{code:'RESOURCE_UNAVAILABLE',outcome:'NOT_SENT'})):undefined);await s.load();assert.equal(s.node('native-node-stop').disabled,false);assert.equal(s.node('native-node-start').disabled,true);assert.equal(s.node('native-resource-stop').disabled,true);assert.match(s.node('native-resource-operation').textContent,/RESOURCE_UNAVAILABLE/);
});

test('native business UI same-ID review with changed original intent cannot enable Wallet submission',async()=>{
 const changed={...entry(),intent:{...entry().intent,request:{...entry().intent.request,action:'withdraw',unbondingId:OTHER}}};
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(changed),walletApproval:false,capabilities:{...partCaps,submit:true}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-operation').textContent,/NATIVE_RESPONSE_INVALID/);
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
 const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_review'?response({code:'OK',review:review(),walletApproval:false,capabilities:{...partCaps,submit:true}}):op==='participation_list'?response({code:'OK',authority:false,walletApproval:false,entries:[{id:ID,requestId:'local-fixture-correlation',action:'delegate',state:'UNKNOWN',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}],capabilities:{...partCaps,submit:true}}):undefined);await s.load();await select(s);await doReview(s);assert.equal(s.node('native-part-submit').disabled,false);s.emit('native-part-list','click');await settle();assert.equal(s.node('native-part-entry-panel').hidden,true);assert.equal(s.node('native-part-submit').disabled,true);assert.match(s.node('native-part-records').children[0].textContent,/UNKNOWN/);
});

test('native business UI prepare UNKNOWN freezes original correlation and resolves an original alias without reprepare',async()=>{
 let originalRequest;const s=setup((op,payload)=>{
  if(op==='participation_prepare'){originalRequest=JSON.parse(JSON.stringify(payload));return Promise.reject(Object.assign(new Error('posted preparation ack lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'}));}
  if(op==='participation_resolve')return response({code:'OK',entry:{...entry(),intent:{request:{...originalRequest,requestId:'first-original-correlation'},generation:'1'}},resolvedRequestId:payload.requestId,authority:false,walletApproval:false,capabilities:{...partCaps}});
 });await s.load();fields(s);await s.emit('native-part-form','submit');await settle();assert.match(s.node('native-part-recovery').textContent,/local-fixture-correlation/);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-draft').disabled,true);s.emit('native-part-draft','click');assert.equal(s.node('native-part-request').value,'local-fixture-correlation');await s.load();s.emit('native-part-form','submit');await settle();assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);s.emit('native-part-resolve','click');await settle();assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(c=>c.operation==='participation_resolve').payload)),{requestId:'local-fixture-correlation'});assert.equal(s.node('native-part-entry-id').textContent,ID);assert.match(s.node('native-part-original').textContent,/first-original-correlation/);assert.match(s.node('native-part-recovery').textContent,/与草稿不同/);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);
});

test('native business UI prepare UNKNOWN NOT_FOUND remains unknown and only retries the original read',async()=>{
 const s=setup((op,payload)=>op==='participation_prepare'?Promise.reject(Object.assign(new Error('ack lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):op==='participation_resolve'?response({code:'NOT_FOUND',entry:null,resolvedRequestId:payload.requestId,authority:false,walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();fields(s);await s.emit('native-part-form','submit');await settle();await s.load();for(let i=0;i<2;i++){s.emit('native-part-resolve','click');await settle();}assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);assert.equal(s.calls.filter(c=>c.operation==='participation_resolve').length,2);assert.match(s.node('native-part-operation').textContent,/UNKNOWN/);assert.equal(s.node('native-part-recovery').hidden,false);assert.equal(s.node('native-part-draft').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);
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
 const s=setup(op=>op==='participation_list'?response({code:'NOT_SUPPLIED',entries:[],walletApproval:false,authority:false,capabilities:Object.fromEntries(Object.keys(partCaps).map(k=>[k,false]))}):undefined);await s.load();assert.match(s.node('native-part-notice').textContent,/NOT_SUPPLIED/);assert.match(s.node('native-part-notice').textContent,/当前接口未提供/);assert.equal(s.node('native-part-prepare').disabled,true);assert.equal(s.node('native-part-submit').disabled,true);assert.equal(s.node('native-part-records').children.length,0);
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
 assert.match(s.node('native-node-operation').textContent,/OK/);
 assert.doesNotMatch(s.node('native-node-operation').textContent,/NATIVE_RESPONSE_INVALID/);
 assert.match(s.node('native-node-notice').textContent,/原发布方工件/);
 for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
 assert.equal(actual.result.payload.node.generation,'0');
 assert.equal(actual.result.payload.node.artifactSHA256,'');
 assert.deepEqual(actual.result.payload.capabilities,{install:false,start:false,stop:false,restart:false,visibleConsent:true,read:true,logs:false});
 assert.deepEqual(s.calls.map(call=>call.operation),['node_status','resource_status','participation_list']);
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
  assert.match(s.node('native-node-operation').textContent,/NATIVE_RESPONSE_INVALID/);
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
test('owned synchronization UI displays an isolated observation then expires locally without another native call',async()=>{
 const clock={now:Date.now()},n=nativeSyncNode(clock);const s=setup(op=>op==='node_status'?response({code:'OK',node:n,productionGrant:false,capabilities:{...nodeCaps,start:false,stop:false,restart:false}}):undefined);attachSynchronization(s,clock);await settle();await s.load();
 assert.equal(s.node('local-node-sync').textContent,'本机隔离进程报告');assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');assert.equal(s.node('local-node-sync-target').textContent,'—');assert.equal(s.node('local-node-sync-updated').textContent,n.diagnostics.synchronization.updatedAt);assert.match(s.node('local-node-sync-catching').textContent,/进程报告未在追赶/);assert.match(s.node('local-node-sync-original').textContent,/"networkId32Observed": false/);assert.equal(s.node('native-node-mode').textContent,'隔离生命周期测试模式');
 const count=s.calls.length;clock.now+=3001;s.fireTimers();assert.equal(s.node('local-node-sync').textContent,'同步观测已过期');assertSyncCleared(s);assert.equal(s.calls.length,count);for(const action of ['install','start','stop','restart','confirm'])assert.equal(s.node('native-node-'+action).disabled,true,action);
});
test('owned synchronization UI clears on pending read, unavailable result, transport failure and native reset',async()=>{
 const clock={now:Date.now()};let value=nativeSyncNode(clock),pending=null,fail=false;const s=setup(op=>op==='node_status'?fail?Promise.reject(Object.assign(new Error('original native unavailable'),{code:'NATIVE_UNAVAILABLE',outcome:'NOT_SENT'})):pending?new Promise(resolve=>{pending.resolve=resolve;}):response({code:'OK',node:value,productionGrant:false,capabilities:{...nodeCaps,start:false}}):undefined);attachSynchronization(s,clock);await settle();await s.load();assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');
 pending={};const loading=s.load();await settle();assertSyncCleared(s);assert.equal(s.node('local-node-sync').textContent,'正在读取');pending.resolve(response({code:'UNAVAILABLE',node:null,productionGrant:false,capabilities:Object.fromEntries(Object.keys(nodeCaps).map(key=>[key,false]))}));await loading;pending=null;assertSyncCleared(s);assert.equal(s.node('local-node-sync').textContent,'同步观测不可用');
 await s.load();assert.equal(s.node('local-node-sync-height').textContent,'9007199254740993');fail=true;await s.load();assertSyncCleared(s);assert.match(s.node('native-node-operation').textContent,/NATIVE_UNAVAILABLE/);fail=false;await s.load();s.native.ready=false;s.nativeState();clock.now+=3001;s.fireTimers();assertSyncCleared(s);assert.equal(s.node('local-node-sync').textContent,'尚未读取');assert.equal(s.calls.some(call=>/^node_(prepare|install|start|stop|restart)$/.test(call.operation)),false);
});
test('owned synchronization UI gives each unavailable code a clear state and never derives sync from logs',async()=>{
 const clock={now:Date.now()};for(const [code,label]of [['NOT_SUPPLIED','当前接口未提供'],['NOT_RUNNING','本机节点未运行'],['EXPIRED','同步观测已过期'],['UNAVAILABLE','同步观测不可用']]){const n=nativeSyncNode(clock);n.diagnostics.logs.stdout={text:'synced=true height=99999999999999'};Object.assign(n.diagnostics.synchronization,{code,localHeight:null,targetHeight:null,catchingUp:null,source:null,updatedAt:null,expiresAt:null,runId:null,generation:null,networkIdentity:null,isolatedFixture:false});const s=setup(op=>op==='node_status'?response({code:'OK',node:n,productionGrant:false,capabilities:{...nodeCaps,start:false}}):undefined);attachSynchronization(s,clock);await settle();await s.load();assert.equal(s.node('local-node-sync').textContent,label);assertSyncCleared(s);assert.match(s.node('local-node-stdout').textContent,/synced=true/);}
});

test('governance proposal prefill preserves UNKNOWN Wallet records and lost preparation correlation',async()=>{
 for(const state of ['UNKNOWN','AWAITING_WALLET']){
  const s=setup(op=>op==='participation_get'?response({code:'OK',entry:entry(state),walletApproval:false,capabilities:{...partCaps}}):undefined);await s.load();fields(s);await select(s);const calls=s.calls.length,target=s.node('native-part-target').value;
  assert.equal(s.window.NetworkOperations.selectProposal(HASH),false);assert.equal(s.node('native-part-target').value,target);assert.match(s.node('native-part-operation').textContent,/OK/);assert.equal(s.node('native-part-original-action').textContent,'delegate');assert.equal(s.calls.length,calls);assert.equal(s.node('native-part-submit').disabled,true);
 }
 const s=setup(op=>op==='participation_prepare'?Promise.reject(Object.assign(new Error('preparation acknowledgement lost'),{code:'NATIVE_TIMEOUT',outcome:'UNKNOWN'})):undefined);await s.load();fields(s);await s.emit('native-part-form','submit');await settle();const request=s.node('native-part-request').value,target=s.node('native-part-target').value;
 assert.equal(s.window.NetworkOperations.selectProposal(HASH),false);assert.equal(s.node('native-part-request').value,request);assert.equal(s.node('native-part-target').value,target);assert.equal(s.node('native-part-recovery').hidden,false);assert.equal(s.calls.filter(c=>c.operation==='participation_prepare').length,1);assert.equal(s.node('native-part-draft').disabled,true);
});
