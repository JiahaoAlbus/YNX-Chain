// Dedicated A-profile transport controls only. The actual Go forwarder fixture
// owns its original request/session; no test claims P08 Source or TLS admission.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,chmod,rm,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {
  openInboundTaskRuntimeServer,acquireInboundTaskRuntimeCaller,currentInboundTaskRuntimeCaller,
  assertCurrentInboundTaskRuntimeCaller,releaseInboundTaskRuntimeCaller,exchangeInboundTaskRuntime,
  retireInboundTaskRuntimeServer,joinInboundTaskRuntimeServer,closeInboundTaskRuntimeServer,
  openInboundAuthorityServer,acquireInboundCaller,currentInboundCaller,assertCurrentInboundCaller,
  releaseInboundCaller,closeInboundAuthorityServer,
} from './inbound-caller.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const artifact='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/shared/LINK/task-runtime-custody-next';
const native=createRequire(import.meta.url)('./build/caller.node');
const ops=['capture','capture-conversation','execute-local','observe','outcome','observe-outcome','reconcile-observe','release'];
const original=Buffer.from('{ "PUBLIC":"opaque carrier" }');
let buildDirectory,rawPeer,forwarder,forwarderBuilt=false;
function build(output,input){
  const run=spawnSync('go',['build','-mod=readonly','-p','1','-o',output,input],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,GOMAXPROCS:'2'}});
  assert.equal(run.error,undefined);assert.equal(run.status,0,run.stderr);
}

