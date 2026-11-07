// PUBLIC physical transport controls, not Source/Root/Principal qualification.
// The only W/A DATA codec is the byte-for-byte frozen sole-SDK test mirror.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {openSocialDirectoryInboundTransportForOriginalBootstrap as open} from './social-directory-transport.mjs';
import {acquireInboundCaller,currentInboundCaller,releaseInboundCaller,
  waitInboundSocialDirectoryReadRelease,writeInboundSocialDirectoryClosedAck,
  joinInboundAuthorityServer,openInboundAuthorityServer,openInboundDesktopTaskGrantServer,
  openInboundTaskRuntimeServer,openInboundSocialDirectoryServer,
  closeInboundAuthorityServer,closeInboundTaskRuntimeServer} from './inbound-caller.mjs';
import {bindSocialDirectoryOriginalBytesDATA,encodeSocialDirectoryClosedAckDATA,
  decodeSocialDirectoryReadReleaseDATA,decodeSocialDirectoryClosedAckDATA} from './testdata/social-directory-lc-r2/codec.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const routes=['/v4/devices/directory','/m1qa/v4/devices/directory'];
const operations=['currentExistingSocialDeviceDirectoryPrincipalV4','recheckExistingSocialDeviceDirectoryPrincipalV4'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
let evidence,executable;
async function pin(p){const b=await fs.readFile(p);return{path:p,bytes:b.length,sha256:digest(b)};}
async function json(name,value){await fs.writeFile(path.join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
before(async()=>{
  const root=process.env.YNX_LINK_SOCIAL_DIRECTORY_TEST_ARTIFACTS;
  assert.ok(root&&path.isAbsolute(root),'explicit owned external Social evidence root required');
  assert.ok(process.env.GOCACHE&&process.env.GOTMPDIR,'explicit owned external Go cache/tmp required');
  await fs.mkdir(root,{recursive:true,mode:0o700});evidence=await fs.mkdtemp(path.join(root,'sd-'));await fs.chmod(evidence,0o700);
  for(const p of [process.env.GOCACHE,process.env.GOTMPDIR]){assert.ok(path.isAbsolute(p));await fs.mkdir(p,{recursive:true,mode:0o700});}
  const inputs=['social-directory-transport.test.mjs','social-directory-public-peer.go.txt','social-directory-transport.mjs','social-directory-transport-private.mjs','social-directory-transport-native.inc.c','inbound-caller.mjs','native.c','build/caller.node','testdata/social-directory-lc-r2/codec.mjs','testdata/social-directory-lc-r2/IDL.json','testdata/social-directory-lc-r2/ORIGINAL.json'];
  inputs.push(...['social_directory_transport.go','social_directory_transport_unix.go','social_directory_transport_unsupported.go','social_directory_transport_frames.go'].map(n=>'../../internal/securelink/'+n));
  const pins=await Promise.all(inputs.map(n=>pin(path.join(here,n))));
  const mirror=JSON.parse(await fs.readFile(path.join(here,'testdata/social-directory-lc-r2/ORIGINAL.json'),'utf8'));
  for(const ref of mirror.refs){const actual=await pin(path.join(here,'testdata/social-directory-lc-r2',ref.mirror));assert.equal(actual.bytes,ref.bytes);assert.equal(actual.sha256,ref.sha256);}
  await json('SOURCE-BEFORE.json',pins);
  const source=path.join(evidence,'PUBLIC-peer.go');executable=path.join(evidence,'PUBLIC-peer');await fs.copyFile(path.join(here,'social-directory-public-peer.go.txt'),source);
  const args=['build','-mod=readonly','-p','1','-o',executable,source];const r=spawnSync('go',args,{cwd:evidence,encoding:'utf8',timeout:90000,maxBuffer:4<<20,env:{...process.env,GOTOOLCHAIN:'local',GOWORK:'off',GOMAXPROCS:'2',GOMEMLIMIT:'1536MiB',TMPDIR:process.env.GOTMPDIR}});
  await fs.writeFile(path.join(evidence,'go-build.stdout'),r.stdout??'',{flag:'wx'});await fs.writeFile(path.join(evidence,'go-build.stderr'),r.stderr??'',{flag:'wx'});await json('go-build-command.json',{exe:'go',args,status:r.status,signal:r.signal,error:r.error?{message:r.error.message,code:r.error.code}:null,GoArchive:false,PUBLIC:true});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);await json('FIXTURE.json',{source:await pin(source),binary:await pin(executable),PUBLIC:true,actualUnixSCM:true,SDKDataCodecOnly:true,Qualified9Executed:false,nonceLedgerExecuted:false,actualAuthResponseLoanExecuted:false,actualTLS:false,RootAdmission:false,SourceAdmission:false});
  console.log('# Social transport evidence '+evidence);
},{timeout:95000});
after(async()=>{if(!evidence)return;const before=JSON.parse(await fs.readFile(path.join(evidence,'SOURCE-BEFORE.json'),'utf8')),after=await Promise.all(before.map(x=>pin(x.path)));await json('SOURCE-AFTER.json',after);assert.deepEqual(after,before,'Social source/native/sole-SDK tuple changed during controls');});

// The expected17 and Source/window bytes are unverified PUBLIC originals. This
// fixture proves exact copying only; Auth remains the sole semantic validator.
const expected17=Object.freeze({networkId:'a'.repeat(64),canonicalOwner:'PUBLIC-owner',account:'PUBLIC-account',sessionBinding:'PUBLIC-session',productId:'social',clientId:'PUBLIC-client',platform:'macos',applicationId:'PUBLIC-app',bundleId:'PUBLIC-bundle',packageId:'PUBLIC-package',origin:'https://public.invalid',callback:'PUBLIC-callback',deviceId:'PUBLIC-device',generation:'1',registrationId:'PUBLIC-registration',revision:'1',registrationDigest:'b'.repeat(64)});
function originals(route,proof){
  return{request:Buffer.from(JSON.stringify({requestId:'PUBLIC-original-request',method:'GET',path:route,body:'',proofHeader:proof,expected:expected17})),source:Buffer.from(' { "PUBLIC":"source binding \\u03bb", "expected":'+JSON.stringify(expected17)+' }\n'),window:Buffer.from('{ "PUBLIC":"window bytes \\u03bb", "expiresMS":"1" }\n'),response:Buffer.from(' {"PUBLIC":"original response \\u03bb"}\n')};
}
async function fixture(t,handler,{route=routes[0],operation=operations[0],method='GET',proof='PUBLIC-proof-original',mode='normal',start=true,currentTimeoutMs=500,requestBody=Buffer.alloc(0),padding=''}={}){
  const socketDirectory=await fs.mkdtemp('/tmp/sd-');await fs.chmod(socketDirectory,0o700);const socketPath=path.join(socketDirectory,'s'),id=path.basename(socketDirectory),raw=originals(route,proof);
  const config={Socket:socketPath,Method:method,Path:route,Operation:operation,Proof:proof,Mode:mode,Padding:padding,RequestOriginal:raw.request.toString('base64'),SourceBindingOriginal:raw.source.toString('base64'),SourceWindowOriginal:raw.window.toString('base64'),RequestBody:requestBody.toString('base64')};
  const configPath=path.join(evidence,id+'.json');await fs.writeFile(configPath,JSON.stringify(config)+'\n',{flag:'wx',mode:0o600});
  const child=spawn(executable,[configPath],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',tail='';const done=deferred(),exit=deferred(),handled=deferred(),events=[],waiting=[];const cleanups=[];let owner;
  function event(v){events.push(v);for(const w of [...waiting])if(w.name===v.event){waiting.splice(waiting.indexOf(w),1);w.resolve(v);}if(v.event==='result')done.resolve(v);}
  child.stdout.on('data',b=>{stdout+=b;tail+=b;let n;while((n=tail.indexOf('\n'))>=0){const line=tail.slice(0,n);tail=tail.slice(n+1);try{event(JSON.parse(line));}catch(e){done.reject(e);}}});child.stderr.on('data',b=>{stderr+=b;});child.stdin.on('error',e=>{stderr+='stdin: '+e.message+'\n';});child.on('error',e=>{done.reject(e);exit.reject(e);});child.on('exit',(code,signal)=>{exit.resolve({code,signal});if(!events.some(v=>v.event==='result'))done.reject(Error('PUBLIC peer ended before result '+code+' '+stderr));});
  const f={child,raw,socketPath,operation,done:done.promise,handled:handled.promise,cleanups,events,
    wait(name){const old=events.find(e=>e.event===name);return old?Promise.resolve(old):new Promise(resolve=>waiting.push({name,resolve}));},
    command(s){if(child.exitCode===null&&!child.stdin.destroyed)child.stdin.write(s+'\n');},
    async acquire(req){const out=await owner.acquireOriginalInbound(req);if(out.caller)cleanups.push(()=>owner.releaseOriginalInbound(out.caller));return out;},
    rawCaller(req){const h=acquireInboundCaller(req,f.server);cleanups.push(()=>releaseInboundCaller(h));return h;},
  };
  t.after(async()=>{f.command('finish');for(const fn of cleanups.reverse())try{await fn();}catch{}if(owner){const a=new AbortController(),timer=setTimeout(()=>a.abort(Error('owned Social cleanup deadline')),1500);try{await owner.close({signal:a.signal});}catch{}finally{clearTimeout(timer);}}if(child.exitCode===null)child.kill();await exit.promise.catch(()=>{});await fs.writeFile(path.join(evidence,id+'.stdout'),stdout,{flag:'wx'});await fs.writeFile(path.join(evidence,id+'.stderr'),stderr,{flag:'wx'});await fs.rm(socketDirectory,{recursive:true,force:true});});
  const profile={socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:child.pid,service:'social-directory-test',acceptTimeoutMs:500,currentTimeoutMs,maxConnections:2,routes:routes.map(path=>({method:'GET',path,maxRequestBytes:0,maxResponseBytes:524288}))};
  const opened=await open(profile,(req,res)=>{try{const work=handler(req,res,f);if(work&&typeof work.then==='function')return work.then(v=>{handled.resolve();return v;},e=>{handled.reject(e);throw e;});return work;}catch(e){handled.reject(e);throw e;}});
  owner=opened.owner;assert.ok(owner);assert.equal(opened.errorPresent,false,opened.error?.stack);f.owner=owner;f.profile=profile;f.server=owner.registeredServer();if(start)f.command('go');return f;
}
function binding(f){return bindSocialDirectoryOriginalBytesDATA(f.raw.request,f.raw.response,digest(f.raw.request));}
async function reply(res,f){const finished=once(res,'finish');res.setHeader('content-type','application/json');res.end(f.raw.response);await finished;}
async function acknowledged(req,res,f,{ack={closed:true,errorPresent:false,errorKind:'none',errorCode:0},assertData=true}={}){
  const out=await f.acquire(req);assert.equal(out.errorPresent,false);
  if(assertData){const data=await f.owner.currentOriginalInbound(out.caller);assert.equal(data.transportKind,'localOSpeer');assert.equal(data.Operation,f.operation);assert.equal(Object.hasOwn(data,'Channel'),false);assert.equal(data.sourceVerified,false);assert.equal(data.principalVerified,false);assert.deepEqual(data.RequestOriginal,f.raw.request);assert.deepEqual(data.SourceBindingOriginal,f.raw.source);assert.deepEqual(data.SourceWindowOriginal,f.raw.window);assert.equal(Object.keys(JSON.parse(data.RequestOriginal).expected).length,17);assert.equal(req.headers['x-ynx-product-session-proof-v4'],JSON.parse(f.raw.request).proofHeader);for(let n=0;n<32;n++)assert.equal(f.owner.assertOriginalInboundAtCommit(out.caller),undefined);data.RequestOriginal.fill(0);data.SourceBindingOriginal.fill(0);data.SourceWindowOriginal.fill(0);const fresh=await f.owner.currentOriginalInbound(out.caller);assert.deepEqual(fresh.RequestOriginal,f.raw.request);assert.deepEqual(fresh.SourceBindingOriginal,f.raw.source);assert.deepEqual(fresh.SourceWindowOriginal,f.raw.window);}
  await reply(res,f);assert.equal(req.socket.destroyed,false,'HTTP finish must not physically close same W/A data FD');
  const w=await f.owner.waitOriginalReadRelease(out.caller);assert.equal(w.length,74);decodeSocialDirectoryReadReleaseDATA(w,binding(f));
  const a=encodeSocialDirectoryClosedAckDATA(binding(f),ack);assert.equal(a.length,81);await f.owner.writeOriginalClosedAck(out.caller,a);await f.owner.releaseOriginalInbound(out.caller);
}

test('Social GET2 real original caller preserves Proof expected17 Source/window bytes and ACK drains the same FD',{timeout:15000},async t=>{
  for(const route of routes)for(const operation of operations){const f=await fixture(t,acknowledged,{route,operation});const result=await f.done;await f.handled;assert.equal(result.ackValid,true);assert.equal(result.complete,true);assert.equal(result.physicalClosed,true);assert.equal(result.dialCount,1);assert.equal(result.unknown,false);const a=decodeSocialDirectoryClosedAckDATA(Buffer.from(result.ack,'base64'),binding(f));assert.equal(a.closed,true);await f.owner.close();assert.equal(f.owner.lifetime().closed,true);assert.equal(f.owner.lifetime().transportKind,'localOSpeer');assert.equal(f.owner.lifetime().sourceVerified,false);}
});

test('Social exactly 196608 encoded proof bytes traverse real HTTP and original C material',{timeout:15000},async t=>{
  const f=await fixture(t,acknowledged,{proof:'P'.repeat(196608)});const result=await f.done;await f.handled;assert.equal(result.complete,true);assert.equal(result.dialCount,1);
});

test('Social invalid proof bound GET body route and method never enter handler or query Current',{timeout:15000},async t=>{
  for(const selected of [{proof:'P'.repeat(196609)},{proof:'P'.repeat(196608),padding:'H'.repeat(70000)},{method:'POST'},{route:routes[0]+'?grant=true'},{route:'/v4/devices/directory-other'},{requestBody:Buffer.from('x')}]){
    let called=false;const f=await fixture(t,()=>{called=true;assert.fail('invalid Social request reached original handler');},selected);const result=await f.done;assert.ok(result.error);assert.equal(called,false);assert.equal(result.queries??0,0);assert.equal(result.dialCount,1);
  }
});

test('Social W and A require the same original caller and actual registered server',{timeout:15000},async t=>{
  const other=await fixture(t,()=>assert.fail('other receiver must stay unused'),{start:false});
  const f=await fixture(t,async(req,res,f)=>{
    const out=await f.acquire(req);assert.equal(out.errorPresent,false);const h=f.rawCaller(req);assert.throws(()=>acquireInboundCaller(req,other.server));assert.throws(()=>f.owner.registeredServer({}));
    for(const fake of [{},{...h},out.caller]){await assert.rejects(waitInboundSocialDirectoryReadRelease(req,fake,f.server));await assert.rejects(writeInboundSocialDirectoryClosedAck(req,fake,f.server,Buffer.alloc(81)));}
    await assert.rejects(waitInboundSocialDirectoryReadRelease(req,h,other.server));await assert.rejects(waitInboundSocialDirectoryReadRelease({...req},h,f.server));
    const a=encodeSocialDirectoryClosedAckDATA(binding(f),{closed:true,errorPresent:false,errorKind:'none',errorCode:0});await assert.rejects(writeInboundSocialDirectoryClosedAck(req,h,f.server,a),'A before original W must be refused');
    await f.owner.releaseOriginalInbound(out.caller);await reply(res,f);const w=await waitInboundSocialDirectoryReadRelease(req,h,f.server);decodeSocialDirectoryReadReleaseDATA(w,binding(f));await assert.rejects(writeInboundSocialDirectoryClosedAck(req,h,f.server,a.subarray(0,80)),'old A80 must be refused');await writeInboundSocialDirectoryClosedAck(req,h,f.server,a);await assert.rejects(writeInboundSocialDirectoryClosedAck(req,h,f.server,a),'ACK may be written once');releaseInboundCaller(h);
  });assert.equal((await f.done).complete,true);await f.handled;
});

test('Social partial foreign malformed W and early EOF remain UNKNOWN without another request',{timeout:15000},async t=>{
  for(const mode of ['partial-W','foreign-W','bad-W-length','early-EOF']){
    const observed=deferred();const f=await fixture(t,async(req,res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);await reply(res,f);let failure;try{const w=await f.owner.waitOriginalReadRelease(out.caller);decodeSocialDirectoryReadReleaseDATA(w,binding(f));}catch(e){failure=e;}assert.ok(failure);if(mode==='partial-W'){assert.equal(failure.bytesReceived,37);assert.ok(Buffer.isBuffer(failure.frameData));assert.equal(failure.frameData.length,37);assert.equal(Object.hasOwn(failure,'partial'),false);}if(mode==='foreign-W'){const a=encodeSocialDirectoryClosedAckDATA(binding(f),{closed:true,errorPresent:false,errorKind:'none',errorCode:0});await assert.rejects(f.owner.writeOriginalClosedAck(out.caller,a));}f.command('finish');await assert.rejects(f.owner.releaseOriginalInbound(out.caller));assert.equal(f.owner.lifetime().cleanupUnknown,true);assert.equal(f.owner.lifetime().callerHolds,1);observed.resolve();},{mode});await Promise.race([observed.promise,f.handled]);await f.handled;const result=await f.done;assert.equal(result.unknown,true);assert.equal(result.complete??false,false);assert.equal(result.dialCount,1);const first=f.owner.firstCause();assert.throws(()=>f.owner.retire(),e=>e===first);await assert.rejects(f.owner.close(),e=>e===first);assert.equal(f.owner.lifetime().closed,false);
  }
});

test('Social ACK coded zero and retained uncoded cause preserve physical closure independently from success',{timeout:15000},async t=>{
  for(const ack of [{closed:true,errorPresent:true,errorKind:'code',errorCode:0},{closed:true,errorPresent:true,errorKind:'retained',errorCode:0}]){
    const f=await fixture(t,(req,res,f)=>acknowledged(req,res,f,{ack}));const result=await f.done;await f.handled;assert.equal(result.ackValid,true);assert.equal(result.physicalClosed,true);assert.equal(result.unknown,true);assert.equal(result.complete,false);assert.equal(result.dialCount,1);const got=decodeSocialDirectoryClosedAckDATA(Buffer.from(result.ack,'base64'),binding(f));assert.equal(got.errorPresent,true);assert.equal(got.errorKind,ack.errorKind);assert.equal(got.errorCode,0);
  }
});

test('Social logical release and callback return undefined leave the original response FD alive until W A and Main close',{timeout:15000},async t=>{
  const completed=deferred();
  const f=await fixture(t,(req,res,f)=>{
    void(async()=>{try{const out=await f.acquire(req);assert.equal(out.errorPresent,false);const h=f.rawCaller(req);await f.owner.releaseOriginalInbound(out.caller);assert.equal(f.owner.lifetime().callerHolds,0);assert.equal(req.socket.destroyed,false);await reply(res,f);assert.equal(req.socket.destroyed,false);const w=await waitInboundSocialDirectoryReadRelease(req,h,f.server);decodeSocialDirectoryReadReleaseDATA(w,binding(f));const a=encodeSocialDirectoryClosedAckDATA(binding(f),{closed:true,errorPresent:false,errorKind:'none',errorCode:0});await writeInboundSocialDirectoryClosedAck(req,h,f.server,a);releaseInboundCaller(h);completed.resolve();}catch(e){completed.reject(e);res.destroy();}})();return undefined;
  });await completed.promise;const result=await f.done;assert.equal(result.complete,true);assert.equal(result.physicalClosed,true);await f.owner.close();assert.equal(f.owner.lifetime().closed,true);
});

test('Social missing W times out UNKNOWN with the same response debt and no reissue',{timeout:15000},async t=>{
  const observed=deferred();const f=await fixture(t,async(req,res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);await reply(res,f);await assert.rejects(f.owner.waitOriginalReadRelease(out.caller));assert.equal(f.owner.lifetime().cleanupUnknown,true);assert.equal(f.owner.lifetime().callerHolds,1);await assert.rejects(f.owner.releaseOriginalInbound(out.caller));f.command('finish');observed.resolve();},{mode:'wait-before-W',currentTimeoutMs:80});await Promise.race([observed.promise,f.handled]);await f.handled;const result=await f.done;assert.equal(result.unknown,true);assert.equal(result.wSent,false);assert.equal(result.dialCount,1);
});

test('Social actual peer close before A cannot turn the sent W into a completed delivery',{timeout:15000},async t=>{
  const observed=deferred();const f=await fixture(t,async(req,res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);await reply(res,f);const w=await f.owner.waitOriginalReadRelease(out.caller);decodeSocialDirectoryReadReleaseDATA(w,binding(f));f.command('close-peer');await f.wait('peer-closed');const a=encodeSocialDirectoryClosedAckDATA(binding(f),{closed:true,errorPresent:false,errorKind:'none',errorCode:0});await assert.rejects(f.owner.writeOriginalClosedAck(out.caller,a));assert.equal(f.owner.lifetime().cleanupUnknown,true);assert.equal(f.owner.lifetime().callerHolds,1);observed.resolve();},{mode:'close-before-A'});await Promise.race([observed.promise,f.handled]);await f.handled;const result=await f.done;assert.equal(result.unknown,true);assert.equal(result.wSent,true);assert.equal(result.ackValid??false,false);assert.equal(result.dialCount,1);
});

