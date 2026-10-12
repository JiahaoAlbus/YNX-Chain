import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createAdmittedLocalProjectMapping } from './admitted-local-project.mjs';
import { createNativeToolsClient } from './native-tools-client.mjs';
import { createLocalAIToolsHost } from './local-ai-tools-host.mjs';
import { createWorkspaceStore } from '../services/workspace-manager/src/store.mjs';
import { createCodeOSSService } from '../services/codeoss-service/src/service.mjs';
import { createNativeToolsService } from '../services/codeoss-service/src/tools-service.mjs';
import { createNativeAIStore } from '../services/codeoss-service/src/native-ai-store.mjs';
import { consumerIdentityBinding } from '../services/codeoss-service/src/identity-consumer-binding.mjs';
import { OPENVSCODE_X64 } from '../services/codeoss-service/src/upstream.mjs';

// Actual original journal/Tools/client/host, with explicitly PUBLIC test-only
// driver, identity verifier and separate Tools authority. No protected supplier,
// desktop window, production Wallet approval or online model is claimed here.
async function fixture(t, modelWork) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-public-mapped-project-')));
  const owner = 'a'.repeat(64), projectId = 'PUBLIC-canonical-project';
  let identity = { owner, workspaceOwner: owner, account: 'PUBLIC-account', generation: 1,
    identityReference: 'a'.repeat(43), expiresAt: Date.now()+60000, isCurrent() {} };
  const verifyIdentity = async () => identity; verifyIdentity.resolveReference = async () => identity;
  const store = createWorkspaceStore({ filename: join(root, 'workspace.sqlite') });
  store.put(owner, projectId, { expectedRevision: 0, idempotencyKey: 'PUBLIC-seed', payload: {
    name: 'PUBLIC project', files: { 'hello.js': 'console.log("Hello World")' }, folders: [], open: ['hello.js'], active: 'hello.js' } });
  let tools, runtime, held, calls = 0, pathValid = true;
  const driver = { upstream: OPENVSCODE_X64, async start(value) { runtime = value; },
    async stop(value) { return { stopped: true, runtimeId: value.runtimeId, identityDigest: value.identityDigest }; }, connect() { throw Error('PUBLIC no runtime listener'); } };
  const core = createCodeOSSService({ filename: join(root, 'core.sqlite'), root: join(root, 'native'), workspaceStore: store,
    verifyIdentity, driver, launchURL: ({sessionId})=>`https://${sessionId}.native.ynxweb4.com/`, assertProjectQuiescent() {},
    onCompletedProject: async value => { held = value.admittedProject; },
    requestNativeTools: value => tools.dispatchRetained(value) });
  const server = createServer((req,res)=>core.handler(req,res)); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));core.close();store.close();});
  const response = await fetch(`http://127.0.0.1:${server.address().port}/runtime/codeoss`, { method:'POST',headers:{'content-type':'application/json','x-ynx-agent-identity':consumerIdentityBinding(identity)},
    body:JSON.stringify({projectId,expectedRevision:1,approval:'launch-native-ide-once'}) });
  assert.equal(response.status,201); const started=await response.json();
  const workspace=join(runtime.projectDirectory,'workspace'), canonical={projectId,workspace,launch:started.session.sessionId};
  assert.ok(held, 'Original normal approved completed-start must supply the held owner');
  const aiStore=createNativeAIStore({filename:join(root,'PUBLIC-ai.sqlite'),keyPath:join(root,'PUBLIC-ai.key')});t.after(()=>aiStore.close());
  tools=createNativeToolsService({coreService:core,aiStore,modelRouter:{catalog:()=>({hosted:{id:'ynx-hosted',configuredModel:'PUBLIC-model'}}),
    async generate(value){calls++;await value.assertCurrent();value.onDispatch();return modelWork?modelWork(value):{model:'PUBLIC-model',text:'PUBLIC result'};}}});
  const supplied={async openProject(binding,{signal}={}) {
    assert.deepEqual(binding,canonical); const borrowed=await core.acquireProject(binding,{signal});
    return {async assertCurrent(value){assert.deepEqual(value,canonical);const s=await borrowed.assertCurrent();return {...s,generation:String(s.generation)};},request:(...args)=>borrowed.request(...args),close:()=>borrowed.close()};
  }};
  const context={id:'11111111-1234-1234-1234-123456789abc',workspace};
  const mapping=createAdmittedLocalProjectMapping({context,canonicalProject:held,nativeTools:supplied});
  const client=createNativeToolsClient({supply:mapping});
  const host=createLocalAIToolsHost(context,{client,async assertPathCurrent(){if(!pathValid)throw Error('PUBLIC inode changed');}});
  t.after(()=>{host.close();mapping.close();});
  return {root,core,store,aiStore,context,host,mapping,canonical,calls:()=>calls,
    mutate:value=>{identity={...identity,...value};},invalidatePath:()=>{pathValid=false;}};
}

