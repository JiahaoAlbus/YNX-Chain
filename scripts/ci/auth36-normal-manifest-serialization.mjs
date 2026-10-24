// Build-only DATA serializer. No file writes, runtime readback or admission.
import {types} from 'node:util';
import {canonicalJSON} from '../../packages/wallet-auth/src/canonical.js';
import {AUTH_RUNTIME_MANIFEST_VERSION} from '../../packages/wallet-auth/scripts/auth-runtime-closure.mjs';
export const AUTH36_NORMAL_MANIFEST_NAMES=Object.freeze(['original-auth-runtime-manifest.json','original-ide-auth-runtime-manifest.json','original-ide-contract-relay-runtime-manifest.json']);
const emptySHA='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const fail=()=>{throw Object.assign(Error('AUTH36_NORMAL_MANIFEST_INVALID'),{code:'AUTH36_NORMAL_MANIFEST_INVALID'});};
function record(value,keys){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(ds);
 if(own.length!==keys.length||keys.some(k=>!ds[k]||!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))||own.some(k=>!keys.includes(k)))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
function capture(name,input){
 if(!AUTH36_NORMAL_MANIFEST_NAMES.includes(name))fail();
 const body=record(input,['files','version']);if(body.version!==AUTH_RUNTIME_MANIFEST_VERSION)fail();
 const list=body.files;if(!Array.isArray(list)||types.isProxy(list)||Object.getPrototypeOf(list)!==Array.prototype||!list.length||list.length>20000)fail();
 const ds=Object.getOwnPropertyDescriptors(list);if(Reflect.ownKeys(ds).length!==list.length+1)fail();
 const files=[];let previous='';const union=name==='original-ide-contract-relay-runtime-manifest.json';
 for(let i=0;i<list.length;i++){
  if(!ds[i]||!ds[i].enumerable||!Object.hasOwn(ds[i],'value'))fail();
  const r=record(ds[i].value,['bytes','path','sha256']);
  if(typeof r.path!=='string'||!r.path||r.path<=previous||!union&&!/^[\x20-\x7e]+$/.test(r.path)||r.path.startsWith('/')||r.path.includes('\\')||r.path.split('/').some(s=>!s||s==='.'||s==='..')||r.path===(union?'native/original-ide-contract-relay-runtime-manifest.json':'native/original-ide-auth-runtime-manifest.json')||!Number.isSafeInteger(r.bytes)||r.bytes<(union?0:1)||r.bytes>16777216||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||r.bytes===0&&r.sha256!==emptySHA)fail();
  previous=r.path;files.push(Object.freeze(r));
 }
 return Object.freeze({files:Object.freeze(files),version:body.version});
}
/** Input rows must already be strictly path-sorted; only JSON keys are sorted. */
export function serializeAuth36NormalManifestData(manifestName,input){
 const body=capture(manifestName,input),raw=Buffer.from(canonicalJSON(body),'utf8');if(raw.length>8388608)fail();return raw;
}
/** Strict byte validation, not a repair parser. LF/pretty/key/row drift refuses. */
export function inspectAuth36NormalManifestData(manifestName,original){
 if(types.isProxy(original)||!types.isUint8Array(original))fail();
 const proto=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(proto,k).get.call(original);
 const buffer=get('buffer'),length=get('byteLength'),offset=get('byteOffset');
 if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype||buffer.resizable||buffer.detached||length<1||length>8388608)fail();
 const raw=Buffer.from(new Uint8Array(buffer,offset,length));let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw));}catch{fail();}
 const body=capture(manifestName,parsed);if(!serializeAuth36NormalManifestData(manifestName,body).equals(raw))fail();return body;
}