test('Social Main receives an actual partial original body but emits no W or replay',{timeout:15000},async t=>{
  const prefix=Buffer.from('PUBLIC-original-prefix'),observed=deferred();const f=await fixture(t,async(req,res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);res.writeHead(200,{'content-type':'application/json','content-length':prefix.length+10});await new Promise((resolve,reject)=>res.write(prefix,e=>e?reject(e):resolve()));await f.wait('body-progress');res.destroy();await assert.rejects(f.owner.waitOriginalReadRelease(out.caller));assert.equal(f.owner.lifetime().cleanupUnknown,true);observed.resolve();});await Promise.race([observed.promise,f.handled]);await f.handled;const result=await f.done;const read=f.events.find(e=>e.event==='read');assert.deepEqual(Buffer.from(read.body,'base64'),prefix);assert.equal(read.complete,false);assert.equal(result.wSent,false);assert.equal(result.unknown,true);assert.equal(result.dialCount,1);
});

test('Social retirement stops new Current but retains same original cleanup W A and caller debt',{timeout:15000},async t=>{
  const ready=deferred(),continueCleanup=deferred(),finished=deferred();let caller;
  const f=await fixture(t,async(req,res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);caller=out.caller;await reply(res,f);ready.resolve();await continueCleanup.promise;const w=await f.owner.waitOriginalReadRelease(caller);decodeSocialDirectoryReadReleaseDATA(w,binding(f));const a=encodeSocialDirectoryClosedAckDATA(binding(f),{closed:true,errorPresent:true,errorKind:'retained',errorCode:0});await f.owner.writeOriginalClosedAck(caller,a);await f.owner.releaseOriginalInbound(caller);finished.resolve();},{mode:'wait-before-W'});
  f.cleanups.push(()=>continueCleanup.resolve());await ready.promise;await f.wait('read');f.owner.retire();assert.throws(()=>f.owner.registeredServer());await assert.rejects(f.owner.currentOriginalInbound(caller));const abort=new AbortController();const probe=f.owner.join({signal:abort.signal});abort.abort(0);const reason=await probe.then(()=>({rejected:false}),actual=>({rejected:true,actual}));assert.equal(reason.rejected,true);assert.equal(reason.actual,0);assert.equal(f.owner.lifetime().callerHolds,1);assert.equal(f.owner.lifetime().joined,false);continueCleanup.resolve();f.command('send-W');await finished.promise;await f.handled;const result=await f.done;assert.equal(result.ackValid,true);assert.equal(result.unknown,true);assert.equal(result.complete,false);assert.equal(result.physicalClosed,true);await f.owner.join();await f.owner.close();assert.equal(f.owner.lifetime().closed,true);
});