// Malformed-control negative peer and one adjacent old L compatibility case.
// These PUBLIC OS/SCM fixtures do NOT mint a Go TaskStore object or TLS channel.
const rawSource=String.raw`package main
import("bufio";"bytes";"encoding/base64";"encoding/binary";"encoding/json";"fmt";"io";"net";"net/http";"os";"strings";"syscall";"time")
func main(){mode:=os.Args[2];bufio.NewReader(os.Stdin).ReadString('\n');c,e:=net.DialUnix("unix",nil,&net.UnixAddr{Name:os.Args[1],Net:"unix"});if e!=nil{out(e);return};defer c.Close();c.SetDeadline(time.Now().Add(5*time.Second));pair,e:=syscall.Socketpair(syscall.AF_UNIX,syscall.SOCK_STREAM,0);if e!=nil{out(e);return};l,r:=os.NewFile(uintptr(pair[0]),"control"),os.NewFile(uintptr(pair[1]),"passed");control,e:=net.FileConn(l);l.Close();if e!=nil{r.Close();out(e);return};defer control.Close()
 marker:=byte('A');legacy:=mode=="legacy"||mode=="L-to-A";if legacy{marker='L'};_,_,e=c.WriteMsgUnix([]byte{marker},syscall.UnixRights(int(r.Fd())),nil);r.Close();if e!=nil{out(e);return}
 body:=[]byte("{ \"PUBLIC\":\"opaque carrier\" }");route:="/internal/auth/ai-task-v6/effect";if legacy||mode=="A-to-L"{route="/internal/auth/task-grants/effect"}
 go func(){defer control.Close();for n:=0;n<64;n++{var command [1]byte;if _,e:=io.ReadFull(control,command[:]);e!=nil{return}
  if command[0]=='C'{m:=map[string]any{"Profile":"AUTH_AI_V6_PRIVATE_RUNTIME_TRANSPORT/v1","Service":"runtime-test","Method":"POST","Path":route,"Host":"runtime-test","ContentType":"application/json","ContentLength":len(body)}
   if mode=="legacy"{delete(m,"Profile");m["Host"]="auth.ynx.test";m["Channel"]=map[string]any{"Peer":map[string]any{"ServiceID":"PUBLIC","SubjectAltName":"peer.ynx.test","CertDigest":strings.Repeat("a",64),"RootDigest":strings.Repeat("b",64),"Edge":"PUBLIC","Epoch":1,"Expires":"2099-01-01T00:00:00Z"},"Exporter":base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7},32)),"LocalSAN":"auth.ynx.test"}}
   meta,_:=json.Marshal(m);p:=make([]byte,4+len(meta)+len(body));binary.BigEndian.PutUint32(p,uint32(len(meta)));copy(p[4:],meta);copy(p[4+len(meta):],body);length:=make([]byte,4);binary.BigEndian.PutUint32(length,uint32(len(p)));control.Write(length);control.Write(p);continue}
  if command[0]!='T'{return};var h [5]byte;if _,e:=io.ReadFull(control,h[:]);e!=nil{return};size:=binary.BigEndian.Uint32(h[1:]);if size>1048576{return};data:=make([]byte,size);if _,e:=io.ReadFull(control,data);e!=nil{return};fmt.Printf("{\"event\":\"wire-operation\",\"op\":%d}\n",h[0])
  if mode=="ack-loss"{return};if mode=="slow"{time.Sleep(200*time.Millisecond)};length:=make([]byte,4)
  if mode=="oversized"{binary.BigEndian.PutUint32(length,33554436);control.Write(length);return}
  status:=200;flag:=byte(0);if mode=="bad-status"{status=999};if mode=="bad-flag"{flag=2};if mode=="release-error"&&h[0]==8{status=409;flag=1}
  p:=make([]byte,3+len(data));binary.BigEndian.PutUint16(p,uint16(status));p[2]=flag;copy(p[3:],data);binary.BigEndian.PutUint32(length,uint32(len(p)));control.Write(length)
  if mode=="truncated"{control.Write(p[:min(len(p),6)]);return};if _,e:=control.Write(p);e!=nil{return}
 }}()
 req,_:=http.NewRequest("POST","http://runtime-test"+route,bytes.NewReader(body));req.Header.Set("Content-Type","application/json");req.Close=true;if e=req.Write(c);e!=nil{out(e);return};res,e:=http.ReadResponse(bufio.NewReader(c),req);if e!=nil{out(e);return};b,e:=io.ReadAll(res.Body);res.Body.Close();if e!=nil{out(e);return};json.NewEncoder(os.Stdout).Encode(map[string]any{"status":res.StatusCode,"body":string(b)})
}
func out(e error){fmt.Printf("{\"error\":%q}\n",e.Error())}
`;
before(async()=>{
  await mkdir(artifact,{recursive:true});buildDirectory=await mkdtemp(path.join(artifact,'runtime-test-build-'));
  rawPeer=path.join(buildDirectory,'raw-peer');forwarder=path.join(buildDirectory,'actual-forwarder');
  const source=path.join(buildDirectory,'raw.go');await writeFile(source,rawSource);
  build(rawPeer,source);
});
after(async()=>{if(buildDirectory)await rm(buildDirectory,{recursive:true,force:true});});
async function fixture(t,mode,handler,{legacy=false,actual=false,timeout=1000,kind='effect'}={}){
  if(actual&&!forwarderBuilt){build(forwarder,'./cmd/ynx-secure-link-caller/go-task-runtime-fixture');forwarderBuilt=true;}
  const directory=await mkdtemp(path.join(os.tmpdir(),'tr-'));await chmod(directory,0o700);const socketPath=path.join(directory,'s');
  const child=spawn(actual?forwarder:rawPeer,actual?[socketPath,String(process.geteuid()),String(process.pid),kind,mode]:[socketPath,mode],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='',lines='',operationSeen;
  const wireOperation=new Promise(resolve=>{operationSeen=resolve;});
  child.stdout.on('data',chunk=>{stdout+=chunk;lines+=chunk;for(;;){const n=lines.indexOf('\n');if(n<0)break;const line=lines.slice(0,n);lines=lines.slice(n+1);try{const row=JSON.parse(line);if(row.event==='wire-operation')operationSeen(row);}catch{}}});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{if(code!==0){reject(Error(`Go peer ${code}: ${stderr}\n${stdout}`));return;}try{resolve(stdout.split('\n').filter(Boolean).map(line=>JSON.parse(line)));}catch(error){reject(error);}});});done.catch(()=>{});
  let resolveHandler,rejectHandler;const handled=new Promise((resolve,reject)=>{resolveHandler=resolve;rejectHandler=reject;});handled.catch(()=>{});
  const routes=legacy?['/internal/auth/task-grants/effect','/internal/auth/task-grants/effect-query']:['/internal/auth/ai-task-v6/effect','/internal/auth/ai-task-v6/effect-query'];
  const config={socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:child.pid,service:'runtime-test',acceptTimeoutMs:200,currentTimeoutMs:timeout,maxConnections:2,routes:routes.map(p=>({method:'POST',path:p,maxRequestBytes:legacy?1024:1835008,maxResponseBytes:legacy?1024:2097152}))};
  let server;const unblocks=[];
  t.after(async()=>{for(const unblock of unblocks)unblock();if(server)await (legacy?closeInboundAuthorityServer:closeInboundTaskRuntimeServer)(server).catch(()=>{});if(child.exitCode===null)child.kill();await done.catch(()=>{});await rm(directory,{recursive:true,force:true});});
  server=await (legacy?openInboundAuthorityServer:openInboundTaskRuntimeServer)(config,async(req,res)=>{try{await handler(req,res,server);resolveHandler();}catch(error){rejectHandler(error);throw error;}});
  child.stdin.end('go\n');return {server,done,handled,unblocks,config,wireOperation};
}
function final(res){res.setHeader('Content-Type','application/json');res.end('{}');}

