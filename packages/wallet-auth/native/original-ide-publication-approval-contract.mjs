// ORIGINAL Auth Source-v2 approval-current contract prerequisite. This code
// issues no capability. An account/KEY7 signature, UUID, local journal or
// generic source-current statement MUST NOT be admitted as this evidence.
// The dedicated Root/role/caller registration remains independently required.
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2} from './original-auth-identity-source-v2-verifier.mjs';
import {verifyPQRegisteredMemberData} from '../src/pq-registered-member.js';
import {pqDecodeBase64url,pqBase64url,exactPQRecord} from '../src/pq-wallet-contract.js';
import {pqU64} from '../src/pq-wallet-authorization.js';
import {inspectPQAuthorizationView} from '../src/pq-wallet-policy.js';
export const ORIGINAL_IDE_PUBLICATION_APPROVAL_SCOPE='YNX-IDE-PUBLICATION-APPROVAL-SCOPE/v1';
export const ORIGINAL_IDE_APPROVAL_CURRENT='YNX-IDE-APPROVAL-CURRENT/v1';
export const ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE='ide-publication-approval-authority-v1';
export const ORIGINAL_IDE_APPROVAL_FRAMES=Object.freeze({artifact:'YNX-IDE-ARTIFACT-APPROVAL-CURRENT/v1',resource:'YNX-IDE-RESOURCE-APPROVAL-CURRENT/v1'});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.isWellFormed()&&Buffer.byteLength(v)>0&&Buffer.byteLength(v)<=256&&!/[\x00-\x20\x7f]/u.test(v);
const ms=v=>Number.isSafeInteger(v)&&v>0;
function number(v,positive=true){try{if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)||pqU64(v).toString()!==v||positive&&v==='0')fail('IDE_APPROVAL_DECIMAL');return BigInt(v);}catch{fail('IDE_APPROVAL_DECIMAL');}}
function parse(raw,cap){if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>cap)fail('IDE_APPROVAL_CAPACITY');let v;try{v=JSON.parse(raw);}catch{fail('IDE_APPROVAL_CANONICAL');}if(canonical(v)!==raw)fail('IDE_APPROVAL_CANONICAL');return v;}
function nonce(v){try{return typeof v==='string'&&pqDecodeBase64url(v,{exact:32,max:32}).some(x=>x!==0)&&pqBase64url(pqDecodeBase64url(v,{exact:32,max:32}))===v;}catch{return false;}}
const common=['version','kind','sourcePurpose','sourceId','instanceId','generation','callerIdentity','principalSHA256','account','deviceId','projectId','projectRevision','projectCurrentRef','publisherId','publisherPublicSHA256','publisherRegistrationRef','publisherRevision','publisherKeyVersion','manifestSHA256','artifactSHA256','artifactVersion','publishPurpose','targetEnvironment','byteSize','originalRequestSHA256','originalInvocationSHA256','actualApprovalRef','confirmationRef','revocationRef','approvedAtMs','expiresAtMs'];
const resource=['resourceId','resourceApprovalRef','runtimeSeconds','resourceValidUntilMs','requiresAdditionalCharge'];
function scope(raw){const s=parse(raw,16384),kind=s.kind;if(!Object.hasOwn(ORIGINAL_IDE_APPROVAL_FRAMES,kind))fail('IDE_APPROVAL_KIND');exactPQRecord(s,kind==='resource'?[...common,...resource]:common,'IDE_APPROVAL_SCOPE_SCHEMA');
 if(s.version!==ORIGINAL_IDE_PUBLICATION_APPROVAL_SCOPE||s.sourcePurpose!==ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE)fail('IDE_APPROVAL_DEDICATED_SCOPE_REQUIRED');
 for(const k of ['sourceId','instanceId','callerIdentity','account','deviceId','projectId','projectCurrentRef','publisherId','publisherRegistrationRef','artifactVersion','publishPurpose','targetEnvironment','confirmationRef','revocationRef'])if(!text(s[k]))fail('IDE_APPROVAL_SCOPE_BINDING');
 for(const k of ['principalSHA256','publisherPublicSHA256','manifestSHA256','artifactSHA256','originalRequestSHA256','originalInvocationSHA256'])if(!digest(s[k]))fail('IDE_APPROVAL_SCOPE_DIGEST');
 for(const k of ['generation','projectRevision','publisherRevision','publisherKeyVersion'])number(s[k]);
 if(typeof s.actualApprovalRef!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.actualApprovalRef)||!Number.isSafeInteger(s.byteSize)||s.byteSize<1||s.byteSize>67108864||!ms(s.approvedAtMs)||!ms(s.expiresAtMs)||s.expiresAtMs<=s.approvedAtMs||s.expiresAtMs-s.approvedAtMs>30000)fail('IDE_APPROVAL_SCOPE_WINDOW');
 if(kind==='resource'&&(!text(s.resourceId)||!text(s.resourceApprovalRef)||!Number.isSafeInteger(s.runtimeSeconds)||s.runtimeSeconds<1||s.runtimeSeconds>86400||!ms(s.resourceValidUntilMs)||s.expiresAtMs>s.resourceValidUntilMs||typeof s.requiresAdditionalCharge!=='boolean'))fail('IDE_APPROVAL_RESOURCE_SCOPE');
 return s;
}
function binding(b){exactPQRecord(b,['networkId','owner','keyVersion','executionHeight'],'IDE_APPROVAL_SIGNER');if(!digest(b.networkId)||typeof b.owner!=='string'||!/^0x[0-9a-f]{40}$/.test(b.owner))fail('IDE_APPROVAL_SIGNER');number(b.keyVersion);number(b.executionHeight,false);return b;}
const fields=['version','kind','scopeSHA256','actualApprovalRef','confirmationRef','revocationRef','decision','requestState','resultOriginalSHA256','sequence','floor','nonce','issuedAtMs','expiresAtMs'];
function statement(raw,s,expectedNonce,at){const r=parse(raw,16384);exactPQRecord(r,fields,'IDE_APPROVAL_CURRENT_SCHEMA');
 if(r.version!==ORIGINAL_IDE_APPROVAL_CURRENT||r.kind!==s.kind||r.scopeSHA256!==sha(canonical(s))||r.actualApprovalRef!==s.actualApprovalRef||r.confirmationRef!==s.confirmationRef||r.revocationRef!==s.revocationRef||!['approved','rejected','revoked','expired','unknown'].includes(r.decision)||!['selected','signed-unhanded','returned','rejected','failed','unknown'].includes(r.requestState)||!(r.resultOriginalSHA256===''||digest(r.resultOriginalSHA256)))fail('IDE_APPROVAL_CURRENT_BINDING');
 if(['signed-unhanded','returned'].includes(r.requestState)&&!digest(r.resultOriginalSHA256)||r.decision==='approved'&&!['selected','signed-unhanded','returned','failed'].includes(r.requestState)||r.decision==='rejected'&&r.requestState!=='rejected'||r.decision==='unknown'&&r.requestState!=='unknown')fail('IDE_APPROVAL_REQUEST_STATE');
 const seq=number(r.sequence),floor=number(r.floor,false);if(floor>seq||!nonce(r.nonce)||r.nonce!==expectedNonce)fail('IDE_APPROVAL_NONCE_OR_FLOOR');
 if(!ms(at)||!ms(r.issuedAtMs)||!ms(r.expiresAtMs)||r.issuedAtMs<s.approvedAtMs||r.expiresAtMs<=r.issuedAtMs||r.expiresAtMs-r.issuedAtMs>30000||r.expiresAtMs>s.expiresAtMs||at<r.issuedAtMs||at>=r.expiresAtMs)fail('IDE_APPROVAL_CURRENT_EXPIRED');return r;
}
export function inspectOriginalIDEApprovalScopeDATA(scopeOriginal){const s=scope(scopeOriginal);return Object.freeze({...s,dataOnly:true,authorized:false,nativeAdmission:false});}
// Bytes for the original registered current-role issuer, never a signer API.
// Only an independently commissioned Native approval custodian may produce
// them from its actual captured review/result/current state (not caller DTO).
export function encodeOriginalIDEApprovalCurrentDATA(context,scopeOriginal,currentOriginal){const s=scope(scopeOriginal),r=parse(currentOriginal,16384);binding(context);statement(currentOriginal,s,r.nonce,r.issuedAtMs);return encodeOriginalAuthSourceStatementV2('current',ORIGINAL_IDE_APPROVAL_FRAMES[s.kind],context,currentOriginal);}
export function canonicalOriginalIDEApprovalCurrentDATA(context,scopeOriginal,currentOriginal,memberOriginal){encodeOriginalIDEApprovalCurrentDATA(context,scopeOriginal,currentOriginal);const raw=pqDecodeBase64url(memberOriginal,{max:262144});if(!raw.length||pqBase64url(raw)!==memberOriginal)fail('IDE_APPROVAL_MEMBER');const result=canonical({version:ORIGINAL_IDE_APPROVAL_CURRENT,binding:context,scopeOriginal,currentOriginal,memberOriginal});parse(result,393216);return result;}
export function verifyOriginalIDEApprovalCurrentDATA(envelopeOriginal,registeredCurrentIssuer,expectedScopeOriginal,challenge,previous,atMs){
 const e=parse(envelopeOriginal,393216);exactPQRecord(e,['version','binding','scopeOriginal','currentOriginal','memberOriginal'],'IDE_APPROVAL_ENVELOPE');if(e.version!==ORIGINAL_IDE_APPROVAL_CURRENT||e.scopeOriginal!==expectedScopeOriginal)fail('IDE_APPROVAL_SCOPE_CHANGED');const s=scope(expectedScopeOriginal),r=statement(e.currentOriginal,s,challenge,atMs);binding(e.binding);
 exactPQRecord(previous,['sequence','floor','decision','requestState','resultOriginalSHA256','scopeSHA256','timeFloor'],'IDE_APPROVAL_PREVIOUS');const previousSeq=number(previous.sequence,false),previousFloor=number(previous.floor,false);if(previousFloor>previousSeq||number(r.sequence)<previousSeq||number(r.floor,false)<previousFloor||!Number.isSafeInteger(previous.timeFloor)||previous.timeFloor<0||atMs<previous.timeFloor||!['','approved','rejected','revoked','expired','unknown'].includes(previous.decision)||previousSeq===0n&&['decision','requestState','resultOriginalSHA256','scopeSHA256'].some(k=>previous[k]!=='')||previousSeq>0n&&(!previous.decision||previous.scopeSHA256!==r.scopeSHA256||!['selected','signed-unhanded','returned','rejected','failed','unknown'].includes(previous.requestState)||!(previous.resultOriginalSHA256===''||digest(previous.resultOriginalSHA256))))fail('IDE_APPROVAL_ROLLBACK');
 // Every non-approved outcome is terminal. UNKNOWN is not cleared by a later
 // successful lookup or by replacing the approval with a fresh local UUID.
 if(previous.decision&&previous.decision!=='approved'&&r.decision!==previous.decision||['rejected','failed','unknown'].includes(previous.requestState)&&r.requestState!==previous.requestState||previousSeq===number(r.sequence)&&previousSeq>0n&&['decision','requestState','resultOriginalSHA256'].some(k=>r[k]!==previous[k]))fail('IDE_APPROVAL_TERMINAL_OR_EQUIVOCATION');
 // Signed issuance height and independently observed CURRENT height differ
 // when a block arrives during transport. Authenticate against the actual
 // current active full pair, not an invented snapshot at the signed height.
 // The normal dispatcher additionally fences signed height between its own
 // before/after observations and checks current policy before AND after.
 const observed=inspectPQAuthorizationView(registeredCurrentIssuer);if(!observed.activeRecord||number(e.binding.executionHeight,false)>number(registeredCurrentIssuer.executionHeight,false)||number(e.binding.executionHeight,false)<number(observed.activeRecord.activeFrom,false))fail('IDE_APPROVAL_ISSUANCE_HEIGHT');
 const result=verifyPQRegisteredMemberData(registeredCurrentIssuer,pqDecodeBase64url(e.memberOriginal,{max:262144}),{chainId:e.binding.networkId,owner:e.binding.owner,keyVersion:e.binding.keyVersion,executionHeight:registeredCurrentIssuer.executionHeight,purpose:'AUTH-SOURCE-CURRENT',message:encodeOriginalIDEApprovalCurrentDATA(e.binding,e.scopeOriginal,e.currentOriginal)});if(result.memberCount!==1||result.memberIndex!==0)fail('IDE_APPROVAL_N1_REQUIRED');
 // Even approved/signed does NOT authorize publication here. Genuine Source
 // must authenticate the independent Root/caller, publisher/result originals,
 // exact expected scope, durable previous, and BEFORE/AFTER current/revoke/time.
 return Object.freeze({kind:s.kind,scopeSHA256:sha(e.scopeOriginal),statementSHA256:sha(e.currentOriginal),resultOriginalSHA256:r.resultOriginalSHA256,sequence:r.sequence,floor:r.floor,decision:r.decision,requestState:r.requestState,statementExecutionHeight:e.binding.executionHeight,observedExecutionHeight:registeredCurrentIssuer.executionHeight,timeFloor:atMs,expiresAtMs:r.expiresAtMs,readyForSourceVerification:r.decision==='approved'&&['signed-unhanded','returned'].includes(r.requestState)&&!(s.kind==='resource'&&s.requiresAdditionalCharge),dataOnly:true,signatureVerified:true,authorized:false,nativeAdmission:false,publicationAuthorized:false,resourceAuthorized:false});
}
