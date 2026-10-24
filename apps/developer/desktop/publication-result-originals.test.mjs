import test from 'node:test';
import assert from 'node:assert/strict';
import * as caller from './artifact-publication-client.mjs';
const utf8=v=>new TextEncoder().encode(v);
const fields={version:'YNX-IDE-ARTIFACT-RELEASE-RESULT/v1',purpose:'ARTIFACT-RELEASE',requestOriginal:'{"requestId":"PUBLIC-request"}',manifestOriginal:'{"projectId":"PUBLIC-project"}',invocationOriginal:'{"projectId":"PUBLIC-project"}',publisherOriginal:'AQID',signatureOriginal:'BAUG',actualApprovalRef:'00000000-0000-4000-8000-000000000001',publisherRegistrationRef:'PUBLIC-registration',publisherRevision:'1',publisherKeyVersion:'1'};
const originals=()=>utf8(JSON.stringify(fields));
function dataDecoder(raw,change={}){
 const snapshot=new Uint8Array(raw),value=JSON.parse(new TextDecoder().decode(snapshot));
 const out={...value,dataOnly:true,signatureVerified:false,trusted:false,authorized:false,nativeAdmission:false,registered:false,current:false,approvalCurrent:false,publicationAuthorized:false,...change};
 for(const [key,bytes]of Object.entries({resultOriginal:snapshot,requestOriginalBytes:utf8(value.requestOriginal),manifestOriginalBytes:utf8(value.manifestOriginal),invocationOriginalBytes:utf8(value.invocationOriginal),signatureOriginalBytes:Uint8Array.of(4,5,6),publisherOriginalBytes:Uint8Array.of(1,2,3)}))Object.defineProperty(out,key,{enumerable:true,get:()=>new Uint8Array(bytes)});
 return Object.freeze(out);
}
const input=()=>({resultOriginal:originals(),expectedRequestOriginal:fields.requestOriginal,expectedManifestOriginal:fields.manifestOriginal});
test('backend exposes the fixed bundled result consumer and preserves existing wire bytes',()=>{
 assert.equal(typeof caller.openBundledOriginalPublicationResult,'function');assert.equal(typeof caller.decodeOriginalPublicationResultData,'function');
 const v=input(),original=new Uint8Array(v.resultOriginal),decoded=caller.decodeOriginalPublicationResultData(v,dataDecoder);v.resultOriginal.fill(0);
 assert.deepEqual(decoded.resultOriginal,original);assert.equal(decoded.authorized,false);assert.equal(decoded.signatureOriginal,'BAUG');assert.deepEqual(decoded.signatureOriginalBytes,Uint8Array.of(4,5,6));
});
for(const key of ['signatureVerified','trusted','authorized','nativeAdmission','registered','current','approvalCurrent','publicationAuthorized'])test('consumer refuses DATA decoder raising '+key,()=>{
 assert.throws(()=>caller.decodeOriginalPublicationResultData(input(),r=>dataDecoder(r,{[key]:true})),{code:'IDE_PUBLICATION_RESULT_INVALID'});
});
test('request or invocation changes cannot be rebound by caller metadata',()=>{
 for(const key of ['expectedRequestOriginal','expectedManifestOriginal']){const v=input();v[key]+=' ';assert.throws(()=>caller.decodeOriginalPublicationResultData(v,dataDecoder),{code:'IDE_PUBLICATION_RESULT_BINDING_INVALID'});}
});
test('proof extras are refused rather than treated as a publication proof',()=>{
 let called=0;assert.throws(()=>caller.decodeOriginalPublicationResultData({...input(),proofOriginal:'PUBLIC-identity'},r=>{called++;return dataDecoder(r);}),{code:'IDE_PUBLICATION_RESULT_ARGUMENTS'});assert.equal(called,0);
 assert.throws(()=>caller.decodeOriginalPublicationResultData(input(),r=>dataDecoder(r,{proofOriginal:'PUBLIC-identity'})),{code:'IDE_PUBLICATION_RESULT_INVALID'});
});
test('returned bytes must be the exact captured raw result, not a reserialized DTO',()=>{
 const v=input();assert.throws(()=>caller.decodeOriginalPublicationResultData(v,r=>{const d=dataDecoder(r);return Object.freeze({...d,resultOriginal:utf8('different')});}),{code:'IDE_PUBLICATION_RESULT_BINDING_INVALID'});
});
test('captured input is independent before calling a foreign DATA decoder',()=>{
 const v=input(),before=new Uint8Array(v.resultOriginal);const d=caller.decodeOriginalPublicationResultData(v,bytes=>{v.resultOriginal.fill(0);return dataDecoder(bytes);});assert.deepEqual(d.resultOriginal,before);
});
test('shared/resizable or detached input cannot enter a result decoder',()=>{
 if(typeof SharedArrayBuffer==='function')assert.throws(()=>caller.decodeOriginalPublicationResultData({...input(),resultOriginal:new Uint8Array(new SharedArrayBuffer(4))},dataDecoder));
 const bytes=originals();structuredClone(bytes.buffer,{transfer:[bytes.buffer]});assert.throws(()=>caller.decodeOriginalPublicationResultData({...input(),resultOriginal:bytes},dataDecoder));
});

