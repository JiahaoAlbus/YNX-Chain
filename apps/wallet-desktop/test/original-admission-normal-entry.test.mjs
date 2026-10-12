import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// New controls execute only exact lexical consumer bodies with PUBLIC stand-ins.
// No Electron/Vault/crypto/native module is imported or executed.
const root=process.env.PUBLIC_NATIVE_PARENT?new URL('file://'+process.env.PUBLIC_NATIVE_PARENT+'/'):new URL('../src/',import.meta.url);
const source=name=>readFileSync(new URL(name,root),'utf8');
test('R12 PUBLIC actual normal main retains absent producer and protected four IPC routes',async()=>{
 const main=source('main.mjs'),start=main.indexOf('let originalAdmissionSupply = null;'),end=main.indexOf('const recipientCameraPermission',start);assert.ok(start>=0&&end>start,'actual main entry absent');
 const routes=new Map(),context={createOriginalAdmissionController:()=>({status:()=>({available:false,busy:false,hasReview:false}),cancel(){}}),openOriginalAdmissionSupply:async()=>null,closeOriginalAdmissionSupply:async()=>undefined,readOriginalAdmissionSummary:async()=>({state:'not-supplied'}),originalAdmissionSelectionUnresolved:()=>false,keyAccess:{status:()=>({locked:false,account:'PUBLIC-account',revision:1,unlockExpiresAt:2000}),run:()=>{throw Error('no original supply; no key operation');}},mainWindow:{isFocused:()=>true,webContents:{send(){}}},accountChangeInProgress:false,randomUUID:()=> 'PUBLIC-id',handleWalletIPC:(c,h)=>routes.set(c,h),safeIPC:async f=>{try{return {ok:true,value:await f()};}catch{return {ok:false};}}};
 runInNewContext(main.slice(start,end),context);assert.equal(routes.size,4);assert.equal((await routes.get('wallet:original-admission-status')()).value.available,false);assert.equal((await routes.get('wallet:original-admission-review')()).ok,false);
 assert.match(main,/assertWalletIPC\(event, mainWindow\?\.webContents/);assert.match(main,/originalAdmissionSecurityStamp/);
});

function publicEntry({read,open,close}={}){
 const text=source('main.mjs'),start=text.indexOf('function createOriginalAdmissionEntry('),end=text.indexOf('\noriginalAdmissionEntry=createOriginalAdmissionEntry',start);
 assert.ok(start>=0&&end>start,'actual R12 entry missing');
 const state={locked:false,authenticating:false,account:'PUBLIC-A',revision:2,unlockExpiresAt:2000},events=[];
 let busy=false,hasReview=false,phase='not-supplied',reviews=0,supply=null,closes=0;
 const controller={status:()=>({phase,busy,hasReview,available:supply!==null,outcomeUnknown:false,ownerRetained:false,publicationRetained:false,cleanupIncomplete:false}),review:()=>{reviews++;hasReview=true;phase='review';},cancel:()=>{hasReview=false;phase='cancelled';},confirm:async()=>{phase='retired';}};
 const keyAccess={status:()=>({...state}),run:async action=>{if(busy)throw Error('PUBLIC_BUSY');busy=true;try{return await action({account:state.account,assert:()=>{if(state.locked)throw Error('PUBLIC_LOCKED');}});}finally{busy=false;}}};
 const context={accountChangeInProgress:false};runInNewContext(text.slice(start,end)+'\nthis.make=createOriginalAdmissionEntry;',context);
 const entry=context.make({controller,keyAccess,now:()=>1000,getVault:()=>({PUBLIC:'same-vault'}),getWindow:()=>({isFocused:()=>true}),openSupply:open??(async()=>({PUBLIC:'selection'})),closeSupply:async value=>{closes++;return close?.(value);},readSummary:read??(async()=>({state:'read',records:[],runtimeRecords:[],unresolved:false})),setSupply:value=>{supply=value;},selectionUnresolved:()=>false,notify:value=>events.push(value)});
 return {entry,state,events,controller,reviews:()=>reviews,closes:()=>closes,supply:()=>supply};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('R12 PUBLIC actual async Review fences late lock and retains returned selection for one cleanup',async()=>{
 const pending=deferred(),owned=Object.freeze({PUBLIC:'late-selection'}),f=publicEntry({open:()=>pending.promise});
 const operation=f.entry.review();await Promise.resolve();await Promise.resolve();
 await assert.rejects(f.entry.review(),/UNRESOLVED/);
 f.state.locked=true;f.state.revision++;f.entry.securityChanged();pending.resolve(owned);
 await assert.rejects(operation,/UNAVAILABLE/);assert.equal(f.reviews(),0);assert.equal(f.closes(),1);assert.equal(f.supply(),null);
 assert.equal(f.entry.status().preparing,false);assert.equal(f.entry.status().account,'PUBLIC-A');
});
test('R12 PUBLIC actual async Review rejects account generation change and cold unresolved state',async()=>{
 const pending=deferred(),f=publicEntry({read:()=>pending.promise});const operation=f.entry.review();
 f.state.account='PUBLIC-B';f.state.revision++;f.entry.securityChanged();pending.resolve({state:'read',records:[],runtimeRecords:[],unresolved:false});
 await assert.rejects(operation,/UNAVAILABLE/);assert.equal(f.reviews(),0);
 const g=publicEntry({read:async()=>({state:'read',records:[{state:'UNKNOWN'}],runtimeRecords:[],unresolved:true})});
 await assert.rejects(g.entry.review(),/UNAVAILABLE/);assert.equal(g.reviews(),0);assert.equal(g.entry.status().canPrepareReview,false);
 const absent=publicEntry({read:async()=>({state:'not-supplied',records:null,runtimeRecords:null,unresolved:null})});
 await assert.rejects(absent.entry.review(),/UNAVAILABLE/);assert.equal(absent.reviews(),0);assert.equal(absent.entry.status().recovery.records,null);
});
test('R12 PUBLIC actual normal Review publishes one current selection and refuses duplicate review',async()=>{
 const f=publicEntry();await f.entry.review();assert.equal(f.reviews(),1);assert.ok(f.supply());
 await assert.rejects(f.entry.review(),/UNRESOLVED/);assert.equal(f.reviews(),1);
 const text=source('main.mjs');assert.match(text,/originalAdmissionVault=passwordVault;/);assert.doesNotMatch(text,/originalAdmissionSupply=await openOriginalAdmissionSupply\(passwordVault\)/);
 for(const route of ['status','review','confirm','cancel'])assert.ok(text.includes(`wallet:original-admission-${route}`));
});
function publicSupply(original={}){
 const context={PUBLIC_ORIGINAL:original,admissionCanonical:JSON.stringify,bindOriginalAdmissionParentSelection:()=>{}};
 const text=source('original-admission-supply.mjs').replace(/^import .*;$/mg,'').replaceAll('export ','').replace("await import('./original-admission-custodian.mjs')",'PUBLIC_ORIGINAL');
 runInNewContext(text+'\nthis.api={openOriginalAdmissionSupply,closeOriginalAdmissionSupply,originalAdmissionSelectionUnresolved,projectOriginalAdmissionSummary,readOriginalAdmissionSummary};',context);return context.api;
}
const nonce=i=>String(i).padStart(43,'A');
test('R12 PUBLIC summary preserves all 32 admission and 64 runtime states without raw IPC fields',()=>{
 const api=publicSupply(),summary={account:'PUBLIC-A',records:Array.from({length:32},(_,i)=>({requestNonce:nonce(i),state:'signed',deliveryState:i===0?null:'acknowledged',signedRaw:'PUBLIC_NEVER_IPC'})),runtimeRecords:Array.from({length:64},(_,i)=>({nonce:nonce(i),state:i===63?'UNKNOWN':'signed',runtimeRaw:'PUBLIC_NEVER_IPC'}))};
 const result=api.projectOriginalAdmissionSummary(summary,'PUBLIC-A');assert.equal(result.records.length,32);assert.equal(result.runtimeRecords.length,64);assert.equal(result.unresolved,true);assert.ok(!JSON.stringify(result).includes('PUBLIC_NEVER_IPC'));
 assert.throws(()=>api.projectOriginalAdmissionSummary({...summary,runtimeRecords:[...summary.runtimeRecords,{nonce:nonce(64),state:'pending'}]},'PUBLIC-A'),/INVALID/);
 assert.throws(()=>api.projectOriginalAdmissionSummary(summary,'PUBLIC-B'),/INVALID/);
});
test('R12 PUBLIC absent fixed producer stays unavailable and late configuration is cleanup-owned',async()=>{
 const absent=publicSupply(),guard={account:'PUBLIC-A',assert(){}};assert.equal(await absent.openOriginalAdmissionSupply({},guard),null);
 assert.equal((await absent.readOriginalAdmissionSummary({},guard)).records,null);
 const pending=deferred(),calls=[],vault={},owned={vault};let locked=false;
 const api=publicSupply({acquireOriginalAdmissionConfiguration:()=>pending.promise,retireOriginalAdmissionConfiguration:value=>{assert.equal(value,owned);calls.push('retire');},joinOriginalAdmissionConfiguration:async()=>{calls.push('join');},closeOriginalAdmissionConfiguration:async()=>{calls.push('close');}});
 const operation=api.openOriginalAdmissionSupply(vault,{assert(){if(locked)throw Error('PUBLIC_LOCKED');}});await Promise.resolve();locked=true;pending.resolve(owned);
 await assert.rejects(operation,/PUBLIC_LOCKED/);assert.deepEqual(calls,['retire','join','close']);assert.equal(api.originalAdmissionSelectionUnresolved(),false);
});
test('R12 PUBLIC normal cancel releases idle selection and cleanup failure blocks new review',async()=>{
 const f=publicEntry();const reviewed=await f.entry.review();assert.equal(reviewed.preparing,false);await f.entry.cancel();assert.equal(f.closes(),1);assert.equal(f.supply(),null);
 const g=publicEntry({close:async()=>{throw false;}});await g.entry.review();await g.entry.cancel();assert.equal(g.entry.status().cleanupIncomplete,true);await assert.rejects(g.entry.review(),/UNRESOLVED/);assert.equal(g.closes(),1);
});
test('R12 PUBLIC fresh guarded status still reads while original UNKNOWN custody blocks business',async()=>{
 let reads=0;const f=publicEntry({read:async()=>{reads++;return {state:'read',records:[{state:'UNKNOWN'}],runtimeRecords:[],unresolved:true};}}),status=f.controller.status;
 f.controller.status=()=>({...status(),phase:'unknown',outcomeUnknown:true,ownerRetained:true});
 const result=await f.entry.refresh();assert.equal(reads,1);assert.equal(result.phase,'unknown');assert.equal(result.recovery.state,'read');assert.equal(result.canPrepareReview,false);assert.equal(f.reviews(),0);
});
test('R12 PUBLIC actual renderer shows bounded distinct progress and rejects stale account generation',()=>{
 const text=source('renderer.js'),start=text.indexOf('function renderOriginalAdmission('),end=text.indexOf('async function originalAdmissionAction',start),nodes=new Map();
 const node=()=>({rows:[],replaceChildren(){this.rows=[];},append(...values){this.rows.push(...values);}}),context={originalAdmissionState:{revision:-1},keyState:{locked:false,revision:3,account:'PUBLIC-A'},document:{querySelector:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:()=>node()}};
 runInNewContext(text.slice(start,end)+'\nthis.render=renderOriginalAdmission;',context);
 context.render({revision:4,securityRevision:3,account:'PUBLIC-A',phase:'cancelled',canPrepareReview:false,recovery:{state:'read',unresolved:true,records:[{requestNonce:'PUBLIC',state:'signed',deliveryState:null},{requestNonce:'PUBLIC',state:'signed',deliveryState:'entered'},{requestNonce:'PUBLIC',state:'signed',deliveryState:'acknowledged'},{requestNonce:'PUBLIC',state:'UNKNOWN',deliveryState:null}],runtimeRecords:Array.from({length:64},()=>({nonce:'PUBLIC',state:'UNKNOWN'}))}});
 const copy=nodes.get('#original-admission-facts').rows.map(x=>x.textContent).join('|');assert.match(copy,/Signed, not delivered/);assert.match(copy,/Delivery entered, unconfirmed/);assert.match(copy,/Delivery acknowledged/);assert.equal(nodes.get('#original-admission-review').disabled,true);assert.equal(nodes.get('#original-admission-facts').rows.length,136);
 context.render({revision:99,securityRevision:2,account:'PUBLIC-B',phase:'acknowledged'});assert.equal(context.originalAdmissionState.revision,4);
});
test('R9 PUBLIC actual preload exposes only review ID, status and cancel, not owner or selection',()=>{const text=source('preload.cjs');for(const method of ['originalAdmissionStatus','originalAdmissionReview','originalAdmissionConfirm','originalAdmissionCancel','onOriginalAdmissionState'])assert.ok(text.includes(method));assert.match(text,/originalAdmissionConfirm:reviewId=>ipcRenderer.invoke\('wallet:original-admission-confirm',reviewId\)/);});
test('R9 PUBLIC actual renderer projects unknown and does not present delivery as account authorization',()=>{
 const text=source('renderer.js'),start=text.indexOf('function renderOriginalAdmission('),end=text.indexOf('async function originalAdmissionAction',start);assert.ok(start>=0&&end>start);
 const nodes=new Map(),context={originalAdmissionState:{revision:-1},keyState:{locked:false},document:{querySelector:id=>{if(!nodes.has(id))nodes.set(id,{replaceChildren(){},append(){}});return nodes.get(id);}}};
 runInNewContext(text.slice(start,end)+'\nrenderOriginalAdmission({revision:2,phase:"unknown",available:true,busy:false,outcomeUnknown:true,publicationRetained:true,hasReview:false});',context);
 assert.match(nodes.get('#original-admission-status').textContent,/Outcome unknown/);assert.equal(nodes.get('#original-admission-review').disabled,true);
 runInNewContext('renderOriginalAdmission({revision:1,phase:"acknowledged",available:true,hasReview:false});',context);assert.match(nodes.get('#original-admission-status').textContent,/Outcome unknown/);
 assert.match(source('index.html'),/original-admission-status/);assert.match(source('index.html'),/no account, project, tools or transfer permission/);
});
