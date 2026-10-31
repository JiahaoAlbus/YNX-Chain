import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {configurePUBLICHTTPV5Source} from './native/product-device-v5-transport-sdk.fixture.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),native=path.join(root,'native'),fixture=path.join(root,'test/native'),applicable=process.platform==='darwin';
let directory,binary,b,sdkPrivate,sdkURL,sdkPin;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bodyData=(body,contentType)=>Object.freeze({contentType,bodyDigest:hash(body),bodyBinding:Object.freeze({bytes:String(body.length),sha3_512:createHash('sha3-512').update(body).digest('hex'),sha512:createHash('sha512').update(body).digest('hex')})});
before(async()=>{
 if(!applicable)return;
 directory=await fs.mkdtemp(path.join(tmpdir(),'ynx-v5-transport-'));binary=path.join(directory,'PUBLIC-transport.node');
 const raw=await fs.readFile(path.join(native,'original-product-device-v4-source-read.inc.mm'),'utf8'),first=raw.indexOf('static NSDictionary*DeviceV4ExpectedOriginal'),last=raw.indexOf('static void DeviceV4ReadEnvCleanup');assert.ok(first>0&&last>first);
 await fs.writeFile(path.join(directory,'PUBLIC-device-v4-read-intrinsics.inc.mm'),raw.slice(0,first)+raw.slice(last));
 const candidates=[path.resolve(path.dirname(process.execPath),'../../include/node'),'/Users/huangjiahao/Library/Caches/node-gyp/22.13.1/include/node'];let headers;
 for(const candidate of candidates)try{await fs.access(path.join(candidate,'node_api.h'));headers=candidate;break;}catch{}
 assert.ok(headers,'Normal Node NAPI headers required.');
 const r=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-Wno-unused-function','-Wno-unused-const-variable','-shared','-undefined','dynamic_lookup','-I'+headers,'-I'+native,'-I'+directory,path.join(fixture,'product-device-v5-transport-public.mm'),'-framework','Foundation','-o',binary],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);b=createRequire(import.meta.url)(binary);
 let sdkRoot=path.dirname(createRequire(import.meta.url).resolve('@ynx-chain/wallet-auth'));for(let i=0;i<4;i++){try{await fs.access(path.join(sdkRoot,'src/original-http-binary-v5-client-private.js'));break;}catch{sdkRoot=path.dirname(sdkRoot);}}
 sdkURL=pathToFileURL(path.join(sdkRoot,'src/original-http-binary-v5-client-private.js'));sdkPin=hash(await fs.readFile(sdkURL));
 const redirect=new URL('./native/product-device-v5-transport-sdk.fixture.mjs',import.meta.url).href,hook=registerHooks({resolve(name,context,next){if(name==='./original-auth-identity-fixed-native-image.js'&&context.parentURL?.startsWith(sdkURL.href))return {url:redirect,shortCircuit:true};return next(name,context);}});
 try{sdkPrivate=await import(sdkURL.href+'?PUBLIC-v5-transport');}finally{hook.deregister();}
});
after(async()=>{if(sdkURL)assert.equal(hash(await fs.readFile(sdkURL)),sdkPin,'Sole SDK private input changed during tests');if(directory)await fs.rm(directory,{recursive:true,force:true});});
function fixtureControl({view,bodyBinding,module:changeModule,context:chosenContext}={}){
 const parent=b.PUBLICSource(),peer=Object.freeze({}),abort=new AbortController(),context=Object.freeze({signal:abort.signal}),bytes=Buffer.from([0,1,0,255,13,10,42]),contentType='multipart/form-data; boundary=PUBLIC_transport-v5';
 const f={parent,peer,abort,context,bytes,contentType,counts:{read:0,current:0,context:0,recheck:0,binding:0},stale:false,cause:undefined,flight:null,lastView:null};
 let m={isOriginalHTTPBinaryTransportV5Peer:v=>v===peer,assertOriginalHTTPBinaryTransportV5Context(v,c){f.counts.context++;if(v!==peer||c!==context)throw Object.assign(Error('PUBLIC exact original context'),{code:'PUBLIC_CONTEXT'});if(abort.signal.aborted)throw abort.signal.reason;},assertOriginalHTTPBinaryTransportV5Current(v){f.counts.current++;assert.equal(v,peer);if(f.stale)throw f.cause;},readOriginalHTTPBinaryTransportV5ForNative(v){f.counts.read++;assert.equal(v,peer);const raw={version:'5',requestId:'req_PUBLIC_transport_12345',method:'POST',path:'/api/v1/ide/deployments',url:'https://ide.example/api/v1/ide/deployments',contentType,bodyOriginal:Buffer.from(bytes),expectedSlotRevision:'0',rollbackTarget:''};f.lastView=raw;return view?view(raw,f):Object.freeze(raw);},readOriginalHTTPBinaryTransportV5BodyDATAForNative(v){f.counts.binding++;assert.equal(v,peer);return bodyBinding?bodyBinding(bodyData(bytes,contentType),f):bodyData(bytes,contentType);},recheckOriginalHTTPBinaryTransportV5(v){f.counts.recheck++;assert.equal(v,peer);return f.flight??Promise.resolve();}};
 if(changeModule)m=changeModule(m,f);f.module=Object.freeze(m);f.t=b.PUBLICCapture(parent,f.module,peer,chosenContext?chosenContext(context):context);f.current=()=>f.t.assertCurrent(parent,peer,context);f.recheck=()=>f.t.recheck(parent,peer,context);f.borrow=()=>f.t.borrow(parent,peer,context);return f;
}
const only={skip:!applicable};
test('PUBLIC Native transport copies immutable original body and exact metadata without exposing body in normal status',only,()=>{
 const f=fixtureControl();assert.equal(f.t.status().firstPresent,false);assert.equal(f.t.status().captured,true);assert.deepEqual(f.borrow(),f.bytes);f.t.releaseBorrow();f.lastView.bodyOriginal.fill(77);assert.deepEqual(f.borrow(),f.bytes);f.t.releaseBorrow();
 const s=f.t.status();assert.equal(JSON.parse(s.metadata).requestId,'req_PUBLIC_transport_12345');assert.equal(Object.hasOwn(JSON.parse(s.metadata),'bodyOriginal'),false);assert.deepEqual(JSON.parse(s.binding),bodyData(f.bytes,f.contentType));f.current();assert.equal(f.t.close(),true);assert.equal(f.t.status().closed,true);
});
test('missing formal context callee fails NOT_SUPPLIED before reading any body',only,()=>{
 const f=fixtureControl({module:m=>{delete m.assertOriginalHTTPBinaryTransportV5Context;return m;}});assert.equal(f.t.status().first.code,'PRODUCT_DEVICE_V5_CONTEXT_NOT_SUPPLIED');assert.equal(f.t.status().captured,false);assert.equal(f.counts.read,0);assert.equal(f.t.close(),true);
});
test('copied context with the same signal is refused by exact private context callee',only,()=>{
 const f=fixtureControl({context:c=>Object.freeze({signal:c.signal})});assert.equal(f.t.status().first.code,'PUBLIC_CONTEXT');assert.equal(f.counts.read,0);assert.equal(f.t.close(),true);
});
for(const cause of [false,null,undefined,0,''])test('late current '+String(cause)+' retains owned original and exact falsy first through close',only,()=>{
 const f=fixtureControl({bodyBinding:(v,f)=>{f.stale=true;f.cause=cause;return v;}});const s=f.t.status();assert.equal(s.captured,true);assert.equal(s.firstPresent,true);assert.equal(s.first,cause);assert.ok(s.metadata&&s.binding);assert.throws(f.current,e=>e===cause);assert.equal(f.t.close(),true);assert.equal(f.t.status().first,cause);
});
test('abort after original read retains native body and original false reason without substituting cleanup error',only,()=>{
 const f=fixtureControl({bodyBinding:(v,f)=>{f.abort.abort(false);return v;}});assert.equal(f.t.status().captured,true);assert.equal(f.t.status().first,false);assert.equal(f.t.close(),true);assert.equal(f.t.status().first,false);
});
for(const field of ['parent','peer','context'])test('same native Source also requires the same JS '+field,only,()=>{
 const f=fixtureControl(),args=[f.parent,f.peer,f.context];args[{parent:0,peer:1,context:2}[field]]=field==='parent'?b.PUBLICSource():field==='peer'?Object.freeze({}):Object.freeze({signal:f.context.signal});const before=f.counts.current;assert.throws(()=>f.t.assertCurrent(...args),{code:'PRODUCT_DEVICE_V5_TRANSPORT_SAME_OWNER_REQUIRED'});assert.equal(f.counts.current,before);assert.equal(f.t.close(),true);
});
test('PUBLIC asynchronous recheck follows the original Promise before close can release references',only,async()=>{
 const f=fixtureControl();let resolve;f.flight=new Promise(r=>resolve=r);const p=f.recheck();assert.equal(f.t.status().pending,true);assert.equal(f.t.close(),false);assert.equal(f.t.status().closed,false);assert.equal(f.t.status().captured,true);resolve();await assert.rejects(p,{code:'PRODUCT_DEVICE_V5_TRANSPORT_RETIRED'});assert.equal(f.t.status().pending,false);assert.equal(f.t.close(),true);assert.equal(f.t.status().closeCause.code,'PRODUCT_DEVICE_V5_TRANSPORT_JOIN_PENDING');
});
for(const cause of [false,null,undefined,0,''])test('original recheck rejection '+String(cause)+' remains independent of close pending',only,async()=>{
 const f=fixtureControl();let reject;f.flight=new Promise((_,r)=>reject=r);const p=f.recheck();assert.equal(f.t.close(),false);reject(cause);await assert.rejects(p,e=>e===cause);assert.equal(f.t.status().first,cause);assert.equal(f.t.status().captured,true);assert.equal(f.t.close(),true);assert.equal(f.t.status().first,cause);
});
test('body borrow keeps immutable storage live for the whole synchronous use interval',only,()=>{
 const f=fixtureControl(),raw=f.borrow();assert.equal(f.t.close(),false);assert.deepEqual(raw,f.bytes);assert.equal(f.t.status().closed,false);f.t.releaseBorrow();assert.equal(f.t.close(),true);
});