test('fixed package loader refuses missing exports and escaped SDK targets without executing them',async t=>{
 const {mkdtemp,mkdir,writeFile,copyFile,symlink,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{pathToFileURL}=await import('node:url');
 const root=await mkdtemp(join(tmpdir(),'ynx-publication-result-loader-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const desktop=join(root,'missing/apps/developer/desktop'),sdk=join(root,'missing/packages/wallet-auth');await mkdir(desktop,{recursive:true});await mkdir(sdk,{recursive:true});
 await copyFile(new URL('./publication-result-originals.mjs',import.meta.url),join(desktop,'publication-result-originals.mjs'));
 await writeFile(join(sdk,'package.json'),JSON.stringify({name:'@ynx-chain/wallet-auth',type:'module',exports:{}}));
 const loader=await import(pathToFileURL(join(desktop,'publication-result-originals.mjs')).href);
 await assert.rejects(loader.openBundledOriginalPublicationResult(input()),{code:'IDE_PUBLICATION_RESULT_NOT_SUPPLIED'});
 const escapeDesktop=join(root,'escape/apps/developer/desktop'),escapeSDK=join(root,'escape/packages/wallet-auth');await mkdir(escapeDesktop,{recursive:true});await mkdir(escapeSDK,{recursive:true});
 await copyFile(new URL('./publication-result-originals.mjs',import.meta.url),join(escapeDesktop,'publication-result-originals.mjs'));
 const escaped=join(root,'outside.mjs');await writeFile(escaped,'throw Error("outside source must never run");');await symlink(escaped,join(escapeSDK,'result.mjs'));
 await writeFile(join(escapeSDK,'package.json'),JSON.stringify({name:'@ynx-chain/wallet-auth',type:'module',exports:{'./ide-artifact-release-result':'./result.mjs'}}));
 const escapeLoader=await import(pathToFileURL(join(escapeDesktop,'publication-result-originals.mjs')).href);
 await assert.rejects(escapeLoader.openBundledOriginalPublicationResult(input()),{code:'IDE_PUBLICATION_RESULT_NOT_SUPPLIED'});
});

test('fixed loader actually calls pinned official SDK35 decoder with raw whole-member DATA',async()=>{
 const v=input(),original=new Uint8Array(v.resultOriginal),d=await caller.openBundledOriginalPublicationResult(v);
 assert.deepEqual(d.resultOriginal,original);assert.deepEqual(d.signatureOriginalBytes,Uint8Array.of(4,5,6));assert.equal(d.signatureVerified,false);assert.equal(d.publicationAuthorized,false);assert.equal(Object.hasOwn(d,'proofOriginal'),false);
 const first=d.resultOriginal;first.fill(0);assert.deepEqual(d.resultOriginal,original);
});
test('official decoder rejects wrong domain and an invented proof field inside retained wire',async()=>{
 for(const change of [{purpose:'AUTH-RECEIVE'},{proofOriginal:'PUBLIC-not-publication'}]){
  const v=input();v.resultOriginal=utf8(JSON.stringify({...fields,...change}));
  await assert.rejects(caller.openBundledOriginalPublicationResult(v),{code:'IDE_ARTIFACT_RELEASE_RESULT_INVALID'});
 }
});
test('explicit Go v1 transport uses original result text and member string without DTO reserialization',async()=>{
 assert.equal(typeof caller.openBundledOriginalPublicationInput,'function');
 const v=input();v.resultOriginal=utf8(JSON.stringify(fields,null,1));
 const packet=await caller.openBundledOriginalPublicationInput(v);
 assert.deepEqual(Object.keys(packet).sort(),['version','requestOriginal','resultOriginal','invocationOriginal','signatureOriginal','actualApprovalRef'].sort());
 assert.equal(packet.version,'YNX-IDE-PUBLICATION-INPUT/v1');assert.deepEqual(utf8(packet.resultOriginal),v.resultOriginal);assert.equal(packet.signatureOriginal,'BAUG');assert.equal(packet.invocationOriginal,fields.manifestOriginal);assert.equal(Object.hasOwn(packet,'proofOriginal'),false);
});
