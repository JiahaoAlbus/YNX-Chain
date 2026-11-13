// Private pre-signing DATA comparison only. This never verifies an account
// signature, creates a policy observation, selects a Root row, or signs.
import {createHash} from 'node:crypto';
import {canonicalJSON} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {productSessionApprovalDigest} from './product-session-v2.js';
import {decodeBase64url} from './base64url.js';
import {readFileSync} from 'node:fs';
import {inspectOriginalProductSessionV4ApprovalDATA} from './product-session-pq-v4-codec.js';
import {readProductSessionAccountPolicy} from './product-session-account-policy.js';
import {accountAuthorizationFromView} from './product-session-account-private.js';
import {inspectOriginalProductDeviceV4PendingScopeDATA,PRODUCT_DEVICE_V4_PENDING_PURPOSE} from '../native/original-product-device-v4-pending-source-contract.mjs';
import {createOriginalDeviceRegistrationPublicOriginalsFromSeedCanonicalDATA} from './original-device-registration-public-originals-core.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const mismatch=()=>fail('AUTH_FIRST_DEVICE_ORIGINAL_MISMATCH');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8'));
function exact(v,fields){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k)))mismatch();
 return v;
}
function original(raw,max){
 if(typeof raw!=='string'||!raw.length||!raw.isWellFormed()||Buffer.byteLength(raw)>max)mismatch();
 let value;try{value=JSON.parse(raw);if(canonicalJSON(value)!==raw)mismatch();}catch{mismatch();}
 return value;
}
function instant(raw){
 if(typeof raw!=='string')mismatch();
 const t=Date.parse(raw);if(!Number.isSafeInteger(t)||t<0||new Date(t).toISOString()!==raw)mismatch();return t;
}

// These arguments are exact strings read from the owning boundaries, not a
// replaceable authority object. mainRaw is a local projection of the original
// seed/independent C2840 pair and the three immutable journal readbacks.
export function inspectOriginalDeviceRegistrationFirstProfileBindingDATA(mainRaw,walletRaw,profileRaw,atMs){
 if(arguments.length!==4||!Number.isSafeInteger(atMs)||atMs<0||!Number.isFinite(+new Date(atMs)))mismatch();
 const main=exact(original(mainRaw,65536),['seedInputOriginal','allocationOriginal','requestOriginal','registrationOriginal']);
 const retained=createOriginalDeviceRegistrationPublicOriginalsFromSeedCanonicalDATA(main.seedInputOriginal);
 for(const k of ['allocationOriginal','requestOriginal','registrationOriginal'])if(main[k]!==retained[k])mismatch();
 const wallet=exact(original(walletRaw,393216),['version','policyOriginal','approvalOriginal','requestOriginal','requestDigest','operationId','registrationOriginal','account']);
 if(wallet.version!=='YNX-WALLET-DEVICE-V4-APPROVED-PUBLIC/v1')mismatch();
 for(const k of ['requestOriginal','requestDigest','operationId','registrationOriginal'])if(wallet[k]!==retained[k])mismatch();
 const registration=original(retained.registrationOriginal,16384),approval=original(wallet.approvalOriginal,196608);
 if(approval?.version!=='4'||approval.result!=='approved'||approval.requestDigest!==retained.requestDigest||wallet.account!==registration.canonicalOwner||evmAddressFromYNX(approval.account)!==wallet.account)mismatch();
 const policy=exact(original(wallet.policyOriginal,196608),['version','networkId','canonicalOwner','checkpoint','policyVersion','algorithmVersion','activeRecord','observedAt','expiresAt']);
 const auth=exact(approval.accountAuthorization,['policyVersion','algorithmVersion','networkId','canonicalOwner','revision','registeredAt','activeFrom','pkA','pkB']);
 const active=exact(policy.activeRecord,['revision','registeredAt','activeFrom','pkA','pkB']);
 if(policy.version!=='YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1'||policy.policyVersion!=='YNX-ACCOUNT-POLICY/v1'||policy.algorithmVersion!=='YNX-BATCH/v0.1'||policy.networkId!==registration.networkId||policy.canonicalOwner!==registration.canonicalOwner||registration.pkA===active.pkA||registration.pkB===active.pkB)mismatch();
 for(const k of ['networkId','canonicalOwner','policyVersion','algorithmVersion'])if(auth[k]!==policy[k])mismatch();
 for(const k of Object.keys(active))if(auth[k]!==active[k])mismatch();
 const approvedAt=instant(approval.issuedAt),approvalEnd=instant(approval.expiresAt);
 if(instant(policy.observedAt)>approvedAt||approvedAt>=instant(policy.expiresAt)||approvedAt>atMs||atMs>=approvalEnd)fail('AUTH_FIRST_DEVICE_APPROVAL_WINDOW');
 const p=original(profileRaw,65536),s=p?.selection,scope=s?.productSessionDeviceV4Pending;
 if(p?.version!==2||p.purpose!==PRODUCT_DEVICE_V4_PENDING_PURPOSE||p.subjectOwner!==registration.canonicalOwner||!scope||scope.operation!=='registration-pop'||scope.pendingId!==retained.operationId||scope.requestOriginal!==retained.requestOriginal||scope.registrationOriginal!==retained.registrationOriginal||scope.approvalDigest!==productSessionApprovalDigest(approval)||p.issuedAtMs<approvedAt||p.expiresAtMs>approvalEnd)mismatch();
 inspectOriginalProductDeviceV4PendingScopeDATA(scope,s.association,registration.networkId,p.subjectOwner,p.issuedAtMs,p.expiresAtMs,atMs);
 return Object.freeze({creationOperationId:retained.creationOperationId,mainDeviceOperationId:retained.mainDeviceOperationId,pairOperationId:retained.operationId,profileBodySHA256:sha(profileRaw),currentHead:sha(canonicalJSON(scope)),expiresAtMs:p.expiresAtMs,dataOnly:true,signatureVerified:false,authorized:false,SourceAdmission:false,NativeAdmission:false});
}

