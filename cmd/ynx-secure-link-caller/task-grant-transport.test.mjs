// Real AF_UNIX/SCM_RIGHTS lifecycle controls. The Go peer's channel is PUBLIC
// transport DATA: no TLS, Source4, SQL authority, Root, Grant or effect approval.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openTaskGrantInboundTransportForOriginalBootstrap as open} from './task-grant-transport.mjs';
import {acquireInboundCaller, currentInboundCaller, releaseInboundCaller, joinInboundAuthorityServer, closeInboundAuthorityServer,
  openInboundAuthorityServer, openInboundDesktopTaskGrantServer} from './inbound-caller.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const originalBody=Buffer.from('{ "PUBLIC":"original TaskGrant transport bytes", "n":1 }\n');
const closedRoutes=Object.freeze(['issue','effect','query','effect-query','effect-reconcile','revoke','management'].map(name=>'/internal/auth/task-grants/'+name));
const registeredRoutes=()=>closedRoutes.map(route=>({method:'POST',path:route,maxRequestBytes:1024,maxResponseBytes:1024}));
const goSource=String.raw`package main
import("bufio";"bytes";"encoding/base64";"encoding/binary";"encoding/json";"io";"net";"net/http";"os";"strings";"sync";"sync/atomic";"syscall";"time")
var output sync.Mutex
func event(v any){output.Lock();defer output.Unlock();json.NewEncoder(os.Stdout).Encode(v)}
func main(){
 commands:=make(chan string,8);go func(){s:=bufio.NewScanner(os.Stdin);for s.Scan(){commands<-s.Text()};close(commands)}();if <-commands!="go"{return}
 conn,e:=net.DialUnix("unix",nil,&net.UnixAddr{Name:os.Args[1],Net:"unix"});if e!=nil{event(map[string]any{"event":"result","error":e.Error()});return};defer conn.Close();conn.SetDeadline(time.Now().Add(8*time.Second))
 pair,e:=syscall.Socketpair(syscall.AF_UNIX,syscall.SOCK_STREAM,0);if e!=nil{event(map[string]any{"event":"result","error":e.Error()});return}
 left,right:=os.NewFile(uintptr(pair[0]),"PUBLIC-control"),os.NewFile(uintptr(pair[1]),"PUBLIC-passed");control,e:=net.FileConn(left);left.Close();if e!=nil{right.Close();event(map[string]any{"event":"result","error":e.Error()});return};defer control.Close()
 _,_,e=conn.WriteMsgUnix([]byte{'L'},syscall.UnixRights(int(right.Fd())),nil);right.Close();if e!=nil{event(map[string]any{"event":"result","error":e.Error()});return}
 body:=[]byte("{ \"PUBLIC\":\"original TaskGrant transport bytes\", \"n\":1 }\n");route,method:=os.Args[3],os.Args[4];var queries atomic.Int32
 go func(){for n:=1;n<=64;n++{var c [1]byte;if _,e:=io.ReadFull(control,c[:]);e!=nil||c[0]!='C'{return};queries.Add(1);event(map[string]any{"event":"query","n":n})
  if os.Args[2]=="hold-first"&&n==1{if <-commands!="reply"{return}}
  if os.Args[2]=="deny-first"||(os.Args[2]=="deny-second"&&n==2){control.Write([]byte{0,0,0,0});return}
  peer:=map[string]any{"ServiceID":"PUBLIC-peer","SubjectAltName":"peer.ynx.test","CertDigest":strings.Repeat("a",64),"RootDigest":strings.Repeat("b",64),"Edge":"PUBLIC-edge","Epoch":1,"Expires":"2099-01-01T00:00:00Z"}
  metadata,_:=json.Marshal(map[string]any{"Service":"task-grant-test","Method":method,"Path":route,"Host":"auth.ynx.test","ContentType":"application/json","ContentLength":len(body),"Channel":map[string]any{"Peer":peer,"Exporter":base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7},32)),"LocalSAN":"auth.ynx.test"}})
  payload:=make([]byte,4+len(metadata)+len(body));binary.BigEndian.PutUint32(payload,uint32(len(metadata)));copy(payload[4:],metadata);copy(payload[4+len(metadata):],body);length:=make([]byte,4);binary.BigEndian.PutUint32(length,uint32(len(payload)));if _,e:=control.Write(length);e!=nil{return};if _,e:=control.Write(payload);e!=nil{return}
 }}()
 req,_:=http.NewRequest(method,"http://task-grant-test"+route,bytes.NewReader(body));req.Header.Set("Content-Type","application/json");req.Close=true
 if e=req.Write(conn);e!=nil{event(map[string]any{"event":"result","error":e.Error(),"queries":queries.Load()});return};response,e:=http.ReadResponse(bufio.NewReader(conn),req);if e!=nil{event(map[string]any{"event":"result","error":e.Error(),"queries":queries.Load()});return};raw,e:=io.ReadAll(response.Body);response.Body.Close();result:=map[string]any{"event":"result","status":response.StatusCode,"body":base64.StdEncoding.EncodeToString(raw),"queries":queries.Load()};if e!=nil{result["error"]=e.Error()};event(result)
}
`;
let evidence, executable;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
async function pin(p){const b=await fs.readFile(p);return {path:p,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};}
async function json(name,v){await fs.writeFile(path.join(evidence,name),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});}
before(async()=>{
  const root=process.env.YNX_LINK_TASK_GRANT_TEST_ARTIFACTS;
  assert.ok(root&&path.isAbsolute(root),'YNX_LINK_TASK_GRANT_TEST_ARTIFACTS must name an owned external output root');
  await fs.mkdir(root,{recursive:true,mode:0o700});
  evidence=await fs.mkdtemp(path.join(root,'tg-'));await fs.chmod(evidence,0o700);
  const cache=process.env.GOCACHE,tmp=process.env.GOTMPDIR;
  assert.ok(cache&&tmp&&path.isAbsolute(cache)&&path.isAbsolute(tmp),'GOCACHE/GOTMPDIR must name explicit owned scratch outside public evidence');
  for(const p of [cache,tmp]){assert.ok(!p.startsWith(evidence+'/'));await fs.mkdir(p,{recursive:true,mode:0o700});}
  const inputs=['task-grant-transport.test.mjs','task-grant-transport.mjs','task-grant-transport-private.mjs','inbound-caller.mjs','native.c','build/caller.node'];
  await json('SOURCE-BEFORE.json',await Promise.all(inputs.map(p=>pin(path.join(here,p)))));
  const source=path.join(evidence,'PUBLIC-peer.go');executable=path.join(evidence,'PUBLIC-peer');await fs.writeFile(source,goSource,{flag:'wx',mode:0o600});
  const args=['build','-mod=readonly','-p','1','-o',executable,source];
  const env={...process.env,GOMAXPROCS:'2',GOMEMLIMIT:'1536MiB',GOCACHE:cache,GOTMPDIR:tmp,TMPDIR:tmp,GOWORK:'off',GOTOOLCHAIN:'local'};
  const result=spawnSync('go',args,{cwd:evidence,encoding:'utf8',timeout:90000,env,maxBuffer:4*1024*1024});
  await fs.writeFile(path.join(evidence,'go-build.stdout'),result.stdout??'',{flag:'wx'});await fs.writeFile(path.join(evidence,'go-build.stderr'),result.stderr??'',{flag:'wx'});
  await json('go-build-command.json',{exe:'go',args,status:result.status,signal:result.signal,error:result.error?{message:result.error.message,code:result.error.code}:null,goArchive:false,fixtureOnly:true});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
  await json('FIXTURE.json',{source:await pin(source),binary:await pin(executable),PUBLIC:true,actualUnixSCM:true,actualTLS:false,RootAdmission:false,SourceAdmission:false});
  console.log('# TaskGrant evidence '+evidence);
},{timeout:95000});
after(async()=>{
  if(!evidence)return;
  const before=JSON.parse(await fs.readFile(path.join(evidence,'SOURCE-BEFORE.json'),'utf8'));
  const after=await Promise.all(before.map(r=>pin(r.path)));await json('SOURCE-AFTER.json',after);assert.deepEqual(after,before,'matching source/native tuple changed during controls');
});
async function read(req){const chunks=[];for await(const b of req)chunks.push(b);return Buffer.concat(chunks);}
async function fixture(t,handler,{mode='normal',start=true,route='/internal/auth/task-grants/effect',method='POST'}={}){
  // Only this bounded owned AF_UNIX endpoint uses /tmp, because Darwin's path
  // limit excludes the long external artifact/cache path. Source stays outside.
  const socketDirectory=await fs.mkdtemp('/tmp/tg-');await fs.chmod(socketDirectory,0o700);const socketPath=path.join(socketDirectory,'s');
  const child=spawn(executable,[socketPath,mode,route,method],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',remaining='';const result=deferred(),handled=deferred(),exited=deferred();const events=[],listeners=[];
  function notify(v){events.push(v);for(const w of [...listeners])if(w.match(v)){listeners.splice(listeners.indexOf(w),1);w.resolve(v);}if(v.event==='result')result.resolve(v);}
  child.stdout.on('data',b=>{stdout+=b;remaining+=b;let n;while((n=remaining.indexOf('\n'))>=0){const line=remaining.slice(0,n);remaining=remaining.slice(n+1);try{notify(JSON.parse(line));}catch(e){result.reject(e);}}});child.stderr.on('data',b=>{stderr+=b;});child.stdin.on('error',e=>{stderr+='stdin: '+e.message+'\n';});child.on('error',e=>{result.reject(e);exited.reject(e);});child.on('exit',(code,signal)=>{exited.resolve({code,signal});if(!events.some(v=>v.event==='result'))result.reject(Error('PUBLIC peer exited before result: '+code+' '+stderr));});
  let owner;const callers=new Set(),unblocks=[];
  const f={child,callers,unblocks,done:result.promise,handled:handled.promise,socketPath,events,
    query(n){const old=events.find(v=>v.event==='query'&&v.n===n);if(old)return Promise.resolve(old);return new Promise(resolve=>listeners.push({match:v=>v.event==='query'&&v.n===n,resolve}));},
    async acquire(req){const out=await owner.acquireOriginalInbound(req);if(out.caller)callers.add(out.caller);return out;},
    async release(caller){await owner.releaseOriginalInbound(caller);callers.delete(caller);},
    start(){child.stdin.write('go\n');},reply(){if(child.exitCode===null&&!child.stdin.destroyed)child.stdin.write('reply\n');},
  };
  t.after(async()=>{
    for(const unblock of unblocks)unblock();
    for(const caller of callers)await owner?.releaseOriginalInbound(caller).catch(()=>{});
    if(owner){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(Error('test cleanup drain timeout')),1500);try{await owner.close({signal:controller.signal});}catch{}finally{clearTimeout(timer);}}
    if(child.exitCode===null)child.kill();await exited.promise.catch(()=>{});
    const id=path.basename(socketDirectory);await fs.writeFile(path.join(evidence,id+'.stdout'),stdout,{flag:'wx'});await fs.writeFile(path.join(evidence,id+'.stderr'),stderr,{flag:'wx'});await fs.rm(socketDirectory,{recursive:true,force:true});
  });
  const profile={socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:child.pid,service:'task-grant-test',acceptTimeoutMs:500,currentTimeoutMs:1000,maxConnections:2,routes:registeredRoutes()};
  const opened=await open(profile,(req,res)=>{
    try{const work=handler(req,res,f);if(work&&typeof work.then==='function')return work.then(v=>{handled.resolve();return v;},e=>{handled.reject(e);throw e;});return work;}catch(e){handled.reject(e);throw e;}
  });
  owner=opened.owner;f.owner=owner;f.profile=profile;assert.equal(opened.errorPresent,false,opened.error?.stack);assert.ok(owner);f.registered=owner.registeredServer();
  if(start)f.start();return f;
}

