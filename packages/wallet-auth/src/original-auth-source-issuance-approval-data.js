import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2} from '../native/original-auth-identity-source-v2-verifier.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const roles=Object.freeze({enrollment:'AUTH-SOURCE-ENROLLMENT',profile:'AUTH-SOURCE-PROFILE'});
// Existing separately admitted families plus the dedicated device-v4 CODE
function document(raw){let v;try{v=JSON.parse(raw);}catch{fail('AUTH_ISSUANCE_CANONICAL');}if(typeof raw!=='string'||Buffer.byteLength(raw)>393216||canonical(v)!==raw)fail('AUTH_ISSUANCE_CANONICAL');return v;}
function exact(v,names){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==names.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))fail('AUTH_ISSUANCE_SCHEMA');}
function window(v,now){if(!Number.isSafeInteger(v.issuedAtMs)||!Number.isSafeInteger(v.expiresAtMs)||v.issuedAtMs<0||v.expiresAtMs<=v.issuedAtMs||v.expiresAtMs-v.issuedAtMs>86400000||now<v.issuedAtMs||now>=v.expiresAtMs)fail('AUTH_ISSUANCE_EXPIRED');}
export function inspectOriginalAuthSourceIssuanceApprovalV2DATA(p,raw,now){
 const a=document(raw),message=encodeOriginalAuthSourceStatementV2(p.role,p.policy.signatureContract[p.role+'Frame'],p.binding,p.bodyRaw);
 exact(a,['version','role','purpose','owner','networkId','keyVersion','bodySHA256','messageSHA256','decision','issuedAtMs','expiresAtMs']);
 if(sha(raw)!==p.approvalDigest||a.version!=='YNX-ORIGINAL-SOURCE-ISSUANCE-APPROVAL/v1'||a.role!==p.role||a.purpose!==roles[p.role]||a.owner!==p.binding.owner||a.networkId!==p.binding.networkId||a.keyVersion!==p.binding.keyVersion||a.bodySHA256!==sha(p.bodyRaw)||a.messageSHA256!==sha(message)||a.decision!=='approved')fail('AUTH_ISSUANCE_INDEPENDENT_APPROVAL_REQUIRED');
 window(a,now);return{message,a};
}