test('Social raw uncoded zero handler failure remains present after actual descriptor cleanup',{timeout:15000},async t=>{
  let caller;const entered=deferred();const f=await fixture(t,async(req,_res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);caller=out.caller;entered.resolve();throw 0;});await entered.promise;assert.ok((await f.done).error);await f.owner.releaseOriginalInbound(caller);f.owner.retire();const raw=await f.owner.join().then(()=>({rejected:false}),actual=>({rejected:true,actual}));assert.equal(raw.rejected,true);assert.equal(raw.actual,0);assert.equal(f.owner.firstCause(),0);assert.equal(f.owner.lifetime().firstCausePresent,true);const closed=await f.owner.close().then(()=>({rejected:false}),actual=>({rejected:true,actual}));assert.equal(closed.rejected,true);assert.equal(closed.actual,0);assert.equal(f.owner.lifetime().closed,true);assert.equal(f.owner.lifetime().cleanupUnknown,false);
});

test('Social GET2 registration cannot borrow TaskGrant or AI purpose and cannot expand its own routes or budgets',{timeout:15000},async t=>{
  const f=await fixture(t,()=>assert.fail('registration-only peer must not dispatch'),{start:false});let count=0;
  async function refused(factory,selected,close=closeInboundAuthorityServer){let accepted;try{await assert.rejects(factory({...f.profile,socketPath:path.join(path.dirname(f.socketPath),'r-'+(++count)),routes:selected},()=>{}).then(v=>{accepted=v;return v;}));}finally{if(accepted)await close(accepted);}}
  for(const factory of [openInboundAuthorityServer,openInboundDesktopTaskGrantServer])await refused(factory,f.profile.routes);
  await refused(openInboundTaskRuntimeServer,f.profile.routes,closeInboundTaskRuntimeServer);
  for(const selected of [f.profile.routes.slice(1),[f.profile.routes[0],f.profile.routes[0]],f.profile.routes.map((r,n)=>n?r:{...r,method:'POST'}),f.profile.routes.map((r,n)=>n?r:{...r,path:r.path+'?grant=true'}),f.profile.routes.map((r,n)=>n?r:{...r,maxRequestBytes:1}),f.profile.routes.map((r,n)=>n?r:{...r,maxResponseBytes:524289})])await refused(openInboundSocialDirectoryServer,selected);
});

