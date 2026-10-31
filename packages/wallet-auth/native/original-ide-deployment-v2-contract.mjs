// PRIVATE proposed V2 Source contract. DATA inspection cannot admit a Root,
// manufacture registered fullRefs, authorize a signer or revive old approvals.
import {decodeDeploymentManifestV2DATA,assertDeploymentArtifactV2DATA,bindDeploymentV2Bytes} from "@ynx-chain/open-protocol/deployment-v2";
import {canonical,sha} from "./original-auth-identity-source-verifier.mjs";
export const IDE_DEPLOYMENT_V2_SOURCE_PURPOSE="ide-deployment-authority-v2";
export const IDE_DEPLOYMENT_V2_OPERATIONS=Object.freeze(["deployment.sign-e11"]);
export const IDE_DEPLOYMENT_V2_SIGNATURE_PURPOSE="CLOUD-DEPLOYMENT-MANIFEST-V2";
export const fail=code=>{throw Object.assign(new Error(code),{code});};
export function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,"value")||!d.enumerable))fail("IDE_DEPLOYMENT_V2_SCHEMA");}
export function original(raw,keys){if(typeof raw!=="string"||!raw.length||Buffer.byteLength(raw)>32768)fail("IDE_DEPLOYMENT_V2_ORIGINAL_BOUNDS");let v;try{v=JSON.parse(raw);}catch{fail("IDE_DEPLOYMENT_V2_ORIGINAL_CANONICAL");}if(canonical(v)!==raw)fail("IDE_DEPLOYMENT_V2_ORIGINAL_CANONICAL");exact(v,keys);return v;}
export function same(a,b,code="IDE_DEPLOYMENT_V2_BINDING"){if(canonical(a)!==canonical(b))fail(code);}
export function u64(v){if(typeof v!=="string"||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>0xffffffffffffffffn)fail("IDE_DEPLOYMENT_V2_EPOCH");return v;}
function window(v,at,limit=86400000){if(![v.issuedAtMs,v.expiresAtMs,at].every(Number.isSafeInteger)||v.issuedAtMs<0||v.expiresAtMs<=v.issuedAtMs||v.expiresAtMs-v.issuedAtMs>limit||at<v.issuedAtMs||at>=v.expiresAtMs)fail("IDE_DEPLOYMENT_V2_WINDOW");}
export function wire(v,max=262144){if(typeof v!=="string"||!v.length||v.length>Math.ceil(max*4/3)||!/^[A-Za-z0-9_-]+$/.test(v))fail("IDE_DEPLOYMENT_V2_ENCODING");const b=Buffer.from(v,"base64url");if(!b.length||b.length>max||b.toString("base64url")!==v)fail("IDE_DEPLOYMENT_V2_ENCODING");return b;}
const ROLE=["schema","ref","epoch","keyRole","subjectOwner","networkId","pkA","pkB","ledgerCurrentRef","status","issuedAtMs","expiresAtMs"];
function role(raw,purpose,at){const r=original(raw,ROLE);if(r.schema!=="ynx-registered-deployment-role-original/v2"||r.keyRole!==purpose||r.status!=="active"||!/^0x[a-f0-9]{40}$/.test(r.subjectOwner??"")||!/^[a-f0-9]{64}$/.test(r.networkId??"")||wire(r.pkA,2592).length!==2592||wire(r.pkB,64).length!==64||typeof r.ledgerCurrentRef!=="string"||!r.ledgerCurrentRef.length)fail("IDE_DEPLOYMENT_V2_REGISTERED_ROLE");u64(r.epoch);if(r.epoch==="0")fail("IDE_DEPLOYMENT_V2_EPOCH");window(r,at);return r;}
/** Called only beneath original v2 Source Root/enrollment/profile/current AND.
 * registered originals are selected by that Source, never manufactured from a
 * local project/publisher string. This function is not ledger authentication. */