test('TaskGrant real original caller owns fresh opaque bytes and local fence performs no extra queries',{timeout:12000},async t=>{
  const f=await fixture(t,async(req,res,f)=>{
    const out=await f.acquire(req);assert.equal(out.errorPresent,false);const h=out.caller;assert.ok(Object.isFrozen(h));
    for(let i=0;i<256;i++)assert.equal(f.owner.assertOriginalInboundAtCommit(h),undefined);
    assert.equal(req.readableEnded,false);const material=await f.owner.currentOriginalInbound(h);assert.deepEqual(material.Body,originalBody);assert.equal(material.Channel.Exporter.length,32);
    material.Body.fill(0);const fresh=await f.owner.currentOriginalInbound(h);assert.deepEqual(fresh.Body,originalBody);assert.deepEqual(await read(req),originalBody);
    assert.equal(f.owner.assertOriginalInboundAtCommit(h),undefined);assert.equal(f.owner.firstCallerCause(h),null);await f.release(h);
    res.setHeader('content-type','application/json');res.end(originalBody);
  });
  const response=await f.done;assert.equal(response.status,200);assert.equal(response.queries,3);assert.deepEqual(Buffer.from(response.body,'base64'),originalBody);await f.handled;
  await f.owner.close();assert.equal(f.owner.lifetime().closed,true);assert.equal(f.owner.lifetime().sourceVerified,false);
});

