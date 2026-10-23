import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {spawnSync} from 'node:child_process';
import {createPQWalletKeyHandle,destroyPQWalletKeyHandle} from '../src/pq-wallet-key-backup.js';
import {decodeMember,encodeMember,encodeFields,importKeyMaterial,batchSign,extract,discardBatch,destroyKey,createVerifier} from '@ynx/batch-v01-candidate';
import {encodeIDEArtifactManifestData} from '../src/ide-artifact-manifest.js';
import {createIDEArtifactPublisherKeyData as create,readIDEArtifactPublisherPublicOriginalData as readPublic,exportIDEArtifactPublisherKeyMaterialData as exportMaterial,importIDEArtifactPublisherKeyMaterialData as restore,destroyIDEArtifactPublisherKeyData as destroy,readIDEArtifactPublisherKeyCleanupData as cleanup,inspectIDEArtifactPublisherPublicOriginalData as inspectPublic,signIDEArtifactManifestData as sign,inspectIDEArtifactSignatureData as verify} from '../src/ide-artifact-signature.js';
const binding=()=>({networkId:'ab'.repeat(32),subjectOwner:'0x'+'12'.repeat(20),account:'account-1',projectId:'project-1',publisherId:'发布者'.repeat(20),publisherKeyVersion:'1'});
const manifest=()=>encodeIDEArtifactManifestData({byteSize:7,contentDigest:'a'.repeat(64),projectId:'project-1',version:'1',publishPurpose:'release',targetEnvironment:'testnet'});
const bad=f=>assert.throws(f);
function readKnownRFields(original){const r=Buffer.from(original),f=[];let at=4;assert.equal(r.readUInt32BE(0),13);for(let i=0;i<13;i++){const n=r.readUInt32BE(at);at+=4;f.push(Buffer.from(r.subarray(at,at+n)));at+=n;}assert.equal(at,r.length);return f;}
function genericFailure(fn){assert.throws(fn,e=>e.code==='IDE_ARTIFACT_SIGNATURE_DATA_INVALID'&&e.message==='IDE_ARTIFACT_SIGNATURE_DATA_INVALID'&&!Object.hasOwn(e,'cause'));}
test('public R input getter, fake Buffer and intrinsic view errors remain generic without disclosure',()=>{
 let reads=0;const hostile=Object.create(null);Object.defineProperty(hostile,'buffer',{get(){reads++;throw new Error('SECRET-MATERIAL');}});genericFailure(()=>inspectPublic(hostile));assert.equal(reads,0);
 const b=Buffer.from([1]);Object.defineProperty(b,'hidden',{get(){reads++;throw new Error('SECRET-MATERIAL');}});genericFailure(()=>inspectPublic(b));assert.equal(reads,0);
 const fake=Object.create(Buffer.prototype);Object.defineProperty(fake,'buffer',{get(){reads++;throw new Error('SECRET-MATERIAL');}});genericFailure(()=>inspectPublic(fake));assert.equal(reads,0);
 genericFailure(()=>inspectPublic(new Proxy(Buffer.from([1]),{})));genericFailure(()=>inspectPublic(new Uint8Array(new SharedArrayBuffer(5))));
});
test('reject invalid binding before keygen and descriptor getters without entering them',()=>{
 for(const changed of [{publisherKeyVersion:'0'},{publisherKeyVersion:'18446744073709551616'},{subjectOwner:'0x'+'AB'.repeat(20)},{networkId:'AB'.repeat(32)},{publisherId:' x'},{account:'\ud800'},{projectId:''},{extra:true}])bad(()=>create({...binding(),...changed}));
 let calls=0;const b=binding();Object.defineProperty(b,'account',{enumerable:true,get(){calls++;return 'x';}});bad(()=>create(b));assert.equal(calls,0);bad(()=>sign(Object.freeze({}),manifest(),new Uint8Array([1])));assert.equal(destroy(Object.freeze({})),false);
});
test('isolated original primitive cleanup negatives retain UNKNOWN, debt and first cause without retry',()=>{
 const target=new URL('../src/ide-artifact-signature.js',import.meta.url).href;
 const actual=new URL('../node_modules/@ynx/batch-v01-candidate/src/index.mjs',import.meta.url).href;
 for(const mode of ['false','undefined','throw','acquisition']){
  const wrapper=`import * as p from ${JSON.stringify(actual)};export * from ${JSON.stringify(actual)};export function keyGen(...args){const r=p.keyGen(...args);return globalThis.__mode==='acquisition'?{...r,publicKey:{...r.publicKey,pkB:new Uint8Array(1)}}:r;}export function destroyKey(h){globalThis.__calls++;p.destroyKey(h);if(globalThis.__mode==='throw'||globalThis.__mode==='acquisition')throw globalThis.__first;return globalThis.__mode==='undefined'?undefined:false;}`;
  const code=`import assert from 'node:assert/strict';import {registerHooks} from 'node:module';globalThis.__mode=${JSON.stringify(mode)};globalThis.__calls=0;globalThis.__first=new Error('original-cleanup-first');const target=${JSON.stringify(target)},replacement=${JSON.stringify('data:text/javascript,'+encodeURIComponent(wrapper))};registerHooks({resolve(s,c,next){return s==='@ynx/batch-v01-candidate'&&c.parentURL===target?{url:replacement,shortCircuit:true}:next(s,c);}});const api=await import(target);const b=${JSON.stringify(binding())};if(__mode==='acquisition'){assert.throws(()=>api.createIDEArtifactPublisherKeyData(b),{code:'IDE_ARTIFACT_SIGNATURE_DATA_INVALID'});assert.equal(__calls,1);assert.throws(()=>api.createIDEArtifactPublisherKeyData(b),{code:'IDE_ARTIFACT_PUBLISHER_CLEANUP_UNRESOLVED'});assert.equal(__calls,1);}else{const h=api.createIDEArtifactPublisherKeyData(b);let first;try{api.destroyIDEArtifactPublisherKeyData(h);}catch(e){first=e;}assert.ok(first);assert.equal(__calls,1);assert.throws(()=>api.destroyIDEArtifactPublisherKeyData(h),e=>e===first);assert.equal(__calls,1);const out=api.readIDEArtifactPublisherKeyCleanupData(h);assert.equal(out.retired,true);assert.equal(out.cleanupUnknown,true);assert.equal(out.cleanupComplete,false);assert.equal(out.firstCause,first);assert.equal(out.globalCleanupDebt,true);if(__mode==='throw')assert.equal(first,__first);assert.throws(()=>api.exportIDEArtifactPublisherKeyMaterialData(h));assert.throws(()=>api.createIDEArtifactPublisherKeyData(b),{code:'IDE_ARTIFACT_PUBLISHER_CLEANUP_UNRESOLVED'});}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,`${mode}: ${result.stderr}`);
 }
});
test('actual ephemeral independent publisher pair, exact R13 and M3 dual signature; DATA cannot grant authority',async()=>{
 const h=create(binding());let material,restored;
 try{
  const r=readPublic(h),p=inspectPublic(r);assert.equal(p.publisherId,binding().publisherId);assert.equal(p.pkA.length,2592);assert.equal(p.pkB.length,64);assert.equal(p.authorized,false);assert.equal(p.registered,false);assert.equal(new DataView(r.buffer).getUint32(0),13);
  const detached=readPublic(h);detached.fill(0);assert.deepEqual(readPublic(h),r);const publicCopy=p.pkA;publicCopy.fill(0);assert.notDeepEqual(p.pkA,publicCopy);
  const m=manifest(),sig=sign(h,m,r),v=verify(sig,m,r);assert.equal(v.signatureVerified,true);assert.equal(v.publicationAuthorized,false);assert.equal(v.current,false);assert.equal(v.memberCount,1);assert.ok(Object.isFrozen(v));
  for(const dto of [p,v])for(const k of ['trusted','authorized','nativeAdmission'])assert.equal(dto[k],false);
  const asset=await createPQWalletKeyHandle({chainId:binding().networkId,owner:binding().subjectOwner});try{bad(()=>sign(asset,m,r));bad(()=>exportMaterial(asset));bad(()=>readPublic(asset));assert.equal(destroy(asset),false);}finally{destroyPQWalletKeyHandle(asset);}
  const decoded=decodeMember(Buffer.from(sig));assert.equal(decoded.certificate.N,1);assert.equal(decoded.index,0);assert.deepEqual(decoded.pathA,[]);assert.deepEqual(decoded.pathB,[]);assert.deepEqual(decoded.message,encodeFields(['YNX-IDE-ARTIFACT-RELEASE/v1',Buffer.from(r),Buffer.from(m)]));
  const tampered=new Uint8Array(m);tampered[m.length-3]^=1;bad(()=>verify(sig,tampered,r));bad(()=>verify(sig,m,new Uint8Array([...r,0])));bad(()=>inspectPublic(new Uint8Array([...r,0])));bad(()=>verify(new Uint8Array([...sig,0]),m,r));
  for(const branch of ['sigmaA','sigmaB']){const d=decodeMember(Buffer.from(sig));d.certificate[branch][0]^=1;bad(()=>verify(new Uint8Array(encodeMember(d)),m,r));}
  const changed=decodeMember(Buffer.from(sig));changed.certificate.purpose='AUTH-IDENTITY';bad(()=>verify(new Uint8Array(encodeMember(changed)),m,r));
  const wrongProject=encodeIDEArtifactManifestData({...{byteSize:7,contentDigest:'a'.repeat(64),projectId:'other-project',version:'1',publishPurpose:'release',targetEnvironment:'testnet'}});bad(()=>sign(h,wrongProject,r));
  material=exportMaterial(h);assert.equal(material.format,'YNX-BATCH/KEY-MATERIAL/v1');assert.equal(material.pkcs8A.length,54);assert.equal(material.pkcs8B.length,150);
  const wrongR=Buffer.from(r);let at=4;for(let i=0;i<10;i++){at+=4+wrongR.readUInt32BE(at);}const versionLength=wrongR.readUInt32BE(at);assert.equal(versionLength,1);wrongR[at+4]=50;assert.equal(inspectPublic(new Uint8Array(wrongR)).publisherKeyVersion,'2');bad(()=>sign(h,m,new Uint8Array(wrongR)));bad(()=>verify(sig,m,new Uint8Array(wrongR)));
  for(const field of [7,8,9]){const fields=readKnownRFields(r);fields[field]=Buffer.from('different-context');const other=new Uint8Array(encodeFields(fields));assert.equal(inspectPublic(other)[field===7?'account':field===8?'projectId':'publisherId'],'different-context');genericFailure(()=>verify(sig,m,other));}
  const pairFields=readKnownRFields(r);pairFields[11][0]^=1;pairFields[12][0]^=1;const otherPair=new Uint8Array(encodeFields(pairFields));assert.equal(inspectPublic(otherPair).pkA.length,2592);genericFailure(()=>verify(sig,m,otherPair));
  const retainedA=new Uint8Array(material.pkcs8A);restored=restore(material,r);assert.deepEqual(material.pkcs8A,Buffer.from(retainedA));assert.deepEqual(readPublic(restored),r);assert.equal(verify(sign(restored,m,r),m,r).signatureVerified,true);
  // A genuinely valid old-purpose certificate still cannot be an artifact signature.
  const primitive=importKeyMaterial(material,{provider:'portable'});let signed;
  try{
   signed=batchSign(primitive.privateKey,{chainId:Buffer.from(binding().networkId,'hex'),owner:binding().subjectOwner,purpose:'TX-BATCH'},[decoded.message]);bad(()=>verify(new Uint8Array(encodeMember(extract(signed.batch,0))),m,r));discardBatch(signed.batch);signed=undefined;
   signed=batchSign(primitive.privateKey,{chainId:Buffer.from(binding().networkId,'hex'),owner:binding().subjectOwner,purpose:'ARTIFACT-RELEASE'},[decoded.message,decoded.message]);
   const math=createVerifier({provider:'portable',chainId:Buffer.from(binding().networkId,'hex'),purpose:'ARTIFACT-RELEASE',cacheEntries:0,resolveTrustedOwner:()=>({enabled:true,algorithmVersion:'YNX-BATCH/v0.1',chainId:Buffer.from(binding().networkId,'hex'),owner:binding().subjectOwner,purpose:'ARTIFACT-RELEASE',pkA:primitive.publicKey.pkA,pkB:primitive.publicKey.pkB,policyRevision:'public-negative-fixture',activeFrom:0,revokedAt:null})});
   try{for(const index of [0,1]){const member=extract(signed.batch,index);assert.equal(member.certificate.N,2);assert.equal(member.index,index);assert.equal(member.pathA.length,1);assert.equal(member.pathB.length,1);const wire=encodeMember(member);assert.equal(math.verifyOne(wire,{height:0}),true);genericFailure(()=>verify(new Uint8Array(wire),m,r));}}finally{math.clear();}
  }
  finally{if(signed)discardBatch(signed.batch);destroyKey(primitive.privateKey);}
  const badMaterial={...material,pkB:new Uint8Array(material.pkB)};badMaterial.pkB[0]^=1;bad(()=>restore(badMaterial,r));
  const getterMaterial={...material};let calls=0;Object.defineProperty(getterMaterial,'pkcs8A',{enumerable:true,get(){calls++;return material.pkcs8A;}});bad(()=>restore(getterMaterial,r));assert.equal(calls,0);
  assert.equal(destroy(h),true);assert.equal(destroy(h),false);assert.deepEqual(cleanup(h),{retired:true,cleanupComplete:true,cleanupUnknown:false,firstCause:undefined,globalCleanupDebt:false});bad(()=>sign(h,m,r));bad(()=>exportMaterial(h));bad(()=>readPublic(h));
 }finally{destroy(h);if(restored)destroy(restored);material?.pkcs8A.fill(0);material?.pkcs8B.fill(0);}
});
test('original Go catalog text rule rejects interior ASCII space but preserves valid Unicode format in publisher R',()=>{
 for(const field of ['account','projectId','publisherId'])for(const value of ['inside space','inside\u001fcontrol','inside\u007fcontrol','\u0085edge','edge\u3000'])assert.throws(()=>create({...binding(),[field]:value}),{code:'IDE_ARTIFACT_SIGNATURE_DATA_INVALID'});
 const h=create({...binding(),publisherId:'publisher\u200cjoin'});
 try{const r=readPublic(h),p=inspectPublic(r);assert.equal(p.publisherId,'publisher\u200cjoin');const sig=sign(h,manifest(),r);assert.equal(verify(sig,manifest(),r).publisherId,p.publisherId);}finally{destroy(h);}
});
