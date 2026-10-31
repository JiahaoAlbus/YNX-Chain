import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm,lstat} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import {createRequire} from 'node:module';
import {openInboundAuthorityServer,acquireInboundCaller,currentInboundCaller,releaseInboundCaller,retireInboundAuthorityServer,joinInboundAuthorityServer,closeInboundAuthorityServer} from './inbound-caller.mjs';

// Real Go socketpair/SCM_RIGHTS peer. Channel values below are explicitly PUBLIC
// transport fixtures, not actual TLS or a protected Source. Root tests the real
// AuthorityIPCIngress + native TLS composition separately with the same API.
const goSource=String.raw`package main
import("bufio";"bytes";"encoding/base64";"encoding/binary";"encoding/json";"fmt";"io";"net";"net/http";"os";"strings";"syscall";"time")
func main(){
 mode:=os.Args[2];bufio.NewReader(os.Stdin).ReadString('\n');
 conn,e:=net.DialUnix("unix",nil,&net.UnixAddr{Name:os.Args[1],Net:"unix"});if e!=nil{out(e);return};defer conn.Close();conn.SetDeadline(time.Now().Add(3*time.Second))
 pair,e:=syscall.Socketpair(syscall.AF_UNIX,syscall.SOCK_STREAM,0);if e!=nil{out(e);return}
 left,right:=os.NewFile(uintptr(pair[0]),"control"),os.NewFile(uintptr(pair[1]),"passed");control,e:=net.FileConn(left);left.Close();if e!=nil{out(e);return};defer control.Close()
 marker:=byte('L');if mode=="wrong-marker"{marker='X'}
 rights:=syscall.UnixRights(int(right.Fd()));if mode=="no-fd"{rights=nil};if mode=="extra-fd"{rights=syscall.UnixRights(int(right.Fd()),int(right.Fd()))}
 _,_,e=conn.WriteMsgUnix([]byte{marker},rights,nil);right.Close();if e!=nil{out(e);return}
 body:=[]byte("{ \"original\":\"PUBLIC opaque DATA\" }");route:="/internal/auth/task-grants/effect"
 go func(){defer control.Close();for n:=0;n<64;n++{var c [1]byte;if _,e:=io.ReadFull(control,c[:]);e!=nil||c[0]!='C'{return}
  if mode=="control-closed"{return};if mode=="slow-current"{time.Sleep(250*time.Millisecond)}
  if mode=="deny"{control.Write([]byte{0,0,0,0});return}
  method:="POST";if mode=="wrong-metadata"{method="DELETE"}
  peer:=map[string]any{"ServiceID":"PUBLIC-peer","SubjectAltName":"peer.ynx.test","CertDigest":strings.Repeat("a",64),"RootDigest":strings.Repeat("b",64),"Edge":"PUBLIC-edge","Epoch":1,"Expires":"2099-01-01T00:00:00Z"}
  metadata,_:=json.Marshal(map[string]any{"Service":"isolated-auth","Method":method,"Path":route,"Host":"auth.ynx.test","ContentType":"application/json","ContentLength":len(body),"Channel":map[string]any{"Peer":peer,"Exporter":base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7},32)),"LocalSAN":"auth.ynx.test"}})
  if mode=="bad-json"{metadata=[]byte("{")}
  payload:=make([]byte,4+len(metadata)+len(body));binary.BigEndian.PutUint32(payload,uint32(len(metadata)));copy(payload[4:],metadata);copy(payload[4+len(metadata):],body)
  length:=make([]byte,4);binary.BigEndian.PutUint32(length,uint32(len(payload)));if mode=="oversized-frame"{binary.BigEndian.PutUint32(length,1<<30)}
  if _,e:=control.Write(length);e!=nil{return};if _,e:=control.Write(payload);e!=nil{return}
 }}()
 req,_:=http.NewRequest("POST","http://isolated-auth"+route,bytes.NewReader(body));req.Host="isolated-auth";req.Header.Set("Content-Type","application/json");req.Close=true
 if mode=="fake-header"{req.Header.Set("X-YNX-Service-ID","forged")};if mode=="wrong-route"{req.URL.Path+="-other"};if mode=="chunked"{req.ContentLength=-1}
 if e=req.Write(conn);e!=nil{out(e);return};response,e:=http.ReadResponse(bufio.NewReader(conn),req);if e!=nil{out(e);return};raw,e:=io.ReadAll(response.Body);response.Body.Close();if e!=nil{out(e);return};json.NewEncoder(os.Stdout).Encode(map[string]any{"status":response.StatusCode,"body":base64.StdEncoding.EncodeToString(raw)})
}
func out(e error){fmt.Printf("{\"error\":%q}\n",e.Error())}
`;
let buildDirectory,executable;
before(async()=>{
  buildDirectory=await mkdtemp('/tmp/ynx-inbound-peer-build-');const source=path.join(buildDirectory,'peer.go');executable=path.join(buildDirectory,'peer');await writeFile(source,goSource);
  const result=spawnSync('go',['build','-mod=readonly','-p','1','-o',executable,source],{encoding:'utf8',env:{...process.env,GOMAXPROCS:'2'}});assert.equal(result.status,0,result.stderr);
});
after(async()=>{await rm(buildDirectory,{recursive:true,force:true});});
async function fixture(t,mode,handler,{wrongPID=false,currentTimeoutMs=500,maxResponseBytes=1024}={}){
  const directory=await mkdtemp('/tmp/ynx-inbound-native-');await chmod(directory,0o700);const socketPath=path.join(directory,'peer.sock');
  const child=spawn(executable,[socketPath,mode],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>{
      if(code!==0){reject(Error(stderr));return;}
      try{resolve(JSON.parse(stdout));}catch(error){reject(error);}
    });
  });
  const config={socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:wrongPID?child.pid+100000:child.pid,service:'isolated-auth',acceptTimeoutMs:500,currentTimeoutMs,maxConnections:4,routes:[
    {method:'POST',path:'/internal/auth/task-grants/effect',maxRequestBytes:1024,maxResponseBytes},
    {method:'POST',path:'/internal/auth/task-grants/effect-query',maxRequestBytes:512,maxResponseBytes:512},
  ]};
  const server=await openInboundAuthorityServer(config,handler);
  t.after(async()=>{await closeInboundAuthorityServer(server).catch(()=>{});if(child.exitCode===null)child.kill();await done.catch(()=>{});await rm(directory,{recursive:true,force:true});});
  child.stdin.end('go\n');return {server,done,socketPath,config};
}
async function read(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);}

