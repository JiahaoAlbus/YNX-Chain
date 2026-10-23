// Original Protocol ARTIFACT-RELEASE typed DATA adapter. Protected Node/Electron
// only: the existing portable batch provider is not a browser implementation.
// Neither key custody nor valid mathematics establishes registration or approval.
import {Buffer} from 'node:buffer';
import {keyGen,exportKeyMaterial,importKeyMaterial,destroyKey,batchSign,extract,encodeMember,decodeMember,discardBatch,createVerifier,encodeFields,VERSION,SUITE} from '@ynx/batch-v01-candidate';
import {inspectIDEArtifactManifestData} from './ide-artifact-manifest.js';
const purpose='ARTIFACT-RELEASE',role='ide-artifact-publisher',publicTag='YNX-IDE-ARTIFACT-PUBLISHER/v1',messageTag='YNX-IDE-ARTIFACT-RELEASE/v1';
const bindingFields=['networkId','subjectOwner','account','projectId','publisherId','publisherKeyVersion'];
const materialFields=['format','algorithmVersion','suite','pkcs8A','pkcs8B','pkA','pkB'];
const states=new WeakMap(),debts=new Set(),provider=Object.freeze({provider:'portable'});
const error=code=>Object.assign(new Error(code),{code});
const invalid=()=>{throw error('IDE_ARTIFACT_SIGNATURE_DATA_INVALID');};
const typed=Object.getPrototypeOf(Uint8Array.prototype),bg=Object.getOwnPropertyDescriptor(typed,'buffer').get,lg=Object.getOwnPropertyDescriptor(typed,'length').get,og=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const ag=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,rg=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get,dg=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached')?.get;
function bytes(value,max,exact){
 const proto=Object.getPrototypeOf(value);if(proto!==Uint8Array.prototype&&proto!==Buffer.prototype)invalid();
 const b=bg.call(value),n=lg.call(value),o=og.call(value);
 if(Object.getPrototypeOf(b)!==ArrayBuffer.prototype||Reflect.ownKeys(b).length||!n||n>max||(exact!==undefined&&n!==exact)||rg?.call(b)||dg?.call(b)||o+n>ag.call(b))invalid();
 const own=Reflect.ownKeys(value);if(own.length!==n||own.some((k,i)=>k!==String(i)))invalid();
 return Buffer.from(new Uint8Array(b,o,n));
}
function record(value,fields){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 const ds=Object.getOwnPropertyDescriptors(value),ks=Reflect.ownKeys(ds);if(ks.length!==fields.length||ks.some(k=>!fields.includes(k)))invalid();
 const out=Object.create(null);for(const k of fields){const d=ds[k];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)invalid();out[k]=d.value;}return out;
}
const textEdge=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
// Original Protocol artifactCatalogText / Auth R161 catalog rule. Manifest
// strings use a different rule; do not apply its Unicode Cf ban to publisher R.
function text(value){if(typeof value!=='string'||!value.length||value.length>256||/[\ud800-\udfff\u0000-\u0020\u007f]/u.test(value)||textEdge.test(value)||Buffer.byteLength(value)>256)invalid();return value;}
function binding(value){
 const b=record(value,bindingFields);
 if(typeof b.networkId!=='string'||! /^[a-f0-9]{64}$/.test(b.networkId)||typeof b.subjectOwner!=='string'||! /^0x[a-f0-9]{40}$/.test(b.subjectOwner)||typeof b.publisherKeyVersion!=='string'||! /^[1-9][0-9]{0,19}$/.test(b.publisherKeyVersion)||BigInt(b.publisherKeyVersion)>18446744073709551615n)invalid();
 for(const k of ['account','projectId','publisherId'])text(b[k]);return Object.freeze({...b});
}
function encodePublic(b,a,c){return encodeFields([publicTag,VERSION,SUITE,purpose,role,Buffer.from(b.networkId,'hex'),b.subjectOwner,b.account,b.projectId,b.publisherId,b.publisherKeyVersion,a,c]);}
function publicData(original){
 const raw=bytes(original,8192),caps=[64,64,64,64,64,32,42,256,256,256,20,2592,64];
 if(raw.length<4||raw.readUInt32BE(0)!==13)invalid();let at=4;const f=[];
 for(const cap of caps){if(at+4>raw.length)invalid();const n=raw.readUInt32BE(at);at+=4;if(!n||n>cap||n>raw.length-at)invalid();f.push(raw.subarray(at,at+n));at+=n;}
 if(at!==raw.length||f[5].length!==32||f[11].length!==2592||f[12].length!==64)invalid();
 const td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),s=f.map((v,i)=>i===5||i===11||i===12?null:td.decode(v));
 if(s[0]!==publicTag||s[1]!==VERSION||s[2]!==SUITE||s[3]!==purpose||s[4]!==role)invalid();
 const b=binding({networkId:f[5].toString('hex'),subjectOwner:s[6],account:s[7],projectId:s[8],publisherId:s[9],publisherKeyVersion:s[10]});
 if(!encodePublic(b,f[11],f[12]).equals(raw))invalid();return {raw,b,pkA:Buffer.from(f[11]),pkB:Buffer.from(f[12])};
}
function exposePublic(p){return Object.freeze({...p.b,protocolVersion:VERSION,suite:SUITE,purpose,keyRole:role,get pkA(){return new Uint8Array(p.pkA);},get pkB(){return new Uint8Array(p.pkB);},dataOnly:true,trusted:false,authorized:false,nativeAdmission:false,registered:false,current:false});}
export function inspectIDEArtifactPublisherPublicOriginalData(original){try{return exposePublic(publicData(original));}catch{invalid();}}
function live(handle){const s=states.get(handle);if(!s?.active)throw error('IDE_ARTIFACT_PUBLISHER_HANDLE_UNAVAILABLE');if(s.batchDebt||s.cleanup==='unknown'||s.cleanup==='entered')throw s.firstCause??error('IDE_ARTIFACT_PUBLISHER_CLEANUP_UNRESOLVED');return s;}
function adopt(native,b,pkA,pkB){const raw=encodePublic(b,bytes(pkA,2592,2592),bytes(pkB,64,64)),handle=Object.freeze(Object.create(null));states.set(handle,{native,raw,active:true,cleanup:'not-requested',batchDebt:false,firstCause:undefined});return handle;}
function retire(s){
 s.active=false;if(s.cleanup==='complete')return false;if(s.cleanup==='unknown'||s.cleanup==='entered')throw s.firstCause??error('IDE_ARTIFACT_PUBLISHER_CLEANUP_UNRESOLVED');
 s.cleanup='entered';debts.add(s);try{if(destroyKey(s.native)!==true)throw error('IDE_ARTIFACT_PUBLISHER_CLEANUP_UNRESOLVED');s.cleanup='complete';if(!s.batchDebt)debts.delete(s);return true;}
 catch(cause){s.firstCause??=cause;s.cleanup='unknown';throw s.firstCause;}
}
function failedAcquisition(native,cause){const s={native,active:false,cleanup:'not-requested',batchDebt:false,firstCause:cause};try{retire(s);}catch{/* retain original custody/debt and first cause */}}
function acquisitionAllowed(){if(debts.size)throw error('IDE_ARTIFACT_PUBLISHER_CLEANUP_UNRESOLVED');}
export function createIDEArtifactPublisherKeyData(input){
 acquisitionAllowed();const b=binding(input),result=keyGen(provider),native=result?.privateKey;if(!native||typeof native!=='object')throw error('IDE_ARTIFACT_PUBLISHER_KEY_REQUIRED');
 try{return adopt(native,b,result.publicKey.pkA,result.publicKey.pkB);}catch(cause){failedAcquisition(native,cause);throw cause;}
}
export function readIDEArtifactPublisherPublicOriginalData(handle){return new Uint8Array(live(handle).raw);}
export function exportIDEArtifactPublisherKeyMaterialData(handle){
 const s=live(handle),material=exportKeyMaterial(s.native);let copied;
 try{copied=captureMaterial(material);const p=publicData(s.raw);if(!copied.pkA.equals(p.pkA)||!copied.pkB.equals(p.pkB))invalid();live(handle);return Object.freeze({...copied});}
 catch(cause){copied?.pkcs8A.fill(0);copied?.pkcs8B.fill(0);throw cause;}
 finally{material.pkcs8A?.fill(0);material.pkcs8B?.fill(0);}
}
function captureMaterial(input){
 const m=record(input,materialFields);if(m.format!=='YNX-BATCH/KEY-MATERIAL/v1'||m.algorithmVersion!==VERSION||m.suite!==SUITE)invalid();let a,b;
 try{a=bytes(m.pkcs8A,54,54);b=bytes(m.pkcs8B,150,150);return {...m,pkcs8A:a,pkcs8B:b,pkA:bytes(m.pkA,2592,2592),pkB:bytes(m.pkB,64,64)};}
 catch(cause){a?.fill(0);b?.fill(0);throw cause;}
}
export function importIDEArtifactPublisherKeyMaterialData(input,expectedPublicOriginal){
 acquisitionAllowed();const p=publicData(expectedPublicOriginal),m=captureMaterial(input);let native;
 try{if(!m.pkA.equals(p.pkA)||!m.pkB.equals(p.pkB))invalid();const result=importKeyMaterial(m,provider);native=result.privateKey;if(!native||typeof native!=='object')throw error('IDE_ARTIFACT_PUBLISHER_KEY_REQUIRED');const recomputed=encodePublic(p.b,bytes(result.publicKey.pkA,2592,2592),bytes(result.publicKey.pkB,64,64));if(!recomputed.equals(p.raw))invalid();const handle=adopt(native,p.b,result.publicKey.pkA,result.publicKey.pkB);native=undefined;return handle;}
 catch(cause){if(native)failedAcquisition(native,cause);throw cause;}finally{m.pkcs8A.fill(0);m.pkcs8B.fill(0);}
}
export function destroyIDEArtifactPublisherKeyData(handle){const s=states.get(handle);return s?retire(s):false;}
export function readIDEArtifactPublisherKeyCleanupData(handle){const s=states.get(handle);if(!s)throw error('IDE_ARTIFACT_PUBLISHER_HANDLE_UNAVAILABLE');return Object.freeze({retired:!s.active,cleanupComplete:s.cleanup==='complete'&&!s.batchDebt,cleanupUnknown:s.cleanup==='unknown'||s.cleanup==='entered'||s.batchDebt,firstCause:s.firstCause,globalCleanupDebt:debts.size!==0});}
function manifest(raw,p){const original=bytes(raw,16384);const dto=inspectIDEArtifactManifestData(new Uint8Array(original));if(dto.projectId!==p.b.projectId)invalid();return original;}
function message(p,m){return encodeFields([messageTag,p.raw,m]);}
export function inspectIDEArtifactSignatureData(signatureOriginal,manifestOriginal,expectedPublicOriginal){
 let verifier;try{
 const p=publicData(expectedPublicOriginal),m=manifest(manifestOriginal,p),wire=bytes(signatureOriginal,100000),decoded=decodeMember(wire),c=decoded.certificate;
 if(c.N!==1||decoded.index!==0||decoded.pathA.length||decoded.pathB.length||!decoded.message.equals(message(p,m))||!c.chainId.equals(Buffer.from(p.b.networkId,'hex'))||c.owner!==p.b.subjectOwner||c.purpose!==purpose||!c.pkA.equals(p.pkA)||!c.pkB.equals(p.pkB))invalid();
 // This local resolver supplies only public mathematics for fixed height zero.
 // It is explicitly NOT Auth's live registration/current/ACL authority.
 verifier=createVerifier({provider:'portable',chainId:Buffer.from(p.b.networkId,'hex'),purpose,cacheEntries:0,resolveTrustedOwner:()=>({enabled:true,algorithmVersion:VERSION,chainId:Buffer.from(p.b.networkId,'hex'),owner:p.b.subjectOwner,purpose,pkA:p.pkA,pkB:p.pkB,policyRevision:'artifact-data-only',activeFrom:0,revokedAt:null})});
 if(!verifier.verifyOne(wire,{height:0}))invalid();
 return Object.freeze({...p.b,purpose,keyRole:role,signatureVerified:true,memberCount:1,memberIndex:0,dataOnly:true,trusted:false,authorized:false,nativeAdmission:false,registered:false,current:false,publicationAuthorized:false});
 }catch{invalid();}finally{verifier?.clear();}
}
export function signIDEArtifactManifestData(handle,manifestOriginal,expectedPublicOriginal){
 const s=live(handle),p=publicData(expectedPublicOriginal),m=manifest(manifestOriginal,p);if(!s.raw.equals(p.raw))invalid();
 const signed=batchSign(s.native,{chainId:Buffer.from(p.b.networkId,'hex'),owner:p.b.subjectOwner,purpose},[message(p,m)]);let wire,first;
 try{wire=encodeMember(extract(signed.batch,0));live(handle);inspectIDEArtifactSignatureData(wire,m,p.raw);live(handle);}catch(cause){first=cause;}
 try{if(discardBatch(signed.batch)!==true)throw error('IDE_ARTIFACT_PUBLISHER_BATCH_CLEANUP_UNRESOLVED');}
 catch(cause){s.batchDebt=true;s.batch=signed.batch;s.firstCause??=first??cause;debts.add(s);first??=cause;}
 if(first)throw first;return new Uint8Array(wire);
}
