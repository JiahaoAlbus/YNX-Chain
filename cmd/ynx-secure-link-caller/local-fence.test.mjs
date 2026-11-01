// New synchronous local fence only. This small actual Go UDS/SCM peer supplies
// PUBLIC transport DATA, never a Source/issuer/kernel/TaskStore or actual TLS.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {
  openInboundAuthorityServer,acquireInboundCaller,currentInboundCaller,
  assertCurrentInboundCaller,releaseInboundCaller,
  retireInboundAuthorityServer,joinInboundAuthorityServer,closeInboundAuthorityServer,
} from './inbound-caller.mjs';

const native=createRequire(import.meta.url)('./build/caller.node');
const peerSource=String.raw`package main
import("bufio";"bytes";"encoding/base64";"encoding/binary";"encoding/json";"fmt";"io";"net";"net/http";"os";"strings";"sync/atomic";"syscall";"time")
func main(){
 bufio.NewReader(os.Stdin).ReadString('\n');conn,e:=net.DialUnix("unix",nil,&net.UnixAddr{Name:os.Args[1],Net:"unix"});if e!=nil{out(e);return};defer conn.Close();conn.SetDeadline(time.Now().Add(5*time.Second))
 pair,e:=syscall.Socketpair(syscall.AF_UNIX,syscall.SOCK_STREAM,0);if e!=nil{out(e);return};left,right:=os.NewFile(uintptr(pair[0]),"PUBLIC-control"),os.NewFile(uintptr(pair[1]),"PUBLIC-passed");control,e:=net.FileConn(left);left.Close();if e!=nil{right.Close();out(e);return};defer control.Close()
 _,_,e=conn.WriteMsgUnix([]byte{'L'},syscall.UnixRights(int(right.Fd())),nil);right.Close();if e!=nil{out(e);return}
 body:=[]byte("{ \"PUBLIC\":\"original opaque request\" }");route:="/internal/auth/task-grants/effect";var queries atomic.Int32
 go func(){for n:=0;n<64;n++{var command [1]byte;if _,e:=io.ReadFull(control,command[:]);e!=nil||command[0]!='C'{return};queries.Add(1)
  peer:=map[string]any{"ServiceID":"PUBLIC-peer","SubjectAltName":"peer.ynx.test","CertDigest":strings.Repeat("a",64),"RootDigest":strings.Repeat("b",64),"Edge":"PUBLIC-edge","Epoch":1,"Expires":"2099-01-01T00:00:00Z"}
  meta,_:=json.Marshal(map[string]any{"Service":"local-fence-test","Method":"POST","Path":route,"Host":"auth.ynx.test","ContentType":"application/json","ContentLength":len(body),"Channel":map[string]any{"Peer":peer,"Exporter":base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7},32)),"LocalSAN":"auth.ynx.test"}})
  payload:=make([]byte,4+len(meta)+len(body));binary.BigEndian.PutUint32(payload,uint32(len(meta)));copy(payload[4:],meta);copy(payload[4+len(meta):],body);length:=make([]byte,4);binary.BigEndian.PutUint32(length,uint32(len(payload)));if _,e:=control.Write(length);e!=nil{return};if _,e:=control.Write(payload);e!=nil{return}
 }}()
 req,_:=http.NewRequest("POST","http://local-fence-test"+route,bytes.NewReader(body));req.Header.Set("Content-Type","application/json");req.Close=true;if e=req.Write(conn);e!=nil{out(e);return};response,e:=http.ReadResponse(bufio.NewReader(conn),req);if e!=nil{out(e);return};data,e:=io.ReadAll(response.Body);response.Body.Close();if e!=nil{out(e);return};json.NewEncoder(os.Stdout).Encode(map[string]any{"status":response.StatusCode,"body":string(data),"freshQueries":queries.Load()})
}
func out(e error){fmt.Printf("{\"error\":%q}\n",e.Error())}
`;

