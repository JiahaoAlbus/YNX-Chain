// Actual six-callee ABI, real native/Go Unix transport, PUBLIC DATA only.
// No fake Native Root, reserved continuation, Source, Store, nonce or receipt.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
// Auth's fixed bridge uses createRequire(modulePath), not an injected provider.
const client=createRequire(import.meta.url)('./task-read-resource-client-original.mjs');
const here=path.dirname(fileURLToPath(import.meta.url)),repository=path.resolve(here,'../..');
const service='ynx-ai-original-task-read-v1';
const body=Buffer.from('{ "Version":"1", "AuthorityOperationID":"PUBLIC-original-operation", "RawInput":null, "PUBLIC":true }\n');
const inputResponse=Buffer.from('{ "input":"UFVCTElDAGlucHV0/wo=" }\n');
const queryResponse=Buffer.from('{ "operationId":"PUBLIC-original-operation", "state":"UNKNOWN", "original":null, "authScope":"" }\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
let evidence,executable,beforePins;
const files=['cmd/ynx-secure-link-caller/task-read-resource-client-original.test.mjs',
  'cmd/ynx-secure-link-caller/task-read-resource-client-original.mjs',
  'cmd/ynx-secure-link-caller/testdata/task-read-resource-original/ORIGINAL.json',
  'cmd/ynx-secure-link-caller/go-task-read-resource-fixture/main.go',
  'cmd/ynx-secure-link-caller/task-read-resource-caller.mjs','cmd/ynx-secure-link-caller/native.c','cmd/ynx-secure-link-caller/build/caller.node',
  'internal/securelink/local_caller.go','internal/securelink/local_caller_unix.go','internal/securelink/ipc_peer_darwin.go','internal/securelink/ipc_peer_linux.go','go.mod','go.sum'];
const pin=async file=>{const b=await fs.readFile(path.join(repository,file));return{file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
const put=(name,value)=>fs.writeFile(path.join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
before(async()=>{
  const root=process.env.YNX_LINK_TASK_READ_RESOURCE_TEST_ARTIFACTS;
  assert.ok(root&&path.isAbsolute(root),'explicit external YNX_LINK_TASK_READ_RESOURCE_TEST_ARTIFACTS required');
  await fs.mkdir(root,{recursive:true,mode:0o700});evidence=await fs.mkdtemp(path.join(root,'tr-original-'));await fs.chmod(evidence,0o700);
  for(const name of ['GOCACHE','GOTMPDIR']){const p=process.env[name];assert.ok(p&&path.isAbsolute(p)&&!p.startsWith(evidence+'/'));await fs.mkdir(p,{recursive:true,mode:0o700});}
  beforePins=await Promise.all(files.map(pin));await put('SOURCE-BEFORE.json',beforePins);
  executable=path.join(evidence,'PUBLIC-peer');const args=['build','-mod=readonly','-p','1','-o',executable,'./cmd/ynx-secure-link-caller/go-task-read-resource-fixture'];
  const r=spawnSync('go',args,{cwd:repository,env:{...process.env,CGO_ENABLED:'0',GOTOOLCHAIN:'local',GOWORK:'off',GOMAXPROCS:'2',GOMEMLIMIT:'1536MiB',TMPDIR:process.env.GOTMPDIR},encoding:'utf8',timeout:90000,maxBuffer:4<<20});
  await fs.writeFile(path.join(evidence,'go-build.stdout'),r.stdout??'',{flag:'wx',mode:0o600});await fs.writeFile(path.join(evidence,'go-build.stderr'),r.stderr??'',{flag:'wx',mode:0o600});
  await put('go-build-command.json',{exe:'go',args,status:r.status,signal:r.signal,error:r.error?{code:r.error.code,message:r.error.message}:null,goArchive:false});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);const b=await fs.readFile(executable);
  await put('FIXTURE.json',{PUBLIC:true,actualGoLocalCallerServer:true,actualNativeUnix:true,actualAuthBridgeCalled:false,actualNativeRootExecuted:false,SourceAdmission:false,RootAdmission:false,P08StoreExecuted:false,AuthStoreExecuted:false,protectedContinuationExecuted:false,binary:{bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}});
  console.log('# Original resource client evidence '+evidence);
},{timeout:95000});
after(async()=>{if(!beforePins)return;const actual=await Promise.all(files.map(pin));await put('SOURCE-AFTER.json',actual);assert.deepEqual(actual,beforePins,'source changed during original-client controls');});
function profile(socketPath,pid,uid){return{socketPath,serverUID:uid,serverPID:pid,service,connectTimeoutMs:1000,requestTimeoutMs:600,routes:['input','execute','query'].map(id=>({id,method:'POST',path:'/internal/ai/original-task-read/'+id,maxRequestBytes:1<<20,maxResponseBytes:1<<20}))};}
function observed(fn){let present=false,error;try{fn();}catch(value){present=true;error=value;}assert.equal(present,true,'a first error, including a falsy value, must actually be thrown');return error;}
async function cleanup(handle){
  assert.equal(client.retireOriginalTaskReadResourceCaller(handle),undefined);
  assert.equal(await client.joinOriginalTaskReadResourceCaller(handle),undefined);
  assert.equal(await client.closeOriginalTaskReadResourceCaller(handle),undefined);
  const life=client.inspectOriginalTaskReadResourceCallerLifetime(handle);
  assert.equal(life.joined,true);assert.equal(life.closed,true);assert.equal(life.responseHeld,false);assert.equal(life.physical.joined,true);assert.equal(life.physical.localFDClosed,true);assert.equal(life.physical.packetHolds,0);
  assert.equal(life.sourceVerified,false);assert.equal(life.operationVerified,false);return life;
}
async function fixture(t,mode='p08-data'){
  const directory=await fs.mkdtemp('/tmp/tro-');await fs.chmod(directory,0o700);const socket=path.join(directory,'s');
  const child=spawn(executable,[socket,mode,String(process.geteuid()),String(process.pid)],{stdio:['pipe','pipe','pipe']});
  const events=[],waiters=[],exit=deferred();let stdout='',stderr='',tail='';
  const event=match=>{const known=events.find(match);if(known)return Promise.resolve(known);return new Promise((resolve,reject)=>{const w={match,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(Error('PUBLIC event deadline '+stderr));},3500)};waiters.push(w);});};
  child.stdout.on('data',raw=>{stdout+=raw;tail+=raw;let end;while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end);tail=tail.slice(end+1);let value;try{value=JSON.parse(line);}catch(error){for(const w of waiters)w.reject(error);continue;}events.push(value);for(const w of [...waiters])if(w.match(value)){clearTimeout(w.timer);waiters.splice(waiters.indexOf(w),1);w.resolve(value);}}});
  child.stderr.on('data',raw=>{stderr+=raw;});child.stdin.on('error',error=>{stderr+='stdin '+error.message+'\n';});child.on('error',error=>exit.reject(error));
  child.on('exit',(code,signal)=>{exit.resolve({code,signal});for(const w of waiters){clearTimeout(w.timer);w.reject(Error('PUBLIC peer exited '+code));}waiters.length=0;});
  const owned=[];const f={events,child,event,owned,command(value){if(!child.stdin.destroyed)child.stdin.write(value+'\n');},async open(changes={},options){const handle=await client.openOriginalTaskReadResourceCaller({...f.profile,...changes},options);assert.ok(handle,'direct open must adopt nonnull partial');owned.push(handle);return handle;}};
  t.after(async()=>{
    f.command('respond');f.command('stop');let cleanupError,killed=false,actualExit;const states=[];
    for(const handle of owned){try{client.retireOriginalTaskReadResourceCaller(handle);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(Error('test cleanup deadline')),1000);try{await client.joinOriginalTaskReadResourceCaller(handle,{signal:controller.signal});await client.closeOriginalTaskReadResourceCaller(handle,{signal:controller.signal});}finally{clearTimeout(timer);}}catch(error){cleanupError??=error;}states.push(client.inspectOriginalTaskReadResourceCallerLifetime(handle));}
    const timer=setTimeout(()=>{killed=true;child.kill();},1500);try{actualExit=await exit.promise;}finally{clearTimeout(timer);}
    const id=path.basename(directory),drained=events.find(v=>v.event==='drained');await fs.writeFile(path.join(evidence,id+'.stdout'),stdout,{flag:'wx',mode:0o600});await fs.writeFile(path.join(evidence,id+'.stderr'),stderr,{flag:'wx',mode:0o600});await put(id+'.exit.json',{mode,exit:actualExit,killSelected:killed,drained:drained??null,callerLifetimes:states});await fs.rm(directory,{recursive:true,force:true});
    assert.equal(killed,false);assert.deepEqual(actualExit,{code:0,signal:null});assert.ok(drained);if(mode.startsWith('p08-')){assert.equal(drained.joinError,'<nil>');assert.equal(drained.closeError,'<nil>');}
    if(cleanupError)throw cleanupError;for(const state of states)assert.equal(state.closed,true);
  });
  const ready=await event(v=>v.event==='ready');assert.equal(ready.pid,child.pid);f.profile=profile(socket,ready.pid,ready.uid);return f;
}