// CURRENT independently admits the signed envelope digest, not a digest of the
// bare PROFILE body or the caller's PAIR ID. The original CURRENT loader still
// owns signature, signed-profile membership, journal and role verification.
export function inspectOriginalDeviceRegistrationFirstCurrentBindingDATA(mainRaw,walletRaw,profileRaw,signedProfileRaw,admittedProfileDigest,atMs){
 if(arguments.length!==6||typeof admittedProfileDigest!=='string'||!/^[a-f0-9]{64}$/.test(admittedProfileDigest))mismatch();
 const binding=inspectOriginalDeviceRegistrationFirstProfileBindingDATA(mainRaw,walletRaw,profileRaw,atMs);
 const envelope=original(signedProfileRaw,393216);
 if(!envelope||typeof envelope.body!=='string'||sha(signedProfileRaw)!==admittedProfileDigest)mismatch();
 let body;try{body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(decodeBase64url(envelope.body));}catch{mismatch();}
 if(body!==profileRaw)mismatch();
 return Object.freeze({...binding,profileDigest:admittedProfileDigest,currentAdmitted:false});
}

// The policyRef is borrowed from the original independent server account
// policy resource. Never register the Wallet's historical JSON as a policy.
// This guard does not call the issuer, acquire keys or consume an operation.
export function verifyOriginalDeviceRegistrationFirstProfileDATA(mainRaw,walletRaw,profileRaw,policyRef,atMs){
 if(arguments.length!==5)mismatch();
 const binding=inspectOriginalDeviceRegistrationFirstProfileBindingDATA(mainRaw,walletRaw,profileRaw,atMs);
 const wallet=original(walletRaw,393216),approval=original(wallet.approvalOriginal,196608);
 const checkCurrent=()=>{
  const view=readProductSessionAccountPolicy(policyRef,approval.account,new Date(atMs));
  if(canonicalJSON(accountAuthorizationFromView(view))!==canonicalJSON(approval.accountAuthorization))fail('AUTH_FIRST_DEVICE_ACCOUNT_POLICY_CHANGED');
 };
 checkCurrent();
 const verified=inspectOriginalProductSessionV4ApprovalDATA(registry,{requestOriginal:wallet.requestOriginal,approvalOriginal:wallet.approvalOriginal,registrationOriginal:wallet.registrationOriginal,checkedAtMs:atMs});
 if(verified.signatureVerified!==true||canonicalJSON(verified.accountAuthorization)!==canonicalJSON(approval.accountAuthorization))mismatch();
 checkCurrent();
 return Object.freeze({...binding,signatureVerified:true});
}