test('TaskGrant private owner rejects foreign server request caller copies and nonzero getter arguments',{timeout:12000},async t=>{
  const other=await fixture(t,async(req,res,f)=>{await read(req);res.end('{}');},{start:false});
  const f=await fixture(t,async(req,res,f)=>{
    const server=f.owner.registeredServer();assert.equal(f.owner.registeredServer(),server);assert.throws(()=>f.owner.registeredServer(f.profile));
    assert.notEqual(server,other.owner.registeredServer());assert.throws(()=>acquireInboundCaller(req,other.owner.registeredServer()));
    const foreign=await other.owner.acquireOriginalInbound(req);assert.equal(foreign.errorPresent,true);assert.equal(foreign.caller,null);
    const out=await f.acquire(req);assert.equal(out.errorPresent,false);const h=out.caller;
    for(const fake of [{},Object.create(h),{...h}]){assert.throws(()=>f.owner.assertOriginalInboundAtCommit(fake));await assert.rejects(f.owner.currentOriginalInbound(fake));await assert.rejects(f.owner.releaseOriginalInbound(fake));}
    assert.throws(()=>other.owner.assertOriginalInboundAtCommit(h));await assert.rejects(other.owner.currentOriginalInbound(h));
    await read(req);await f.release(h);res.end('{}');
  });
  assert.equal((await f.done).status,200);await f.handled;
});