let buildDirectory,executable;
before(async()=>{
  buildDirectory=await mkdtemp(path.join(os.tmpdir(),'lf-build-'));
  const source=path.join(buildDirectory,'peer.go');executable=path.join(buildDirectory,'peer');await writeFile(source,peerSource);
  const result=spawnSync('go',['build','-mod=readonly','-p','1','-o',executable,source],{encoding:'utf8',timeout:30000,env:{...process.env,GOMAXPROCS:'2'}});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
});
after(async()=>{if(buildDirectory)await rm(buildDirectory,{recursive:true,force:true});});
async function fixture(t,handler){
  const directory=await mkdtemp(path.join(os.tmpdir(),'lf-'));await chmod(directory,0o700);const socketPath=path.join(directory,'s');
  const child=spawn(executable,[socketPath],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>{if(code!==0){reject(Error(`PUBLIC peer exit ${code}: ${stderr}`));return;}try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});});done.catch(()=>{});
  let resolveHandler,rejectHandler;const handled=new Promise((resolve,reject)=>{resolveHandler=resolve;rejectHandler=reject;});handled.catch(()=>{});
  const profile={socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:child.pid,service:'local-fence-test',acceptTimeoutMs:500,currentTimeoutMs:500,maxConnections:2,routes:[
    {method:'POST',path:'/internal/auth/task-grants/effect',maxRequestBytes:1024,maxResponseBytes:1024},
    {method:'POST',path:'/internal/auth/task-grants/effect-query',maxRequestBytes:512,maxResponseBytes:512},
  ]};
  let server;const unblocks=[];
  t.after(async()=>{for(const unblock of unblocks)unblock();if(server)await closeInboundAuthorityServer(server).catch(()=>{});if(child.exitCode===null)child.kill();await done.catch(()=>{});await rm(directory,{recursive:true,force:true});});
  server=await openInboundAuthorityServer(profile,async(req,res)=>{try{await handler(req,res,server);resolveHandler();}catch(error){rejectHandler(error);throw error;}});
  child.stdin.end('go\n');return {server,done,handled,unblocks};
}
async function read(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);}

test('sync inbound fence keeps exact registered held request across original body consumption',async t=>{
  let request,handle,registered;
  const f=await fixture(t,async(req,res,server)=>{
    request=req;registered=server;handle=acquireInboundCaller(req,server);
    const fresh=await currentInboundCaller(req,handle,server);
    // The actual native addon entry stays original and nonwritable; the Go
    // peer counts control queries independently of repeated local assertions.
    const descriptor=Object.getOwnPropertyDescriptor(native,'currentInbound');
    assert.equal(descriptor.writable,false);
    for(let n=0;n<256;n++)assert.equal(assertCurrentInboundCaller(req,handle,server),undefined);
    const body=await read(req);assert.deepEqual(body,fresh.Body);
    assert.equal(assertCurrentInboundCaller(req,handle,server),undefined);
    const again=acquireInboundCaller(req,server);assert.equal(again,handle);
    releaseInboundCaller(again);assert.equal(assertCurrentInboundCaller(req,handle,server),undefined);
    releaseInboundCaller(handle);assert.throws(()=>assertCurrentInboundCaller(req,handle,server));
    const third=acquireInboundCaller(req,server);assert.equal(third,handle);
    assert.equal(assertCurrentInboundCaller(req,third,server),undefined);
    res.setHeader('Content-Type','application/json');res.end(body);
  });
  const result=await f.done;assert.equal(result.status,200);assert.equal(result.freshQueries,1);await f.handled;
  assert.throws(()=>assertCurrentInboundCaller(request,handle,registered));
});

