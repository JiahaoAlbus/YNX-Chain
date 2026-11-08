// Sole existing device V4 HTTP response DATA grammar, moved from streaming
// Node gateway. Actual fixed TLS/headers/Source provenance belongs to Main;
// these bytes/status alone never supply transport admission or a Source.
import{canonicalJSON,exactFields,WalletAuthError}from'./canonical.js';
const fail=(code,message)=>{throw new WalletAuthError(code,message);};
const ta=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(ta,Symbol.toStringTag).get,len=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buf=Object.getOwnPropertyDescriptor(ta,'buffer').get,abl=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,set=Uint8Array.prototype.set;
export function inspectOriginalDeviceV4HTTPResponseDATA(status,originalBytes){
 let n,b;try{if(tag.call(originalBytes)!=='Uint8Array')throw 0;n=len.call(originalBytes);b=buf.call(originalBytes);abl.call(b);}catch{fail('PAIR_V4_HTTP_RESPONSE','Original bounded bytes/status required');}
 if(n>1048576||!Number.isInteger(status))fail('PAIR_V4_HTTP_RESPONSE','Original bounded bytes/status required');const raw=new Uint8Array(n);try{set.call(raw,originalBytes);}catch{fail('PAIR_V4_HTTP_RESPONSE','Original bounded bytes/status required');}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('PAIR_V4_HTTP_RESPONSE','Invalid response JSON');}
  if(status===409){exactFields(value,['code','newSession'],'Original recovery-only response');if(value.code!=='PAIR_V4_RECOVER_ORIGINAL_ONLY'||value.newSession!==false)fail('PAIR_V4_HTTP_RESPONSE','Invalid recovery-only response');throw Object.assign(new WalletAuthError(value.code,'Original operation requires recovery'),{originalResponse:value});}
  if(status!==200){exactFields(value,['code','authorized','newSession'],'Original refused response');if(typeof value.code!=='string'||!/^PAIR_V4_[A-Z0-9_]+$/.test(value.code)||value.authorized!==false||value.newSession!==false)fail('PAIR_V4_HTTP_RESPONSE','Invalid refusal');throw Object.assign(new WalletAuthError(value.code,'Original Auth refused this request'),{originalResponse:value});}
  exactFields(value,['original','durable','sourceAdmission','nativeAdmission'],'Original durable response');
  if(value.durable!==true||value.sourceAdmission!==false||value.nativeAdmission!==false||typeof value.original!=='string'||!value.original.length||new TextEncoder().encode(value.original).length>393216)fail('PAIR_V4_HTTP_RESPONSE','Invalid original result');
  let original;try{original=JSON.parse(value.original);}catch{fail('PAIR_V4_HTTP_RESPONSE','Original result is not JSON');}
  if(canonicalJSON(original)!==value.original)fail('PAIR_V4_HTTP_RESPONSE','Original result bytes changed');
  // DATA only. The existing caller verifies the returned original against the
  // request, current Source, account approval and fixed proof codecs.
  return Object.freeze(value);
}
