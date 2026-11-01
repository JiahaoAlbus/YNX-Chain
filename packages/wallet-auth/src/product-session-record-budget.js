// Purpose-limited pending storage, not approval/Source/authorization parsing.
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {decodeBase64url} from './base64url.js';
const bytes=s=>new TextEncoder().encode(s).length;
const fail=()=>{throw new WalletAuthError('INVALID_SESSION_STORE','Protected Product Session record exceeds its purpose budget')};
export function productSessionRecordWithinBudget(key,raw){
 if(typeof raw!=='string')return false;
 if(key.endsWith(':revoke-completions'))return bytes(raw)<=131072;
 if(bytes(raw)<=16384)return true;
 if(key.endsWith(':completion')){
  if(bytes(raw)>196608)return false;
  try{const v=JSON.parse(raw);exactFields(v,['request','approval','completion'],'PQ completion record');return v.request?.version==='2'&&v.approval?.version==='3'&&v.approval?.accountAuthorization?.algorithmVersion==='YNX-BATCH/v0.1'&&canonicalJSON(v)===raw;}catch{return false;}
 }
 if(key.endsWith(':return')){
  if(bytes(raw)>262144)return false;
  try{const u=new URL(raw);if(u.hash||u.username||u.password||['http:','file:','javascript:'].includes(u.protocol)||[...u.searchParams.keys()].sort().join('|')!=='approval|nonce|result|state'||u.searchParams.get('result')!=='approved')return false;
   const a=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64url(u.searchParams.get('approval'))));return a.version==='3'&&a.accountAuthorization?.algorithmVersion==='YNX-BATCH/v0.1';
  }catch{return false;}
 }
 return false;
}
export function assertProductSessionRecordBudget(key,raw){if(!productSessionRecordWithinBudget(key,raw))fail();return undefined;}
