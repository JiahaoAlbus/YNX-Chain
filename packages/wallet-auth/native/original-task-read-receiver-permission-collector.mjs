// PURE DATA collector using the sole Source-v2 Root4/current verifier. It neither
// constructs nor brands a Go/Native Source, listener, private receiver or loan.
import{types}from'node:util';
import{canonical,sha}from'./original-auth-identity-source-verifier.mjs';
import{verifyOriginalAuthSourceCurrentV2}from'./original-auth-identity-source-v2-verifier.mjs';
import{TASK_READ_RECEIVER_SOURCE_PURPOSE as PURPOSE,TASK_READ_RECEIVER_SOURCE_SELECTION_KEY as KEY,receiverExactDATA as exact,projectOriginalTaskReadReceiverRegistrationV1DATA}from'./original-task-read-receiver-source-contract.mjs';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
function bytes(v){if(!v||types.isProxy(v)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(v)))fail('TASK_RECEIVER_ORIGINAL_BYTES');const proto=Object.getPrototypeOf(Uint8Array.prototype),get=k=>Object.getOwnPropertyDescriptor(proto,k).get.call(v),length=get('byteLength'),offset=get('byteOffset'),backing=get('buffer');if(length<1||length>1048576||Object.getPrototypeOf(backing)!==ArrayBuffer.prototype)fail('TASK_RECEIVER_ORIGINAL_BYTES');const b=Buffer.alloc(length);b.set(new Uint8Array(backing,offset,length));return b}
function time(v){if(typeof v!=='string'||!/^[1-9][0-9]{0,15}$/.test(v)||BigInt(v)>BigInt(Number.MAX_SAFE_INTEGER))fail('TASK_RECEIVER_SOURCE_WINDOW');return BigInt(v)}
export function collectOriginalTaskReadReceiverPermissionV1DATA(input){
 exact(input,['rootRaw','enrollmentRaw','profileRaw','currentRaw','policy','registrations','expectedNonce','previous','atMs','taskSource','receiverRegistration']);
 if(input.policy?.signatureContract?.purpose!==PURPOSE)fail('TASK_RECEIVER_DEDICATED_PURPOSE_REQUIRED');
 const t=input.taskSource;exact(t,['rootIdentity','subjectOwner','authority','realm','tenant','version','projectionOriginal','observedMS','expiresMS']);exact(t.rootIdentity,['rootId','rootOwner','networkId']);exact(t.version,['authority','revision','policyRevision']);
 // Capture SAME held original bytes before mathematics or external boundaries.
 const original=bytes(t.projectionOriginal),receiver=projectOriginalTaskReadReceiverRegistrationV1DATA(input.receiverRegistration),receiverOriginal=canonical(receiver),from=time(t.observedMS),end=time(t.expiresMS);
 if(end<=from||!Number.isSafeInteger(input.atMs)||BigInt(input.atMs)<from||BigInt(input.atMs)>=end)fail('TASK_RECEIVER_SOURCE_WINDOW');
 const current=verifyOriginalAuthSourceCurrentV2(input.rootRaw,input.enrollmentRaw,input.profileRaw,input.currentRaw,input.policy,input.registrations,input.expectedNonce,input.previous,input.atMs),scope=current.selection[KEY];
 if(current.historical===true||current.status!=='active'||!scope||canonical(current.rootIdentityDATA)!==canonical(t.rootIdentity)||scope.subjectOwner!==t.subjectOwner)fail('TASK_RECEIVER_SAME_ROOT_IDENTITY');
 if(scope.authority!==t.authority||scope.realm!==t.realm||scope.tenant!==t.tenant||canonical(scope.sourceVersion)!==canonical(t.version)||scope.sourceProjection.bytes!==original.length||scope.sourceProjection.sha256!==sha(original))fail('TASK_RECEIVER_SAME_SOURCE_ORIGINAL');
 if(BigInt(scope.issuedMS)<from||BigInt(scope.expiresMS)>end)fail('TASK_RECEIVER_SOURCE_WINDOW');
 const projected={};for(const k of Object.keys(receiver))projected[k]=scope[k];if(canonical(projected)!==receiverOriginal)fail('TASK_RECEIVER_REGISTRATION_BINDING');
 return Object.freeze({scopeOriginal:canonical(scope),scopeHead:sha(canonical(scope)),expiresAtMs:Math.min(current.expiresAtMs,Number(scope.expiresMS),Number(end)),mathVerifiedDATA:true,sameRootIdentityMatchedDATA:true,sourceProjectionMatchedDATA:true,receiverRegistrationMatchedDATA:true,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,listenCapability:false});
}