test('actual original Go forwarder retains original session through all eight Node reverse operations and final response',async t=>{
  const f=await fixture(t,'normal',async(req,res,server)=>{
    const h=acquireInboundTaskRuntimeCaller(req,server),first=await currentInboundTaskRuntimeCaller(req,h,server);
    assert.equal(first.Profile,'AUTH_AI_V6_PRIVATE_RUNTIME_TRANSPORT/v1');assert.equal(Object.hasOwn(first,'Channel'),false);assert.equal(first.sourceVerified,false);
    assert.equal(first.Peer.uid,process.geteuid());assert.equal(first.Method,'POST');assert.equal(first.Path,'/internal/auth/ai-task-v6/effect');
    const data=Buffer.from('{ "PUBLIC":"original reverse request" }');
    for(const operation of ops){
      assert.equal(assertCurrentInboundTaskRuntimeCaller(req,h,server),undefined);
      const result=await exchangeInboundTaskRuntime(req,h,server,operation,data);assert.equal(result.errorPresent,false);assert.equal(result.dataOnly,true);assert.equal(result.sourceVerified,false);assert.deepEqual(result.body,data);
    }
    assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));await assert.rejects(currentInboundTaskRuntimeCaller(req,h,server));await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'execute-local',data));
    releaseInboundTaskRuntimeCaller(h);final(res);
  },{actual:true});
  const events=await f.done;await f.handled;
  const operations=events.filter(row=>row.type==='operation'||row.event==='operation');
  assert.deepEqual(operations.map(row=>row.op),ops);
  assert.ok(operations.every(row=>row.ctxAlive===true));
  const opened=events.find(row=>row.event==='open');assert.equal(opened.sameRequest,true);assert.equal(opened.ctxAlive,true);
  assert.equal(events.filter(row=>row.event==='session-closed').length,1);
  t.diagnostic(JSON.stringify({actualForwarder:true,operations:operations.map(row=>({op:row.op,ctxAlive:row.ctxAlive})),sameOriginalRequest:opened.sameRequest,ownedSessionCloseCount:1}));
  const result=events.findLast(row=>row.type==='result'||row.event==='result');assert.equal(result.statusCode,200);assert.equal(result.drained,true);
});

test('runtime C and T share the same finite 64-query budget',async t=>{
  let first;
  const f=await fixture(t,'normal',async(req,res,server)=>{
    const h=acquireInboundTaskRuntimeCaller(req,server);await currentInboundTaskRuntimeCaller(req,h,server);
    for(let n=0;n<62;n++)await exchangeInboundTaskRuntime(req,h,server,'capture',Buffer.from('{}'));
    await currentInboundTaskRuntimeCaller(req,h,server);
    await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'capture',Buffer.from('{}')),error=>{first=error;assert.equal(error.dispatchPossible,false);return true;});
    assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));res.destroy();
  });
  assert.ok((await f.done).at(-1).error);await f.handled;retireInboundTaskRuntimeServer(f.server);await assert.rejects(joinInboundTaskRuntimeServer(f.server),error=>error===first);
});

