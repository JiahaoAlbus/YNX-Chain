// Original Auth R159 typed6 publication manifest DATA. No key, grant or issuer.
// Inspecting validates the retained original; signing must bind that original
// byte array, never a newly serialized DTO returned by this inspector.
const keys=Object.freeze(['byteSize','contentDigest','projectId','publishPurpose','targetEnvironment','version']);
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fail=()=>{throw Object.assign(new Error('IDE_ARTIFACT_MANIFEST_INVALID'),{code:'IDE_ARTIFACT_MANIFEST_INVALID'});};
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typed,'buffer').get;
const lengthOf=Object.getOwnPropertyDescriptor(typed,'length').get;
const offsetOf=Object.getOwnPropertyDescriptor(typed,'byteOffset').get;
const capacityOf=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get;
const resizableOf=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
const detachedOf=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'detached')?.get;
function copyOriginal(value){
 if(Object.getPrototypeOf(value)!==Uint8Array.prototype)fail();
 const buffer=bufferOf.call(value),length=lengthOf.call(value),offset=offsetOf.call(value);
 if(Object.getPrototypeOf(buffer)!==ArrayBuffer.prototype||length<1||length>16384||offset+length>capacityOf.call(buffer)||resizableOf?.call(buffer)||detachedOf?.call(buffer))fail();
 const own=Reflect.ownKeys(value);
 if(own.length!==length||own.some((key,i)=>key!==String(i)))fail();
 // Built-in buffer/view operations cannot invoke a caller iterator or getter.
 return new Uint8Array(new Uint8Array(buffer,offset,length));
}
function capture(value){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const ds=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(ds);
 if(own.length!==6||own.some(k=>!keys.includes(k)))fail();
 const result={};
 for(const k of keys){const d=ds[k];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();result[k]=d.value;}
 return result;
}
// Foundation whitespaceAndNewlineCharacterSet (including NEL), and control
// character categories Cc/Cf. Do not use ECMAScript trim's different FEFF set.
const edge=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
function validate(m){
 if(!Number.isSafeInteger(m.byteSize)||m.byteSize<1||m.byteSize>67108864)fail();
 if(typeof m.contentDigest!=='string'||! /^[a-f0-9]{64}$/.test(m.contentDigest))fail();
 for(const k of ['projectId','version','publishPurpose','targetEnvironment']){
  const text=m[k];
  // With /u a valid surrogate pair is one scalar and does not match this range.
  if(typeof text!=='string'||text.length===0||text.length>256||/[\ud800-\udfff]/u.test(text)||/[\p{Cc}\p{Cf}]/u.test(text)||edge.test(text)||te.encode(text).length>256)fail();
 }
 return m;
}
function encode(m){const raw=te.encode(JSON.stringify(m));if(raw.length<1||raw.length>16384)fail();return raw;}
/** Copy and encode exact six own enumerable DATA fields in original key order. */
export function encodeIDEArtifactManifestData(input){try{return encode(validate(capture(input)));}catch{fail();}}
/** Validate exact original canonical UTF-8; return a frozen six-field DATA DTO. */
export function inspectIDEArtifactManifestData(original){
 try{
  const raw=copyOriginal(original),text=td.decode(raw),m=validate(capture(JSON.parse(text))),canonical=encode(m);
  if(raw.length!==canonical.length||raw.some((v,i)=>v!==canonical[i]))fail();
  return Object.freeze(m);
 }catch{fail();}
}
