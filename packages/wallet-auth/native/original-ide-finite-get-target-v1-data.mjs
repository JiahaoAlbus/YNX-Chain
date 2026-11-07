import{inspectProductSessionHTTPProofV4OriginDATA}from'../src/product-session-proof-v4.js';
// PRIVATE signed-profile projection DATA. Never Target/Root/Source/TLS authority.
import {types} from 'node:util';import {createHash} from 'node:crypto';
import {canonicalJSON} from '../src/canonical.js';
import {IDE_FINITE_GET_OPERATIONS} from '../src/original-ide-finite-get-proof-v4.js';
export const IDE_FINITE_GET_TARGET_SELECTION_KEY='ideFiniteGETTargetV1';
export const IDE_FINITE_GET_TARGET_SOURCE_PURPOSE='ide-project-authority-v1';
const fields=['version','parentSourceId','projectSourceId','deviceSourceId','account','deviceId','sessionBinding','registrationDigest','catalogProjectId','registeredCloudFullRef','resourceApprovalRef','targetOrigin','serverName','port','spkiSHA256','productOrigin','requiredScopes','permittedSelectors','publicCredentialRef','localSAN','peerSAN','rootCertificateSHA256','clientCertificateSHA256','notBeforeMs','expiresMs','rootEpoch','rootUntilMs','credentialEpoch','credentialUntilMs'];
const fail=c=>{throw Object.assign(Error(c),{code:c});};
function exact(v,keys){if(types.isProxy(v)||!v||Object.getPrototypeOf(v)!==Object.prototype)fail('IDE_GET_TARGET_EXACT_DATA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('IDE_GET_TARGET_EXACT_DATA');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
function text(v){return typeof v==='string'&&v.length>0&&v.isWellFormed()&&Buffer.byteLength(v)<=256&&!/[\p{White_Space}\p{Cc}]/u.test(v);}
function hex(v){return typeof v==='string'&&v.length===64&&/^[0-9a-f]{64}$/.test(v);}
function u64(v){return typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;}
function origin(v){try{const u=new URL(v);return typeof v==='string'&&text(v)&&u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&!u.search&&!u.hash&&u.origin===v;}catch{return false;}}
function vector(v,finite){if(types.isProxy(v)||!Array.isArray(v))fail('IDE_GET_TARGET_VECTOR');const d=Object.getOwnPropertyDescriptors(v),n=d.length.value;if(Reflect.ownKeys(d).length!==n+1)fail('IDE_GET_TARGET_VECTOR');const a=[];for(let i=0;i<n;i++){const x=d[i];if(!x||!Object.hasOwn(x,'value')||!text(x.value)||(finite&&!IDE_FINITE_GET_OPERATIONS.includes(x.value)))fail('IDE_GET_TARGET_VECTOR');a.push(x.value);}if(new Set(a).size!==a.length)fail('IDE_GET_TARGET_VECTOR');return Object.freeze(a);}
export function inspectOriginalIDEFiniteGETTargetV1DATA(value){
 const c=exact(value,fields),r=exact(c.registeredCloudFullRef,['realm','tenant','kind','id','rev']);
 if(c.version!==1)fail('IDE_GET_TARGET_VERSION');
 for(const k of ['parentSourceId','projectSourceId','deviceSourceId','account','deviceId','catalogProjectId','resourceApprovalRef','serverName','publicCredentialRef','localSAN','peerSAN'])if(!text(c[k]))fail('IDE_GET_TARGET_TEXT');
 if(!['realm','tenant','kind','id'].every(k=>text(r[k]))||!u64(r.rev)||!u64(c.rootEpoch)||!u64(c.credentialEpoch))fail('IDE_GET_TARGET_U64');
 if(!['sessionBinding','registrationDigest','spkiSHA256','rootCertificateSHA256','clientCertificateSHA256'].every(k=>hex(c[k])))fail('IDE_GET_TARGET_DIGEST');
 let validProduct=false;try{validProduct=inspectProductSessionHTTPProofV4OriginDATA(c.productOrigin)===c.productOrigin;}catch{}
 if(!origin(c.targetOrigin)||!validProduct||!Number.isInteger(c.port)||c.port<1||c.port>65535)fail('IDE_GET_TARGET_ORIGIN');
 for(const k of ['notBeforeMs','expiresMs','rootUntilMs','credentialUntilMs'])if(!Number.isSafeInteger(c[k])||c[k]<1)fail('IDE_GET_TARGET_WINDOW');
 if(c.expiresMs<=c.notBeforeMs||c.expiresMs>c.rootUntilMs||c.expiresMs>c.credentialUntilMs)fail('IDE_GET_TARGET_WINDOW');
 const cap=Object.freeze({...c,registeredCloudFullRef:Object.freeze(r),requiredScopes:vector(c.requiredScopes,false),permittedSelectors:vector(c.permittedSelectors,true)}),capOriginal=canonicalJSON(cap),capSHA256=createHash('sha256').update(capOriginal).digest('hex');
 return Object.freeze({cap,capOriginal,capSHA256,dataOnly:true,TargetQualified:false,RootAdmission:false,SourceAdmission:false,permission:false});
}
/** Coherence ONLY after original Source V2 signed profile math. Not Native expected. */
export function assertOriginalIDEFiniteGETTargetProfileBindingDATA(value,profile){
 const data=inspectOriginalIDEFiniteGETTargetV1DATA(value),c=data.cap,s=profile.selection;
 if(profile.purpose!==IDE_FINITE_GET_TARGET_SOURCE_PURPOSE||c.projectSourceId!==profile.sourceId||c.account!==s.association.account||c.deviceId!==s.association.deviceId||c.account!==s.projectAuthority.principal.account||c.deviceId!==s.projectAuthority.principal.deviceId||c.catalogProjectId!==s.projectAuthority.project.projectId||c.notBeforeMs<profile.issuedAtMs||c.expiresMs>profile.expiresAtMs)fail('IDE_GET_TARGET_PROFILE_BINDING');
 // principal.sessionRef is NOT a V4 sessionBinding hash. Native must bind actual
 // DEVICE.expected.sessionBinding + independent Root row and original session.
 return data;
}