test('runtime exchanges and C serialize exact opaque owned bytes; closed operations and independent input bounds cannot enlarge',async t=>{
  const f=await fixture(t,'normal',async(req,res,server)=>{
    const h=acquireInboundTaskRuntimeCaller(req,server);
    for(const op of ['unknown','/internal/arbitrary',1,{},'writer-current'])await assert.rejects(exchangeInboundTaskRuntime(req,h,server,op,Buffer.from('{}')),e=>e.dispatchPossible===false);
    for(const input of [Buffer.alloc(0),Buffer.alloc(1048577),new Uint8Array(new SharedArrayBuffer(8)),{}])await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'capture',input),e=>e.dispatchPossible===false);
    const bytes=Buffer.from('{ "raw": "not reserialized" }'),expected=Buffer.from(bytes);
    const pending=exchangeInboundTaskRuntime(req,h,server,'capture',bytes);bytes.fill(0);
    const [result,material,second]=await Promise.all([pending,currentInboundTaskRuntimeCaller(req,h,server),exchangeInboundTaskRuntime(req,h,server,'outcome',expected)]);
    assert.deepEqual(result.body,expected);assert.deepEqual(second.body,expected);assert.deepEqual(material.Body,original);assert.equal(Object.hasOwn(material,'Channel'),false);
    result.body.fill(0);assert.deepEqual(second.body,expected);
    const max=Buffer.alloc(1048576,0x78),large=await exchangeInboundTaskRuntime(req,h,server,'observe',max);assert.deepEqual(large.body,max);
    await exchangeInboundTaskRuntime(req,h,server,'release',Buffer.from('{}'));assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));final(res);
  });
  assert.equal((await f.done).at(-1).status,200);await f.handled;
});

test('runtime remote release error retains exact response DATA and terminal fence while original HTTP may finish',async t=>{
  const f=await fixture(t,'release-error',async(req,res,server)=>{
    const h=acquireInboundTaskRuntimeCaller(req,server),body=Buffer.from('{ "PUBLIC":"release-original" }');
    await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'release',body),error=>{
      assert.equal(error.code,'RUNTIME_REMOTE_ERROR');assert.equal(error.dispatchPossible,true);assert.equal(error.responseData.statusCode,409);assert.equal(error.responseData.errorPresent,true);assert.deepEqual(error.responseData.body,body);assert.equal(Object.hasOwn(error,'partial'),false);return true;
    });
    assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'release',body));releaseInboundTaskRuntimeCaller(h);final(res);
  });
  assert.equal((await f.done).at(-1).status,200);await f.handled;
});

test('lost ACK malformed bounded responses and timeout preserve UNKNOWN dispatch with no automatic retry',async t=>{
  for(const mode of ['ack-loss','oversized','bad-status','bad-flag','truncated','slow'])await t.test(mode,async t=>{
    let first;
    const f=await fixture(t,mode,async(req,res,server)=>{
      const h=acquireInboundTaskRuntimeCaller(req,server),body=Buffer.from('PUBLIC-exact-request');
      await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'execute-local',body),error=>{
        first=error;assert.equal(error.dispatchPossible,true);assert.equal(Object.hasOwn(error,'partial'),false);assert.ok(error.cause);if(mode==='truncated'){assert.deepEqual(error.responseData.body,body.subarray(0,3));assert.equal(error.responseData.complete,false);}return true;
      });
      assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'execute-local',body),error=>error.dispatchPossible===false);res.destroy();
    },{timeout:mode==='slow'?30:1000});
    assert.ok((await f.done).at(-1).error);await f.handled;retireInboundTaskRuntimeServer(f.server);await assert.rejects(joinInboundTaskRuntimeServer(f.server),error=>error===first);
  });
});