test('Native transport refuses Proxy module, peer and context without touching their hooks',only,()=>{
 for(const field of ['module','peer','context']){const f=fixtureControl();let hooks=0;const values={module:f.module,peer:f.peer,context:f.context};values[field]=new Proxy(values[field],{get(){hooks++;throw Error('PUBLIC proxy hook')},getOwnPropertyDescriptor(){hooks++;throw Error('PUBLIC proxy hook')},ownKeys(){hooks++;throw Error('PUBLIC proxy hook')}});
  const t=b.PUBLICCapture(f.parent,values.module,values.peer,values.context);assert.equal(t.status().captured,false);assert.equal(hooks,0);assert.equal(t.close(),true);f.t.close();}
});
for(const variant of ['view-proxy','view-accessor','view-extra','view-not-frozen','view-wrong-path','view-wrong-url','view-zero-body','view-shared-body','view-resizable-body','view-detached-body'])test('Native transport '+variant+' fails closed without turning bytes into a peer',only,()=>{
 let hooks=0;const f=fixtureControl({view:raw=>{
  if(variant==='view-proxy')return new Proxy(raw,{ownKeys(){hooks++;throw Error('PUBLIC proxy')},getPrototypeOf(){hooks++;throw Error('PUBLIC proxy')}});
  if(variant==='view-accessor')Object.defineProperty(raw,'bodyOriginal',{enumerable:true,get(){hooks++;throw Error('PUBLIC getter')}});
  if(variant==='view-extra')raw.extra=true;if(variant==='view-not-frozen')return raw;if(variant==='view-wrong-path')raw.path='/other';if(variant==='view-wrong-url')raw.url='https://other.example/other';if(variant==='view-zero-body')raw.bodyOriginal=Buffer.alloc(0);
  if(variant==='view-shared-body')raw.bodyOriginal=Buffer.from(new SharedArrayBuffer(7));if(variant==='view-resizable-body')raw.bodyOriginal=Buffer.from(new ArrayBuffer(7,{maxByteLength:8}));
  if(variant==='view-detached-body'){const v=new Uint8Array(7);structuredClone(v.buffer,{transfer:[v.buffer]});raw.bodyOriginal=v;}
  return Object.freeze(raw);
 }});assert.equal(f.t.status().captured,false);assert.equal(f.t.status().firstPresent,true);assert.equal(hooks,0);assert.equal(f.t.close(),true);
});
for(const variant of ['extra','proxy','getter','binding-extra','wrong-digest','wrong-length','wrong-ctype'])test('late BodyDATA '+variant+' refuses but retains the native-owned original',only,()=>{
 let hooks=0;const f=fixtureControl({bodyBinding:raw=>{let d={...raw};if(variant==='extra')d.extra=true;if(variant==='proxy')return new Proxy(raw,{get(){hooks++;throw false},ownKeys(){hooks++;throw false}});if(variant==='getter')Object.defineProperty(d,'bodyBinding',{enumerable:true,get(){hooks++;throw false}});if(variant==='binding-extra')d.bodyBinding=Object.freeze({...raw.bodyBinding,extra:true});if(variant==='wrong-digest')d.bodyDigest='0'.repeat(64);if(variant==='wrong-length')d.bodyBinding=Object.freeze({...raw.bodyBinding,bytes:'6'});if(variant==='wrong-ctype')d.contentType='multipart/form-data; boundary=other';return Object.freeze(d);}});
 assert.equal(f.t.status().captured,true);assert.equal(f.t.status().firstPresent,true);assert.equal(hooks,0);assert.ok(f.t.status().metadata);assert.equal(f.t.close(),true);
});
test('fixed export accessor is refused without invoking a public function getter',only,()=>{
 let hooks=0;const f=fixtureControl({module:m=>{Object.defineProperty(m,'assertOriginalHTTPBinaryTransportV5Context',{enumerable:true,get(){hooks++;throw false}});return m;}});assert.equal(f.t.status().firstPresent,true);assert.equal(f.t.status().captured,false);assert.equal(hooks,0);assert.equal(f.t.close(),true);
});
test('ordinary Buffer or copied object cannot qualify as the private SDK peer',only,()=>{
 const f=fixtureControl();for(const peer of [Buffer.from(f.bytes),Object.freeze({requestId:'req_PUBLIC_transport_12345'})]){const t=b.PUBLICCapture(f.parent,f.module,peer,f.context);assert.equal(t.status().first.code,'PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_PEER_REQUIRED');assert.equal(t.status().captured,false);assert.equal(t.close(),true);}f.t.close();
});
test('original Promise recheck succeeds with post-current and never reads a thenable getter',only,async()=>{
 const f=fixtureControl();await f.recheck();assert.equal(f.counts.recheck,1);assert.equal(f.t.status().firstPresent,false);assert.equal(f.t.status().pending,false);let hooks=0;f.flight={get then(){hooks++;throw false}};await assert.rejects(f.recheck(),{code:'PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_RECHECK_PROMISE_REQUIRED'});assert.equal(hooks,0);assert.equal(f.t.close(),true);
});
test('same fixed recheck throwing false before returning a Promise is retained exactly',only,async()=>{
 const f=fixtureControl({module:m=>({...m,recheckOriginalHTTPBinaryTransportV5(){throw false;}})});await assert.rejects(f.recheck(),e=>e===false);assert.equal(f.t.status().first,false);assert.equal(f.t.status().pending,false);assert.equal(f.t.close(),true);
});
test('Promise own constructor getter and changed species never execute an untrusted continuation',only,async()=>{
 for(const which of ['own','species']){const f=fixtureControl();let hooks=0;f.flight=Promise.resolve();let saved;
  if(which==='own')Object.defineProperty(f.flight,'constructor',{get(){hooks++;throw false;}});else{saved=Object.getOwnPropertyDescriptor(Promise,Symbol.species);Object.defineProperty(Promise,Symbol.species,{configurable:true,get(){hooks++;throw false;}});}
  let rejected;try{rejected=f.recheck();}finally{if(saved)Object.defineProperty(Promise,Symbol.species,saved);}await assert.rejects(rejected,{code:'PRODUCT_DEVICE_V5_TRANSPORT_ORIGINAL_RECHECK_PROMISE_REQUIRED'});assert.equal(hooks,0);assert.equal(f.t.close(),true);
 }
});
test('captured intrinsics survive public Object/Promise monkeypatching without executing the replacement',only,async()=>{
 const f=fixtureControl(),frozen=Object.isFrozen,descriptor=Object.getOwnPropertyDescriptor,then=Object.getOwnPropertyDescriptor(Promise.prototype,'then');let hooks=0,p;
 try{Object.isFrozen=()=>{hooks++;throw false};Object.getOwnPropertyDescriptor=()=>{hooks++;throw false};Object.defineProperty(Promise.prototype,'then',{configurable:true,get(){hooks++;throw false}});f.current();p=f.recheck();}
 finally{Object.isFrozen=frozen;Object.getOwnPropertyDescriptor=descriptor;Object.defineProperty(Promise.prototype,'then',then);}await p;assert.equal(hooks,0);assert.equal(f.t.close(),true);
});
test('close unknown preserves original falsy failure, body and independent cleanup cause without retrying a selected delete',only,()=>{
 const f=fixtureControl({bodyBinding:(v,f)=>{f.stale=true;f.cause=false;return v;}});b.PUBLICFailDeleteOnce();assert.equal(f.t.close(),false);const first=f.t.status();assert.equal(first.first,false);assert.equal(first.captured,true);assert.equal(first.closed,false);assert.equal(first.closeCause.code,'PRODUCT_DEVICE_V5_TRANSPORT_CLOSE_UNKNOWN');const calls=b.PUBLICCounts().deleteCalls;assert.equal(f.t.close(),false);assert.equal(b.PUBLICCounts().deleteCalls,calls);assert.equal(f.t.status().first,false);
});
test('factory same native Source pointer borrows immutable NSData and a different object cannot consume it',only,()=>{
 const f=fixtureControl();assert.deepEqual(f.t.factoryBorrow(),f.bytes);assert.throws(()=>f.t.factoryWrongSource(),{code:'PRODUCT_DEVICE_V5_TRANSPORT_SAME_NATIVE_SOURCE_REQUIRED'});assert.equal(f.t.status().captured,true);assert.equal(f.t.close(),true);
});
async function realSDKPeer(t){
 const parent=b.PUBLICSource(),abort=new AbortController(),context=Object.freeze({signal:abort.signal}),body=Buffer.from([0,7,255,10,0,8]);let rejectProof;const counts={acquires:0,produces:0,retire:0,join:0,close:0},f={parent,abort,context,body,counts};
 const scope=Object.freeze({version:'5',targetURL:'https://ide.example/api/v1/ide/deployments',networkId:'a'.repeat(64),pkA:'11'.repeat(2592),pkB:'22'.repeat(64),identity:Object.freeze({sessionBinding:'b'.repeat(64),productId:'developer',clientId:'developer.macos',applicationId:'com.ynx.ide',bundleId:'com.ynx.ide',packageId:null,origin:'https://ide.example',callback:'ynx-ide://auth/callback',account:'ynx1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg36avh43',canonicalOwner:'0x'+'11'.repeat(20),deviceId:'PUBLIC-v5-device',deviceRegistrationId:'PUBLIC-v5-registration',deviceRegistrationRevision:'1',deviceRegistrationDigest:'c'.repeat(64)}),expiresAtMs:Date.now()+60000,maxBodyBytes:'1024'});
 const state={acquires:0,source:Object.freeze({readOriginalScopeDATA:()=>scope,assertCurrent(){},produceOriginalHTTPProofV5(peer,ctx){counts.produces++;f.peer=peer;assert.equal(ctx,context);return new Promise((_,reject)=>{rejectProof=reject;});},retire(){counts.retire++;},async join(){counts.join++;},async close(){counts.close++;}})};
 configurePUBLICHTTPV5Source(state);const client=await sdkPrivate.openOriginalHTTPBinaryClientV5();f.client=client;const packet=client.prepareOriginalRequest({requestId:'req_PUBLIC_native_peer_12345',expectedSlotRevision:'0',rollbackTarget:'',bodySnapshot:{bodyOriginal:body,contentType:'multipart/form-data; boundary=PUBLIC_real_peer'},abortContext:context});const proof=client.produceOriginalProof(packet);proof.catch(()=>{});assert.ok(f.peer);counts.acquires=state.acquires;
 t.after(async()=>{rejectProof(Error('PUBLIC capture-only proof stopped'));await assert.rejects(proof);await client.close();});return f;
}
test('normal sole SDK peer is read only through the formal exact-context callee or strictly remains NOT_SUPPLIED',only,async t=>{
 const f=await realSDKPeer(t);assert.equal(sdkPrivate.isOriginalHTTPBinaryTransportV5Peer(f.peer),true);const transport=b.PUBLICCapture(f.parent,sdkPrivate,f.peer,f.context);
 const supplied=typeof sdkPrivate.assertOriginalHTTPBinaryTransportV5Context==='function';
 if(!supplied){assert.equal(transport.status().first.code,'PRODUCT_DEVICE_V5_CONTEXT_NOT_SUPPLIED');assert.equal(transport.status().captured,false);}else{assert.equal(transport.status().firstPresent,false);assert.equal(transport.status().captured,true);assert.deepEqual(transport.borrow(f.parent,f.peer,f.context),f.body);transport.releaseBorrow();await transport.recheck(f.parent,f.peer,f.context);}
 assert.equal(transport.close(),true);assert.equal(f.counts.produces,1);assert.equal(sdkPrivate.isOriginalHTTPBinaryTransportV5Peer(Buffer.from(f.body)),false);t.diagnostic(JSON.stringify({actualSDKPrivatePeer:true,exactContextSupplied:supplied,privateInputSHA256:sdkPin,RootAdmission:false,SourceAdmission:false,math:false,HTTP:false}));
});
test('sole SDK same-signal copied context never substitutes for the original transport context',only,async t=>{
 const f=await realSDKPeer(t),copy=Object.freeze({signal:f.context.signal}),transport=b.PUBLICCapture(f.parent,sdkPrivate,f.peer,copy);assert.equal(transport.status().firstPresent,true);assert.equal(transport.status().captured,false);assert.equal(transport.close(),true);assert.equal(f.counts.produces,1);
});
test('Native transport exact body maximum is a copy bound and Source-specific authorization remains separate',only,()=>{
 const large=Buffer.alloc(68288512,7),f=fixtureControl({view:r=>Object.freeze({...r,bodyOriginal:large}),bodyBinding:()=>bodyData(large,'multipart/form-data; boundary=PUBLIC_transport-v5')});assert.equal(f.t.status().captured,true);assert.equal(f.t.status().firstPresent,false);assert.equal(f.t.close(),true);
 const overflow=fixtureControl({view:r=>Object.freeze({...r,bodyOriginal:Buffer.alloc(68288513)})});assert.equal(overflow.t.status().captured,false);assert.equal(overflow.t.status().firstPresent,true);assert.equal(overflow.t.close(),true);
});
test('PUBLIC worker environment cannot acquire the original main-thread transport',only,async()=>{
 const script=`const {Worker}=require('node:worker_threads');const w=new Worker(${JSON.stringify(`const {parentPort}=require('node:worker_threads');try{require(${JSON.stringify(binary)});parentPort.postMessage({refused:false});}catch(e){parentPort.postMessage({refused:true,code:e.code})}`)},{eval:true});w.once('message',v=>{if(!v.refused||v.code!=='PUBLIC_INTRINSICS_OR_ORIGINAL_ACTOR_REQUIRED')process.exitCode=9;else console.log('PUBLIC_V5_WORKER_REFUSED');});w.once('error',e=>{console.error(e);process.exitCode=8;});`;
 const r=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/WORKER_REFUSED/);
});
const gcModule=`function makeModule(body,ctype,flight){const binding=()=>({contentType:ctype,bodyDigest:require('node:crypto').createHash('sha256').update(body).digest('hex'),bodyBinding:Object.freeze({bytes:String(body.length),sha3_512:require('node:crypto').createHash('sha3-512').update(body).digest('hex'),sha512:require('node:crypto').createHash('sha512').update(body).digest('hex')})});return Object.freeze({isOriginalHTTPBinaryTransportV5Peer(){return true},assertOriginalHTTPBinaryTransportV5Context(){},assertOriginalHTTPBinaryTransportV5Current(){},readOriginalHTTPBinaryTransportV5ForNative(){return Object.freeze({version:'5',requestId:'req_PUBLIC_GC_transport_1234',method:'POST',path:'/api/v1/ide/deployments',url:'https://ide.example/api/v1/ide/deployments',contentType:ctype,bodyOriginal:Buffer.from(body),expectedSlotRevision:'0',rollbackTarget:''})},readOriginalHTTPBinaryTransportV5BodyDATAForNative(){return Object.freeze(binding())},recheckOriginalHTTPBinaryTransportV5(){return flight||Promise.resolve()}})};const tick=()=>new Promise(r=>setImmediate(r));async function gc(){for(let i=0;i<10;i++){await tick();global.gc();await tick();}}`;
for(const mode of ['ordinary','pending-orphan'])test('PUBLIC GC '+mode+' retains original parent/peer/context until safe release',only,()=>{
 const script=`const assert=require('node:assert/strict'),b=require(${JSON.stringify(binary)});${gcModule}(async()=>{let parent=b.PUBLICSource(),peer=Object.freeze({}),ctx=Object.freeze({signal:new AbortController().signal}),resolve;const flight=${mode==='pending-orphan'?'new Promise(r=>resolve=r)':'null'},m=makeModule(Buffer.from([1,0,255]),'multipart/form-data; boundary=PUBLIC_GC',flight);const wp=new WeakRef(parent),wn=new WeakRef(peer),wc=new WeakRef(ctx);let t=b.PUBLICCapture(parent,m,peer,ctx);assert.equal(t.status().firstPresent,false);${mode==='pending-orphan'?'const pending=t.recheck(parent,peer,ctx);pending.catch(()=>{});t.dropOwner();t=null;':''}parent=null;peer=null;ctx=null;await gc();assert.ok(wp.deref());assert.ok(wn.deref());assert.ok(wc.deref());${mode==='pending-orphan'?'resolve();await assert.rejects(pending,{code:"PRODUCT_DEVICE_V5_TRANSPORT_RETIRED"});':'assert.equal(t.close(),true);t=null;'}await gc();assert.equal(wp.deref(),undefined);assert.equal(wn.deref(),undefined);assert.equal(wc.deref(),undefined);console.log('PUBLIC_V5_GC_${mode}_PASS');})().catch(e=>{console.error(e);process.exitCode=8;});`;
 const r=spawnSync(process.execPath,['--expose-gc','-e',script],{encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/GC_.*_PASS/);
});
test('frozen non-enumerable view and BodyDATA fields are not exact original data records',only,()=>{
 const early=fixtureControl({view:raw=>{Object.defineProperty(raw,'requestId',{value:raw.requestId,enumerable:false});return Object.freeze(raw);}});assert.equal(early.t.status().captured,false);assert.equal(early.t.status().firstPresent,true);early.t.close();
 const late=fixtureControl({bodyBinding:raw=>{const d={...raw};Object.defineProperty(d,'bodyDigest',{value:raw.bodyDigest,enumerable:false});return Object.freeze(d);}});assert.equal(late.t.status().captured,true);assert.equal(late.t.status().firstPresent,true);late.t.close();
});
test('factory failure retains false without a pending JS exception that could hide an adopted partial',only,()=>{
 const f=fixtureControl();f.stale=true;f.cause=false;const result=f.t.factoryCheckDATA();assert.equal(result.current,false);assert.equal(result.pendingException,false);assert.equal(result.first,false);assert.equal(f.t.status().captured,true);assert.equal(f.t.close(),true);assert.equal(f.t.status().first,false);
});