test('incoming native Go fd mints same original req handle before reading, through response finish',async t=>{
  let originalReq,handle,first;
  const f=await fixture(t,'normal',async(req,res)=>{
    originalReq=req;handle=acquireInboundCaller(req);
    first=await currentInboundCaller(req,handle);
    assert.equal(req.readableEnded,false);assert.equal(first.Service,'isolated-auth');assert.equal(first.Host,'auth.ynx.test');assert.equal(first.Channel.Exporter.length,32);
    const raw=await read(req);assert.deepEqual(raw,first.Body);
    releaseInboundCaller(handle);const second=acquireInboundCaller(req);assert.equal(second,handle);
    first.Body.fill(0);first.Channel.Exporter.fill(0);
    const fresh=await currentInboundCaller(req,second);assert.deepEqual(fresh.Body,raw);assert.equal(fresh.Channel.Exporter[0],7);
    releaseInboundCaller(second);res.setHeader('Content-Type','application/json');res.end(raw);
  });
  const response=await f.done;assert.equal(response.status,200);assert.equal(Buffer.from(response.body,'base64').toString(),'{ "original":"PUBLIC opaque DATA" }');
  await assert.rejects(currentInboundCaller(originalReq,handle));assert.throws(()=>acquireInboundCaller(originalReq));
  await closeInboundAuthorityServer(f.server);assert.equal((await lstat(f.socketPath)).isSocket(),true);
});

