import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalProjectReader} from '../src/original-project-reader.mjs';
const record=()=>({principal:{account:'public-account',deviceId:'public-device',sessionRef:'s',currentRef:'c',accountGeneration:'1',sessionGeneration:'1'},project:{projectId:'A',ownerAccount:'public-account',currentReference:'p',projectRevision:'1',catalogRevision:'1',read:true,publish:false,runtime:false}});
function fixture(){
 const owners=[],calls=[];let reading=0;const value=record();
 const sdk={acquireOriginalIDEProjectAuthority(...args){assert.equal(args.length,0);const o={partial:true};owners.push(o);calls.push(['acquire',o]);return o;},
  readOriginalIDECurrentProject(o,id){assert.equal(o,owners.at(-1));assert.equal(id,'A');calls.push(['project',o]);reading++;return value;},
  readOriginalIDECurrentServiceRegistration(o,id){assert.equal(id,'A');calls.push(['service',o]);return {...value,serviceRegistration:{projectId:'A'}};},
  readOriginalIDECurrentPublisher(o,id,pub){assert.equal(id,'A');assert.equal(pub,'publisher-A');calls.push(['publisher',o]);return {...value,publisher:{publisherId:pub,revoked:false,keyRole:'ide-artifact-publisher'},publisherOriginal:Uint8Array.of(1)};},
  closeOriginalIDEProjectAuthority(o){assert.equal(o,owners.at(-1));calls.push(['close',o]);}};
 return {sdk,owners,calls,value};
}
test('same original partial, current project/service/publisher reads and one close; reopen acquires fresh owner and creates no grant',async()=>{
 const h=fixture(),reader=createOriginalProjectReader({originalSDK:h.sdk});const result=await reader.readCurrent('A',{includeService:true,publisherId:'publisher-A'});
 assert.equal(result.project,h.value);assert.equal(result.publisher.publisher.publisherId,'publisher-A');assert.equal(result.project.project.publish,false);assert.deepEqual(Object.keys(result),['project','service','publisher']);
 assert.deepEqual(h.calls.map(x=>x[0]),['acquire','project','service','publisher','project','close']);await reader.readCurrent('A');assert.equal(h.owners.length,2);assert.notEqual(h.owners[0],h.owners[1]);
});
test('read failure including falsy cause closes same partial once without reacquisition',async()=>{
 for(const cause of [false,undefined,Error('IDE_PROJECT_DEDICATED_SOURCE_REQUIRED')]){const h=fixture();h.sdk.readOriginalIDECurrentProject=()=>{throw cause;};let rejected=false;try{await createOriginalProjectReader({originalSDK:h.sdk}).readCurrent('A');}catch(error){rejected=true;assert.equal(error,cause);}assert.equal(rejected,true);assert.equal(h.owners.length,1);assert.equal(h.calls.filter(x=>x[0]==='close').length,1);}
});
test('cleanup failure never returns data and retains both original failures',async()=>{
 const h=fixture(),original=Error('revoked'),cleanup=Error('UNKNOWN cleanup');h.sdk.readOriginalIDECurrentProject=()=>{throw original;};h.sdk.closeOriginalIDEProjectAuthority=()=>{throw cleanup;};await assert.rejects(createOriginalProjectReader({originalSDK:h.sdk}).readCurrent('A'),error=>error instanceof AggregateError&&error.errors[0]===original&&error.errors[1]===cleanup);
 const next=fixture();next.sdk.closeOriginalIDEProjectAuthority=()=>{throw cleanup;};await assert.rejects(createOriginalProjectReader({originalSDK:next.sdk}).readCurrent('A'),error=>error===cleanup);
});
test('changed device/project revision or publisher cannot be returned as restored access',async()=>{
 for(const field of ['device','project','publisher']){const h=fixture();let reads=0;h.sdk.readOriginalIDECurrentProject=()=>{const v=record();if(++reads===2&&field==='device')v.principal.deviceId='other';if(reads===2&&field==='project')v.project.projectRevision='2';return v;};if(field==='publisher')h.sdk.readOriginalIDECurrentPublisher=()=>({...record(),publisher:{publisherId:'other'}});await assert.rejects(createOriginalProjectReader({originalSDK:h.sdk}).readCurrent('A',{publisherId:'publisher-A'}),{code:'project_identity_changed'});assert.equal(h.calls.filter(x=>x[0]==='close').length,1);}
});
test('missing original implementation or Source remains unavailable, never synthesizes an owner',async()=>{
 await assert.rejects(createOriginalProjectReader({originalSDK:{}}).readCurrent('A'),{code:'IDE_PROJECT_IMPLEMENTATION_NOT_SUPPLIED'});const h=fixture();h.sdk.acquireOriginalIDEProjectAuthority=()=>null;await assert.rejects(createOriginalProjectReader({originalSDK:h.sdk}).readCurrent('A'),{code:'IDE_PROJECT_DEDICATED_SOURCE_REQUIRED'});assert.equal(h.calls.length,0);
});
function workspaceFixture(){
 const h=fixture(),selector={original:true},selected={projectId:'A',publisherId:'publisher-A',projectRevision:'1',catalogRevision:'1',expiresMS:100000};
 Object.assign(h.sdk,{
  acquireOriginalIDEWorkspaceProjectSelection(...args){h.calls.push(['select',selector]);assert.deepEqual(args,['/public/workspace','/public/profile','local-id']);return selector;},
  readOriginalIDEWorkspaceProjectSelection(owner){assert.equal(owner,selector);h.calls.push(['selection',owner]);return selected;},
  closeOriginalIDEWorkspaceProjectSelection(owner){assert.equal(owner,selector);h.calls.push(['close-selection',owner]);},
 });return {...h,selector,selected};
}
const workspaceInput=()=>({workspaceCanonicalAbsolutePath:'/public/workspace',profileCanonicalAbsolutePath:'/public/profile',localProjectID:'local-id'});
test('workspace uses original Native mapping rather than local ID and releases both same owners after fresh reads',async()=>{
 const h=workspaceFixture(),input=workspaceInput();const pending=createOriginalProjectReader({loadSDK:async()=>h.sdk}).readWorkspace(input,{includeService:true});input.localProjectID='different-after-request';const result=await pending;
 assert.equal(result.selection.projectId,'A');assert.equal(result.publisher.publisher.publisherId,'publisher-A');assert.equal(h.calls.filter(x=>x[0]==='select').length,1);assert.deepEqual(h.calls.slice(-3).map(x=>x[0]),['close','selection','close-selection']);
 // A second read is a new original selection and project owner, never a cache.
 await createOriginalProjectReader({originalSDK:h.sdk}).readWorkspace(workspaceInput());assert.equal(h.owners.length,2);
});
test('workspace map change or mismatched revisions fails after releasing project and selector',async()=>{
 for(const mismatch of ['mapping','revision']){const h=workspaceFixture();let reads=0;h.sdk.readOriginalIDEWorkspaceProjectSelection=()=>({...h.selected,...(mismatch==='mapping'&&++reads===2?{projectId:'B'}:{}),...(mismatch==='revision'?{catalogRevision:'2'}:{})});await assert.rejects(createOriginalProjectReader({originalSDK:h.sdk}).readWorkspace(workspaceInput()),{code:'project_identity_changed'});assert.equal(h.calls.filter(x=>x[0]==='close').length,1);assert.equal(h.calls.filter(x=>x[0]==='close-selection').length,1);}
});
test('missing publisher stays absent and caller cannot override canonical project identity',async()=>{
 const h=workspaceFixture();h.selected.publisherId=null;const reader=createOriginalProjectReader({originalSDK:h.sdk});const result=await reader.readWorkspace(workspaceInput());assert.equal(Object.hasOwn(result,'publisher'),false);assert.equal(h.calls.some(x=>x[0]==='publisher'),false);
 const count=h.calls.length;await assert.rejects(reader.readWorkspace({...workspaceInput(),projectId:'attacker-project'}),{code:'project_selection'});assert.equal(h.calls.length,count);
});
test('selector read or nested authority failure preserves first cause and closes only acquired original owners',async()=>{
 for(const nested of [false,true]){const h=workspaceFixture(),cause=Error('original Source missing');if(nested)h.sdk.readOriginalIDECurrentProject=()=>{throw cause;};else h.sdk.readOriginalIDEWorkspaceProjectSelection=()=>{throw cause;};await assert.rejects(createOriginalProjectReader({originalSDK:h.sdk}).readWorkspace(workspaceInput()),error=>error===cause);assert.equal(h.calls.filter(x=>x[0]==='close-selection').length,1);assert.equal(h.owners.length,nested?1:0);assert.equal(h.calls.filter(x=>x[0]==='close').length,nested?1:0);}
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
test('retained workspace keeps the same Native selector/project until its original Source has joined',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput(),{includeService:true}),events=[],gate=deferred();
 const data=await lease.read();assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);assert.equal(Object.hasOwn(data,'owner'),false);
 const source={retire(){events.push('retire-child-source');},async join(){events.push('join-enter');await gate.promise;events.push('join-exit');},close(){events.push('close-source');}};
 const factory=original=>{assert.equal(original,h.selector);assert.notEqual(original,data.selection);return source;};
 assert.equal(await lease.retainOriginalChild(factory),source);assert.equal(await lease.retainOriginalChild(factory),source);assert.equal(h.owners.length,1);assert.equal(h.calls.filter(x=>x[0]==='select').length,1);
 const closing=lease.close();await new Promise(r=>setImmediate(r));assert.deepEqual(events,['retire-child-source','join-enter']);assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);
 gate.resolve();assert.equal((await closing).complete,true);await lease.close();assert.deepEqual(events,['retire-child-source','join-enter','join-exit','close-source']);assert.deepEqual(h.calls.slice(-2).map(x=>x[0]),['close','close-selection']);
});
for(const phase of ['retire','join','close'])test('uncertain Source '+phase+' retains original parents and falsy failure once',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());let calls=0;
 const source={retire(){if(phase==='retire'){calls++;throw false;}},join(){if(phase==='join'){calls++;throw false;}},close(){if(phase==='close'){calls++;throw false;}}};
 await lease.retainOriginalChild(()=>source);await assert.rejects(lease.close(),error=>error===false);await assert.rejects(lease.close(),error=>error===false);assert.equal(calls,1);assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);assert.equal(lease.status().sourceDebt,true);
});
test('a partial Source is adopted before an original acquisition failure and cleaned before its parents',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput()),events=[],cause=Object.assign(Error('PUBLIC source acquisition failed'),{partial:{retire(){events.push('retire');},join(){events.push('join');},close(){events.push('close');}}});
 await assert.rejects(lease.retainOriginalChild(()=>{throw cause;}),e=>e===cause);assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);await lease.close();assert.deepEqual(events,['retire','join','close']);assert.equal(lease.status().firstCausePresent,true);
});
test('malformed partial debt never releases the actual Native selection or admits a replacement',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput()),cause=Object.assign(Error('PUBLIC partial'),{partial:{PUBLIC:'not a cleanup owner'}});let acquisitions=0;
 await assert.rejects(lease.retainOriginalChild(()=>{acquisitions++;throw cause;}),e=>e===cause);await assert.rejects(lease.close(),e=>e===cause);await assert.rejects(lease.retainOriginalChild(()=>{acquisitions++;}),e=>e===cause);assert.equal(acquisitions,1);assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);
});
test('late asynchronous Source is cleanup-only and cannot escape synchronous original acquisition',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput()),late=deferred(),events=[];
 await assert.rejects(lease.retainOriginalChild(()=>late.promise),{code:'IDE_PROJECT_SOURCE_SYNCHRONOUS_REQUIRED'});let done=false;const closing=lease.close().then(()=>{done=true;});await new Promise(r=>setImmediate(r));assert.equal(done,false);late.resolve({retire(){events.push('retire');},join(){events.push('join');},close(){events.push('close');}});await closing;assert.deepEqual(events,['retire','join','close']);assert.equal(lease.status().closed,true);
});
test('changed original project cannot reuse a retained Source or silently acquire a fresh selector',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());await lease.read();h.value.project.projectRevision='2';await assert.rejects(lease.read(),{code:'project_identity_changed'});await assert.rejects(lease.retainOriginalChild(()=>{throw Error('must not acquire');}),{code:'project_identity_changed'});assert.equal(h.owners.length,1);assert.equal(h.calls.filter(x=>x[0]==='select').length,1);await lease.close();
});

