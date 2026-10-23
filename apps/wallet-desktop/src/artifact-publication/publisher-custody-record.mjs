// Private plaintext STORAGE layout, not a cryptographic envelope or signed
// message. The original KEY-MATERIAL/v1 object ABI is preserved on decode.
// Only the protected store may use this buffer, seal it with the original R in
// the SAME ciphertext, and wipe it. Never write this plaintext to the file
// backend, renderer, IPC, logs or an evidence handoff.
// This codec grants no Source/current/registration/approval and does not prove
// key purpose history or that private keys derive the claimed public pair.
// The owning native caller must verify actual Source and exact registered R,
// then use the SDK's purpose-specific import to recompute both public keys.
import {types} from 'node:util';
const magic=Buffer.from('YNX-PUBLISHER-CUSTODY/v1\n');
const suite='ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512';
const sizes={pkcs8A:54,pkcs8B:150,pkA:2592,pkB:64};
const fields=['format','algorithmVersion','suite',...Object.keys(sizes)];
const MAX=magic.length+4+8192+4*4+54+150+2592+64;
const fail=()=>{throw Object.assign(Error('PUBLISHER_CUSTODY_RECORD_INVALID'),{code:'PUBLISHER_CUSTODY_RECORD_INVALID'});};
const typed=Object.getPrototypeOf(Uint8Array.prototype);
const getter=key=>Object.getOwnPropertyDescriptor(typed,key).get;
const getBuffer=getter('buffer'),getOffset=getter('byteOffset'),getLength=getter('byteLength');
const resizable=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get;
function bytes(value,max,exact){
 if(types.isProxy(value)||!types.isUint8Array(value))fail();
 const buffer=getBuffer.call(value),offset=getOffset.call(value),length=getLength.call(value);
 if(types.isSharedArrayBuffer(buffer)||resizable?.call(buffer)||!length||length>max||exact!==undefined&&length!==exact)fail();
 return Buffer.from(new Uint8Array(buffer,offset,length));
}
function material(input){
 if(!input||types.isProxy(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail();
 const ds=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(ds);
 if(keys.length!==fields.length||keys.some(k=>!fields.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();
 if(ds.format.value!=='YNX-BATCH/KEY-MATERIAL/v1'||ds.algorithmVersion.value!=='YNX-BATCH/v0.1'||ds.suite.value!==suite)fail();
 const result={};
 try{for(const [key,size]of Object.entries(sizes))result[key]=bytes(ds[key].value,size,size);return result;}
 catch(cause){wipe(result);throw cause;}
}
function wipe(value){value?.pkcs8A?.fill(0);value?.pkcs8B?.fill(0);}
/** Returns sensitive plaintext; caller must immediately seal and wipe it. */
export function encodePublisherCustodyRecordData(publicOriginal,keyMaterial){
 let r,m;
 try{
  r=bytes(publicOriginal,8192);m=material(keyMaterial);
  const pieces=[magic];
  for(const part of [r,...Object.keys(sizes).map(k=>m[k])]){const length=Buffer.alloc(4);length.writeUInt32BE(part.length);pieces.push(length,part);}
  return Buffer.concat(pieces);
 }finally{wipe(m);}
}
/** Only call after unsealing. expectedPublicOriginal must be from the original
 * protected record AND currently registered Source, never renderer input.
 * Exact R equality precedes returning any private material. No key is created
 * or imported here; validation and admission are still the SDK/Native owners'. */
export function decodePublisherCustodyRecordData(plaintext,expectedPublicOriginal){
 let raw,m;
 try{
  raw=bytes(plaintext,MAX);const expected=bytes(expectedPublicOriginal,8192);
  if(raw.length<magic.length+4||!raw.subarray(0,magic.length).equals(magic))fail();
  let at=magic.length;
  const take=(max,exact)=>{if(at+4>raw.length)fail();const n=raw.readUInt32BE(at);at+=4;if(!n||n>max||exact!==undefined&&n!==exact||at+n>raw.length)fail();const result=raw.subarray(at,at+n);at+=n;return result;};
  const r=take(8192);if(!r.equals(expected))fail();
  // Parse all lengths and enforce no trailing bytes before copying secrets.
  const parts={};for(const [key,size]of Object.entries(sizes))parts[key]=take(size,size);
  if(at!==raw.length)fail();
  m={format:'YNX-BATCH/KEY-MATERIAL/v1',algorithmVersion:'YNX-BATCH/v0.1',suite};
  for(const key of Object.keys(sizes))m[key]=Buffer.from(parts[key]);
  return Object.freeze({publicOriginal:Buffer.from(r),keyMaterial:Object.freeze(m)});
 }catch(cause){wipe(m);throw cause;}finally{raw?.fill(0);}
}