test('request copies, fake contexts, header mutation and outbound handle do not mint incoming caller',async t=>{
  const f=await fixture(t,'normal',async(req,res)=>{
    const handle=acquireInboundCaller(req);
    for(const fake of [{},Object.create(req),{...req},{method:req.method,url:req.url,headers:req.headers,socket:req.socket,context:req.context}]){
      assert.throws(()=>acquireInboundCaller(fake));await assert.rejects(currentInboundCaller(fake,handle));
    }
    await assert.rejects(currentInboundCaller(req,{}));
    req.headers.host='changed';await assert.rejects(currentInboundCaller(req,handle));
    res.destroy();
  });
  assert.ok((await f.done).error);
});

test('same native Go PID and exact one-FD marker are required before handler',async t=>{
  for(const mode of ['wrong-marker','no-fd','extra-fd','fake-header','wrong-route','chunked']){
    await t.test(mode,async t=>{let calls=0;const f=await fixture(t,mode,()=>{calls++;});assert.ok((await f.done).error);assert.equal(calls,0);});
  }
  await t.test('wrong-Go-PID',async t=>{let calls=0;const f=await fixture(t,'normal',()=>{calls++;},{wrongPID:true});assert.ok((await f.done).error);assert.equal(calls,0);});
});

test('fresh Current denial, metadata/frame mismatch, control close and timeout retire the capability',async t=>{
  for(const mode of ['deny','wrong-metadata','bad-json','oversized-frame','control-closed','slow-current']){
    await t.test(mode,async t=>{
      let refused=false;
      const f=await fixture(t,mode,async(req,res)=>{const handle=acquireInboundCaller(req);await assert.rejects(currentInboundCaller(req,handle));refused=true;assert.throws(()=>acquireInboundCaller(req));res.destroy();},{currentTimeoutMs:mode==='slow-current'?30:500});
      assert.ok((await f.done).error);assert.equal(refused,true);
    });
  }
});

test('retire joins actual accept/current/handler/socket ownership without fake drain',async t=>{
  let entered,release;const entry=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
  const f=await fixture(t,'normal',async(req,_res)=>{const h=acquireInboundCaller(req);await currentInboundCaller(req,h);entered();await held;});
  await entry;retireInboundAuthorityServer(f.server);let joined=false;
  const joining=joinInboundAuthorityServer(f.server).then(()=>{joined=true;});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(joined,false);release();await joining;assert.equal(joined,true);assert.ok((await f.done).error);
});

test('listener preserves existing endpoint and rejects outbound/native data impersonation',async t=>{
  const directory=await mkdtemp('/tmp/ynx-inbound-existing-');await chmod(directory,0o700);const socketPath=path.join(directory,'existing');await writeFile(socketPath,'preserve');
  const base={socketPath,nodeUID:process.geteuid(),bridgeUID:process.geteuid(),bridgePID:process.pid,service:'isolated-auth',acceptTimeoutMs:100,currentTimeoutMs:100,maxConnections:1,routes:[{method:'POST',path:'/internal/auth/task-grants/effect',maxRequestBytes:64,maxResponseBytes:64},{method:'POST',path:'/internal/auth/task-grants/effect-query',maxRequestBytes:64,maxResponseBytes:64}]};
  await assert.rejects(openInboundAuthorityServer(base,()=>{}));assert.equal((await lstat(socketPath)).isFile(),true);
  const native=createRequire(import.meta.url)('./build/caller.node');for(const value of [{},JSON.parse('{}')]){assert.throws(()=>native.takeInboundFD(value));assert.throws(()=>native.currentInbound(value,{timeoutMs:100,maxFrameBytes:100}));}
  await rm(directory,{recursive:true,force:true});
});