test('TaskGrant callback undefined and logical release preserve original socket through final response',{timeout:12000},async t=>{
  const continued=deferred();let request,caller;
  const f=await fixture(t,(req,res,f)=>{
    request=req;
    void(async()=>{
      try{const out=await f.acquire(req);assert.equal(out.errorPresent,false);caller=out.caller;const server=f.owner.registeredServer();await read(req);await f.release(caller);assert.equal(req.socket.destroyed,false);assert.equal(f.owner.lifetime().callerHolds,0);assert.throws(()=>f.owner.assertOriginalInboundAtCommit(caller));
        const h=acquireInboundCaller(req,server);const material=await currentInboundCaller(req,h,server);assert.deepEqual(material.Body,originalBody);releaseInboundCaller(h);res.setHeader('content-type','application/json');res.end(originalBody);continued.resolve();
      }catch(e){continued.reject(e);res.destroy();}
    })();
    return undefined;
  });
  await continued.promise;const response=await f.done;assert.equal(response.status,200);assert.deepEqual(Buffer.from(response.body,'base64'),originalBody);assert.throws(()=>f.owner.assertOriginalInboundAtCommit(caller));assert.equal(request.complete,true);
});

test('TaskGrant fresh denial adopts nonnull failure caller and retains first caller cause without retiring listener',{timeout:12000},async t=>{
  const partial=deferred();let captured;
  const f=await fixture(t,async(req,_res,f)=>{captured=await f.acquire(req);assert.equal(captured.errorPresent,true);assert.ok(captured.caller);assert.ok(captured.error);assert.equal(f.owner.firstCallerCause(captured.caller),captured.error);assert.equal(f.owner.firstCause(),null);assert.equal(f.owner.lifetime().callerHolds,1);partial.resolve();},{mode:'deny-first'});
  await partial.promise;await f.handled;assert.ok((await f.done).error);assert.equal(f.owner.lifetime().retired,false);
  f.owner.retire();const reason=Error('caller debt probe');const c=new AbortController();const joining=f.owner.join({signal:c.signal});c.abort(reason);await assert.rejects(joining,e=>e===reason);assert.equal(f.owner.lifetime().callerHolds,1);assert.equal(f.owner.firstCallerCause(captured.caller),captured.error);
  await f.release(captured.caller);await f.owner.join();await f.owner.close();assert.equal(f.owner.lifetime().closed,true);assert.equal(f.owner.firstCause(),null);
});