test('Social late original transport Current denial preserves its caller cause and never manufactures W or A',{timeout:15000},async t=>{
  const observed=deferred();const f=await fixture(t,async(req,_res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,false);let failure;try{await f.owner.currentOriginalInbound(out.caller);assert.fail('fresh second C must be refused');}catch(e){failure=e;}assert.equal(f.owner.firstCallerCause(out.caller),failure);await assert.rejects(f.owner.currentOriginalInbound(out.caller));assert.equal(f.owner.firstCallerCause(out.caller),failure);await f.owner.releaseOriginalInbound(out.caller);observed.resolve();},{mode:'deny-second'});await Promise.race([observed.promise,f.handled]);await f.handled;const result=await f.done;assert.equal(result.queries,2);assert.equal(result.wSent,false);assert.equal(result.unknown,true);assert.equal(result.dialCount,1);
});

test('Social operation is an explicit closed Host word rather than a path-derived permission',{timeout:15000},async t=>{
  const observed=deferred();const f=await fixture(t,async(req,_res,f)=>{const out=await f.acquire(req);assert.equal(out.errorPresent,true);assert.ok(out.caller);assert.ok(out.error);assert.equal(f.owner.firstCallerCause(out.caller),out.error);await f.owner.releaseOriginalInbound(out.caller);observed.resolve();},{operation:'PUBLIC-unknown-operation'});await Promise.race([observed.promise,f.handled]);await f.handled;const result=await f.done;assert.equal(result.queries,1);assert.equal(result.wSent,false);assert.equal(result.unknown,true);assert.equal(result.dialCount,1);
});