test('original six-callee require ABI uses actual Go input/query and post-FIN response custody, with strict void cleanup',async t=>{
  const names=['openOriginalTaskReadResourceCaller','currentOriginalTaskReadResourceCaller','exchangeOriginalTaskReadResource','retireOriginalTaskReadResourceCaller','joinOriginalTaskReadResourceCaller','closeOriginalTaskReadResourceCaller'];
  for(const name of names)assert.equal(typeof client[name],'function');assert.deepEqual(Object.keys(client).sort(),[...names,'inspectOriginalTaskReadResourceCallerLifetime'].sort());
  const f=await fixture(t);
  for(const stage of ['input','query']){
    const handle=await f.open();assert.equal(client.currentOriginalTaskReadResourceCaller(handle),undefined);
    const packet=await client.exchangeOriginalTaskReadResource(handle,stage,body,{signal:undefined});assert.ok(packet);assert.equal(packet.statusCode,200);assert.equal(packet.bodyComplete,true);
    assert.deepEqual(packet.body,stage==='input'?inputResponse:queryResponse);assert.equal(packet.path,'/internal/ai/original-task-read/'+stage);assert.equal(packet.method,'POST');assert.deepEqual(packet.headers['x-public-multi'],['first','second']);
    assert.equal(client.currentOriginalTaskReadResourceCaller(handle),undefined,'complete original packet has custody, not live-peer authority');
    const life=client.inspectOriginalTaskReadResourceCallerLifetime(handle);assert.equal(life.responseHeld,true);assert.equal(life.physical.packetHolds,1);assert.equal(life.sourceVerified,false);
    if(stage==='input')assert.deepEqual(Buffer.from(JSON.parse(packet.body).input,'base64'),Buffer.from([80,85,66,76,73,67,0,105,110,112,117,116,255,10]));
    else assert.equal(JSON.parse(packet.body).state,'UNKNOWN','ordinary query DATA is not effect/receipt approval');
    await cleanup(handle);assert.equal(await client.closeOriginalTaskReadResourceCaller(handle),undefined);
  }
  assert.equal(f.events.filter(v=>v.event==='request').length,2);for(const request of f.events.filter(v=>v.event==='request')){assert.equal(request.originalCurrent,true);assert.equal(request.cloneDenied,true);assert.equal(request.sameContextCaller,true);assert.deepEqual(Buffer.from(request.body,'base64'),body);}
},{timeout:15000});

