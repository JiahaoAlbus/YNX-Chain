// PRIVATE Source-v2 compatibility proposal. Same original registered four-role
// verifier/domain; no Root signer, public provider or admission from this DATA.
import{types}from'node:util';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
export const DESKTOP_GRANT_SOURCE_PURPOSE='desktop-task-grant-authority-source-v1';
export const DESKTOP_GRANT_SOURCE_SELECTION_KEY='desktopTaskGrantAuthorityV1';
export const DESKTOP_GRANT_SOURCE_OPERATIONS=Object.freeze(['grant.issue','grant.effect','grant.query','grant.effect-query','grant.effect-reconcile','grant.list','grant.current','grant.pause','grant.revoke']);
const fail=c=>{throw Object.assign(Error(c),{code:c})};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('DESKTOP_GRANT_SOURCE_SCHEMA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))fail('DESKTOP_GRANT_SOURCE_SCHEMA')}
function token(v){return typeof v==='string'&&/^[A-Za-z0-9._:/-]{1,256}$/.test(v)&&!v.includes('*')}
function decimal(v){return typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18446744073709551615n}
function fullref(r,realm,tenant){exact(r,['realm','tenant','kind','id','rev']);if(!['realm','tenant','kind','id'].every(k=>token(r[k]))||!decimal(r.rev)||r.realm!==realm||r.tenant!==tenant)fail('DESKTOP_GRANT_SOURCE_REF')}
export function inspectOriginalDesktopGrantAuthorityScopeV1DATA(s,association,networkId,subjectOwner,sourceId,instanceId,issuedAtMs,expiresAtMs,atMs){
 exact(s,['version','networkId','subjectOwner','sourceId','instanceId','authorityRef','realm','tenant','issuerFullRef','issuerAccount','issuerEpoch','holderAccount','policyRevision','storeNamespace','storeResourceRef','callerResourceRef','currentPolicyOriginal','effectAmount','nativeBackend','expiresMS']);
 exact(s.nativeBackend,['bytes','sha256']);if(!Number.isSafeInteger(s.nativeBackend.bytes)||s.nativeBackend.bytes<1||s.nativeBackend.bytes>16777216||!/^[0-9a-f]{64}$/.test(s.nativeBackend.sha256)||typeof s.effectAmount!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(s.effectAmount)||BigInt(s.effectAmount)>18446744073709551615n)fail('DESKTOP_GRANT_SOURCE_NATIVE_BACKEND');
 exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(s.version!==1||!/^[a-f0-9]{64}$/.test(networkId)||s.networkId!==networkId||s.subjectOwner!==subjectOwner||s.issuerAccount!==subjectOwner||association.account!==subjectOwner||s.sourceId!==sourceId||s.instanceId!==instanceId||!/^0x[0-9a-f]{40}$/.test(s.issuerAccount)||!/^0x[0-9a-f]{40}$/.test(s.holderAccount)||s.issuerAccount===s.holderAccount||![s.realm,s.tenant,s.storeNamespace,s.storeResourceRef,s.callerResourceRef].every(token)||![s.issuerEpoch,s.policyRevision].every(decimal))fail('DESKTOP_GRANT_SOURCE_SCOPE');
 fullref(s.authorityRef,s.realm,s.tenant);fullref(s.issuerFullRef,s.realm,s.tenant);if(!['human','organization','service'].includes(s.issuerFullRef.kind))fail('DESKTOP_GRANT_SOURCE_AGENT_CANNOT_APPROVE');
 if(Object.values(association).some(v=>typeof v!=='string'||!v||v.length>512)||!['macos','linux','windows'].includes(association.platform))fail('DESKTOP_GRANT_SOURCE_ASSOCIATION');
 if(typeof s.currentPolicyOriginal!=='string'||Buffer.byteLength(s.currentPolicyOriginal)>32768)fail('DESKTOP_GRANT_SOURCE_POLICY_ORIGINAL');const policy=JSON.parse(s.currentPolicyOriginal);if(canonical(policy)!==s.currentPolicyOriginal)fail('DESKTOP_GRANT_SOURCE_POLICY_CANONICAL');
 // This is an authenticated policy ORIGINAL, never parsed caller metadata.
 // The existing BoundGrant policy remains sole semantic validator against the
 // exact actual grant/task/tool/session/input/resource/disclosure at each use.
 exact(policy,['observedAt','expires','issuer','holder','task','session','catalog','policyRevision','authorizedResources','sources',...(Object.hasOwn(policy,'disclosure')?['disclosure']:[])]);
 if(canonical(policy.issuer?.ref)!==canonical(s.issuerFullRef)||policy.issuer?.epoch!==s.issuerEpoch||policy.policyRevision!==s.policyRevision||policy.issuer?.kind!==s.issuerFullRef.kind||policy.issuer?.status!=='active'||policy.issuer?.registered!==true)fail('DESKTOP_GRANT_SOURCE_ISSUER_BINDING');
 if(!decimal(s.expiresMS)||BigInt(s.expiresMS)>BigInt(Number.MAX_SAFE_INTEGER)||!Number.isSafeInteger(issuedAtMs)||!Number.isSafeInteger(expiresAtMs)||!Number.isSafeInteger(atMs)||BigInt(s.expiresMS)<BigInt(expiresAtMs)||atMs<issuedAtMs||atMs>=expiresAtMs||typeof policy.expires!=='string'||!decimal(policy.expires)||BigInt(policy.expires)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(policy.expires)<=BigInt(atMs))fail('DESKTOP_GRANT_SOURCE_WINDOW');
 const scopeOriginal=canonical(s);return Object.freeze({scopeOriginal,scopeHead:sha(scopeOriginal),effectExpiresAtMs:Math.min(expiresAtMs,Number(s.expiresMS),Number(policy.expires)),dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false});
}
