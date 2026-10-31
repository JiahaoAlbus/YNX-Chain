import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire,registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {configurePUBLICHTTPV5Source} from './native/product-device-v5-transport-sdk.fixture.mjs';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url)),native=path.join(root,'native'),here=path.join(root,'test/native'),only={skip:process.platform!=='darwin'};
let dir,b,module,modulePath,strictBinary,sdkRoot;
const scope=()=>({version:'5',targetURL:'https://public.invalid/api/v1/ide/deployments',networkId:'1'.repeat(64),pkA:'2'.repeat(5184),pkB:'3'.repeat(128),identity:{sessionBinding:'4'.repeat(64),productId:'ide',clientId:'PUBLIC',applicationId:'PUBLIC',bundleId:null,packageId:null,origin:'https://public.invalid',callback:'https://public.invalid/callback',account:'PUBLIC',canonicalOwner:'0x'+'5'.repeat(40),deviceId:'PUBLIC',deviceRegistrationId:'PUBLIC',deviceRegistrationRevision:'1',deviceRegistrationDigest:'6'.repeat(64)},expiresAtMs:Date.now()+600000,maxBodyBytes:'1024'});
const configure=(options={})=>b.PUBLICConfigure(JSON.stringify({scope:scope(),path:modulePath,...options}));
const open=(options={})=>{configure(options);return b.acquireOriginalProductSessionHTTPProofV5Source()};
const close=p=>{p.retire();p.join();p.close()};
const fixture=()=>module.PUBLICCreate();
before(async()=>{
 if(process.platform!=='darwin')return;
 dir=await fs.mkdtemp(path.join(tmpdir(),'ynx-v5-source-'));
 sdkRoot=path.dirname(createRequire(import.meta.url).resolve('@ynx-chain/wallet-auth'));for(let i=0;i<4;i++){try{await fs.access(path.join(sdkRoot,'native/original-auth-identity-source-authority.h'));break;}catch{sdkRoot=path.dirname(sdkRoot)}}
 const raw=await fs.readFile(path.join(native,'original-product-device-v4-source-read.inc.mm'),'utf8');
 await fs.writeFile(path.join(dir,'PUBLIC-device-v4-read-intrinsics.inc.mm'),raw.slice(0,raw.indexOf('static NSDictionary*DeviceV4ExpectedOriginal'))+raw.slice(raw.indexOf('static void DeviceV4ReadEnvCleanup')));
 // PUBLIC harness pins the actual supplied native API declaration so normal
 // CI does not depend on an external owner's working directory. This is the
 // declaration only; Source/OS/implementation remain explicit PUBLIC doubles.
 await fs.copyFile(path.join(sdkRoot,'native/original-auth-identity-source-authority.h'),path.join(dir,'original-auth-identity-source-authority.h'));
 const imageAPI=await fs.readFile(process.env.YNX_ORIGINAL_RUNTIME_IMAGE_PRIVATE_HEADER??path.join(here,'original-auth-runtime-image-private.PUBLIC-API.h'));
 assert.equal(createHash('sha256').update(imageAPI).digest('hex'),'a2930e74920697207ae8353d56dcfb9d7e0e3ef2174ddd7a631259dd01499336','Actual Auth native API declaration changed; reconcile the explicit PUBLIC harness.');
 await fs.writeFile(path.join(dir,'original-auth-runtime-image-private.h'),imageAPI);
 await fs.copyFile(path.join(native,'original-product-device-v5-factory.h'),path.join(dir,'original-product-device-v5-factory.h'));
 const source=await fs.readFile(path.join(native,'original-product-device-v5-source-stage.inc.mm'),'utf8'),refusal='return fail(p->env,p->first,"PRODUCT_DEVICE_V5_IMPLEMENTING_IMAGE_ADMISSION_NOT_SUPPLIED");';
 assert.equal(source.split(refusal).length,2,'One explicit production refusal, never a runtime hook.');
 const headers='/Users/huangjiahao/Library/Caches/node-gyp/22.13.1/include/node';
 for(const variant of ['strict','PUBLIC']){
  const target=path.join(dir,variant);await fs.mkdir(target);await fs.writeFile(path.join(target,'PUBLIC-source-stage.inc.mm'),variant==='strict'?source:source.replace(refusal,'return true; // PUBLIC OS/Root stand-in ONLY in generated test TU'));
  const binary=path.join(target,'PUBLIC-source.node');
  const r=spawnSync('/usr/bin/clang++',['-std=c++17','-fobjc-arc','-mmacosx-version-min=13.0','-Wall','-Wextra','-Werror','-Wno-incomplete-implementation','-Wno-deprecated-declarations','-Wno-unused-function','-Wno-unused-const-variable','-shared','-undefined','dynamic_lookup','-I'+target,'-I'+dir,'-I'+headers,'-I'+native,path.join(here,'product-device-v5-source-public.mm'),'-framework','Foundation','-o',binary],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
  if(variant==='strict')strictBinary=binary;else b=createRequire(import.meta.url)(binary);
 }
 modulePath=path.join(dir,'original-http-binary-v5-client-private.js');
 await fs.writeFile(modulePath,`const {createHash}=require('node:crypto');const peers=new WeakMap();
 const active=v=>{const r=peers.get(v);if(!r)throw Error('PUBLIC_PEER');if(r.failed)throw r.cause;if(r.context.signal.aborted)throw r.context.signal.reason;return r};
 exports.PUBLICCreate=()=>{const controller=new AbortController(),context=Object.freeze({signal:controller.signal}),peer=Object.freeze({}),r={context,controller,body:Buffer.from('PUBLIC'),contentType:'multipart/form-data; boundary=PUBLIC',failed:false,cause:undefined,recheck:()=>Promise.resolve()};peers.set(peer,r);return{peer,context,r}};
 exports.isOriginalHTTPBinaryTransportV5Peer=v=>peers.has(v);
 exports.assertOriginalHTTPBinaryTransportV5Context=(v,c)=>{if(active(v).context!==c)throw Object.assign(Error('PUBLIC_SAME_CONTEXT'),{code:'PUBLIC_SAME_CONTEXT'})};
 exports.assertOriginalHTTPBinaryTransportV5Current=v=>{active(v)};
 exports.recheckOriginalHTTPBinaryTransportV5=v=>active(v).recheck();
 exports.readOriginalHTTPBinaryTransportV5ForNative=v=>{const r=active(v);return Object.freeze({version:'5',requestId:'req_PUBLIC_source_12345',method:'POST',path:'/api/v1/ide/deployments',url:'https://public.invalid/api/v1/ide/deployments',contentType:r.contentType,bodyOriginal:Buffer.from(r.body),expectedSlotRevision:'1',rollbackTarget:''})};
 exports.readOriginalHTTPBinaryTransportV5BodyDATAForNative=v=>{const r=active(v),h=a=>createHash(a).update(r.body).digest('hex');return Object.freeze({contentType:r.contentType,bodyDigest:h('sha256'),bodyBinding:Object.freeze({bytes:String(r.body.length),sha3_512:h('sha3-512'),sha512:h('sha512')})})};`);
 module=createRequire(import.meta.url)(modulePath);
});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true})});
test('actual strict production stage refuses absent implementing-image release and retains the same native cleanup partial',only,()=>{
 const code=`const b=require(${JSON.stringify(strictBinary)});b.PUBLICConfigure(${JSON.stringify(JSON.stringify({scope:scope(),path:modulePath}))});let e;try{b.acquireOriginalProductSessionHTTPProofV5Source()}catch(x){e=x}if(e?.cause?.code!=='PRODUCT_DEVICE_V5_IMPLEMENTING_IMAGE_ADMISSION_NOT_SUPPLIED'||!e.partial)process.exit(2);e.partial.retire();e.partial.join();e.partial.close();if(b.PUBLICCounts().factories!==0||b.PUBLICCounts().imageCloses!==1||b.PUBLICCounts().sourceCloses!==1)process.exit(3);`;
 const r=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:15000});assert.equal(r.status,0,r.stdout+r.stderr);
});
test('zero-input acquisition, original tagged parent, and actual fixed native entry address',only,()=>{
 configure();const before=b.PUBLICCounts().acquires;assert.throws(()=>b.acquireOriginalProductSessionHTTPProofV5Source({}),{code:'PRODUCT_DEVICE_V5_SOURCE_ZERO_INPUT'});assert.equal(b.PUBLICCounts().acquires,before);const p=open();assert.equal(b.PUBLICCounts().actualAddressCaptured,1);assert.throws(()=>p.assertCurrent.call({}),{code:'PRODUCT_DEVICE_V5_ORIGINAL_SOURCE_REQUIRED'});assert.throws(()=>p.produceOriginalHTTPProofV5({}, {}, {}),{code:'PRODUCT_DEVICE_V5_SOURCE_EXACT_INPUTS'});close(p);
});
test('nonnil Source plus acquisition error is adopted before error and physically closed',only,()=>{
 configure({acquireError:true});let e;try{b.acquireOriginalProductSessionHTTPProofV5Source()}catch(x){e=x}assert.equal(e.cause.code,'PUBLIC_NATIVE_FAILURE');assert.ok(e.partial);const before=b.PUBLICCounts().sourceCloses;close(e.partial);assert.equal(b.PUBLICCounts().sourceCloses,before+1);
});
test('nonnil image lease plus NSError remains parent-owned until cleanup',only,()=>{
 configure({imageError:true});let e;try{b.acquireOriginalProductSessionHTTPProofV5Source()}catch(x){e=x}assert.equal(e.cause.code,'PRODUCT_DEVICE_V5_IMPLEMENTING_IMAGE_LEASE_NOT_SUPPLIED');const before=b.PUBLICCounts().imageCloses;close(e.partial);assert.equal(b.PUBLICCounts().imageCloses,before+1);
});
test('scope DATA has exact8, deep frozen identity, and a shrinking original expiry',only,()=>{
 const s=scope(),p=open({scope:s}),a=p.readOriginalScopeDATA();assert.equal(Reflect.ownKeys(a).length,8);assert.equal(Reflect.ownKeys(a.identity).length,14);assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.identity));configure({scope:{...s,expiresAtMs:s.expiresAtMs-1000}});assert.equal(p.readOriginalScopeDATA().expiresAtMs,s.expiresAtMs-1000);configure({scope:s});assert.equal(p.readOriginalScopeDATA().expiresAtMs,s.expiresAtMs-1000);close(p);
});
test('selected key/pair or full identity change fails closed',only,()=>{
 for(const key of ['pkA','identity']){const s=scope(),p=open({scope:s});configure({scope:{...s,[key]:key==='pkA'?'7'.repeat(5184):{...s.identity,deviceId:'changed'}}});assert.throws(()=>p.assertCurrent(),{code:'PRODUCT_DEVICE_V5_SCOPE_CHANGED'});close(p)}
});
test('source extra fields and wrong V4 version do not qualify V5',only,()=>{
 for(const s of [{...scope(),extra:true},{...scope(),version:'4'}]){configure({scope:s});let e;try{b.acquireOriginalProductSessionHTTPProofV5Source()}catch(x){e=x}assert.equal(e.cause.code,'PRODUCT_DEVICE_V5_SCOPE_EXACT8_REQUIRED');close(e.partial)}
});
test('await original recheck before exactly one factory call and retain public originals through close',only,async()=>{
 const p=open(),f=fixture();let resolve;f.r.recheck=()=>new Promise(r=>resolve=r);const before=b.PUBLICCounts().factories,flight=p.produceOriginalHTTPProofV5(f.peer,f.context);assert.equal(b.PUBLICCounts().factories,before);resolve();const op=await flight;assert.equal(b.PUBLICCounts().factories,before+1);assert.deepEqual(op.readOriginalMember(),Buffer.from([5,0,1,2]));assert.equal(op.readOriginalUnsigned(),'{"PUBLIC":true}');assert.equal(op.readOriginalStatusDATA().reportedMemberLengthExact,'98303');assert.equal(op.assertCurrent(),undefined);close(op);assert.deepEqual(op.readOriginalMember(),Buffer.from([5,0,1,2]));assert.equal(op.readOriginalStatusDATA().closed,true);close(p);
});
test('factory partial and post-current failure retain raw member, unsigned and status before interpretation',only,async()=>{
 for(const opts of [{factoryError:true},{factoryStale:true}]){const p=open(opts),f=fixture(),op=await p.produceOriginalHTTPProofV5(f.peer,f.context);assert.deepEqual(op.readOriginalMember(),Buffer.from([5,0,1,2]));assert.equal(op.readOriginalUnsigned(),'{"PUBLIC":true}');const status=op.readOriginalStatusDATA();assert.equal(status.originalsCaptured,true);assert.equal(status.primitiveCalled,true);assert.equal(status.persistenceFailure,true);assert.throws(()=>op.assertCurrent());close(op);close(p)}
});
for(const reason of [false,0,null,undefined,''])test('exact recheck rejection is retained: '+String(reason),only,async()=>{
 const p=open(),f=fixture(),before=b.PUBLICCounts().factories;f.r.recheck=()=>Promise.reject(reason);const op=await p.produceOriginalHTTPProofV5(f.peer,f.context);const s=op.readOriginalStatusDATA();assert.equal(s.firstCausePresent,true);assert.equal(s.firstCause,reason);let caught=false;try{op.assertCurrent()}catch(e){caught=true;assert.equal(e,reason)}assert.ok(caught);assert.equal(b.PUBLICCounts().factories,before);close(op);close(p);
});
test('same signal in copied context and copied peer cannot qualify the original transport',only,async()=>{
 for(const kind of ['context','peer']){const p=open(),f=fixture(),op=await p.produceOriginalHTTPProofV5(kind==='peer'?{}:f.peer,kind==='context'?Object.freeze({signal:f.context.signal}):f.context);assert.equal(op.readOriginalStatusDATA().firstCausePresent,true);assert.equal(op.readOriginalStatusDATA().factoryEntered,false);close(op);close(p)}
});
test('retire while recheck pending retains child fence and prevents factory until safely drained',only,async()=>{
 const p=open(),f=fixture();let resolve;f.r.recheck=()=>new Promise(r=>resolve=r);const before=b.PUBLICCounts(),flight=p.produceOriginalHTTPProofV5(f.peer,f.context);p.retire();assert.throws(()=>p.join(),{code:'PRODUCT_DEVICE_V5_PARENT_JOIN_PENDING'});assert.throws(()=>p.close(),{code:'PRODUCT_DEVICE_V5_PARENT_JOIN_PENDING'});assert.equal(b.PUBLICCounts().sourceCloses,before.sourceCloses);resolve();const op=await flight;assert.equal(op.readOriginalStatusDATA().factoryEntered,false);close(op);close(p);assert.equal(b.PUBLICCounts().factories,before.factories);
});
test('core cleanup UNKNOWN retains parent loan and never retries a selected core close',only,async()=>{
 const p=open({coreCloseFailure:true}),f=fixture(),op=await p.produceOriginalHTTPProofV5(f.peer,f.context);op.retire();op.join();assert.throws(()=>op.close(),{code:'PUBLIC_CORE_CLOSE_UNKNOWN'});const before=b.PUBLICCounts();assert.throws(()=>op.close(),{code:'PUBLIC_CORE_CLOSE_UNKNOWN'});assert.equal(b.PUBLICCounts().coreCloses,before.coreCloses);assert.throws(()=>p.close(),{code:'PRODUCT_DEVICE_V5_PARENT_JOIN_PENDING'});assert.equal(b.PUBLICCounts().sourceCloses,before.sourceCloses);
});
test('selected reference deletion failure quarantines child without retry or releasing parent',only,async()=>{
 const p=open(),f=fixture(),op=await p.produceOriginalHTTPProofV5(f.peer,f.context);op.retire();op.join();b.PUBLICFailDeleteOnce();assert.throws(()=>op.close());const before=b.PUBLICCounts();assert.throws(()=>op.close());assert.equal(b.PUBLICCounts().deleteCalls,before.deleteCalls);assert.throws(()=>p.close(),{code:'PRODUCT_DEVICE_V5_PARENT_JOIN_PENDING'});assert.equal(b.PUBLICCounts().sourceCloses,before.sourceCloses);
});
test('parent Source join pending is recoverable and physical close failure is sticky',only,()=>{
 const p=open();configure({joinPending:true});p.retire();assert.throws(()=>p.close(),{code:'PRODUCT_DEVICE_V5_PARENT_JOIN_PENDING'});configure({sourceCloseFailure:true});assert.throws(()=>p.close(),{code:'PUBLIC_NATIVE_FAILURE'});const before=b.PUBLICCounts().sourceCloses;assert.throws(()=>p.close(),{code:'PUBLIC_NATIVE_FAILURE'});assert.equal(b.PUBLICCounts().sourceCloses,before);
});
test('image close UNKNOWN prevents Source join/close and keeps its exact debt',only,()=>{
 const p=open({imageCloseFailure:true}),before=b.PUBLICCounts();assert.throws(()=>p.close(),{code:'PRODUCT_DEVICE_V5_IMPLEMENTING_IMAGE_CLOSE_UNKNOWN'});assert.throws(()=>p.close(),{code:'PRODUCT_DEVICE_V5_IMPLEMENTING_IMAGE_CLOSE_UNKNOWN'});assert.equal(b.PUBLICCounts().imageCloses,before.imageCloses+1);assert.equal(b.PUBLICCounts().sourceCloses,before.sourceCloses);
});
test('formal sole SDK private WeakMap namespace reaches the same fixed Native stage; PUBLIC outputs remain UNKNOWN and are never sent',only,async t=>{
 const actualPath=path.join(sdkRoot,'src/original-http-binary-v5-client-private.js'),bytes=await fs.readFile(actualPath),pin=createHash('sha256').update(bytes).digest('hex');assert.equal(pin,'0ed0751df3b51f44eb3643b5802a6892c9fd375168a8006ad17a1a71ed0ef23f');
 const hook=registerHooks({resolve(name,context,next){if(name==='./original-auth-identity-fixed-native-image.js'&&context.parentURL===pathToFileURL(actualPath).href)return{url:new URL('./native/product-device-v5-transport-sdk.fixture.mjs',import.meta.url).href,shortCircuit:true};return next(name,context)}});
 try{const actual=await import(pathToFileURL(actualPath).href),p=open({path:actualPath}),state={source:p,acquires:0};configurePUBLICHTTPV5Source(state);const client=await actual.openOriginalHTTPBinaryClientV5(),context=Object.freeze({signal:new AbortController().signal}),packet=client.prepareOriginalRequest({requestId:'req_PUBLIC_source_actual_12345',expectedSlotRevision:'0',rollbackTarget:'',bodySnapshot:{bodyOriginal:Buffer.from([0,7,255,0]),contentType:'multipart/form-data; boundary=PUBLIC_actual'},abortContext:context}),before=b.PUBLICCounts().factories;
  await assert.rejects(client.produceOriginalProof(packet));assert.equal(b.PUBLICCounts().factories,before+1);const raw=client.readOriginalRequestDATA(packet);assert.deepEqual(raw.memberOriginal,Buffer.from([5,0,1,2]));assert.equal(raw.unsignedOriginal,'{"PUBLIC":true}');assert.equal(raw.unknown,true);assert.equal(raw.httpEntered,false);const entered=b.PUBLICCounts().factories;await assert.rejects(client.produceOriginalProof(packet));assert.equal(b.PUBLICCounts().factories,entered);await client.close();assert.equal(client.status().physicalSourceClosed,true);assert.equal(state.acquires,1);
  const p2=open({path:actualPath});configurePUBLICHTTPV5Source({source:p2,acquires:0});const client2=await actual.openOriginalHTTPBinaryClientV5(),controller=new AbortController(),ctx2=Object.freeze({signal:controller.signal}),packet2=client2.prepareOriginalRequest({requestId:'req_PUBLIC_source_abort_12345',expectedSlotRevision:'0',rollbackTarget:'',bodySnapshot:{bodyOriginal:Buffer.from('PUBLIC'),contentType:'multipart/form-data; boundary=PUBLIC_abort'},abortContext:ctx2}),beforeAbort=b.PUBLICCounts().factories,flight2=client2.produceOriginalProof(packet2);controller.abort(false);await assert.rejects(flight2,e=>e===false);assert.equal(b.PUBLICCounts().factories,beforeAbort);assert.equal(client2.readOriginalRequestDATA(packet2).unknown,true);assert.equal(client2.readOriginalRequestDATA(packet2).httpEntered,false);await client2.close();
  t.diagnostic(JSON.stringify({sameCanonicalSDKNamespace:true,actualSDKAbortFalseRetained:true,privateSHA256:pin,PUBLICSourceDouble:true,PUBLICFactoryDouble:true,SourceAdmission:false,NativeAdmission:false,math:false,HTTP:false}));
 }finally{hook.deregister();assert.equal(createHash('sha256').update(await fs.readFile(actualPath)).digest('hex'),pin)}
});