test('TaskGrant late Current refusal preserves its first cause and allows logical cleanup without a second request',{timeout:12000},async t=>{
  const observed=deferred();
  const f=await fixture(t,async(req,_res,f)=>{
    const out=await f.acquire(req);assert.equal(out.errorPresent,false);let first;try{await f.owner.currentOriginalInbound(out.caller);assert.fail('second actual Current must be denied');}catch(e){first=e;}
    assert.equal(f.owner.firstCallerCause(out.caller),first);await assert.rejects(f.owner.currentOriginalInbound(out.caller));assert.equal(f.owner.firstCallerCause(out.caller),first);assert.equal(f.owner.firstCause(),null);await f.release(out.caller);observed.resolve();
  },{mode:'deny-second'});
  await observed.promise;await f.handled;const response=await f.done;assert.ok(response.error);assert.equal(response.queries,2);await f.owner.close();
});

test('TaskGrant retire joins original handler and caller debt; cancelled join cannot fake drain',{timeout:12000},async t=>{
  const entered=deferred(),handlerExit=deferred();let caller,request;
  const f=await fixture(t,async(req,_res,f)=>{request=req;const out=await f.acquire(req);assert.equal(out.errorPresent,false);caller=out.caller;const duplicate=await f.owner.acquireOriginalInbound(req);assert.equal(duplicate.errorPresent,true);assert.equal(duplicate.caller,null);assert.match(duplicate.error.code,/ALREADY_CAPTURED/);await read(req);entered.resolve();await handlerExit.promise;});
  f.unblocks.push(()=>handlerExit.resolve());await entered.promise;f.owner.retire();assert.throws(()=>f.owner.registeredServer());assert.throws(()=>f.owner.assertOriginalInboundAtCommit(caller));
  const reason=Error('cancel only this join');const cancel=new AbortController();const joining=f.owner.join({signal:cancel.signal});cancel.abort(reason);await assert.rejects(joining,e=>e===reason);assert.equal(f.owner.lifetime().callerHolds,1);assert.equal(f.owner.lifetime().closed,false);
  const cancellations=[];
  for(const [label,raw] of [['zero',0],['null',null],['false',false],['empty','']])for(const alreadyAborted of [false,true]){
    const controller=new AbortController();if(alreadyAborted)controller.abort(raw);
    const waiting=f.owner.join({signal:controller.signal}).then(()=>({fulfilled:true}),actual=>({fulfilled:false,actual}));
    if(!alreadyAborted)controller.abort(raw);const observed=await waiting;
    cancellations.push({label,alreadyAborted,rejected:!observed.fulfilled,exactRaw:!observed.fulfilled&&observed.actual===raw,actualType:typeof observed.actual,actualCode:observed.actual?.code,lifetime:f.owner.lifetime()});
    assert.equal(f.owner.lifetime().callerHolds,1);assert.equal(f.owner.lifetime().joined,false);assert.equal(f.owner.lifetime().closed,false);assert.equal(f.owner.firstCause(),null);
  }
  await json('join-abort-reasons.json',cancellations);
  for(const row of cancellations){assert.equal(row.rejected,true,row.label+' join cancellation cannot become success');assert.equal(row.exactRaw,true,row.label+' '+(row.alreadyAborted?'pre-aborted':'inflight')+' cancellation must preserve exact original reason');}
  await f.release(caller);const again=await f.owner.acquireOriginalInbound(request);assert.equal(again.errorPresent,true);assert.equal(again.caller,null);let joined=false;const drain=f.owner.join().then(()=>{joined=true;});await nextTurn();assert.equal(joined,false,'live original handler remains an actual child');handlerExit.resolve();await f.handled;await drain;await Promise.all([f.owner.close(),f.owner.close()]);assert.equal(f.owner.lifetime().closed,true);assert.equal(f.owner.firstCause(),null);assert.ok((await f.done).error);
});

