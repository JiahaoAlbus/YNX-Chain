// DATA serialization of the EXISTING Go developerauthority.Principal value.
// Not an identity/grant, Source, HTTP issuer or new signature domain. In
// particular canonical sorted lowercase profile JSON is NOT this original.
// Original server permissions must independently supply the genuine Principal.
import{createHash}from'node:crypto';
const fields=['account','deviceId','sessionRef','currentRef','accountGeneration','sessionGeneration','expiresMS'];
const invalid=()=>{throw Object.assign(Error('IDE_ORIGINAL_PRINCIPAL_DATA_INVALID'),{code:'IDE_ORIGINAL_PRINCIPAL_DATA_INVALID'});};
const edge=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
function record(v){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)invalid();
 const d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
 if(keys.length!==fields.length||keys.some(k=>!fields.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))invalid();
 return Object.fromEntries(fields.map(k=>[k,d[k].value]));
}
function text(s){if(typeof s!=='string'||!s.isWellFormed()||!s.length||Buffer.byteLength(s)>256||/[\x00-\x20\x7f]/.test(s)||edge.test(s))invalid();return s;}
function positive(s,max){if(typeof s!=='string'||! /^[1-9][0-9]{0,19}$/.test(s))invalid();const n=BigInt(s);if(n>max)invalid();return s;}
// Go encoding/json default EscapeHTML=true, also escapes U+2028/2029. Each
// decimal is inserted as its canonical original integer, never JS Number.
function string(s){return JSON.stringify(text(s)).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));}
export function encodeOriginalDeveloperPrincipalDATA(input){
 const p=record(input),u64=18446744073709551615n,i64=9223372036854775807n;
 const ag=positive(p.accountGeneration,u64),sg=positive(p.sessionGeneration,u64),expires=positive(p.expiresMS,i64);
 const original='{"Account":'+string(p.account)+',"DeviceID":'+string(p.deviceId)+',"SessionRef":'+string(p.sessionRef)+',"CurrentRef":'+string(p.currentRef)+',"AccountGeneration":'+ag+',"SessionGeneration":'+sg+',"ExpiresMS":'+expires+'}';
 return Object.freeze({principalOriginal:original,principalSHA256:createHash('sha256').update(original).digest('hex'),dataOnly:true,trusted:false,authorized:false,nativeAdmission:false});
}
