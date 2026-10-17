import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {AsyncLocalStorage} from 'node:async_hooks';
import {types} from 'node:util';
// New controls execute only exact lexical consumer bodies with PUBLIC stand-ins.
// No Electron/Vault/crypto/native module is imported or executed.
const root=process.env.PUBLIC_NATIVE_PARENT?new URL('file://'+process.env.PUBLIC_NATIVE_PARENT+'/'):new URL('../src/',import.meta.url);
const source=name=>readFileSync(name==='main.mjs'&&process.env.PUBLIC_EXIT_MAIN?new URL('file://'+process.env.PUBLIC_EXIT_MAIN):new URL(name,root),'utf8');
function r21ExecutorFixture(withPrivate=true,initial=''){
 const broker=source('original-admission-broker.mjs');
 const canonical=broker.slice(broker.indexOf('export function admissionCanonical'),broker.indexOf('export function captureInstalledAdmission')).replace('export ','');
 const body=source('original-admission-supply.mjs').replace(/^import .*;$/mg,'').replaceAll('export ','').replace("await import('./original-admission-custodian.mjs')",'PUBLIC_ORIGINAL');
 const context={types,Buffer,bindOriginalAdmissionParentSelection(){}};
 runInNewContext(canonical+'\nlet PUBLIC_ORIGINAL;\n'+body+`\n{
 const vault={},executor={executable:'/PUBLIC/executor',args:['PUBLIC'],applicationId:'com.ynxweb4.developer.testnetpreview',consumerManifestDigest:'a'.repeat(64),instanceId:'PUBLIC-instance',currentReference:'b'.repeat(64),expiresAtMs:1000};
 const calls={private:0,current:0,executor:0,cleanup:0,getter:0},received=[];let locked=false,currentFailure=null,currentResult,executorFailure=null,onExecutor=null;
 const privateDispatch=()=>{calls.private++;throw Error('PUBLIC_CALLBACK_MUST_NOT_RUN');};if(${withPrivate})executor.privateDispatch=privateDispatch;
 ${initial}
 const configured={vault,raw:{value:'PUBLIC'},executor,observer:null,assertCurrent(){calls.current++;if(currentFailure!==null)throw currentFailure;return currentResult;},assertExecutorCurrent(value,child){calls.executor++;received.push(value);if(value!==executor)throw Error('PUBLIC_ORIGINAL_IDENTITY_CLONED');if(executorFailure!==null)throw executorFailure;onExecutor?.();},assertAdmissionSuccession(){}};
 PUBLIC_ORIGINAL={acquireOriginalAdmissionConfiguration:async()=>configured,retireOriginalAdmissionConfiguration(){calls.cleanup++;},joinOriginalAdmissionConfiguration:async()=>{},closeOriginalAdmissionConfiguration:async()=>{}};
 this.f={vault,executor,configured,calls,received,privateDispatch,guard:{assert(){if(locked)throw Error('PUBLIC_LOCKED');}},api:{openOriginalAdmissionSupply,closeOriginalAdmissionSupply},clone:value=>JSON.parse(admissionCanonical(value)),lock:()=>locked=true,failCurrent:value=>currentFailure=value,returnCurrent:value=>currentResult=value,failExecutor:value=>executorFailure=value,onExecutor:value=>onExecutor=value};
 }`,context);return context.f;
}
test('R21 actual supply projects private callback privately and routes cloned review to original executor',async()=>{
 const f=r21ExecutorFixture(),s=await f.api.openOriginalAdmissionSupply(f.vault,f.guard);assert.equal(f.calls.private,0);assert.equal(Object.keys(s.executor).length,7);assert.equal('privateDispatch' in s.executor,false);assert.equal(Object.isFrozen(s.executor.args),true);
 assert.equal(s.assertExecutorCurrent(f.clone(s.executor),null),undefined);assert.equal(s.assertExecutorCurrent(f.clone(s.executor),null),undefined);assert.ok(f.received.every(value=>value===f.executor));assert.equal(f.calls.private,0);await f.api.closeOriginalAdmissionSupply(s);assert.equal(f.calls.cleanup,1);
});
test('R21 actual supply retains original identity even for public-only executor',async()=>{const f=r21ExecutorFixture(false),s=await f.api.openOriginalAdmissionSupply(f.vault,f.guard);assert.equal(s.assertExecutorCurrent(f.clone(s.executor),null),undefined);assert.ok(f.received.every(value=>value===f.executor));assert.equal(f.calls.private,0);});
test('R21 foreign extra and accessor review refuses before executor validation',async()=>{const f=r21ExecutorFixture(),s=await f.api.openOriginalAdmissionSupply(f.vault,f.guard),count=f.calls.executor;const changed=f.clone(s.executor);changed.instanceId='PUBLIC-other';assert.throws(()=>s.assertExecutorCurrent(changed,null));const extra=f.clone(s.executor);extra.privateDispatch=f.privateDispatch;assert.throws(()=>s.assertExecutorCurrent(extra,null));const getter=f.clone(s.executor);Object.defineProperty(getter,'applicationId',{get(){f.calls.getter++;return 'PUBLIC';},enumerable:true});assert.throws(()=>s.assertExecutorCurrent(getter,null));assert.equal(f.calls.executor,count);assert.equal(f.calls.getter,0);assert.equal(f.calls.private,0);});
for(const mutation of ['metadata','callback','replacement','args'])test(`R21 original ${mutation} mutation cannot regain executor authority`,async()=>{const f=r21ExecutorFixture(),s=await f.api.openOriginalAdmissionSupply(f.vault,f.guard),count=f.calls.executor;if(mutation==='metadata')f.executor.instanceId='PUBLIC-other';if(mutation==='callback')f.executor.privateDispatch=()=>{};if(mutation==='replacement')f.configured.executor=f.clone(s.executor);if(mutation==='args')f.executor.args.push('PUBLIC-extra');assert.throws(()=>s.assertExecutorCurrent(f.clone(s.executor),null));assert.equal(f.calls.executor,count);assert.equal(f.calls.private,0);});
test('R21 getter or sparse original metadata rejected without invoking getter or executor',async()=>{for(const initial of ["Object.defineProperty(executor,'applicationId',{get(){calls.getter++;return 'PUBLIC';},enumerable:true});","executor.args=Array(1);","executor.unknown='PUBLIC';"]){const f=r21ExecutorFixture(true,initial);await assert.rejects(f.api.openOriginalAdmissionSupply(f.vault,f.guard));assert.equal(f.calls.getter,0);assert.equal(f.calls.executor,0);assert.equal(f.calls.private,0);assert.equal(f.calls.cleanup,1);}});
test('R21 lock source refusal and late original mutation preserve cause without private callbacks',async()=>{
 const locked=r21ExecutorFixture(),s=await locked.api.openOriginalAdmissionSupply(locked.vault,locked.guard),count=locked.calls.executor;locked.lock();assert.throws(()=>s.assertExecutorCurrent(locked.clone(s.executor),null),/PUBLIC_LOCKED/);assert.equal(locked.calls.executor,count);
 const denied=r21ExecutorFixture(),d=await denied.api.openOriginalAdmissionSupply(denied.vault,denied.guard),cause={PUBLIC:'Source unavailable'};denied.failCurrent(cause);assert.throws(()=>d.assertExecutorCurrent(denied.clone(d.executor),null),error=>error===cause);
 const late=r21ExecutorFixture(),l=await late.api.openOriginalAdmissionSupply(late.vault,late.guard);late.onExecutor(()=>{late.executor.currentReference='c'.repeat(64);});assert.throws(()=>l.assertExecutorCurrent(late.clone(l.executor),null));assert.equal(late.calls.private,0);
});
test('R21 falsy source refusal is not replaced by cleanup and retired supply stays unusable',async()=>{const f=r21ExecutorFixture();f.failCurrent(false);let caught='not-caught';try{await f.api.openOriginalAdmissionSupply(f.vault,f.guard);}catch(error){caught=error;}assert.equal(caught,false);assert.equal(f.calls.cleanup,1);assert.equal(f.calls.private,0);const g=r21ExecutorFixture(),s=await g.api.openOriginalAdmissionSupply(g.vault,g.guard);await g.api.closeOriginalAdmissionSupply(s);assert.throws(()=>s.assertExecutorCurrent(g.clone(s.executor),null),/RETIRED/);assert.equal(g.calls.private,0);});
test('R21 nonundefined current return cannot enter executor check',async()=>{const f=r21ExecutorFixture(),s=await f.api.openOriginalAdmissionSupply(f.vault,f.guard),count=f.calls.executor;f.returnCurrent(false);assert.throws(()=>s.assertExecutorCurrent(f.clone(s.executor),null),/CURRENT_INVALID/);assert.equal(f.calls.executor,count);assert.equal(f.calls.private,0);});
test('R21 malformed private callback is refused, never serialized or called',async()=>{for(const initial of ['executor.privateDispatch=null;','executor.privateDispatch=0;']){const f=r21ExecutorFixture(true,initial);await assert.rejects(f.api.openOriginalAdmissionSupply(f.vault,f.guard),/EXECUTOR_INVALID/);assert.equal(f.calls.executor,0);assert.equal(f.calls.private,0);}});
test('R11 PUBLIC normal main initializes fixed private owner with the same Vault, no renderer options',()=>{
 const main=source('main.mjs'),start=main.indexOf('  originalAdmissionVault=passwordVault;'),end=main.indexOf('  familyAccounts =',start);let selected=0,warnings=0;
 const vault={PUBLIC:'same-vault'},context={passwordVault:vault,initializeOriginalAuthIdentityStartup:value=>{assert.equal(value,vault);selected++;return {implementingModuleAvailable:false,nativeQualified:false};},console:{warn:value=>{assert.equal(value,'AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED');warnings++;}}};
 runInNewContext('let originalAdmissionVault=null;'+main.slice(start,end)+'\nthis.selected=originalAdmissionVault;',context);assert.equal(context.selected,vault);assert.equal(selected,1);assert.equal(warnings,1);
 const startup=source('original-auth-identity-startup.mjs');let initialized=0;
 const absent={code:'AUTH_IDENTITY_NATIVE_IMPLEMENTATION_NOT_IMPLEMENTED'},c={initializeOriginalAuthIdentityPrivateStartup:value=>{assert.equal(value,vault);initialized++;throw absent;},originalAuthIdentityStartupStatus:()=>({initialized:true,implementingModuleAvailable:false,nativeQualified:false,resourceSupplied:false})};
 runInNewContext(startup.replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.initialize=initializeOriginalAuthIdentityStartup;',c);assert.equal(c.initialize(vault).nativeQualified,false);assert.equal(initialized,1);
});
test('R12 PUBLIC actual normal main retains absent producer and protected four IPC routes',async()=>{
 const main=source('main.mjs'),start=main.indexOf('let originalAdmissionSupply = null;'),end=main.indexOf('const recipientCameraPermission',start);assert.ok(start>=0&&end>start,'actual main entry absent');
 const routes=new Map(),context={createOriginalAdmissionController:()=>({status:()=>({available:false,busy:false,hasReview:false}),cancel(){}}),openOriginalAdmissionSupply:async()=>null,closeOriginalAdmissionSupply:async()=>undefined,readOriginalAdmissionSummary:async()=>({state:'not-supplied'}),originalAdmissionSelectionUnresolved:()=>false,originalAuthIdentityStartupUnresolved:()=>false,keyAccess:{status:()=>({locked:false,account:'PUBLIC-account',revision:1,unlockExpiresAt:2000}),run:()=>{throw Error('no original supply; no key operation');}},mainWindow:{isFocused:()=>true,webContents:{send(){}}},accountChangeInProgress:false,randomUUID:()=> 'PUBLIC-id',handleWalletIPC:(c,h)=>routes.set(c,h),safeIPC:async f=>{try{return {ok:true,value:await f()};}catch{return {ok:false};}}};
 context.app={on(){},quit(){}}; // PUBLIC Event registration dependency; no app runs.
 runInNewContext(main.slice(start,end),context);assert.equal(routes.size,4);assert.equal((await routes.get('wallet:original-admission-status')()).value.available,false);assert.equal((await routes.get('wallet:original-admission-review')()).ok,false);
 assert.match(main,/assertWalletIPC\(event, mainWindow\?\.webContents/);assert.match(main,/originalAdmissionSecurityStamp/);
});

function publicEntry({read,open,close,key:providedKey,notify:observe}={}){
 const text=source('main.mjs'),start=text.indexOf('function createOriginalAdmissionEntry('),end=text.indexOf('\noriginalAdmissionEntry=createOriginalAdmissionEntry',start);
 assert.ok(start>=0&&end>start,'actual R12 entry missing');
 const state={locked:false,authenticating:false,account:'PUBLIC-A',revision:2,unlockExpiresAt:2000},events=[];
 let busy=false,hasReview=false,phase='not-supplied',reviews=0,supply=null,closes=0;
 const controller={status:()=>({phase,busy,hasReview,available:supply!==null,outcomeUnknown:false,ownerRetained:false,publicationRetained:false,cleanupIncomplete:false}),review:()=>{reviews++;hasReview=true;phase='review';},cancel:()=>{hasReview=false;phase='cancelled';},confirm:async()=>{phase='retired';}};
 const keyAccess=providedKey??{status:()=>({...state}),run:async action=>{if(busy)throw Error('PUBLIC_BUSY');busy=true;try{return await action({account:state.account,assert:()=>{if(state.locked)throw Error('PUBLIC_LOCKED');}});}finally{busy=false;}}};
 const context={accountChangeInProgress:false};runInNewContext(text.slice(start,end)+'\nthis.make=createOriginalAdmissionEntry;',context);
 const entry=context.make({controller,keyAccess,now:()=>1000,getVault:()=>({PUBLIC:'same-vault'}),getWindow:()=>({isFocused:()=>true}),openSupply:open??(async()=>({PUBLIC:'selection'})),closeSupply:async value=>{closes++;return close?.(value);},readSummary:read??(async()=>({state:'read',records:[],runtimeRecords:[],unresolved:false})),setSupply:value=>{supply=value;},selectionUnresolved:()=>false,notify:value=>{events.push(value);observe?.(value);}});
 return {entry,state,events,controller,reviews:()=>reviews,closes:()=>closes,supply:()=>supply};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function publicRealKey(){
 const context={AsyncLocalStorage,setTimeout,clearTimeout,process};
 runInNewContext(source('key-lifecycle.mjs').replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.Key=DesktopKeyLifecycle;',context);
 return new context.Key({authorizer:{available:()=>true,authenticate:async()=>undefined,method:'PUBLIC'},focused:()=>true,now:()=>1000,schedule:()=>({unref(){}}),unschedule(){}});
}
function publicRenderer(api={}){
 const text=source('renderer.js'),nodes=new Map(),node=()=>({rows:[],replaceChildren(){this.rows=[];},append(...values){this.rows.push(...values);},dataset:{},close(){},addEventListener(){}}),noop=()=>{};
 const context={window:{ynxWallet:api},keyState:{locked:true,authenticating:false,revision:0,account:null},securityViewRevision:0,accountSecurityIntent:0,accountState:null,activeAccount:null,signingShort:{},accountOperationOwners:new Map(),document:{querySelector:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},querySelectorAll:()=>[],createElement:()=>node()},invalidateWalletConnectSessions:noop,clearInvoiceInput:noop,invalidatePaymentInput:noop,contractUI:{clear:noop},familyUI:{invalidate:noop},multichainUI:{render:noop},passwordUI:{render:noop,cancel:noop},renderKeyDetail:noop,copyUI:noop,presentApproval:noop,approvalQueue:{clear:noop,suspend:noop},authorizationChoices:new Map()};
 const a=text.indexOf('let originalAdmissionState='),b=text.indexOf("document.querySelector('#original-admission-review').addEventListener",a),c=text.indexOf('function renderKeyState('),d=text.indexOf('\npasswordUI =',c);
 assert.ok(a>=0&&b>a&&c>=0&&d>c);
 runInNewContext(text.slice(a,b)+'\n'+text.slice(c,d)+'\nthis.api={renderKeyState,renderOriginalAdmission,originalAdmissionAction,state:()=>originalAdmissionState};',context);
 return {context,nodes,...context.api};
}
const ticks=async(n=12)=>{for(let i=0;i<n;i++)await Promise.resolve();};
const exitTicks=async()=>{await ticks();await new Promise(setImmediate);};
test('R13 PUBLIC normal controller custody callback ends with original local live fence',async()=>{
 for(const reason of ['cancel','expiry']){
  let time=1000,phase='',spawns=0;const state={account:'PUBLIC-A',revision:1,focused:true,locked:false,unlockExpiresAt:2000},executor={applicationId:'PUBLIC-app',consumerManifestDigest:'PUBLIC-digest',instanceId:'PUBLIC-instance',currentReference:'PUBLIC-ref'},raw={expiresAtMs:2000,expectedRequest:executor};
  const supply={raw,executor,vault:{acquireOriginalServiceAdmissionProduction:async()=>({PUBLIC:'owner'})},assertCurrent(){if(phase==='launching'){if(reason==='cancel')state.locked=true;else time=2000;}},assertExecutorCurrent(){},assertOriginalServiceAdmissionProductionOwner(){},closeOriginalServiceAdmissionProductionOwner(){}};
  const context={admissionCanonical:JSON.stringify,captureInstalledAdmission(){throw Error('PUBLIC_NO_PUBLICATION');},launchOriginalAdmissionIDE:async({assertCustodyCurrent})=>{assertCustodyCurrent();spawns++;throw Error('PUBLIC_NO_CHILD');}};
  runInNewContext(source('original-admission-controller.mjs').replace(/^import .*;$/mg,'').replaceAll('export ','')+'\nthis.make=createOriginalAdmissionController;',context);
  const controller=context.make({getSupply:()=>supply,getContext:()=>state,run:action=>action({assert(){if(state.locked)throw Error('PUBLIC_LOCKED');}}),id:()=> 'PUBLIC-id',now:()=>time,onState:s=>{phase=s.phase;}});
  controller.review();await assert.rejects(controller.confirm('PUBLIC-id'));assert.equal(spawns,0);
 }
});
function publicExit(f){
 const main=source('main.mjs'),start=main.indexOf('function createOriginalAdmissionExitGate('),end=main.indexOf('\nconst originalAdmissionExit=',start),handlers=new Map();assert.ok(start>=0&&end>start,'normal exit gate missing');
 const context={entry:f.entry,setImmediate};let prevented=0,destroyed=0,quits=0,reports=0;
 runInNewContext(main.slice(start,end)+'\nthis.make=createOriginalAdmissionExitGate;',context);
 const gate=context.make({entry:f.entry,lock:()=>{f.state.locked=true;f.state.revision++;f.entry.securityChanged();},quit:()=>{quits++;},report:()=>{reports++;}});
 const window={on:(event,handler)=>handlers.set(event,handler),destroy:()=>{destroyed++;}},app={on:(event,handler)=>handlers.set(event,handler)};
 // Execute actual registration expressions, not a second invented exit caller.
 const close=main.split('\n').find(line=>line.includes('window.on("close",'));
 const all=main.split('\n').find(line=>line.includes('app.on("window-all-closed",'));
 const before=main.split('\n').find(line=>line.includes("app.on('before-quit',"));assert.ok(close&&all&&before);
 runInNewContext(close+'\n'+all+'\n'+before,{window,app,originalAdmissionExit:gate});
 const event={preventDefault(){prevented++;}};
 return {gate,close:()=>handlers.get('close')(event),quit:()=>handlers.get('before-quit')(event),all:()=>handlers.get('window-all-closed')(),counts:()=>({prevented,destroyed,quits,reports})};
}
test('R13 PUBLIC actual close and quit wait late acquisition and same configuration cleanup',async()=>{
 const acquire=deferred(),closing=deferred(),started=deferred();let reentered=false;
 const f=publicEntry({open:()=>{started.resolve();return acquire.promise;},close:()=>{if(!reentered){reentered=true;f.entry.securityChanged();}return closing.promise;}}),exit=publicExit(f);
 const review=f.entry.review();void review.catch(()=>{});await started.promise;
 exit.close();exit.close();exit.quit();exit.all();await exitTicks();assert.equal(exit.counts().destroyed,0);assert.equal(exit.counts().quits,0);
 acquire.resolve({PUBLIC:'late exact selection'});await exitTicks();assert.equal(f.closes(),1);assert.equal(exit.counts().quits,0);assert.equal(exit.counts().destroyed,0);
 closing.resolve();await assert.rejects(review,/UNAVAILABLE/);await exit.gate.request();await exitTicks();assert.equal(f.closes(),1);assert.equal(exit.counts().destroyed,1);assert.equal(exit.counts().quits,1);
 assert.equal(exit.gate.request(),exit.gate.request());await assert.rejects(f.entry.review(),/SHUTDOWN_ENTERED/);
});
test('R13 PUBLIC normal exit waits pending Confirm child join before selection close',async()=>{
 const joined=deferred(),started=deferred(),closed=deferred(),f=publicEntry({close:()=>closed.promise}),exit=publicExit(f);await f.entry.review();
 let active=false;const status=f.controller.status;f.controller.status=()=>({...status(),busy:active,ownerRetained:active});
 f.controller.confirm=async()=>{active=true;started.resolve();await joined.promise;active=false;};
 const confirming=f.entry.confirm('PUBLIC-id');await started.promise;exit.quit();await exitTicks();assert.equal(f.closes(),0);assert.equal(exit.counts().quits,0);
 joined.resolve();await exitTicks();assert.equal(f.closes(),1);assert.equal(exit.counts().quits,0);
 closed.resolve();await confirming;await exit.gate.request();await exitTicks();assert.equal(exit.counts().quits,1);assert.equal(exit.counts().reports,0);
});
test('R13 PUBLIC failed cleanup or UNKNOWN prevents false-clean quit and does not replay close',async()=>{
 for(const kind of ['cleanup','unknown']){
  const f=publicEntry({close:()=>{if(kind==='cleanup')throw false;}}),exit=publicExit(f);await f.entry.review();
  if(kind==='unknown'){const status=f.controller.status;f.controller.status=()=>({...status(),outcomeUnknown:true});}
  exit.close();exit.quit();exit.all();await assert.rejects(exit.gate.request(),{code:'ADMISSION_SHUTDOWN_INCOMPLETE'});await exitTicks();
  assert.equal(exit.counts().quits,0);assert.equal(exit.counts().destroyed,0);assert.equal(exit.counts().reports,1);assert.equal(f.closes(),1);
  exit.quit();await assert.rejects(exit.gate.request(),{code:'ADMISSION_SHUTDOWN_INCOMPLETE'});assert.equal(f.closes(),1);assert.equal(exit.counts().reports,1);
 }
});
test('R13 PUBLIC real key finally notification and normal renderer status route do not feed back',async()=>{
 const key=publicRealKey(),frames=[],routes=new Map();let requests=0,reads=0;
 const f=publicEntry({key,read:async()=>{reads++;return {state:'not-supplied',records:null,runtimeRecords:null,unresolved:null};},notify:value=>frames.push(['admission',value])});
 const renderer=publicRenderer({originalAdmissionStatus:()=>{requests++;if(requests>12)return Promise.resolve({ok:false});return routes.get('wallet:original-admission-status')();}});
 const main=source('main.mjs'),routeStart=main.indexOf("handleWalletIPC('wallet:original-admission-status'"),routeEnd=main.indexOf('\n',main.indexOf("handleWalletIPC('wallet:original-admission-cancel'",routeStart));
 const subStart=main.indexOf('let lastReviewAccount = null;'),subEnd=main.indexOf('\nconst sensitiveIPC',subStart);
 const context={originalAdmissionEntry:f.entry,keyAccess:key,handleWalletIPC:(name,handler)=>routes.set(name,handler),safeIPC:async action=>{try{return {ok:true,value:await action()};}catch{return {ok:false};}},mainWindow:{webContents:{send:(channel,value)=>frames.push(['security',value])}},multichainSecurityContext:null,multichain:null,familyBitcoinTransfer:null,familyBitcoinSubmission:null,familyTronTransfer:null,familyTronSubmission:null,recipientCameraPermission:{invalidate(){}},authorizationController:null,walletConnectInbox:{pending:()=>[]},walletConnectProposalAccounts:new Map(),walletConnect:null,nativeWallet:null,drainWalletConnectInbox(){}};
 runInNewContext(main.slice(routeStart,routeEnd)+'\n'+main.slice(subStart,subEnd),context);
 key.setAccount('PUBLIC-A');await key.unlock();
 const flush=async()=>{for(let i=0;i<60;i++){await ticks(4);const frame=frames.shift();if(frame){if(frame[0]==='security')renderer.renderKeyState(frame[1]);else renderer.renderOriginalAdmission(frame[1]);}}};
 await flush();assert.equal(requests,1);assert.equal(reads,1);assert.equal(renderer.state().recovery.state,'not-supplied');
 // A completed unrelated guarded operation emits the same tuple as well.
 await key.run(async()=>undefined);await flush();assert.equal(requests,1);
 key.cancelOperations();await flush();assert.equal(requests,2);key.lock('manual');await flush();assert.equal(requests,2);
 await key.unlock();await flush();assert.equal(requests,3);
});
test('R13 PUBLIC ahead admission then locked security clears old facts during pending cleanup',()=>{
 const r=publicRenderer();r.renderKeyState({locked:false,authenticating:false,revision:1,account:'PUBLIC-A',unlockExpiresAt:2000});
 r.renderOriginalAdmission({revision:10,securityRevision:1,account:'PUBLIC-A',phase:'review',hasReview:true,review:{id:'PUBLIC-OLD',expiresAtMs:1500}});assert.ok(r.nodes.get('#original-admission-facts').rows.length);
 r.renderOriginalAdmission({revision:11,securityRevision:2,account:'PUBLIC-A',phase:'cancelled',hasReview:false,locked:true,recovery:{state:'locked'}});
 r.renderKeyState({locked:true,authenticating:false,revision:2,account:'PUBLIC-A',unlockExpiresAt:null});
 assert.equal(r.nodes.get('#original-admission-facts').rows.length,0);assert.equal(r.nodes.get('#original-admission-approve').hidden,true);assert.equal(r.nodes.get('#original-admission-review').disabled,true);
 assert.equal(r.state().revision,11);assert.equal(r.state().securityRevision,2);
 // No matching admission event at all: still clear immediately on account lock.
 r.renderKeyState({locked:true,authenticating:false,revision:3,account:'PUBLIC-B',unlockExpiresAt:null});assert.equal(r.nodes.get('#original-admission-facts').rows.length,0);
 r.renderOriginalAdmission({revision:100,securityRevision:1,account:'PUBLIC-A',phase:'review',hasReview:true,review:{expiresAtMs:1500}});assert.equal(r.state().account,'PUBLIC-B');
});
test('R13 PUBLIC delayed status failure or result cannot overwrite new locked account',async()=>{
 for(const ok of [true,false]){
  const pending=deferred(),r=publicRenderer({originalAdmissionStatus:()=>pending.promise});
  r.renderKeyState({locked:false,authenticating:false,revision:1,account:'PUBLIC-A',unlockExpiresAt:2000});
  r.renderKeyState({locked:true,authenticating:false,revision:2,account:'PUBLIC-B',unlockExpiresAt:null});const copy=r.nodes.get('#original-admission-status').textContent;
  pending.resolve(ok?{ok:true,value:{revision:99,securityRevision:1,account:'PUBLIC-A',phase:'review',hasReview:true,review:{expiresAtMs:1500}}}:{ok:false});await ticks();
  assert.equal(r.nodes.get('#original-admission-status').textContent,copy);assert.equal(r.state().account,'PUBLIC-B');assert.equal(r.nodes.get('#original-admission-approve').hidden,true);
 }
});
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