for(const phase of ['project','selection'])test('retained '+phase+' close needs exact void and cannot release a successor parent after uncertainty',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());await lease.read();let closes=0;
 h.sdk[phase==='project'?'closeOriginalIDEProjectAuthority':'closeOriginalIDEWorkspaceProjectSelection']=()=>{closes++;return false;};
 await assert.rejects(lease.close(),{code:phase==='project'?'IDE_PROJECT_PARENT_CLOSE_UNCONFIRMED':'IDE_PROJECT_SELECTION_CLOSE_UNCONFIRMED'});await assert.rejects(lease.close());assert.equal(closes,1);assert.equal(lease.status().closed,false);if(phase==='project')assert.equal(h.calls.some(x=>x[0]==='close-selection'),false);
});
for(const phase of ['selection','project'])test('thrown original '+phase+' partial is adopted for exact cleanup without new acquisition',async()=>{
 const h=workspaceFixture(),partial=phase==='selection'?h.selector:{PUBLIC:'project partial'},cause=Object.assign(Error('PUBLIC partial parent'),{partial});
 if(phase==='selection')h.sdk.acquireOriginalIDEWorkspaceProjectSelection=()=>{throw cause;};else {h.sdk.acquireOriginalIDEProjectAuthority=()=>{throw cause;};h.sdk.closeOriginalIDEProjectAuthority=owner=>{assert.equal(owner,partial);h.calls.push(['close',owner]);};}
 const lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());await assert.rejects(lease.read(),e=>e===cause);await lease.close();assert.equal(h.calls.filter(x=>x[0]==='close-selection').length,1);assert.equal(h.calls.filter(x=>x[0]==='close').length,phase==='selection'?0:1);
});