test('normal desktop mapping keeps local and canonical IDs distinct through actual host and journal',async t=>{
  const f=await fixture(t), result=await f.host.call('context',{});
  assert.equal(result.available,true);assert.equal(result.projectId,f.context.id);assert.notEqual(result.projectId,f.canonical.projectId);
  assert.equal(result.sessionId,f.canonical.launch);assert.notEqual(result.launch,result.sessionId);
  f.host.close();f.mapping.close();
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT status FROM codeoss_sessions').get().status,'running');
  assert.equal(f.calls(),0);
});

test('normal desktop mapping rejects changed identity and actual canonical writer custody',async t=>{
  const f=await fixture(t);await f.host.call('context',{});f.mutate({generation:2});await assert.rejects(f.host.call('context',{}));
  f.mutate({generation:1});f.store.nativeJournalDatabase().prepare('UPDATE workspace_writers SET writer_token=?').run('PUBLIC-wrong');
  await assert.rejects(f.host.call('context',{}));assert.equal(f.calls(),0);
});

test('normal desktop mapping fences OS path after current identity and refuses wrong local locators',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.mapping.openProject({projectId:f.canonical.projectId,workspace:f.context.workspace,launch:f.canonical.launch}));
  f.invalidatePath();await assert.rejects(f.host.call('context',{}));assert.equal(f.calls(),0);
});

test('normal desktop host rechecks path after an asynchronous identity callback and closes its client once',async()=>{
  let valid=true,closed=0;
  const host=createLocalAIToolsHost({id:localBinding.projectId,workspace:localBinding.workspace},{
    async assertPathCurrent(){if(!valid)throw Error('PUBLIC replaced inode');},
    client:{async assertCurrent(binding){valid=false;return {localProjectId:binding.projectId,workspace:binding.workspace,sessionId:binding.launch,generation:'1',expiresAt:Date.now()+60000};},
      request(){throw Error('Must not dispatch after path change');},close(){closed++;}}});
  await assert.rejects(host.call('context',{}));host.close();host.close();assert.equal(closed,1);
});

test('normal desktop mapping refuses a stopped real journal and preserves its project data',async t=>{
  const f=await fixture(t);await f.host.call('context',{});
  f.store.nativeJournalDatabase().prepare("UPDATE codeoss_sessions SET status='stopped'").run();
  await assert.rejects(f.host.call('context',{}));assert.equal(f.calls(),0);
  assert.equal(f.store.get('a'.repeat(64),f.canonical.projectId).files['hello.js'],'console.log("Hello World")');
});

function publicOwner() {
  const state={owner:'a'.repeat(64),workspaceOwner:'a'.repeat(64),account:'PUBLIC',generation:1,identityReference:'a'.repeat(43),
    localProjectId:'PUBLIC-canonical',workspace:'/PUBLIC/workspace',launch:'22222222-1234-1234-1234-123456789abc',sessionId:'22222222-1234-1234-1234-123456789abc',expiresAt:1000};
  let closes=0;return {state,closes:()=>closes,owner:{assertCurrent:async()=>({...state}),request(){throw Error('PUBLIC Tools separately owned');},close(){closes++;}}};
}
const localBinding={projectId:'PUBLIC-local',workspace:'/PUBLIC/workspace',launch:'11111111-1234-1234-1234-123456789abc'};
test('normal desktop mapping does not renew captured expiry or bind a second launch',async()=>{
  let clock=100;const f=publicOwner();
  const mapping=createAdmittedLocalProjectMapping({context:{id:localBinding.projectId,workspace:localBinding.workspace},canonicalProject:f.owner,now:()=>clock,
    nativeTools:{async openProject(){return {assertCurrent:async()=>({...f.state,generation:'1'}),request:async()=>({}),close(){}};}}});
  const held=await mapping.openProject(localBinding);await assert.rejects(mapping.openProject({...localBinding,launch:f.state.launch}));
  f.state.expiresAt=2000;clock=1000;await assert.rejects(held.assertCurrent(localBinding));mapping.close();mapping.close();assert.equal(f.closes(),1);
});