test('callback-style kernel may return synchronously while caller stays live until response finish',async t=>{
  let complete,failed;const completed=new Promise((resolve,reject)=>{complete=resolve;failed=reject;});let handle,request;
  const f=await fixture(t,'normal',(req,res)=>{
    request=req;handle=acquireInboundCaller(req);
    setImmediate(async()=>{
      try{
        const before=await currentInboundCaller(req,handle);assert.equal(req.readableEnded,false);
        const raw=await read(req);assert.deepEqual(before.Body,raw);
        const same=acquireInboundCaller(req);assert.equal(same,handle);releaseInboundCaller(same);
        const after=await currentInboundCaller(req,handle);assert.deepEqual(after.Body,raw);
        releaseInboundCaller(handle);res.setHeader('Content-Type','application/json');res.end(raw);complete();
      }catch(error){res.destroy(error);failed(error);}
    });
    // Deliberately undefined, as with the original callback HTTP kernel.
  });
  const result=await f.done;await completed;assert.equal(result.status,200);await assert.rejects(currentInboundCaller(request,handle));
});

test('control queries are serialized, bounded at 64 and cannot revive a retired request',async t=>{
  let refused=false;
  const f=await fixture(t,'normal',async(req,res)=>{
    const h=acquireInboundCaller(req);
    const first=await Promise.all([currentInboundCaller(req,h),currentInboundCaller(req,h),currentInboundCaller(req,h)]);
    assert.deepEqual(first[0].Body,first[1].Body);assert.deepEqual(first[1].Body,first[2].Body);
    for(let n=3;n<64;n++)await currentInboundCaller(req,h);
    await assert.rejects(currentInboundCaller(req,h));refused=true;assert.throws(()=>acquireInboundCaller(req));res.destroy();
  });
  assert.ok((await f.done).error);assert.equal(refused,true);
});

test('registered response limit forwards exact bytes and refuses a larger original write',async t=>{
  await t.test('exact-limit',async t=>{
    const output=Buffer.from('"'+'x'.repeat(62)+'"');
    const f=await fixture(t,'normal',async(req,res)=>{const h=acquireInboundCaller(req);await currentInboundCaller(req,h);await read(req);res.setHeader('Content-Type','application/json');res.end(output);},{maxResponseBytes:64});
    const result=await f.done;assert.equal(result.status,200);assert.deepEqual(Buffer.from(result.body,'base64'),output);
  });
  await t.test('above-limit',async t=>{
    const f=await fixture(t,'normal',async(req,res)=>{const h=acquireInboundCaller(req);await currentInboundCaller(req,h);await read(req);res.setHeader('Content-Type','application/json');res.end(Buffer.alloc(65));},{maxResponseBytes:64});
    assert.ok((await f.done).error);await assert.rejects(closeInboundAuthorityServer(f.server),/response byte budget/);
  });
});

test('original resolver can bind the exact registered server instead of accepting another public factory',async t=>{
  const other=await fixture(t,'normal',async(req,res)=>{await read(req);res.setHeader('Content-Type','application/json');res.end('{}');});
  let server,ready;const configured=new Promise(resolve=>{ready=resolve;});
  const original=await fixture(t,'normal',async(req,res)=>{
    await configured;
    assert.throws(()=>acquireInboundCaller(req,other.server),/listener instance/);
    assert.throws(()=>acquireInboundCaller(req,{}));
    assert.throws(()=>acquireInboundCaller(req,undefined));
    const h=acquireInboundCaller(req,server);
    await assert.rejects(currentInboundCaller(req,h,other.server),/listener instance/);
    await assert.rejects(currentInboundCaller(req,h,undefined));
    const actual=await currentInboundCaller(req,h,server),body=await read(req);assert.deepEqual(actual.Body,body);
    releaseInboundCaller(h);res.setHeader('Content-Type','application/json');res.end(body);
  });
  server=original.server;ready();assert.equal((await original.done).status,200);assert.equal((await other.done).status,200);
});