test('TaskGrant native Current retirement preserves rejected operation after actual physical drain',{timeout:12000},async t=>{
  const acquisition=deferred(),handlerExit=deferred();let captured;
  const f=await fixture(t,async(req,_res,f)=>{captured=await f.acquire(req);acquisition.resolve();await handlerExit.promise;},{mode:'hold-first'});
  f.unblocks.push(()=>handlerExit.resolve());await f.query(1);f.owner.retire();assert.throws(()=>f.owner.registeredServer());assert.equal(f.owner.lifetime().retired,true);
  const reason=Error('cancel only this join');const cancel=new AbortController();const joining=f.owner.join({signal:cancel.signal});cancel.abort(reason);await assert.rejects(joining,e=>e===reason);assert.equal(f.owner.lifetime().closed,false);
  f.reply();await acquisition.promise;assert.equal(captured.errorPresent,true);assert.ok(captured.caller);assert.equal(f.owner.firstCallerCause(captured.caller),captured.error);assert.throws(()=>f.owner.assertOriginalInboundAtCommit(captured.caller));
  await f.release(captured.caller);handlerExit.resolve();await f.handled;await assert.rejects(f.owner.join(),e=>e===captured.error);assert.equal(f.owner.firstCause(),captured.error);assert.equal(f.owner.lifetime().firstCausePresent,true);assert.equal(f.owner.lifetime().cleanupUnknown,false);assert.equal(f.owner.lifetime().joined,true);assert.equal(f.owner.lifetime().closed,false);await assert.rejects(f.owner.close(),e=>e===captured.error);assert.equal(f.owner.lifetime().closed,true);await assert.rejects(f.owner.close(),e=>e===captured.error);assert.equal(f.owner.firstCause(),captured.error);assert.ok((await f.done).error);
});

test('TaskGrant failed startup returns owned partial with sticky first cause and real cleanup',{timeout:12000},async()=>{
  const opened=await open({},null);assert.ok(opened.owner);assert.equal(opened.errorPresent,true);assert.equal(opened.owner.firstCause(),opened.error);assert.equal(opened.error.code,'TASK_GRANT_TRANSPORT_ORIGINAL_HANDLER_REQUIRED');
  assert.throws(()=>opened.owner.registeredServer());await assert.rejects(opened.owner.close(),e=>e===opened.error);await assert.rejects(opened.owner.close(),e=>e===opened.error);assert.equal(opened.owner.lifetime().closed,true);assert.equal(opened.owner.lifetime().firstCausePresent,true);assert.equal(opened.owner.firstCause(),opened.error);
});

for(const [label,raw,pending] of [['zero',0,false],['undefined',undefined,true]]){
  test('TaskGrant raw rejection '+label+' preserves explicit failure presence through original handler and Join',{timeout:12000},async t=>{
    const entered=deferred(),gate=deferred(),thrown=deferred();
    const f=await fixture(t,async()=>{entered.resolve();if(pending)await gate.promise;thrown.resolve();throw raw;});
    f.unblocks.push(()=>gate.resolve());await entered.promise;
    if(!pending){await f.done;await nextTurn();}
    const registered=f.registered;f.owner.retire();const cancel=new AbortController(),probe=Error('bounded raw-rejection join probe');
    // A JavaScript turn does not prove native accept/current/socket completion.
    // This independent wait on the same real opaque listener is the barrier;
    // its rejection remains an error, never a successful handler observation.
    const physical=joinInboundAuthorityServer(registered).then(()=>({fulfilled:true}),reason=>({fulfilled:false,reason}));
    const joined=f.owner.join({signal:cancel.signal}).then(()=>({fulfilled:true}),reason=>({fulfilled:false,reason}));
    gate.resolve();await thrown.promise;await physical;await nextTurn();cancel.abort(probe);const observation=await joined;
    await json('raw-handler-'+label+'.json',{rawType:typeof raw,rawIsZero:raw===0,pendingAtJoin:pending,joinFulfilled:observation.fulfilled,joinRejectedOriginal:!observation.fulfilled&&observation.reason===raw,joinCancelledProbe:!observation.fulfilled&&observation.reason===probe,lifetime:f.owner.lifetime(),firstCauseType:typeof f.owner.firstCause(),firstCauseExact:f.owner.firstCause()===raw});
    assert.equal(observation.fulfilled,false,'throwing a falsy value must never become successful Join');
    assert.equal(observation.reason,raw,'Join must reject the actual original raw value, without waiting for cancellation');
    assert.equal(f.owner.firstCause(),raw);assert.equal(f.owner.lifetime().firstCausePresent,true);assert.equal(f.owner.lifetime().cleanupUnknown,false);assert.equal(f.owner.lifetime().joined,true);assert.equal(f.owner.lifetime().closed,false);
    const closed=await f.owner.close().then(()=>({fulfilled:true}),reason=>({fulfilled:false,reason}));assert.equal(closed.fulfilled,false);assert.equal(closed.reason,raw);assert.equal(f.owner.lifetime().closed,true);const again=await f.owner.close().then(()=>({fulfilled:true}),reason=>({fulfilled:false,reason}));assert.equal(again.fulfilled,false);assert.equal(again.reason,raw);assert.ok((await f.done).error);
  });
}