test('normal desktop mapping closes partial original acquisition and late Tools owner exactly once',async()=>{
  const f=publicOwner();let release,entered,closed=0;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const mapping=createAdmittedLocalProjectMapping({context:{id:localBinding.projectId,workspace:localBinding.workspace},canonicalProject:f.owner,now:()=>100,
    nativeTools:{async openProject(){entered();await waiting;return {assertCurrent:async()=>({...f.state,generation:'1'}),request:async()=>({}),close(){closed++;}};}}});
  const pending=mapping.openProject(localBinding),rejected=assert.rejects(pending);await started;mapping.close();release();await rejected;
  assert.equal(f.closes(),1);assert.equal(closed,1);
});

test('normal desktop mapping preserves UNKNOWN after actual host cancellation and late model',async t=>{
  let entered,release;const started=new Promise(r=>{entered=r;}),waiting=new Promise(r=>{release=r;});
  const f=await fixture(t,async value=>{entered(value);await waiting;return {model:'PUBLIC-model',text:'PUBLIC late'};});
  const context=await f.host.call('context',{}),preview=await f.host.call('proposals',{csrf:context.csrf,prompt:'Explain PUBLIC code',context:'console.log(42)'});
  const controller=new AbortController();const body={csrf:preview.csrf,proposalId:preview.proposalId,approval:'send-reviewed-context-once'};
  const pending=f.host.call('approve',body,controller.signal),rejected=assert.rejects(pending,error=>error.code==='AI_UNKNOWN');
  const sent=await started;controller.abort();await rejected;release();await new Promise(r=>setImmediate(r));
  assert.equal(sent.signal.aborted,true);assert.equal(f.aiStore.list('a'.repeat(64),f.canonical.projectId)[0].status,'unknown');
  await assert.rejects(f.host.call('approve',body));assert.equal(f.calls(),1);
});

test('normal desktop mapping missing Tools supply releases partial retained owner without granting local access',()=>{
  const f=publicOwner();assert.equal(createAdmittedLocalProjectMapping({canonicalProject:f.owner}),null);assert.equal(f.closes(),1);
});

async function cleanupFixture(session,canonicalClose) {
  const f=publicOwner();if(canonicalClose)f.owner.close=canonicalClose;
  const mapping=createAdmittedLocalProjectMapping({context:{id:localBinding.projectId,workspace:localBinding.workspace},canonicalProject:f.owner,now:()=>100,
    nativeTools:{async openProject(){return {assertCurrent:async()=>({...f.state,generation:'1'}),request:async()=>({}),...session};}}});
  return {f,mapping,open:()=>mapping.openProject(localBinding)};
}

test('retained cleanup keeps incomplete original status and permits only cleanup continuation',async()=>{
  let closes=0,finishes=0;
  const f=await cleanupFixture({close(){closes++;return {complete:false,outstanding:1,errors:[]};},finishCleanup(){finishes++;return {complete:true,outstanding:0,errors:[]};}});
  const owner=await f.open();assert.equal(owner.close().complete,false);assert.equal(f.mapping.cleanupStatus().complete,false);
  await assert.rejects(owner.assertCurrent(localBinding));assert.equal((await f.mapping.finishCleanup()).complete,true);
  f.mapping.close();assert.equal(closes,1);assert.equal(finishes,1);
});

test('retained cleanup preserves primary current error and both secondary cleanup failures',async()=>{
  const primary=Error('PUBLIC primary'),toolsCleanup=Error('PUBLIC tools cleanup'),projectCleanup=Error('PUBLIC project cleanup');
  const f=await cleanupFixture({async assertCurrent(){throw primary;},close(){throw toolsCleanup;}},()=>{throw projectCleanup;});
  await assert.rejects(f.open(),error=>error===primary);
  assert.deepEqual(f.mapping.cleanupStatus().errors,[toolsCleanup,projectCleanup]);assert.deepEqual(primary.cleanupErrors,[toolsCleanup,projectCleanup]);
  assert.equal(f.mapping.cleanupStatus().complete,false);
});

