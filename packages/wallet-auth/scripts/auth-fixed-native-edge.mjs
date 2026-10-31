// Build-time DATA only. This never imports/loads an image or qualifies a Source.
import {lstatSync,openSync,readSync,fstatSync,closeSync,constants} from 'node:fs';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {pathToFileURL} from 'node:url';
import {AUTH_RUNTIME_MANIFEST_VERSION,AUTH_RUNTIME_MANIFEST_PATH,AUTH_RUNTIME_REQUIRED_FILES} from './auth-runtime-manifest-contract.mjs';
export const FIXED_NATIVE_EDGE_VERSION='YNX-ORIGINAL-AUTH-FIXED-NATIVE-EDGE/v1';
export const FIXED_NATIVE_LOADER_PATH='src/original-auth-identity-fixed-native-image.js';
export const FIXED_NATIVE_LOADER_SHA256='11f841402ca8e2c2879a840b4f5b5234df153949b65af2f810db3669b3cdb4ec';
export const FIXED_NATIVE_SPECIFIER='../../../apps/wallet-desktop/native/original-auth-identity.node';
const PURPOSE='product-session-device-http-binary-source-v5';
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('FIXED_EDGE_SCHEMA');const d=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(d);if(ks.length!==keys.length||ks.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail('FIXED_EDGE_SCHEMA');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function path(p,dir=false){if(typeof p!=='string'||p!==p.toWellFormed()||p.includes('\0')||!isAbsolute(p)||resolve(p)!==p)fail('FIXED_EDGE_PATH');let c=p;while(true){const s=lstatSync(c);if(s.isSymbolicLink())fail('FIXED_EDGE_SYMLINK');if(c===p&&(dir?!s.isDirectory():!s.isFile()||s.nlink!==1))fail('FIXED_EDGE_NONREGULAR');if(c===dirname(c))break;c=dirname(c);}return p;}
function identity(s){return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink,s.mode].join(':');}
function capture(p,max){path(p);const before=lstatSync(p);if(before.size<1||before.size>max)fail('FIXED_EDGE_CAP');let fd;try{fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=fstatSync(fd);if(identity(before)!==identity(opened))fail('FIXED_EDGE_CHANGED');const raw=Buffer.alloc(before.size);let offset=0;while(offset<raw.length){const n=readSync(fd,raw,offset,raw.length-offset,null);if(!n)fail('FIXED_EDGE_CHANGED');offset+=n;}if(readSync(fd,Buffer.alloc(1),0,1,null)!==0)fail('FIXED_EDGE_CHANGED');const after=fstatSync(fd);path(p);if(identity(opened)!==identity(after)||identity(after)!==identity(lstatSync(p))||raw.length!==after.size)fail('FIXED_EDGE_CHANGED');return {raw,pin:{path:p,bytes:raw.length,sha256:hash(raw)}};}finally{if(fd!==undefined)closeSync(fd);}}
function selected(v,max){const x=exact(v,['path','bytes','sha256']);if(!Number.isSafeInteger(x.bytes)||x.bytes<1||x.bytes>max||typeof x.sha256!=='string'||! /^[0-9a-f]{64}$/.test(x.sha256))fail('FIXED_EDGE_PIN_SCHEMA');const r=capture(x.path,max);if(r.pin.bytes!==x.bytes||r.pin.sha256!==x.sha256)fail('FIXED_EDGE_PIN_MISMATCH');return r;}
function parse(raw){let value;try{value=JSON.parse(raw.toString('utf8'));}catch{fail('FIXED_EDGE_JSON');}if(!Buffer.from(canonical(value),'utf8').equals(raw))fail('FIXED_EDGE_CANONICAL');return value;}
const inside=(r,p)=>p===r||p.startsWith(r+'/');
export function inspectOriginalAuthFixedNativeLoaderDATA(packageRoot){const root=path(packageRoot,true);const loader=capture(join(root,FIXED_NATIVE_LOADER_PATH),16384);if(loader.pin.bytes!==3004||loader.pin.sha256!==FIXED_NATIVE_LOADER_SHA256)fail('FIXED_EDGE_LOADER_CODEPIN');return Object.freeze({loader:Object.freeze(loader.pin),specifier:FIXED_NATIVE_SPECIFIER,implementingImagePath:resolve(dirname(loader.pin.path),FIXED_NATIVE_SPECIFIER),dataOnly:true,SourceAdmission:false,NativeAdmission:false});}
// Caller must independently select every pin. These pins do NOT authenticate the
// qualifier, signatures, currentness, OS identity or the later loaded image.
export function generateOriginalAuthFixedNativeEdgeMetadataDATA(packageRoot,input){
 const root=path(packageRoot,true),x=exact(input,['normalBinding','runtimeManifest','implementingImage','independentQualification']);
 const nb=exact(x.normalBinding,['normalPackageRoot','normalPrivateModuleURI']);
 const privateModuleURI=pathToFileURL(join(root,'src/original-http-binary-v5-client-private.js')).href;
 if(nb.normalPackageRoot!==root||nb.normalPrivateModuleURI!==privateModuleURI)fail('FIXED_EDGE_NORMAL_NAMESPACE');
 const loader=inspectOriginalAuthFixedNativeLoaderDATA(root);
 const mp=exact(x.runtimeManifest,['path','bytes','sha256']);if(mp.path!==join(root,AUTH_RUNTIME_MANIFEST_PATH))fail('FIXED_EDGE_MANIFEST_PATH');
 const mr=selected(mp,1048576),m=parse(mr.raw);exact(m,['version','files']);if(m.version!==AUTH_RUNTIME_MANIFEST_VERSION||!Array.isArray(m.files)||!m.files.length||m.files.length>4096)fail('FIXED_EDGE_MANIFEST_SCHEMA');
 let last='',total=0;const seen=new Set();for(const r of m.files){exact(r,['path','bytes','sha256']);if(typeof r.path!=='string'||! /^[\x20-\x7e]+$/.test(r.path)||r.path.includes('\\')||r.path.split('/').some(s=>!s||s==='.'||s==='..')||r.path.startsWith('/')||r.path<=last||r.path===AUTH_RUNTIME_MANIFEST_PATH)fail('FIXED_EDGE_MANIFEST_SCHEMA');last=r.path;const f=selected({...r,path:join(root,r.path)},16777216);total+=f.pin.bytes;if(total>268435456)fail('FIXED_EDGE_CAP');seen.add(r.path);}
 for(const r of [...AUTH_RUNTIME_REQUIRED_FILES,FIXED_NATIVE_LOADER_PATH,'src/original-http-binary-v5-client-private.js'])if(!seen.has(r))fail('FIXED_EDGE_REQUIRED_FILE');
 const image=exact(x.implementingImage,['path','bytes','sha256']);if(image.path!==loader.implementingImagePath)fail('FIXED_EDGE_TARGET_PATH');const im=selected(image,16777216);
 const q=exact(x.independentQualification,['purpose','qualificationOriginal','qualifierImage']);if(q.purpose!==PURPOSE)fail('FIXED_EDGE_PURPOSE');
 const qp=exact(q.qualificationOriginal,['path','bytes','sha256']),qi=exact(q.qualifierImage,['path','bytes','sha256']);
 for(const p of [qp.path,qi.path])if(typeof p!=='string'||inside(root,p)||p===image.path||p===mp.path)fail('FIXED_EDGE_CIRCULAR_IDENTITY');if(qp.path===qi.path)fail('FIXED_EDGE_CIRCULAR_IDENTITY');
 const original=selected(qp,1048576),qualifier=selected(qi,67108864);
 if(new Set([im.pin.sha256,original.pin.sha256,qualifier.pin.sha256]).size!==3)fail('FIXED_EDGE_CIRCULAR_IDENTITY');
 const metadata={version:FIXED_NATIVE_EDGE_VERSION,purpose:PURPOSE,normalBinding:nb,loader:{...loader.loader,specifier:FIXED_NATIVE_SPECIFIER},runtimeManifest:mr.pin,implementingImage:im.pin,independentQualification:{purpose:q.purpose,qualificationOriginal:original.pin,qualifierImage:qualifier.pin}};
 const metadataOriginal=canonical(metadata);return Object.freeze({metadataOriginal,metadata:JSON.parse(metadataOriginal),metadataSHA256:hash(Buffer.from(metadataOriginal)),dataOnly:true,signatureVerified:false,SourceAdmission:false,NativeAdmission:false,preLoadQualified:false,sameModuleInstanceVerified:false,runtimeClosureComplete:false});
}
export function validateOriginalAuthFixedNativeEdgeMetadataDATA(packageRoot,original,input){if(typeof original!=='string'||Buffer.byteLength(original)>1048576)fail('FIXED_EDGE_METADATA_SCHEMA');const parsed=parse(Buffer.from(original));exact(parsed,['version','purpose','normalBinding','loader','runtimeManifest','implementingImage','independentQualification']);const generated=generateOriginalAuthFixedNativeEdgeMetadataDATA(packageRoot,input);if(original!==generated.metadataOriginal)fail('FIXED_EDGE_METADATA_MISMATCH');return generated;}