export function inspectOriginalIDEDeploymentV2ScopeDATA(scope,association,networkId,subjectOwner,sourceId,instanceId,generation,issued,expires,at){
 exact(scope,["version","requestId","payloadOriginal","payloadBinding","publisherOriginal","issuerOriginal","projectOriginal","resourceOriginal","approvalOriginal"]);
 if(scope.version!=="ynx-ide-deployment-source/v2"||typeof scope.requestId!=="string"||!/^[A-Za-z0-9._:-]{8,128}$/.test(scope.requestId))fail("IDE_DEPLOYMENT_V2_SCOPE");
 const payload=wire(scope.payloadOriginal,16384),dto=decodeDeploymentManifestV2DATA(payload,scope.payloadBinding);
 const publisher=role(scope.publisherOriginal,"deployment-release-v2",at),issuer=role(scope.issuerOriginal,"deployment-issuer-v2",at);
 same(dto.publisher,publisher.ref);same(dto.issuer,issuer.ref);
 if(dto.publisherEpoch!==publisher.epoch||dto.issuerEpoch!==issuer.epoch||publisher.subjectOwner!==subjectOwner||publisher.networkId!==networkId||issuer.networkId!==networkId||publisher.pkA===issuer.pkA||publisher.pkB===issuer.pkB)fail("IDE_DEPLOYMENT_V2_ROLE_EPOCH");
 const project=original(scope.projectOriginal,["schema","ref","realm","tenant","account","publisher","issuer","permissions","resourceRef","ledgerCurrentRef","status","issuedAtMs","expiresAtMs"]);
 if(project.schema!=="ynx-registered-deployment-project/v2"||project.status!=="active"||project.account!==association.account||project.realm!==dto.realm||project.tenant!==dto.tenant||!project.ledgerCurrentRef)fail("IDE_DEPLOYMENT_V2_PROJECT");
 same(project.ref,dto.project);same(project.publisher,dto.publisher);same(project.issuer,dto.issuer);same(project.permissions,IDE_DEPLOYMENT_V2_OPERATIONS);window(project,at);
 const resource=original(scope.resourceOriginal,["schema","ref","realm","tenant","project","objectKey","content","quotaBytes","ledgerCurrentRef","status","issuedAtMs","expiresAtMs"]);
 if(resource.schema!=="ynx-registered-deployment-resource/v2"||resource.status!=="active"||resource.realm!==dto.realm||resource.tenant!==dto.tenant||resource.objectKey!==dto.artifact.objectKey||!resource.ledgerCurrentRef)fail("IDE_DEPLOYMENT_V2_RESOURCE");
 same(resource.ref,project.resourceRef);same(resource.project,dto.project);same(resource.content,dto.artifact.content);u64(resource.quotaBytes);if(BigInt(resource.quotaBytes)<BigInt(dto.artifact.size))fail("IDE_DEPLOYMENT_V2_RESOURCE_QUOTA");window(resource,at);
 const approval=original(scope.approvalOriginal,["schema","purpose","requestId","sourceId","instanceId","generation","realm","tenant","project","publisher","publisherEpoch","issuer","issuerEpoch","resourceRef","payloadBinding","artifactBinding","confirmationRef","revocationRef","decision","state","issuedAtMs","expiresAtMs"]);
 if(approval.schema!=="ynx-ide-deployment-approval/v2"||approval.purpose!==IDE_DEPLOYMENT_V2_SOURCE_PURPOSE||approval.requestId!==scope.requestId||approval.sourceId!==sourceId||approval.instanceId!==instanceId||approval.generation!==generation||approval.realm!==dto.realm||approval.tenant!==dto.tenant||approval.decision!=="approved"||approval.state!=="approved-unconsumed"||!approval.confirmationRef||!approval.revocationRef)fail("IDE_DEPLOYMENT_V2_APPROVAL");
 for(const k of ["project","publisher","publisherEpoch","issuer","issuerEpoch"])same(approval[k],dto[k]);same(approval.resourceRef,resource.ref);same(approval.payloadBinding,scope.payloadBinding);same(approval.artifactBinding,dto.artifact.content);window(approval,at,30000);
 window({issuedAtMs:issued,expiresAtMs:expires},at);if(approval.issuedAtMs<issued||approval.expiresAtMs>expires)fail("IDE_DEPLOYMENT_V2_APPROVAL_WINDOW");
 const ends=[expires,publisher.expiresAtMs,issuer.expiresAtMs,project.expiresAtMs,resource.expiresAtMs,approval.expiresAtMs];
 return Object.freeze({dto,payload,publisher,issuer,project,resource,approval,expiresAtMs:Math.min(...ends),scopeDigest:sha(canonical(scope)),dataOnly:true,authorized:false,nativeAdmission:false});
}
export function assertOriginalDeploymentV2ArtifactDATA(payload,artifact){return assertDeploymentArtifactV2DATA(payload,artifact);}
export function bindOriginalDeploymentV2PayloadDATA(payload){return bindDeploymentV2Bytes(payload);}