test('sync inbound fence rejects copies forged handles wrong instance and metadata getters without invoking callbacks',async t=>{
  const other=await fixture(t,async(req,res)=>{await read(req);res.setHeader('Content-Type','application/json');res.end('{}');});
  let invoked=0;
  const f=await fixture(t,async(req,res,server)=>{
    const h=acquireInboundCaller(req,server);await currentInboundCaller(req,h,server);
    assert.throws(()=>assertCurrentInboundCaller(req,h));
    for(const candidate of [undefined,{},other.server])assert.throws(()=>assertCurrentInboundCaller(req,h,candidate));
    for(const fake of [{},Object.create(req),{...req},new Proxy(req,{get(){invoked++;throw Error('proxy callback');},getOwnPropertyDescriptor(){invoked++;throw Error('proxy descriptor callback');}})])assert.throws(()=>assertCurrentInboundCaller(fake,h,server));
    for(const fake of [{},JSON.parse('{}'),Object.freeze(Object.create(null)),new Proxy(h,{get(){invoked++;throw Error('handle callback');}})])assert.throws(()=>assertCurrentInboundCaller(req,fake,server));
    const getter=()=>{invoked++;throw Error('supplied metadata getter ran');};
    for(const key of ['method','url','socket','rawHeaders','httpVersion','httpVersionMajor','httpVersionMinor']){
      const old=Object.getOwnPropertyDescriptor(req,key);Object.defineProperty(req,key,{configurable:true,get:getter});
      assert.throws(()=>assertCurrentInboundCaller(req,h,server));Object.defineProperty(req,key,old);
      assert.equal(assertCurrentInboundCaller(req,h,server),undefined);
    }
    Object.defineProperty(req,'headers',{configurable:true,get:getter});assert.throws(()=>assertCurrentInboundCaller(req,h,server));delete req.headers;
    const headers=req.headers,raw=req.rawHeaders;
    for(const [object,key] of [[headers,'host'],[headers,'content-type'],[headers,'content-length'],[raw,'0']]){
      const old=Object.getOwnPropertyDescriptor(object,key);Object.defineProperty(object,key,{configurable:true,get:getter});
      assert.throws(()=>assertCurrentInboundCaller(req,h,server));Object.defineProperty(object,key,old);
    }
    const host=headers.host;headers.host='other-service';assert.throws(()=>assertCurrentInboundCaller(req,h,server));headers.host=host;
    // No body accessor or socket.destroyed getter may be reached, even on the
    // valid path. The async Current still performs its own fresh checks later.
    Object.defineProperty(req,'body',{configurable:true,get:getter});
    const oldDestroyed=Object.getOwnPropertyDescriptor(req.socket,'destroyed');
    Object.defineProperty(req.socket,'destroyed',{configurable:true,get:getter});
    try{assert.equal(assertCurrentInboundCaller(req,h,server),undefined);}finally{if(oldDestroyed)Object.defineProperty(req.socket,'destroyed',oldDestroyed);else delete req.socket.destroyed;delete req.body;}
    assert.equal(invoked,0);
    const body=await read(req);releaseInboundCaller(h);res.setHeader('Content-Type','application/json');res.end(body);
  });
  assert.equal((await f.done).status,200);await f.handled;assert.equal((await other.done).status,200);await other.handled;assert.equal(invoked,0);
});

test('sync inbound fence rejects observed retire and join retains original live handler until release',async t=>{
  let enter,release,request,handle,registered;const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
  const f=await fixture(t,async(req,_res,server)=>{request=req;registered=server;handle=acquireInboundCaller(req,server);await currentInboundCaller(req,handle,server);assert.equal(assertCurrentInboundCaller(req,handle,server),undefined);enter();await held;});
  f.unblocks.push(release);await entered;retireInboundAuthorityServer(f.server);
  assert.throws(()=>assertCurrentInboundCaller(request,handle,registered));
  let joined=false;const joining=joinInboundAuthorityServer(f.server).then(()=>{joined=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(joined,false);
  release();await f.handled;await joining;assert.equal(joined,true);assert.ok((await f.done).error);
  assert.throws(()=>assertCurrentInboundCaller(request,handle,registered));
});
