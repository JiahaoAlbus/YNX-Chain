import test,{after,mock}from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
import{createHash}from'node:crypto';
import Module,{createRequire,syncBuiltinESMExports}from'node:module';
const base=process.env.AUTH_PRELOAD_PUBLIC_BASE,template=process.env.AUTH_PRELOAD_TEMPLATE,owned=process.env.AUTH_PRELOAD_OWNED;
const {createScopeFixtureContext}=await import(pathToFileURL(template+'/test/fixtures/native-dispatch-public.fixture.mjs'));
const {inspectPQAuthorizationView}=await import(pathToFileURL(template+'/src/pq-wallet-policy.js'));
const {decodeMember,encodeMember}=await import(pathToFileURL(createRequire(template+'/package.json').resolve('@ynx/batch-v01-candidate')));
const ctx=createScopeFixtureContext();after(()=>ctx.close());let wall=ctx.at;mock.method(Date,'now',()=>wall);
const sha=b=>createHash('sha256').update(b).digest('hex'),pin=p=>({path:p,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))});let serial=0;
const key=Symbol.for('YNX.PUBLIC.runtime-image-source.transport.only');
const required=['package.json','native/original-auth-identity-source-verifier.mjs','native/original-ide-auth-proof-dispatch.mjs','native/original-auth-identity-v2-contract.mjs','src/auth-identity-verification.js','src/pq-wallet-policy.js','src/pq-wallet-authorization.js','native/original-auth-source-v2-dispatch.mjs','native/original-auth-identity-source-v2-verifier.mjs','native/original-auth-runtime-image-binding-v1.mjs','src/original-auth-runtime-image-source-v1.js','src/original-auth-runtime-image-files-v1.js','src/original-auth-identity-fixed-native-image.js','src/original-http-binary-v5-client-private.js'];
function publicOS(source){
 let s=source.replaceAll('s.uid!==0','(s.uid!==0&&s.uid!==process.getuid())').replaceAll('f.stat.uid!==0','(f.stat.uid!==0&&f.stat.uid!==process.getuid())');
 assert.notEqual(s,source);return s;
}
function raw(owner,height='5'){
 const role=['root','profile','current','subject'].find(r=>ctx.registrations[r].owner===owner),r=inspectPQAuthorizationView(ctx.registrations[role]).activeRecord;
 return{owner,executionHeight:height,ledgerNonce:'1',algorithmVersion:'YNX-BATCH/v0.1',enabled:true,records:[{algorithmVersion:'YNX-BATCH/v0.1',owner,pkA:r.pkA,pkB:r.pkB,revision:'1',registeredAt:'2',activeFrom:'3',ledgerNonce:'1'}],policyVersion:'YNX-ACCOUNT-POLICY/v1',networkId:ctx.network,enableAt:'1',activeRevision:'1'};
}
async function setup(options={}){
 wall=ctx.at;const caseRoot=base+'/case-'+(++serial),root=caseRoot+'/packages/wallet-auth';fs.mkdirSync(path.dirname(root),{recursive:true,mode:0o700});fs.cpSync(template,root,{recursive:true});
 fs.mkdirSync(caseRoot+'/apps/wallet-desktop/native',{recursive:true,mode:0o700});const image=caseRoot+'/apps/wallet-desktop/native/original-auth-identity.node';fs.writeFileSync(image,'PUBLIC ONLY not executable native image\n',{mode:0o600});
 const f=ctx.fixture(options.kind??'http'),plain=f.credentials();const entry={sourceId:plain.p.sourceId,instanceId:plain.p.instanceId,recordPath:root+'/native/PUBLIC-original-four-record.json',policy:plain.policy,node:{origin:'https://PUBLIC.invalid',spki:'e'.repeat(64),nativeChainId:'6423'}};
 let source=fs.readFileSync(owned+'/original-auth-runtime-image-source-v1.js','utf8');source=source.replace('const released=Object.freeze([]),','const released=Object.freeze('+JSON.stringify([entry])+'),');
 source=source.replace("from '../native/original-auth-source-v2-dispatch.mjs'","from '../native/PUBLIC-native-dispatch-wrapper.mjs'");if(!options.productionUID)source=publicOS(source);
 fs.writeFileSync(root+'/src/original-auth-runtime-image-source-v1.js',source);
 const files=fs.readFileSync(owned+'/original-auth-runtime-image-files-v1.js','utf8');fs.writeFileSync(root+'/src/original-auth-runtime-image-files-v1.js',options.productionUID?files:publicOS(files));
 const manifest={version:'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1',files:required.map(p=>({...pin(root+'/'+p),path:p})).sort((a,b)=>a.path<b.path?-1:1)};options.manifest?.(manifest);
 fs.writeFileSync(root+'/native/original-ide-auth-runtime-manifest.json',JSON.stringify(manifest));
 const privatePath=root+'/src/original-http-binary-v5-client-private.js',facts={version:'1',normalPackageRoot:root,fixedLoader:pin(root+'/src/original-auth-identity-fixed-native-image.js'),runtimeManifest:pin(root+'/native/original-ide-auth-runtime-manifest.json'),implementingImage:pin(image),privateModule:{...pin(privatePath),uri:pathToFileURL(privatePath).href}};
 const c=f.credentials(p=>{p.selection.runtimeImageBindingV1=structuredClone(facts);options.profile?.(p)},options.current);
 fs.writeFileSync(entry.recordPath,ctx.canonical({rootRaw:c.rootRaw,enrollmentRaw:c.enrollmentRaw,profileRaw:c.profileRaw,headRaw:c.currentRaw}),{mode:0o600});
 let calls=0;const seam={c,facts,root,image,entry,owner:null,pause:null,afterMath:null,throwCause:undefined,throwSelected:false,role:null,currentEdit:null,seen:[],get:async(_node,owner)=>{calls++;seam.seen.push(owner);const r=raw(owner);if(seam.role===['root','profile','current','subject'].find(k=>ctx.registrations[k].owner===owner))r.enabled=false;return r;},fetch:async(_url,_spki,digest,nonce)=>{assert.equal(digest,ctx.sha(c.profileRaw));if(seam.throwSelected)throw seam.throwCause;if(seam.pause)await seam.pause;const body={...c.c,nonce};seam.currentEdit?.(body);return ctx.signCurrentForPublicFixture(body,c.policy.signatureContract.currentFrame);}};
 globalThis[key]=seam;
 const api=await import(pathToFileURL(root+'/src/original-auth-runtime-image-source-v1.js'));
 return{...seam,api,seam,async acquire(){globalThis[key]=seam;const r=await api.acquireOriginalAuthRuntimeImageAdmissionV1();seam.owner=r.owner;return r;},calls:()=>calls};
}
async function success(options){const x=await setup(options),r=await x.acquire();assert.equal(r.error,null,r.error?.cause?.stack??r.error?.stack);assert(r.owner);return{x,owner:r.owner};}
test('normal source module import/Root0 and zero-input never load Native',async()=>{
 const api=await import(pathToFileURL(template+'/src/original-auth-runtime-image-source-v1.js'));
 const r=await api.acquireOriginalAuthRuntimeImageAdmissionV1();assert.equal(r.owner,null);assert.equal(r.error.code,'AUTH_RUNTIME_IMAGE_ADMISSION_NOT_SUPPLIED');assert.throws(()=>api.assertOriginalAuthRuntimeImagePreLoadCurrentV1(),/NOT_SUPPLIED/);await assert.rejects(api.acquireOriginalAuthRuntimeImageAdmissionV1({approved:true}),/ZERO_INPUT/);
 const loader=await import(pathToFileURL(template+'/src/original-auth-identity-fixed-native-image.js'));let loads=0;const old=Module._extensions['.node'];Module._extensions['.node']=()=>{loads++;throw Error('PUBLIC loader must not run')};try{assert.throws(()=>loader.loadOriginalAuthIdentityNativeImage(),/NOT_SUPPLIED/);assert.equal(loads,0);}finally{Module._extensions['.node']=old;}
});
test('actual SDK guarded loader + normal same URI private WeakMap: no reconstructed peer or Native permission',async()=>{
 const{x,owner}=await success();let nativePeer,nativeBody,readPeer,loads=0;const sourceScope=x.c.p.selection.productSessionHTTPProofV5,session=JSON.parse(sourceScope.sessionOriginal),registration=JSON.parse(sourceScope.registrationOriginal),keys=['sessionBinding','productId','clientId','applicationId','bundleId','packageId','origin','callback','account','canonicalOwner','deviceId','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest'];
 const identity=Object.fromEntries(keys.map(k=>[k,k==='canonicalOwner'?sourceScope.expected.canonicalOwner:session[k]]));const events=[];
 const nativeSource=Object.freeze({readOriginalScopeDATA:()=>({version:'5',targetURL:sourceScope.targetURL,networkId:sourceScope.expected.networkId,pkA:registration.pkA,pkB:registration.pkB,identity,expiresAtMs:108000,maxBodyBytes:'1024'}),assertCurrent(){},produceOriginalHTTPProofV5(peer){nativePeer=peer;nativeBody=readPeer(peer).bodyOriginal;throw 0;},retire(){events.push('retire')},join(){events.push('join')},close(){events.push('close')}});
 const old=Module._extensions['.node'];Module._extensions['.node']=(module,filename)=>{loads++;assert.equal(filename,x.image);module.exports=Object.freeze({acquireOriginalProductSessionHTTPProofV5Source:()=>nativeSource});};
 try{const uri=pathToFileURL(x.root+'/src/original-http-binary-v5-client-private.js').href,bridge=await import(uri),copy=await import(uri+'?PUBLIC_separate_instance');readPeer=bridge.readOriginalHTTPBinaryTransportV5ForNative;assert.equal(uri,x.facts.privateModule.uri);const client=await bridge.openOriginalHTTPBinaryClientV5();assert.equal(loads,1);const abortContext=Object.freeze({signal:new AbortController().signal}),packet=client.prepareOriginalRequest({requestId:'req_PUBLIC_PRELOAD_0001',expectedSlotRevision:'0',rollbackTarget:'',bodySnapshot:{bodyOriginal:Buffer.from('PUBLIC multipart final bytes'),contentType:'multipart/form-data; boundary=PUBLIC_boundary'},abortContext});let failed;try{await client.produceOriginalProof(packet)}catch(cause){failed={cause}}assert.equal(failed?.cause,0);assert(nativePeer&&bridge.isOriginalHTTPBinaryTransportV5Peer(nativePeer));assert.equal(copy.isOriginalHTTPBinaryTransportV5Peer(nativePeer),false);assert.equal(bridge.isOriginalHTTPBinaryTransportV5Peer({...nativePeer}),false);assert.equal(nativeBody.toString(),'PUBLIC multipart final bytes');assert.throws(()=>bridge.readOriginalHTTPBinaryTransportV5ForNative(nativePeer),/RESOURCE_RETIRED/);await client.close();assert(events.includes('close'));await owner.close();const loader=await import(pathToFileURL(x.root+'/src/original-auth-identity-fixed-native-image.js'));assert.throws(()=>loader.loadOriginalAuthIdentityNativeImage(),/RETIRED/);assert.equal(loads,1);}finally{Module._extensions['.node']=old;}
});
test('both actual signed families traverse four-role dual-PQ current, real filesystem closure and guard',async()=>{
 for(const kind of['http','finalization']){const{x,owner}=await success({kind});assert.equal(new Set(x.seam.seen).size,4);assert.equal(x.seam.seen.length,8);assert(Object.isFrozen(owner));assert.equal(x.api.assertOriginalAuthRuntimeImageAdmissionOwnerV1(owner),owner);assert.throws(()=>x.api.assertOriginalAuthRuntimeImageAdmissionOwnerV1({...owner}),/ORIGINAL_OWNER/);x.api.assertOriginalAuthRuntimeImagePreLoadCurrentV1();const obs=owner.readOriginalObservationDATA();assert.equal(obs.original.projection.profileDigest,ctx.sha(x.c.profileRaw));obs.original.projection.status='wrong';assert.equal(owner.readOriginalObservationDATA().original.projection.status,'active');await owner.close();assert.throws(()=>x.api.assertOriginalAuthRuntimeImagePreLoadCurrentV1(),/RETIRED/);}
});
test('production UID0 gate denies same PUBLIC files, never self-admits a user install',async()=>{const x=await setup({productionUID:true}),r=await x.acquire();assert(r.owner&&r.error);assert.match(r.error.cause.code,/PARENT|RECORD/);await r.owner.close();});
test('manifest missing/extra/duplicate/traversal/bytes/hash controls hold actual files and fail closed',async()=>{
 const edits=[m=>m.files.splice(m.files.findIndex(p=>p.path==='src/original-auth-runtime-image-files-v1.js'),1),m=>{m.approved=true},m=>m.files.splice(1,0,{...m.files[0]}),m=>{m.files[0].path='../outside'},m=>{m.files[0].bytes++},m=>{m.files[0].sha256='0'.repeat(64)}];
 for(const manifest of edits){const x=await setup({manifest}),r=await x.acquire();assert(r.owner&&r.error);assert.match(r.error.cause.code,/AUTH_RUNTIME_FILES_/);await r.owner.close();}
});
test('signed namespace/imagehash/privateURI mismatch cannot qualify real independently observed build',async()=>{
 for(const edit of[b=>b.implementingImage.sha256='0'.repeat(64),b=>b.privateModule.uri+='?alias',b=>b.normalPackageRoot+='/other']){const x=await setup({profile:p=>edit(p.selection.runtimeImageBindingV1)}),r=await x.acquire();assert(r.owner&&r.error);await r.owner.close();}
});
test('each original role/current revoke still fails actual math/policy path',async()=>{
 for(const role of['root','profile','current','subject']){const x=await setup();x.seam.role=role;const r=await x.acquire();assert(r.error&&r.owner);await r.owner.close();}
 const x=await setup({current:c=>{c.status='revoked'}}),r=await x.acquire();assert(r.error&&r.owner);await r.owner.close();
});
test('either actual profile PQ half corruption fails through normal Source, not a stub verdict',async()=>{
 for(const field of['sigmaA','sigmaB']){const x=await setup(),record=JSON.parse(fs.readFileSync(x.entry.recordPath,'utf8')),envelope=JSON.parse(record.profileRaw),member=decodeMember(Buffer.from(envelope.member,'base64url'));member.certificate[field][0]^=1;envelope.member=Buffer.from(encodeMember(member)).toString('base64url');record.profileRaw=ctx.canonical(envelope);fs.writeFileSync(x.entry.recordPath,ctx.canonical(record));const r=await x.acquire();assert(r.error&&r.owner);await r.owner.close();}
});
test('mechanical IO class and prototype frozen; loaded comparison stays DATA and sticky falsy close does not retry',async()=>{
 const{x,owner}=await success();const{OriginalAuthRuntimeImageFilesV1:Files}=await import(pathToFileURL(x.root+'/src/original-auth-runtime-image-files-v1.js'));assert(Object.isFrozen(Files)&&Object.isFrozen(Files.prototype));const files=new Files(x.facts,x.c.policy.signatureContract.purpose);assert(Object.isFrozen(files));
 let imageFD;const originalOpen=fs.openSync,originalClose=fs.closeSync;fs.openSync=(...args)=>{const fd=originalOpen(...args);if(args[0]===x.image)imageFD=fd;return fd;};syncBuiltinESMExports();try{files.open();}finally{fs.openSync=originalOpen;syncBuiltinESMExports();}
 const stat=fs.statSync(x.image),actual={path:x.image,device:String(stat.dev),inode:String(stat.ino),bytes:stat.size,sha256:x.facts.implementingImage.sha256,privateModuleURI:x.facts.privateModule.uri};const comparison=files.compareLoadedImageDATA(actual);assert.equal(comparison.matches,true);assert.equal(comparison.SourceAdmission,false);assert.throws(()=>files.compareLoadedImageDATA({...actual,inode:'0'}),/MISMATCH/);
 let calls=0;fs.closeSync=fd=>{if(fd===imageFD){calls++;throw false;}return originalClose(fd);};syncBuiltinESMExports();try{let first,second;try{files.close()}catch(e){first={e}}try{files.close()}catch(e){second={e}}assert.equal(first?.e,false);assert.equal(second?.e,false);assert.equal(calls,1);}finally{fs.closeSync=originalClose;syncBuiltinESMExports();}await owner.close();
});
test('symlink/hardlink/substitution/inplace mutation cannot retain preload permission',async()=>{
 for(const kind of['symlink','hardlink','substitute','mutate']){const{x,owner}=await success();const p=x.root+'/src/original-http-binary-v5-client-private.js';if(kind==='mutate'){const fd=fs.openSync(p,'r+');fs.writeSync(fd,Buffer.from('X'),0,1,0);fs.closeSync(fd);}else if(kind==='hardlink')fs.linkSync(p,p+'.link');else{fs.renameSync(p,p+'.old');if(kind==='symlink')fs.symlinkSync(p+'.old',p);else fs.writeFileSync(p,'foreign');}assert.throws(()=>owner.assertPreLoadCurrent(),/CHANGED/);await owner.close();}
});
test('record bytes/parent namespace mutation denied and actual late returned current retained',async()=>{
 const{x,owner}=await success();x.seam.afterMath=()=>fs.appendFileSync(x.entry.recordPath,' ');await assert.rejects(owner.recheck(),/RECORD_CHANGED/);assert.equal(typeof owner.readOriginalObservationDATA().original.currentRaw,'string');await owner.close();
});
test('unrelated sibling directory changes do not masquerade as held parent identity substitution',async()=>{const{x,owner}=await success();fs.mkdirSync(x.root+'/PUBLIC-unrelated-sibling',{mode:0o700});owner.assertPreLoadCurrent();await owner.close();});
test('pre-crypto observed file/parent partials remain owned until cleanup, no finally masks first failure',async()=>{
 const x=await setup({profile:p=>{p.selection.runtimeImageBindingV1.implementingImage.sha256='0'.repeat(64)}}),opened=new Set(),closed=new Map(),open=fs.openSync,close=fs.closeSync;fs.openSync=(...args)=>{const fd=open(...args);opened.add(fd);return fd;};fs.closeSync=fd=>{closed.set(fd,(closed.get(fd)??0)+1);return close(fd);};syncBuiltinESMExports();try{const r=await x.acquire();assert(r.owner&&r.error);assert.match(r.error.cause.code,/SIGNED_BINDING/);assert(opened.size>8);assert.equal(closed.size,0);await r.owner.close();assert.equal(closed.size,opened.size);assert([...closed.values()].every(n=>n===1));assert(r.owner.readOriginalObservationDATA().original.currentRaw);}finally{fs.openSync=open;fs.closeSync=close;syncBuiltinESMExports();}
});
test('one original Promise serializes pending current watermark, retirement waits then closes once',async()=>{
 const{x,owner}=await success();let release;const pending=new Promise(r=>{release=r});x.seam.pause=pending;const first=owner.recheck(),second=owner.recheck();assert.equal(first,second);const close=owner.close();assert.equal(owner.close(),close);let closed=false;close.then(()=>{closed=true});await Promise.resolve();assert.equal(closed,false);release();await assert.rejects(first,/RETIRED/);await close;assert.equal(owner.statusDATA().pending,0);assert(owner.readOriginalObservationDATA().original.currentRaw);
});
test('falsy first cause preserved, unresolved active partial never automatically replaced',async()=>{
 for(const cause of[false,0,null,undefined]){const x=await setup();x.seam.throwSelected=true;x.seam.throwCause=cause;const r=await x.acquire();assert(r.owner&&r.error);assert.equal(r.error.cause,cause);assert.equal(r.owner.statusDATA().firstCausePresent,true);assert.equal(r.owner.statusDATA().firstCause,cause);const again=await x.acquire();assert.equal(again.owner,r.owner);assert.equal(again.error.cause,cause);await r.owner.close();}
});
test('normal owner sticky close preserves falsy cleanup cause and never retries the uncertain FD',async()=>{
 const x=await setup();let imageFD;const open=fs.openSync,close=fs.closeSync;fs.openSync=(...args)=>{const fd=open(...args);if(args[0]===x.image)imageFD=fd;return fd;};syncBuiltinESMExports();let r;try{r=await x.acquire();}finally{fs.openSync=open;syncBuiltinESMExports();}assert.equal(r.error,null);let calls=0;fs.closeSync=fd=>{if(fd===imageFD){calls++;throw 0;}return close(fd);};syncBuiltinESMExports();try{const first=r.owner.close();assert.equal(first,r.owner.close());let failure;try{await first}catch(cause){failure={cause}}assert.equal(failure?.cause,0);const status=r.owner.statusDATA();assert.equal(status.closeCausePresent,true);assert.equal(status.closeCause,0);assert.equal(status.closeComplete,false);assert.equal(calls,1);let again;try{await r.owner.close()}catch(cause){again={cause}}assert.equal(again?.cause,0);assert.equal(calls,1);}finally{fs.closeSync=close;syncBuiltinESMExports();}
});
test('lease bounded from pre-verification start; backwards/elapsed/late clock all deny',async()=>{
 {const x=await setup();x.seam.afterMath=()=>{wall=ctx.at+5001};const r=await x.acquire();assert(r.error&&r.owner);assert.match(r.error.cause.code,/EXPIRED/);assert(r.owner.readOriginalObservationDATA().original.currentRaw);await r.owner.close();}
 {const{x,owner}=await success();wall=ctx.at-1;assert.throws(()=>owner.assertPreLoadCurrent(),/EXPIRED/);wall=ctx.at;await owner.close();}
 {const{x,owner}=await success();wall=ctx.at+100;owner.assertPreLoadCurrent();wall=ctx.at+99;assert.throws(()=>owner.assertPreLoadCurrent(),/EXPIRED/);wall=ctx.at+100;await owner.close();}
 {const{x,owner}=await success();const at=performance.now(),forward=mock.method(performance,'now',()=>at+6000);try{assert.throws(()=>owner.assertPreLoadCurrent(),/EXPIRED/);}finally{forward.mock.restore();}await owner.close();}
 {const{x,owner}=await success();const backwards=mock.method(performance,'now',()=>-1);try{assert.throws(()=>owner.assertPreLoadCurrent(),/EXPIRED/);}finally{backwards.mock.restore();}await owner.close();}
 {const{x,owner}=await success();const invalid=mock.method(performance,'now',()=>NaN);try{assert.throws(()=>owner.assertPreLoadCurrent(),/EXPIRED/);}finally{invalid.mock.restore();}await owner.close();}
});
