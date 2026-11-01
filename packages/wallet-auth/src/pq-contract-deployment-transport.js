// Five-field compiler-material envelope DATA, not compiler provenance.
// Original Go validates source/code/config/ABI against its fixed registry.
import {pqBase64url} from './pq-wallet-contract.js';
import {encodePQActionTransportData,decodePQActionTransportData} from './pq-action-transport.js';
export const PQ_CONTRACT_DEPLOYMENT_SOURCE_MAX_BYTES=64<<10;
export const PQ_CONTRACT_DEPLOYMENT_ARTIFACT_MAX_BYTES=128<<10;
export const PQ_CONTRACT_DEPLOYMENT_BUILD_INFO_MAX_BYTES=16<<20;
const outerMax=24<<20,te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fail=()=>{throw Object.assign(new Error('PQ_CONTRACT_DEPLOYMENT_TRANSPORT_INVALID'),{code:'PQ_CONTRACT_DEPLOYMENT_TRANSPORT_INVALID'});};
const tap=Object.getPrototypeOf(Uint8Array.prototype);
const tb=Object.getOwnPropertyDescriptor(tap,'buffer').get,tl=Object.getOwnPropertyDescriptor(tap,'length').get,to=Object.getOwnPropertyDescriptor(tap,'byteOffset').get;
const al=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,ar=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get,ad=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached')?.get;
function copy(value,max){
  const buffer=tb.call(value),length=tl.call(value),offset=to.call(value),capacity=al.call(buffer);
  if(!(value instanceof Uint8Array)||!length||length>max||offset+length>capacity||ar?.call(buffer)||ad?.call(buffer))fail();
  return new Uint8Array(new Uint8Array(buffer,offset,length));
}
function record(value,keys){
  if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);
  if(actual.length!==keys.length||actual.some(k=>!keys.includes(k))||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();
  return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
// Go unicode.IsSpace; FEFF is deliberately not whitespace here.
const edge=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
function source(value){
  if(typeof value!=='string'||!value.length||value.length>PQ_CONTRACT_DEPLOYMENT_SOURCE_MAX_BYTES||/[\ud800-\udfff]/u.test(value)||edge.test(value)||te.encode(value).length>PQ_CONTRACT_DEPLOYMENT_SOURCE_MAX_BYTES)fail();
  return value;
}
function capture(value){
  const input=record(value,['source','material']),s=source(input.source),m=record(input.material,['artifactFile','buildInfoFile']);
  return {source:s,artifactFile:copy(m.artifactFile,PQ_CONTRACT_DEPLOYMENT_ARTIFACT_MAX_BYTES),buildInfoFile:copy(m.buildInfoFile,PQ_CONTRACT_DEPLOYMENT_BUILD_INFO_MAX_BYTES)};
}
function material(c){return Object.freeze({artifactFile:new Uint8Array(c.artifactFile),buildInfoFile:new Uint8Array(c.buildInfoFile)});}
function expose(c){return Object.freeze({source:c.source,get material(){return material(c);},dataOnly:true,nativeAdmission:false,compilerMaterialValidationRequired:true});}
/** Before-key availability/copy fence only, never an authenticated witness. */
export function capturePQContractDeploymentMaterialData(value){try{return expose(capture(value));}catch{fail();}}
function standard64(value){const s=pqBase64url(value).replaceAll('-','+').replaceAll('_','/');return s+'='.repeat((4-s.length%4)%4);}
function read64(value,max){
  if(typeof value!=='string'||!value.length||value.length>4*Math.ceil(max/3)||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail();
  const length=value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0);
  if(!length||length>max)fail();
  const decoded=atob(value),b=new Uint8Array(length);
  if(decoded.length!==length)fail();
  // Avoid Uint8Array.from(string): a 16MiB build-info must not first allocate
  // a generic multi-million-element iterator array.
  for(let i=0;i<length;i++)b[i]=decoded.charCodeAt(i);
  if(standard64(b)!==value)fail();return b;
}
// Go encoding/json default HTML + U2028/U2029 escaping, preserving source text.
function goJSON(value){return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
function encode(member,c){
  const base=JSON.parse(td.decode(encodePQActionTransportData({member,originals:[]})));
  const out={version:1,type:'pq_action',wireHex:base.wireHex,source:c.source,material:{artifactFile:'',buildInfoFile:''}};
  const size=te.encode(goJSON(out)).length+4*Math.ceil(c.artifactFile.length/3)+4*Math.ceil(c.buildInfoFile.length/3);
  if(size>outerMax)fail();
  out.material.artifactFile=standard64(c.artifactFile);out.material.buildInfoFile=standard64(c.buildInfoFile);
  const raw=te.encode(goJSON(out));if(raw.length!==size||raw.length>outerMax)fail();return raw;
}
export function encodePQContractDeploymentTransportData(value){
  try{const input=record(value,['member','source','material']);return encode(copy(input.member,128<<10),capture({source:input.source,material:input.material}));}catch{fail();}
}
export function decodePQContractDeploymentTransportData(value){
  try{
    const raw=copy(value,outerMax),text=td.decode(raw),input=record(JSON.parse(text),['version','type','wireHex','source','material']);
    if(input.version!==1||input.type!=='pq_action')fail();
    const base=decodePQActionTransportData(te.encode(JSON.stringify({version:input.version,type:input.type,wireHex:input.wireHex})));
    const m=record(input.material,['artifactFile','buildInfoFile']);
    const c={source:source(input.source),artifactFile:read64(m.artifactFile,PQ_CONTRACT_DEPLOYMENT_ARTIFACT_MAX_BYTES),buildInfoFile:read64(m.buildInfoFile,PQ_CONTRACT_DEPLOYMENT_BUILD_INFO_MAX_BYTES)};
    if(td.decode(encode(base.member,c))!==text)fail();
    const member=base.member;
    return Object.freeze({source:c.source,get member(){return new Uint8Array(member);},get material(){return material(c);},dataOnly:true,nativeAdmission:false,compilerMaterialValidationRequired:true,memberValidationRequired:true});
  }catch{fail();}
}