test('original direct open preserves actual failed partial before current and abort-zero presence, then closes physically',async t=>{
  const f=await fixture(t);
  for(const [changes,options] of [[{service:'wrong-purpose'},undefined],[{serverPID:f.child.pid+100000},undefined],[{}, {signal:AbortSignal.abort(0)}]]){
    const handle=await f.open(changes,options);const first=observed(()=>client.currentOriginalTaskReadResourceCaller(handle));const life=client.inspectOriginalTaskReadResourceCallerLifetime(handle);assert.equal(life.firstCausePresent,true);assert.equal(life.firstCause,first);
    if(options)assert.ok(Object.is(first,0)||Object.is(first?.cause,0),'falsy cancellation is retained, never absence');
    await cleanup(handle);assert.equal(observed(()=>client.currentOriginalTaskReadResourceCaller(handle)),first);
  }
  assert.equal(f.events.filter(v=>v.event==='request').length,0);
},{timeout:15000});

test('ordinary DATA cannot select protected execute or forge another original handle',async t=>{
  const f=await fixture(t),handle=await f.open();
  for(const fake of [{},{...handle},JSON.parse(JSON.stringify(handle)),{reserved:true,Root:true,sourceVerified:true}]){
    assert.throws(()=>client.currentOriginalTaskReadResourceCaller(fake));await assert.rejects(async()=>client.exchangeOriginalTaskReadResource(fake,'input',body));
  }
  await assert.rejects(client.exchangeOriginalTaskReadResource(handle,'execute',Buffer.from('{"OWN_RESERVED":true,"ticket":"PUBLIC-DATA"}')),error=>error.code==='TASK_RESOURCE_PROTECTED_CONTINUATION_REQUIRED');
  assert.equal(client.currentOriginalTaskReadResourceCaller(handle),undefined);await cleanup(handle);assert.equal(f.events.filter(v=>v.event==='request').length,0);
},{timeout:15000});