test('dedicated A profile cannot borrow old L marker handle or API and adjacent old L Current still works',async t=>{
  for(const mode of ['L-to-A','A-to-L'])await t.test(mode,async t=>{
    let calls=0;const f=await fixture(t,mode,()=>{calls++;},{legacy:mode==='A-to-L'});assert.ok((await f.done).at(-1).error);assert.equal(calls,0);
  });
  const legacy=await fixture(t,'legacy',async(req,res,server)=>{
    const h=acquireInboundCaller(req,server),material=await currentInboundCaller(req,h,server);assert.equal(material.Channel.Exporter.length,32);assert.equal(assertCurrentInboundCaller(req,h,server),undefined);
    assert.throws(()=>acquireInboundTaskRuntimeCaller(req,server));assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));await assert.rejects(exchangeInboundTaskRuntime(req,h,server,'capture',Buffer.from('{}')));releaseInboundCaller(h);final(res);
  },{legacy:true});assert.equal((await legacy.done).at(-1).status,200);await legacy.handled;
  const runtime=await fixture(t,'normal',async(req,res,server)=>{
    const h=acquireInboundTaskRuntimeCaller(req,server);assert.throws(()=>acquireInboundCaller(req,server));assert.throws(()=>assertCurrentInboundCaller(req,h,server));await assert.rejects(currentInboundCaller(req,h,server));
    assert.throws(()=>native.takeInboundFD(h));assert.throws(()=>native.currentInbound(h,{timeoutMs:100,maxFrameBytes:1024}));final(res);
  });assert.equal((await runtime.done).at(-1).status,200);await runtime.handled;
});

test('real native listener and accepted peer tags reject cross-profile C T FD transfer and retire',async t=>{
  for(const legacy of [false,true])await t.test(legacy?'L native brand':'A native brand',async t=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'tb-'));await chmod(directory,0o700);const socketPath=path.join(directory,'s');
    const child=spawn(rawPeer,[socketPath,legacy?'legacy':'normal'],{stdio:['pipe','pipe','pipe']});let text='';child.stdout.on('data',chunk=>{text+=chunk;});
    const done=new Promise(resolve=>child.once('exit',resolve));
    const listener=(legacy?native.listenInbound:native.listenTaskRuntime)({socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:child.pid,timeoutMs:500});
    let peer;
    t.after(async()=>{if(peer)(legacy?native.retireInbound:native.retireTaskRuntime)(peer);(legacy?native.retireListener:native.retireTaskRuntimeListener)(listener);if(child.exitCode===null)child.kill();await done;await rm(directory,{recursive:true,force:true});});
    assert.throws(()=>(legacy?native.acceptTaskRuntime:native.acceptInbound)(listener));
    assert.throws(()=>(legacy?native.retireTaskRuntimeListener:native.retireListener)(listener));
    const accepted=(legacy?native.acceptInbound:native.acceptTaskRuntime)(listener);child.stdin.end('go\n');peer=await accepted;assert.ok(peer);
    assert.throws(()=>(legacy?native.takeTaskRuntimeFD:native.takeInboundFD)(peer));
    assert.throws(()=>(legacy?native.currentTaskRuntime:native.currentInbound)(peer,{timeoutMs:100,maxFrameBytes:2048}));
    assert.throws(()=>(legacy?native.retireTaskRuntime:native.retireInbound)(peer));
    if(legacy)assert.throws(()=>native.exchangeTaskRuntime(peer,1,Buffer.from('{}'),{timeoutMs:100,maxResponseBytes:1024}));
    (legacy?native.retireInbound:native.retireTaskRuntime)(peer);await done;assert.ok(JSON.parse(text.trim()).error);
  });
});

test('retire cancels runtime I/O and actual Join waits for the original handler release',async t=>{
  let entered,release;const entry=new Promise(resolve=>{entered=resolve;}),held=new Promise(resolve=>{release=resolve;});let first;
  const f=await fixture(t,'slow',async(req,_res,server)=>{
    const h=acquireInboundTaskRuntimeCaller(req,server),pending=exchangeInboundTaskRuntime(req,h,server,'observe',Buffer.from('{}'));entered();await assert.rejects(pending,error=>{first=error;assert.equal(error.dispatchPossible,true);return true;});assert.throws(()=>assertCurrentInboundTaskRuntimeCaller(req,h,server));await held;
  });f.unblocks.push(release);await entry;
  // Wait for actual peer receipt, rather than guessing native dispatch timing.
  await f.wireOperation;retireInboundTaskRuntimeServer(f.server);let joined=false;
  const joining=joinInboundTaskRuntimeServer(f.server).then(()=>{joined=true;},error=>{assert.equal(error,first);joined=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(joined,false);release();await f.handled;await joining;assert.equal(joined,true);assert.ok((await f.done).at(-1).error);
});
