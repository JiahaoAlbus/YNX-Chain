// PRIVATE SOURCE-ONLY COMPATIBILITY PROPOSAL. NOT a published OPEN schema,
// accepted Root purpose, signing API, or live management permission.
import{types}from'node:util';import{createHash}from'node:crypto';
import{encodeFields}from'@ynx/batch-v01-candidate';
import{canonicalJSON}from'./canonical.js';
import{verifyPQRegisteredMemberData}from'./pq-registered-member.js';
import{inspectPQAuthorizationView}from'./pq-wallet-policy.js';
export const PROPOSED_GRANT_MANAGEMENT_PURPOSE='AUTH-GRANT-MANAGEMENT';
export const PROPOSED_GRANT_MANAGEMENT_DOMAIN='YNX/AUTH/GRANT-MANAGEMENT/1';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
export function exact(v,fields){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('GRANT_MANAGEMENT_SCHEMA');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==fields.length||fields.some(k=>!ds[k]?.enumerable||!Object.hasOwn(ds[k],'value')))fail('GRANT_MANAGEMENT_SCHEMA');return v}
const eq=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
function snapshot(v,depth=0){if(depth>8)fail('GRANT_MANAGEMENT_SCHEMA');if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('GRANT_MANAGEMENT_SCHEMA');const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);if(keys.length>16||keys.some(k=>typeof k!=='string'||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('GRANT_MANAGEMENT_SCHEMA');return Object.freeze(Object.fromEntries(keys.map(k=>[k,snapshot(ds[k].value,depth+1)])))}
export function binding(bytes){if(!(bytes instanceof Uint8Array)||bytes.buffer instanceof SharedArrayBuffer||bytes.length>65536)fail('GRANT_MANAGEMENT_BYTES');return{bytes:String(bytes.length),sha3_512:createHash('sha3-512').update(bytes).digest('hex'),sha512:createHash('sha512').update(bytes).digest('hex')}}
function text(v){if(typeof v!=='string'||!v.isWellFormed()||!v.length||v.length>256||/[\x00-\x1f\x7f]/.test(v))fail('GRANT_MANAGEMENT_TEXT')}
function decimal(v){if(typeof v!=='string'||!/^[1-9][0-9]{0,19}$/.test(v)||BigInt(v)>18446744073709551615n)fail('GRANT_MANAGEMENT_UINT')}
export function inspectManagementRequestDATA(input){
 exact(input,['action','ownerRef','grantRef','expectedRevision','afterId','limit']);
 const b=snapshot(input);if(!['list','current','pause','revoke'].includes(b.action))fail('GRANT_MANAGEMENT_ACTION');exact(b.ownerRef,['realm','tenant','kind','id','rev']);for(const k of['realm','tenant','kind','id'])text(b.ownerRef[k]);decimal(b.ownerRef.rev);if(!['human','organization','service'].includes(b.ownerRef.kind))fail('GRANT_MANAGEMENT_AGENT_CANNOT_APPROVE');
 if(b.action==='list'){if(b.grantRef!==null||b.expectedRevision!==null||typeof b.afterId!=='string'||b.afterId.length>256||!b.afterId.isWellFormed()||/[\x00-\x1f\x7f]/.test(b.afterId)||!Number.isInteger(b.limit)||b.limit<1||b.limit>100)fail('GRANT_MANAGEMENT_SELECTION')}
 else{exact(b.grantRef,['realm','tenant','kind','id','rev']);for(const k of['realm','tenant','id'])text(b.grantRef[k]);decimal(b.grantRef.rev);if(b.grantRef.kind!=='grant'||b.grantRef.realm!==b.ownerRef.realm||b.grantRef.tenant!==b.ownerRef.tenant||b.afterId!==''||b.limit!==1)fail('GRANT_MANAGEMENT_SCOPE');if(b.action==='current'){if(b.expectedRevision!==null)fail('GRANT_MANAGEMENT_REVISION')}else{decimal(b.expectedRevision);if(b.expectedRevision!==b.grantRef.rev)fail('GRANT_MANAGEMENT_REVISION')}}
 return Object.freeze(b);
}
export function encodeProposedManagementMessageDATA(bodyRaw){
 if(typeof bodyRaw!=='string'||Buffer.byteLength(bodyRaw)>16384)fail('GRANT_MANAGEMENT_BODY');const b=JSON.parse(bodyRaw);exact(b,['version','action','realm','tenant','issuerFullRef','grantRef','expectedRevision','selection','sourceRef','issuerEpoch','policyRevision','issuedMS','expiresMS','nonce','bodyBinding']);if(canonicalJSON(b)!==bodyRaw||b.version!=='AUTH-GRANT-MANAGEMENT-PROPOSED/v1')fail('GRANT_MANAGEMENT_BODY');return new Uint8Array(encodeFields([PROPOSED_GRANT_MANAGEMENT_DOMAIN,bodyRaw]));
}
// The caller MUST supply independent original Source/issuer current before and
// after this real registered N1 math; signatureVerified alone grants nothing.
export function verifyOriginalManagementProofDATA(proof,request,authority,registration,at){
 exact(proof,['bodyOriginal','memberOriginal']);if(typeof proof.bodyOriginal!=='string'||types.isProxy(proof.memberOriginal)||!(proof.memberOriginal instanceof Uint8Array)||proof.memberOriginal.buffer instanceof SharedArrayBuffer)fail('GRANT_MANAGEMENT_PROOF');const bodyRaw=proof.bodyOriginal,member=Buffer.from(proof.memberOriginal),message=encodeProposedManagementMessageDATA(bodyRaw),b=JSON.parse(bodyRaw),r=inspectManagementRequestDATA(request);
 inspectPQAuthorizationView(registration);if(!Number.isSafeInteger(at)||at<0||!eq(r.ownerRef,authority.ownerRef)||!eq(b.issuerFullRef,authority.ownerRef)||b.realm!==r.ownerRef.realm||b.tenant!==r.ownerRef.tenant||b.action!==r.action||!eq(b.grantRef,r.grantRef)||b.expectedRevision!==r.expectedRevision||!eq(b.selection,{afterId:r.afterId,limit:r.limit})||!eq(b.sourceRef,authority.sourceRef)||b.issuerEpoch!==authority.issuerEpoch||b.policyRevision!==authority.policyRevision||!eq(b.bodyBinding,binding(Buffer.from(canonicalJSON(r)))))fail('GRANT_MANAGEMENT_BINDING');
 decimal(b.issuerEpoch);decimal(b.policyRevision);for(const n of['issuedMS','expiresMS'])if(typeof b[n]!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(b[n])||BigInt(b[n])>BigInt(Number.MAX_SAFE_INTEGER))fail('GRANT_MANAGEMENT_WINDOW');if(BigInt(b.issuedMS)>BigInt(at)||BigInt(at)>=BigInt(b.expiresMS)||BigInt(b.expiresMS)-BigInt(b.issuedMS)>30000n||BigInt(b.expiresMS)>BigInt(authority.expiresMS)||!/^[a-f0-9]{32,128}$/.test(b.nonce))fail('GRANT_MANAGEMENT_WINDOW');
 const keyVersion=authority.issuerEpoch;if(registration.owner!==authority.issuerAccount||registration.networkId!==authority.networkId)fail('GRANT_MANAGEMENT_ISSUER');
 verifyPQRegisteredMemberData(registration,member,{chainId:authority.networkId,owner:authority.issuerAccount,keyVersion,executionHeight:registration.executionHeight,purpose:PROPOSED_GRANT_MANAGEMENT_PURPOSE,message});
 return Object.freeze({nonce:b.nonce,expiresMS:b.expiresMS,proofBinding:binding(message),dataOnly:true,authorized:false});
}