test('retained cleanup observes one entered asynchronous close without invoking it again',async()=>{
  let closes=0,resolve;
  const waiting=new Promise(r=>{resolve=r;});
  const f=await cleanupFixture({close(){closes++;return waiting;}}),owner=await f.open();
  assert.equal(owner.close().complete,false);const finishing=f.mapping.finishCleanup();f.mapping.close();
  assert.equal(closes,1);resolve({complete:true,outstanding:0,errors:[]});assert.equal((await finishing).complete,true);assert.equal(closes,1);
});

test('retained cleanup keeps the late acquired Tools owner until its asynchronous cleanup settles',async()=>{
  const f=publicOwner();let release,entered,closeDone,closes=0;
  const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;}),cleanup=new Promise(r=>{closeDone=r;});
  const mapping=createAdmittedLocalProjectMapping({context:{id:localBinding.projectId,workspace:localBinding.workspace},canonicalProject:f.owner,now:()=>100,
    nativeTools:{async openProject(){entered();await waiting;return {assertCurrent:async()=>({...f.state,generation:'1'}),request:async()=>({}),close(){closes++;return cleanup;}};}}});
  const pending=mapping.openProject(localBinding),rejected=assert.rejects(pending);await started;mapping.close();release();await rejected;
  assert.equal(mapping.cleanupStatus().complete,false);const finishing=mapping.finishCleanup();closeDone({complete:true,outstanding:0,errors:[]});
  assert.equal((await finishing).complete,true);assert.equal(closes,1);assert.equal(f.closes(),1);
});

test('retained cleanup observes rejected close once and shares concurrent original continuation',async()=>{
  const secondary=Error('PUBLIC async cleanup');let closes=0,finishes=0,release,entered;
  const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const f=await cleanupFixture({close(){closes++;return Promise.reject(secondary);},async finishCleanup(){finishes++;entered();await waiting;return {complete:true};}});
  const owner=await f.open();owner.close();const first=f.mapping.finishCleanup();const second=f.mapping.finishCleanup();
  assert.equal(first,second);await started;assert.equal(closes,1);assert.equal(finishes,1);release();
  assert.equal((await first).complete,true);assert.deepEqual(f.mapping.cleanupStatus().errors,[secondary]);
});

test('retained cleanup keeps frozen primary and failed continuation without reopening business',async()=>{
  const primary=Object.freeze(Error('PUBLIC frozen primary')),secondary=Error('PUBLIC continuation failure');
  let closes=0;
  const f=await cleanupFixture({assertCurrent(){throw primary;},close(){closes++;return {complete:false};},finishCleanup(){throw secondary;}});
  await assert.rejects(f.open(),error=>error===primary);const status=await f.mapping.finishCleanup();
  assert.equal(status.complete,false);assert.equal(status.primary,primary);assert.deepEqual(status.errors,[secondary]);assert.equal(closes,1);
  await assert.rejects(f.mapping.openProject(localBinding));
});

for (const entry of ['close','finishCleanup']) test(`R11 synchronous ${entry} reentry never selects a second cleanup pass`,async()=>{
  let mapping,closes=0,finishes=0,nested;
  const f=await cleanupFixture({close(){closes++;if(entry==='close')nested=mapping.finishCleanup();return {complete:false};},
    finishCleanup(){finishes++;if(entry==='finishCleanup'&&finishes===1)nested=mapping.finishCleanup();return {complete:true};}});
  mapping=f.mapping;await f.open();
  if(entry==='close'){
    const first=mapping.close();assert.equal(first.complete,false);assert.equal(finishes,0);
    assert.equal(nested.complete,false);await mapping.finishCleanup();
  }else{await mapping.finishCleanup();assert.equal(nested.complete,false);}
  assert.equal(closes,1);assert.equal(finishes,1);assert.equal(mapping.cleanupStatus().complete,true);
});

