// Public DATA verifier for explicit AND-v2 consumers. NOT Root admission.
// expectedManifestSHA256 must be from independent release trust, not a request.
import{sha}from'./original-auth-identity-source-verifier.mjs';
import{decodeMember}from'@ynx/batch-v01-candidate';
import{inspectPQAuthorizationView}from'../src/pq-wallet-policy.js';
import{verifyPQRegisteredMemberData}from'../src/pq-registered-member.js';
import{ROOT_AND_SUITE,rootCanonical,rootExact,inspectRootPermitV2}from'./original-source-root-contract-v2.mjs';
const fail=c=>{throw Object.assign(Error(c),{code:c})};
export function inspectOriginalSourceRootEnvelopeV2(envelopeRaw,manifestRaw,rootRegistration,expectedManifestSHA256,expectedOperation,expectedBodyRaw,atMs){
 if(typeof expectedManifestSHA256!=='string'||!/^[0-9a-f]{64}$/.test(expectedManifestSHA256)||sha(manifestRaw)!==expectedManifestSHA256)fail('ROOT_V2_CONSUMER_TRUST_PIN');
 const e=rootCanonical(envelopeRaw,350000);rootExact(e,['version','algorithm','manifestSHA256','permitOriginal','bodyOriginal','member']);
 if(e.version!=='2'||e.algorithm!==ROOT_AND_SUITE||e.manifestSHA256!==expectedManifestSHA256||e.bodyOriginal!==expectedBodyRaw||typeof e.member!=='string'||e.member.length>131072||!/^[A-Za-z0-9_-]+$/.test(e.member))fail('ROOT_V2_CONSUMER_VERSION_OR_BINDING');
 const v=inspectRootPermitV2(e.permitOriginal,manifestRaw,e.bodyOriginal,atMs),m=v.manifest;if(v.permit.operation!==expectedOperation)fail('ROOT_V2_CONSUMER_OPERATION');
 const view=inspectPQAuthorizationView(rootRegistration),record=view.activeRecord;if(rootRegistration.networkId!==m.networkId||rootRegistration.owner!==m.rootOwner||!record||!view.pqSigningEnabled||view.authorizationStatus==='revoked'||record.pkA!==m.pkA||record.pkB!==m.pkB||record.revision!==m.rootRevision||BigInt(v.permit.executionHeight)>BigInt(rootRegistration.executionHeight))fail('ROOT_V2_CONSUMER_REGISTERED_ROOT');
 const wire=Buffer.from(e.member,'base64url');if(wire.length<1||wire.length>98304||wire.toString('base64url')!==e.member)fail('ROOT_V2_CONSUMER_MEMBER');
 const decoded=decodeMember(wire);if(decoded.certificate.N!==1||decoded.index!==0||decoded.pathA.length!==0||decoded.pathB.length!==0)fail('ROOT_V2_N1_REQUIRED');
 const purpose=expectedOperation==='issue-read-release'?'SOURCE-ROOT-READ-V2':'SOURCE-DEVICE-REVOKE-V2',proof=verifyPQRegisteredMemberData(rootRegistration,wire,{chainId:m.networkId,owner:m.rootOwner,keyVersion:m.rootRevision,executionHeight:rootRegistration.executionHeight,purpose,message:v.transcript});
 if(proof.memberCount!==1||proof.memberIndex!==0)fail('ROOT_V2_N1_REQUIRED');
 // Repeat bounded original/schema/time checks after verification. Native/Main
 // still must bracket this DATA call with their SAME physical Source/current.
 inspectRootPermitV2(e.permitOriginal,manifestRaw,e.bodyOriginal,atMs);
 return Object.freeze({version:'2',algorithm:ROOT_AND_SUITE,operation:expectedOperation,manifestSHA256:expectedManifestSHA256,permitSHA256:sha(e.permitOriginal),bodySHA256:sha(e.bodyOriginal),envelopeSHA256:sha(envelopeRaw),registryId:m.registryId,sequence:v.permit.sequence,previousSHA256:v.permit.previousSHA256,expiresAtMs:v.permit.expiresAtMs,dataOnly:true,authorized:false,nativeAdmission:false});
}