test('original late response adopts partial packet before first error; unobserved first cannot be silently drained',async t=>{
  for(const mode of ['partial','drop']){
    const f=await fixture(t,mode),handle=await f.open();const packet=await client.exchangeOriginalTaskReadResource(handle,'query',body);assert.ok(packet,'adopt actual response before interpreting any late first');assert.equal(packet.bodyComplete,false);assert.equal(packet.dispatchPossible,true);
    if(mode==='partial'){assert.equal(packet.statusCode,200);assert.deepEqual(packet.body,Buffer.from('{"PUBLIC":'));}
    assert.equal(client.retireOriginalTaskReadResourceCaller(handle),undefined);
    const saved=client.inspectOriginalTaskReadResourceCallerLifetime(handle).firstCause;assert.ok(saved);let first;
    if(mode==='partial'){
      await assert.rejects(client.joinOriginalTaskReadResourceCaller(handle),error=>error===saved,'a first not yet handed to Current must be reported by cleanup');
      assert.equal(client.inspectOriginalTaskReadResourceCallerLifetime(handle).physical.joined,true,'physical truth is independent from error delivery');
      first=observed(()=>client.currentOriginalTaskReadResourceCaller(handle));
    }else first=observed(()=>client.currentOriginalTaskReadResourceCaller(handle));
    assert.equal(first,saved);await cleanup(handle);assert.equal(observed(()=>client.currentOriginalTaskReadResourceCaller(handle)),first);
    await assert.rejects(client.exchangeOriginalTaskReadResource(handle,'query',body),error=>error===first);assert.equal(f.events.filter(v=>v.event==='request').length,1);assert.equal(f.events.filter(v=>v.event==='connection').length,1);
  }
},{timeout:15000});

test('original held Go request cancellation keeps zero cause and adopted packet until actual joined cleanup',async t=>{
  const f=await fixture(t,'p08-data-hold'),handle=await f.open(),controller=new AbortController();const work=client.exchangeOriginalTaskReadResource(handle,'input',body,{signal:controller.signal});
  const request=await f.event(v=>v.event==='request');assert.equal(request.originalCurrent,true);const before=client.inspectOriginalTaskReadResourceCallerLifetime(handle);assert.equal(before.closed,false);assert.equal(before.physical.requestInFlight,true);assert.equal(before.physical.joined,false);
  controller.abort(0);const packet=await work;assert.ok(packet);assert.equal(packet.bodyComplete,false);assert.equal(packet.dispatchPossible,true);
  const first=observed(()=>client.currentOriginalTaskReadResourceCaller(handle));assert.ok(Object.is(first,0)||Object.is(first?.cause,0));assert.equal(client.inspectOriginalTaskReadResourceCallerLifetime(handle).firstCausePresent,true);
  f.command('respond');await cleanup(handle);assert.equal(observed(()=>client.currentOriginalTaskReadResourceCaller(handle)),first);assert.equal(f.events.filter(v=>v.event==='request').length,1);
},{timeout:15000});

test('original packet mutation is a late dispatched first and cannot be repaired into authority or erase cleanup debt',async t=>{
  const f=await fixture(t),handle=await f.open(),packet=await client.exchangeOriginalTaskReadResource(handle,'input',body);assert.ok(packet);assert.equal(client.currentOriginalTaskReadResourceCaller(handle),undefined);
  const original=Buffer.from(packet.body);packet.body[0]^=1;const first=observed(()=>client.currentOriginalTaskReadResourceCaller(handle));assert.equal(first.code,'TASK_RESOURCE_ORIGINAL_PACKET_CHANGED');assert.equal(first.dispatchPossible,true,'a late corruption cannot claim the HTTP request was never dispatched');
  packet.body.set(original);assert.equal(observed(()=>client.currentOriginalTaskReadResourceCaller(handle)),first,'restoring public DATA does not reset the private first');
  await cleanup(handle);const life=client.inspectOriginalTaskReadResourceCallerLifetime(handle);assert.equal(life.firstCause,first);assert.equal(life.firstCausePresent,true);assert.equal(life.physical.dispatchPossible,true);assert.equal(life.sourceVerified,false);
},{timeout:15000});