test('R11 actual frozen Auth rejected acquisition remains cleanup-only in normal mapping accounting',async()=>{
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{pathToFileURL}=await import('node:url');
  const source=process.env.YNX_IDE_AUTH_R4_SOURCE;
  assert.ok(source,'This focused control requires the explicitly pinned original Auth R4 source.');
  const bytes=await readFile(source);assert.equal(createHash('sha256').update(bytes).digest('hex'),'7e226f2eda3a6d57f0eb420f6abf171737c1acf44779c519b57051c67d7880a4');
  const {createNativeToolsAuthority}=await import(pathToFileURL(source));
  const f=publicOwner(),primary=Object.freeze(Error('PUBLIC identity acquisition rejected')),cleanup=Error('PUBLIC partial project release rejected');
  let attempts=0,acquires=0,dispatches=0;
  const tools=createNativeToolsAuthority({now:()=>100,retainedSSO:{acquireReference(){throw primary;}},admittedProjects:{acquireProject(){acquires++;return {
    assertCurrent:async()=>({...f.state}),request(){dispatches++;},close(){attempts++;if(attempts===1)throw cleanup;}
  };}}});
  const mapping=createAdmittedLocalProjectMapping({context:{id:localBinding.projectId,workspace:localBinding.workspace},canonicalProject:f.owner,nativeTools:tools,now:()=>100});
  let carrier;await assert.rejects(mapping.openProject(localBinding),error=>{carrier=error;return error.code==='AI_ACQUISITION_CLEANUP_REQUIRED'&&error.cause===primary;});
  assert.equal(Object.isFrozen(carrier),true);assert.equal(mapping.cleanupStatus().primary,carrier);
  assert.equal(mapping.cleanupStatus().complete,false);assert.equal(mapping.cleanupStatus().outstanding,1);assert.equal(attempts,1);
  mapping.close();assert.equal(attempts,1);
  const done=await mapping.finishCleanup();assert.equal(done.complete,true);assert.equal(attempts,2);
  assert.equal(done.primary,carrier);assert.equal(carrier.cause,primary);assert.equal(done.errors.some(x=>x.error===cleanup),true);
  await assert.rejects(mapping.openProject(localBinding));assert.equal(acquires,1);assert.equal(dispatches,0);assert.equal(f.closes(),1);
});

for(const where of ['then-getter','then-call'])test(`R11 ${where} cleanup reentry observes status without self-await`,async()=>{
  let mapping,nested,closes=0,finishes=0;
  const f=await cleanupFixture({close(){closes++;return {complete:false};},finishCleanup(){finishes++;
    return {get then(){if(where==='then-getter')nested=mapping.finishCleanup();return resolve=>{if(where==='then-call')nested=mapping.finishCleanup();resolve({complete:true});};}};
  }});
  mapping=f.mapping;await f.open();assert.equal((await mapping.finishCleanup()).complete,true);
  assert.equal(nested.complete,false);assert.equal(typeof nested.then,'undefined');assert.equal(closes,1);assert.equal(finishes,1);
});

for(const kind of ['returned-session','original-rejected-acquisition'])test(`R12 synchronous incomplete ${kind} shares pending public pass and retries only later`,async()=>{
  let mapping,attempts=0;
  if(kind==='returned-session'){
    const f=await cleanupFixture({close(){return {complete:false};},finishCleanup(){attempts++;return {complete:attempts>1};}});
    mapping=f.mapping;await f.open();mapping.close();
  }else{
    const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{pathToFileURL}=await import('node:url');
    const source=process.env.YNX_IDE_AUTH_R4_SOURCE;assert.ok(source);
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),'7e226f2eda3a6d57f0eb420f6abf171737c1acf44779c519b57051c67d7880a4');
    const {createNativeToolsAuthority}=await import(pathToFileURL(source));const f=publicOwner(),primary=Object.freeze(Error('PUBLIC original acquisition failure'));
    const tools=createNativeToolsAuthority({now:()=>100,retainedSSO:{acquireReference(){throw primary;}},admittedProjects:{acquireProject(){return {
      assertCurrent:async()=>({...f.state}),request(){throw Error('business must remain retired');},close(){attempts++;if(attempts<=2)throw Error('PUBLIC explicit release refusal');}
    };}}});
    mapping=createAdmittedLocalProjectMapping({context:{id:localBinding.projectId,workspace:localBinding.workspace},canonicalProject:f.owner,nativeTools:tools,now:()=>100});
    await assert.rejects(mapping.openProject(localBinding),e=>e.code==='AI_ACQUISITION_CLEANUP_REQUIRED'&&e.cause===primary);
  }
  const prior=attempts;
  const first=mapping.finishCleanup(),second=mapping.finishCleanup();
  assert.equal(first,second);assert.equal(attempts,prior+1);
  assert.equal((await first).complete,false);assert.equal((await second).complete,false);
  assert.equal(attempts,prior+1);assert.equal(mapping.cleanupStatus().complete,false);
  assert.equal((await mapping.finishCleanup()).complete,true);assert.equal(attempts,prior+2);
  await assert.rejects(mapping.openProject(localBinding));
});
