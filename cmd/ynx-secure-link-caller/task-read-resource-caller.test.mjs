// PUBLIC finite3 native outbound controls. Actual UID/PID and Go caller custody
// are transport DATA; no P08 Store, Source/Root, Grant, nonce or receipt approval.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import {openOriginalTaskReadResourceCaller as open} from './task-read-resource-caller.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const repository=path.resolve(here,'../..');
const service='ynx-ai-original-task-read-v1';
const ids=['input','execute','query'];
const original=Buffer.from('{ "PUBLIC":"opaque original bytes", "epoch":9007199254740993 }\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
let evidence, executable, beforePins;
const pins=[
  'cmd/ynx-secure-link-caller/task-read-resource-caller.test.mjs',
  'cmd/ynx-secure-link-caller/go-task-read-resource-fixture/main.go',
  'cmd/ynx-secure-link-caller/testdata/task-read-resource/ORIGINAL.json',
  'cmd/ynx-secure-link-caller/task-read-resource-caller.mjs',
  'cmd/ynx-secure-link-caller/native.c', 'cmd/ynx-secure-link-caller/build/caller.node',
  'internal/securelink/local_caller.go', 'internal/securelink/local_caller_unix.go',
  'internal/securelink/ipc_peer_darwin.go', 'internal/securelink/ipc_peer_linux.go',
  'go.mod','go.sum',
];
async function pin(relative){const p=path.join(repository,relative),bytes=await fs.readFile(p);return {file:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
const put=(name,value)=>fs.writeFile(path.join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
before(async()=>{
  const root=process.env.YNX_LINK_TASK_READ_RESOURCE_TEST_ARTIFACTS;
  assert.ok(root&&path.isAbsolute(root),'explicit external YNX_LINK_TASK_READ_RESOURCE_TEST_ARTIFACTS required');
  await fs.mkdir(root,{recursive:true,mode:0o700}); evidence=await fs.mkdtemp(path.join(root,'tr-'));await fs.chmod(evidence,0o700);
  for(const name of ['GOCACHE','GOTMPDIR']){
    const p=process.env[name];assert.ok(p&&path.isAbsolute(p)&&!p.startsWith(evidence+'/'),name+' must be separate explicit scratch');
    await fs.mkdir(p,{recursive:true,mode:0o700});
  }
  beforePins=await Promise.all(pins.map(pin));await put('SOURCE-BEFORE.json',beforePins);
  executable=path.join(evidence,'PUBLIC-peer');
  const args=['build','-mod=readonly','-p','1','-o',executable,'./cmd/ynx-secure-link-caller/go-task-read-resource-fixture'];
  const env={...process.env,CGO_ENABLED:'0',GOTOOLCHAIN:'local',GOWORK:'off',GOMAXPROCS:'2',GOMEMLIMIT:'1536MiB',TMPDIR:process.env.GOTMPDIR};
  const built=spawnSync('go',args,{cwd:repository,env,encoding:'utf8',timeout:90000,maxBuffer:4<<20});
  await fs.writeFile(path.join(evidence,'go-build.stdout'),built.stdout??'',{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(evidence,'go-build.stderr'),built.stderr??'',{flag:'wx',mode:0o600});
  await put('go-build-command.json',{exe:'go',args,status:built.status,signal:built.signal,error:built.error?{code:built.error.code,message:built.error.message}:null,goArchive:false});
  assert.equal(built.error,undefined);assert.equal(built.status,0,built.stderr);
  const raw=await fs.readFile(executable);
  await put('FIXTURE.json',{PUBLIC:true,actualUnix:true,actualGoLocalCallerServer:true,rawFaultModeSeparatelyLabelled:true,
    RootAdmission:false,SourceAdmission:false,P08StoreExecuted:false,AuthStageExecuted:false,businessSchemaExecuted:false,
    binary:{path:executable,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')}});
  console.log('# Task read resource evidence '+evidence);
},{timeout:95000});
after(async()=>{
  if(!evidence||!beforePins)return;
  const actual=await Promise.all(pins.map(pin));await put('SOURCE-AFTER.json',actual);assert.deepEqual(actual,beforePins,'source/native tuple changed during controls');
});
function profile(socketPath,pid,uid=process.geteuid()){
  return {socketPath,serverUID:uid,serverPID:pid,service,connectTimeoutMs:1000,requestTimeoutMs:600,
    routes:ids.map(id=>({id,method:'POST',path:'/internal/ai/original-task-read/'+id,maxRequestBytes:1<<20,maxResponseBytes:1<<20}))};
}
async function fixture(t,mode='normal'){
  // This owned endpoint alone uses a short /tmp path for Darwin AF_UNIX. Source,
  // binary, cache, commands and logs remain in the explicit external roots.
  const directory=await fs.mkdtemp('/tmp/tr-');await fs.chmod(directory,0o700);const socket=path.join(directory,'s');
  const child=spawn(executable,[socket,mode,String(process.geteuid()),String(process.pid)],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',tail='';const events=[],waiters=[],exited=deferred();
  const notify=value=>{events.push(value);for(const w of [...waiters])if(w.match(value)){clearTimeout(w.timer);waiters.splice(waiters.indexOf(w),1);w.resolve(value);}};
  const event=match=>{const old=events.find(match);if(old)return Promise.resolve(old);return new Promise((resolve,reject)=>{
    const w={match,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(Error('PUBLIC peer event deadline: '+stdout+' '+stderr));},3500)};waiters.push(w);
  });};
  child.stdout.on('data',b=>{stdout+=b;tail+=b;let end;while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end);tail=tail.slice(end+1);try{notify(JSON.parse(line));}catch(error){for(const w of waiters)w.reject(error);}}});
  child.stderr.on('data',b=>{stderr+=b;});child.stdin.on('error',error=>{stderr+='stdin '+error.message+'\n';});
  child.on('error',error=>exited.reject(error));child.on('exit',(code,signal)=>{exited.resolve({code,signal});for(const w of waiters){clearTimeout(w.timer);w.reject(Error('PUBLIC peer exited '+code+' '+signal));}waiters.length=0;});
  const owned=[];
  const f={socket,child,events,event,owned,mode,command(value){if(!child.stdin.destroyed)child.stdin.write(value+'\n');},
    async open(changes={},options){const out=await open({...f.profile,...changes},options);if(out.owner)owned.push(out.owner);return out;}};
  t.after(async()=>{
    f.command('respond');f.command('stop');
    const cleanup=[];let cleanupError,killSelected=false,exit;
    for(const owner of owned){
      try{owner.retire();}catch{}const c=new AbortController();const timer=setTimeout(()=>c.abort(Error('bounded fixture cleanup')),1000);
      try{const out=await owner.close({signal:c.signal});cleanup.push({physicalDone:out.physicalDone,errorPresent:out.errorPresent,errorCode:out.error?.code});if(!out.physicalDone)cleanupError??=Error('test-owned caller did not physically drain');}
      catch(error){cleanupError??=error;}finally{clearTimeout(timer);}
    }
    const kill=setTimeout(()=>{killSelected=true;child.kill();},1500);
    try{exit=await exited.promise;}catch(error){cleanupError??=error;}finally{clearTimeout(kill);}
    for(const w of waiters)clearTimeout(w.timer);
    const id=path.basename(directory);await fs.writeFile(path.join(evidence,id+'.stdout'),stdout,{flag:'wx',mode:0o600});await fs.writeFile(path.join(evidence,id+'.stderr'),stderr,{flag:'wx',mode:0o600});
    const drained=events.find(v=>v.event==='drained');await put(id+'.exit.json',{mode,exit:exit??null,killSelected,drained:drained??null,callerCleanup:cleanup});
    await fs.rm(directory,{recursive:true,force:true});
    assert.equal(killSelected,false,'test peer timeout/SIGTERM cannot count as physical completion');
    assert.deepEqual(exit,{code:0,signal:null},'test peer must actually exit normally');
    assert.ok(drained,'actual peer drain event required');
    if(mode==='normal'||mode==='normal-hold'){assert.equal(drained.joinError,'<nil>');assert.equal(drained.closeError,'<nil>');}
    if(cleanupError)throw cleanupError;
  });
  const ready=await event(v=>v.event==='ready');assert.equal(ready.pid,child.pid);assert.equal(ready.uid,process.geteuid());f.profile=profile(socket,ready.pid,ready.uid);return f;
}
async function acquire(f,changes={},options){const out=await f.open(changes,options);assert.ok(out.owner,'nonnull open partial must be adopted');assert.equal(out.errorPresent,false,out.error?.stack);return out.owner;}
async function finish(owner,response){
  if(response){await response.release();assert.throws(()=>response.copyDATA(),'released response cannot export bytes again');}
  const closed=await owner.close();assert.equal(closed.physicalDone,true);
  const life=owner.lifetime();assert.equal(life.localFDClosed,true);assert.equal(life.packetHolds,0);assert.equal(life.requestInFlight,false);
  assert.equal(life.sourceVerified,false);assert.equal(life.operationVerified,false);return closed;
}
const failed=out=>{assert.equal(out.errorPresent,true);assert.ok(Object.hasOwn(out,'error'),'raw error presence independent of truthiness');return out.error;};

test('finite3 actual native peer and original Go caller/body/current preserve exact bytes',async t=>{
  const f=await fixture(t);
  for(const id of ids){
    const p=structuredClone(f.profile),out=await open(p);assert.equal(out.errorPresent,false);const owner=out.owner;f.owned.push(owner);
    p.service='mutated';p.routes[0].path='/changed';p.routes[0].maxRequestBytes=1;
    const current=await owner.current();assert.equal(current.peerPID,f.child.pid);assert.equal(current.peerUID,process.geteuid());
    assert.equal(current.dataOnly,true);assert.equal(current.sourceVerified,false);assert.equal(current.operationVerified,false);
    assert.throws(()=>owner.current.call({}));
    failed(await owner.exchange.call({},id,original));
    const input=Buffer.from(original);const pending=owner.exchange(id,input);input.fill(0);
    const result=await pending;assert.equal(result.errorPresent,false,inspect(result.error,{depth:4}));assert.ok(result.response);
    const data=result.response.copyDATA();assert.equal(data.method,'POST');assert.equal(data.path,'/internal/ai/original-task-read/'+id);
    assert.equal(data.statusCode,200);assert.equal(data.bodyComplete,true);assert.equal(data.dispatchPossible,true);assert.deepEqual(data.body,original);
    assert.equal(data.terminalPeer.livenessProved,false);assert.equal(data.sourceVerified,false);assert.equal(data.operationVerified,false);
    assert.equal(typeof data.terminalPeer.peerIdentityAvailable,'boolean');assert.equal(typeof data.terminalPeer.terminalEOFObserved,'boolean');
    assert.ok(data.terminalPeer.peerIdentityAvailable||data.terminalPeer.terminalEOFObserved,'terminal identity is fresh kernel DATA or original held-fd plus real EOF');
    await put('terminal-'+id+'.json',data.terminalPeer);
    assert.deepEqual(data.headers['x-public-multi'],['first','second']);assert.ok(Array.isArray(data.rawHeaders));
    for(const fake of [{},{...result.response},JSON.parse(JSON.stringify(result.response))]){
      assert.throws(()=>result.response.copyDATA.call(fake));assert.throws(()=>result.response.release.call(fake));
    }
    data.body.fill(0);assert.deepEqual(result.response.copyDATA().body,original,'response bytes must be owned copies');
    const request=f.events.filter(v=>v.event==='request').at(-1);assert.equal(request.peerPID,process.pid);assert.equal(request.peerUID,process.geteuid());
    assert.equal(request.originalCurrent,true);assert.equal(request.sameContextCaller,true);assert.equal(request.cloneDenied,true);assert.equal(request.host,service);
    const closed=await finish(owner,result.response);assert.equal(closed.errorPresent,false);assert.equal(owner.firstCause(),null);
    assert.equal((await owner.exchange('query',original)).errorPresent,true,'no second HTTP attempt/query fallback');
  }
  assert.equal(f.events.filter(v=>v.event==='request').length,3);
},{timeout:15000});

test('finite3 rejects other purposes, routing hooks and invalid profiles before HTTP',async t=>{
  const f=await fixture(t);let touched=0;
  const mutations=[p=>p.service='isolated-auth',p=>p.routes.pop(),p=>p.routes.push({...p.routes[0]}),p=>p.routes[0].path+='?q=1',
    p=>p.routes[0].method='GET',p=>p.routes[0].id='effect',p=>p.routes[0].path='/internal/auth/task-grants/effect',
    p=>p.routes[0].maxRequestBytes=(1<<20)+1,p=>p.routes[0].maxResponseBytes=0,p=>p.headers={Host:service},p=>p.createConnection=()=>{},p=>p.fd=1];
  for(const mutate of mutations){const p=structuredClone(f.profile);mutate(p);const out=await open(p);failed(out);assert.ok(out.owner);const closed=await out.owner.close();assert.equal(closed.physicalDone,true);}
  const p={...f.profile};Object.defineProperty(p,'socketPath',{enumerable:true,get(){touched++;throw Error('external getter');}});
  const out=await open(p);failed(out);assert.equal(touched,0);await out.owner.close();assert.equal(f.events.filter(v=>v.event==='request').length,0);
},{timeout:15000});

test('actual mismatched OS UID/PID and preaborted open preserve non-dispatch partial',async t=>{
  const f=await fixture(t);
  for(const change of [{serverUID:process.geteuid()+1},{serverPID:f.child.pid+100000}]){const out=await f.open(change);failed(out);assert.ok(out.owner);assert.equal((await out.owner.close()).physicalDone,true);}
  const controller=new AbortController();controller.abort(0);const out=await f.open({}, {signal:controller.signal});failed(out);assert.ok(out.owner);assert.equal((await out.owner.close()).physicalDone,true);
  assert.equal(f.events.filter(v=>v.event==='request').length,0);
},{timeout:15000});

test('unknown operation and independent request limit refuse without consuming the HTTP attempt',async t=>{
  const f=await fixture(t);const p=structuredClone(f.profile);p.routes[0].maxRequestBytes=original.length;
  const out=await open(p);assert.equal(out.errorPresent,false);const owner=out.owner;f.owned.push(owner);
  for(const [id,body] of [['effect',original],['input',Buffer.alloc(original.length+1)]]){failed(await owner.exchange(id,body));assert.equal(owner.firstCause(),null);}
  const response=await owner.exchange('input',original);assert.equal(response.errorPresent,false);assert.deepEqual(response.response.copyDATA().body,original);await finish(owner,response.response);
  assert.equal(f.events.filter(v=>v.event==='request').length,1);
  const other=structuredClone(f.profile);other.routes[2].maxResponseBytes=original.length-1;
  const opened=await open(other);assert.equal(opened.errorPresent,false);f.owned.push(opened.owner);
  const bounded=await opened.owner.exchange('query',original);failed(bounded);assert.ok(bounded.response);assert.ok(bounded.response.copyDATA().body.length<=original.length-1);
  await finish(opened.owner,bounded.response);assert.equal(f.events.filter(v=>v.event==='request').length,2);
},{timeout:15000});

test('actual 1MiB transport bound is separate from unexecuted P08 raw-input business schema',async t=>{
  const f=await fixture(t);const owner=await acquire(f);const bytes=Buffer.alloc(1<<20,0x20);bytes[0]=0x7b;bytes[bytes.length-1]=0x7d;
  const out=await owner.exchange('input',bytes);assert.equal(out.errorPresent,false);assert.deepEqual(out.response.copyDATA().body,bytes);await finish(owner,out.response);
  const next=await acquire(f);failed(await next.exchange('input',Buffer.alloc((1<<20)+1)));assert.equal(f.events.filter(v=>v.event==='request').length,1);await finish(next);
},{timeout:15000});

test('owned whole-response debt blocks join and cancellation probe does not replace first cause',async t=>{
  const f=await fixture(t);const owner=await acquire(f);const out=await owner.exchange('execute',original);assert.equal(out.errorPresent,false);
  for(const reason of [0,null,false,'']){const signal=AbortSignal.abort(reason);await assert.rejects(owner.join({signal}),error=>Object.is(error,reason));assert.equal(owner.firstCause(),null);}
  assert.deepEqual(out.response.copyDATA().body,original);await out.response.release();await out.response.release();
  const closed=await owner.close();assert.equal(closed.physicalDone,true);assert.equal(closed.errorPresent,false);assert.equal((await owner.close()).physicalDone,true);
},{timeout:15000});

test('late partial response retains actual prefix/status and UNKNOWN original attempt without replay',async t=>{
  const f=await fixture(t,'partial');const owner=await acquire(f);const out=await owner.exchange('execute',original);const first=failed(out);assert.ok(out.response,'partial HTTP bytes require adopted response debt');
  const data=out.response.copyDATA();assert.equal(data.statusCode,200);assert.equal(data.bodyComplete,false);assert.deepEqual(data.body,Buffer.from('{"PUBLIC":'));assert.equal(data.dispatchPossible,true);
  assert.ok(data.requestBytesWritten>0);assert.equal(data.bytesReceived,data.body.length);assert.equal(Object.hasOwn(first??{},'partial'),false);
  const rejected=await owner.exchange('query',original);failed(rejected);assert.equal(owner.firstCause(),first);
  const closed=await finish(owner,out.response);assert.equal(closed.errorPresent,true);assert.equal(closed.error,first);
  assert.equal(f.events.filter(v=>v.event==='request').length,1);assert.equal(f.events.filter(v=>v.event==='connection').length,1);
},{timeout:15000});

test('EOF and timeout remain dispatch-possible with no reconnect or query fallback',async t=>{
  for(const mode of ['drop','hold']){const f=await fixture(t,mode),owner=await acquire(f,{requestTimeoutMs:70});
    const out=await owner.exchange('execute',original);failed(out);assert.ok(out.response);const data=out.response.copyDATA();assert.equal(data.dispatchPossible,true);assert.equal(data.bodyComplete,false);
    failed(await owner.exchange('query',original));await finish(owner,out.response);assert.equal(f.events.filter(v=>v.event==='request').length,1);assert.equal(f.events.filter(v=>v.event==='connection').length,1);
  }
},{timeout:15000});

test('retire/cancel while original Go handler is held joins actual socket and preserves uncertain raw cause',async t=>{
  const f=await fixture(t,'normal-hold');const owner=await acquire(f);const controller=new AbortController();const work=owner.exchange('execute',original,{signal:controller.signal});
  const request=await f.event(v=>v.event==='request');assert.equal(request.originalCurrent,true);
  controller.abort(0);const out=await work;const first=failed(out);assert.ok(out.response);assert.equal(out.response.copyDATA().dispatchPossible,true);
  assert.ok(Object.is(first,0)||Object.is(first?.cause,0),'original falsy cancellation must remain present');
  f.command('respond');const closed=await finish(owner,out.response);assert.equal(closed.errorPresent,true);assert.equal(closed.error,first);
  failed(await owner.exchange('query',original));assert.equal(f.events.filter(v=>v.event==='request').length,1);
},{timeout:15000});

test('response MIME/length faults are refused and redirect remains original DATA without following',async t=>{
  for(const mode of ['bad-mime','oversize','redirect']){const f=await fixture(t,mode);const owner=await acquire(f);const out=await owner.exchange('query',original);assert.ok(out.response);
    if(mode==='redirect'){assert.equal(out.errorPresent,false);assert.equal(out.response.copyDATA().statusCode,307);assert.deepEqual(out.response.copyDATA().body,Buffer.from('{}'));}
    else failed(out);
    await finish(owner,out.response);assert.equal(f.events.filter(v=>v.event==='connection').length,1);assert.equal(f.events.filter(v=>v.event==='request').length,1);
  }
},{timeout:15000});