test('TaskGrant dedicated closed seven profile carries each exact original route and opaque body over real SCM',{timeout:20000},async t=>{
  for(const route of closedRoutes){
    const f=await fixture(t,async(req,res,f)=>{
      assert.equal(req.url,route);assert.equal(req.method,'POST');const captured=await f.acquire(req);assert.equal(captured.errorPresent,false);
      const data=await f.owner.currentOriginalInbound(captured.caller);assert.equal(data.Path,route);assert.equal(data.Method,'POST');assert.deepEqual(data.Body,originalBody);assert.equal(data.ContentLength,originalBody.length);assert.deepEqual(await read(req),originalBody);await f.release(captured.caller);res.setHeader('content-type','application/json');res.end(originalBody);
    },{route});
    const response=await f.done;await f.handled;assert.equal(response.status,200);assert.equal(response.queries,2);assert.deepEqual(Buffer.from(response.body,'base64'),originalBody);await f.owner.close();
  }
});

test('TaskGrant seven-profile and original two-profile factories have disjoint closed registration and finite bounds',{timeout:12000},async t=>{
  const f=await fixture(t,()=>assert.fail('registration controls must not start a request'),{start:false});
  let number=0;
  async function rejectProfile(factory,routes){
    // An existing endpoint would reject even if the registration gate regressed.
    // Each probe gets an unused path; an unexpectedly accepted listener is
    // really drained before the assertion reports the gate failure.
    let accepted;
    try{await assert.rejects(factory({...f.profile,socketPath:path.join(path.dirname(f.socketPath),'bad-'+(++number)),routes},()=>{}).then(server=>{accepted=server;return server;}));}
    finally{if(accepted)await closeInboundAuthorityServer(accepted);}
  }
  await rejectProfile(openInboundAuthorityServer,f.profile.routes);
  const two=f.profile.routes.filter(r=>r.path.endsWith('/effect')||r.path.endsWith('/effect-query'));
  await rejectProfile(openInboundDesktopTaskGrantServer,two);
  const invalid=[
    registeredRoutes().slice(1),
    [...registeredRoutes(),registeredRoutes()[0]],
    registeredRoutes().map((r,n)=>n===1?registeredRoutes()[0]:r),
    registeredRoutes().map((r,n)=>n? r:{...r,path:'/internal/auth/task-grants/not-registered'}),
    registeredRoutes().map((r,n)=>n? r:{...r,method:'GET'}),
    registeredRoutes().map((r,n)=>n? r:{...r,path:r.path+'?approval=true'}),
    registeredRoutes().map((r,n)=>n? r:{...r,maxRequestBytes:1048577}),
    registeredRoutes().map((r,n)=>n? r:{...r,maxResponseBytes:16777217}),
  ];
  for(const routes of invalid)await rejectProfile(openInboundDesktopTaskGrantServer,routes);
});

test('TaskGrant closed seven rejects actual unknown GET and query requests before handler or Current',{timeout:12000},async t=>{
  for(const selected of [{route:'/internal/auth/task-grants/not-registered'}, {method:'GET'}, {route:'/internal/auth/task-grants/effect?approval=true'}]){
    let entered=false;const f=await fixture(t,()=>{entered=true;assert.fail('unregistered request reached handler');},selected);
    const response=await f.done;assert.ok(response.error);assert.equal(response.queries,0);assert.equal(entered,false);
  }
});