test('abort during synchronous original Source acquisition retires its owned result before any reuse',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput()),abort=new AbortController(),events=[];
 const source={retire(){events.push('retire');},join(){events.push('join');},close(){events.push('close');}};
 await assert.rejects(lease.retainOriginalChild(()=>{abort.abort(false);return source;},{signal:abort.signal}),e=>e===false);assert.deepEqual(events,['retire']);assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);await assert.rejects(lease.retainOriginalChild(()=>{throw Error('new factory must not enter');}),e=>e===false);await lease.close();assert.deepEqual(events,['retire','join','close']);
});

test('explicit continueClose drains only the same unresolved Source while original first-failure promise stays rejected',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());let ready=false,acquires=0,joins=0,closes=0;
 await lease.retainOriginalChild(()=>{acquires++;return{retire(){},join(){joins++;if(!ready)throw false;},close(){closes++;}};});
 const original=lease.close();await assert.rejects(original,e=>e===false);await assert.rejects(lease.continueClose(),e=>e===false);assert.equal(h.calls.some(x=>x[0].startsWith('close')),false);
 ready=true;const one=lease.continueClose(),two=lease.continueClose();assert.equal(one,two);assert.deepEqual(await one,{cleanupComplete:true,firstCausePresent:true,originalOperationRetried:false});assert.equal(lease.close(),original);await assert.rejects(original,e=>e===false);
 assert.equal(acquires,1);assert.equal(joins,3);assert.equal(closes,1);assert.deepEqual(h.calls.slice(-2).map(x=>x[0]),['close','close-selection']);await assert.rejects(lease.read(),e=>e===false);await lease.continueClose();assert.equal(closes,1);
});
test('explicit continuation retries only its same failed local retire, without factory or parent reacquisition',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());let retired=0,joined=0;
 await lease.retainOriginalChild(()=>({retire(){if(++retired===1)throw false;},join(){joined++;},close(){}}));await assert.rejects(lease.close(),e=>e===false);assert.equal(joined,0);assert.equal((await lease.continueClose()).cleanupComplete,true);assert.equal(retired,2);assert.equal(joined,1);assert.equal(h.owners.length,1);
});
test('continueClose cannot skip or repeat an unconfirmed Native parent close',async()=>{
 const h=workspaceFixture(),lease=await createOriginalProjectReader({originalSDK:h.sdk}).openWorkspace(workspaceInput());await lease.read();let closes=0;h.sdk.closeOriginalIDEProjectAuthority=()=>{closes++;throw undefined;};await assert.rejects(lease.close(),e=>e===undefined);await assert.rejects(lease.continueClose(),e=>e===undefined);assert.equal(closes,1);assert.equal(h.calls.some(x=>x[0]==='close-selection'),false);assert.equal(lease.status().closed,false);
});
