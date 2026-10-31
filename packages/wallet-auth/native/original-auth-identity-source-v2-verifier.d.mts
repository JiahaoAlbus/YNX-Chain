import type {PQAuthorizationSnapshot} from '../src/pq-wallet-policy.js';
export const AUTH_SOURCE_V2:'YNX-AUTH-SOURCE/v2';
export const AUTH_SOURCE_DOMAIN_V2:'YNX/AUTH/SOURCE-ORIGINAL/V2';
export const AUTH_SOURCE_STATEMENT_CAP:393216;
export type OriginalAuthSourceV2Role='enrollment'|'profile'|'current';
/** Shared pre-role-key/private-sign body validation DATA. Never issuance,
 * approval, a registered Source service or a global device revocation grant. */
export function inspectOriginalProductDeviceV4IssuanceBodyDATA(role:'enrollment'|'profile',rootRaw:string,enrollmentRaw:string,bodyRaw:string,policy:OriginalAuthSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,atMs:number):Readonly<{role:'enrollment'|'profile';bodySHA256:string;dataOnly:true;authorized:false;nativeAdmission:false}>;
export type OriginalAuthSourceJSON=null|boolean|number|string|readonly OriginalAuthSourceJSON[]|{readonly [key:string]:OriginalAuthSourceJSON};
export interface OriginalAuthSourceV2Context {
 readonly networkId:string;readonly owner:string;
 /** Original signer owner Record.Revision and signed issuance H, canonical U64
  * strings. Current issuance H must equal the actual observed H. */
 readonly keyVersion:string;readonly executionHeight:string;
}
export interface OriginalAuthSourceV2Policy {
 readonly rootDigest:string;readonly enrollmentDigest:string;
 readonly endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current';readonly spki:string;
 readonly signatureContract:Readonly<{purpose:string;enrollmentFrame:string;profileFrame:string;currentFrame:string}>;
 /** Mandatory for dedicated PQ catalog or device-v4 purpose. Native validates
  * the exact role-specific field set and actual application identity. */
 readonly applicationId?:string;
 /** Mandatory only for device-v4, pinned by the same compiled Source row. */
 readonly productId?:string;
 /** Required only by the dedicated Pay Source; independently release-pinned. */
 readonly platform?:'linux'|'macos'|'windows';
}
/** Four separately branded snapshots. Parsing alone does not authenticate their
 * origin. Native must supply/recheck genuine current registrations around use. */
export interface OriginalAuthSourceV2Registrations {
 readonly root:PQAuthorizationSnapshot;readonly profile:PQAuthorizationSnapshot;
 readonly current:PQAuthorizationSnapshot;readonly subject:PQAuthorizationSnapshot;
}
export interface OriginalAuthSourceV2Selection {
 readonly [key:string]:OriginalAuthSourceJSON;
 readonly association:Readonly<{account:string;clientId:string;platform:'macos'|'linux'|'windows';deviceId:string;productId:string;applicationId:string}>;
 readonly expectedRequest:Readonly<Record<string,OriginalAuthSourceJSON>>;
 readonly originalHostStatePath:string;readonly originalHostTerminalDirectory:string;
}
export interface OriginalAuthSourceV2Root {
 readonly version:2;readonly algorithmVersion:'YNX-BATCH/v0.1';
 readonly purpose:string;readonly rootId:string;readonly networkId:string;readonly rootOwner:string;
}
/** Signed enrollment DATA only. The original verifier binds the service and
 * exact operation tuple to the independently admitted purpose; types do not. */
export type OriginalAuthSourceV2Service='wallet-product-session-v2'|'ide-contract-relay-v1'|'ide-project-authority-v1'|'ide-project-control-authority-v1'|'ide-publication-approval-authority-v1'|'wallet-pq-host-catalog-source-v1'|'product-session-device-source-v4'|'ide-deployment-authority-v2'|'cloud-deployment-execution-authority-v2'|'cloud-deployment-recovery-authority-v2'|'product-session-device-registered-finalization-source-v4'|'product-session-device-http-binary-source-v5'|'pay-native-cloud-bill-source-v1';
export type OriginalAuthSourceV2Operations=
 readonly ['beginYNX','handleReturn','restore','disconnect']|
 readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']|
 readonly ['CurrentProject','CurrentPublisher','RecheckProject']|
 readonly ['CaptureProjectControl','RecheckProjectControl']|
 readonly ['approval.capture','approval.current','approval.revoke']|
 readonly ['catalog.receive','catalog.current','catalog.retire']|
 readonly ['device.current','device.http-proof']|
 readonly ['deployment.sign-e11']|
 readonly ['deployment.execute-existing']|
 readonly ['deployment.read-original']|
 readonly ['device.registered-finalize']|
 readonly ['device.current','device.http-proof-v5']|
 readonly ['create','read','lookup','merchant_review','submit_merchant_member','reconcile','prepare_terms','register_terms','review_settlement','settle','review_refund','refund'];
export interface OriginalAuthSourceV2Enrollment {
 readonly version:2;readonly purpose:string;readonly rootId:string;readonly rootOwner:string;
 readonly sourceId:string;readonly service:OriginalAuthSourceV2Service;readonly productId:string;readonly platform:'macos';
 readonly applicationId:string;readonly gatewayOrigin:'https://wallet-auth.ynxweb4.com';
 readonly registryDigest:string;readonly profileOwner:string;readonly currentOwner:string;
 readonly endpoint:string;readonly spki:string;readonly currentStatePath:string;
 readonly operations:OriginalAuthSourceV2Operations;
 readonly issuedAtMs:number;readonly expiresAtMs:number;
}
export interface OriginalAuthSourceV2Profile {
 readonly version:2;readonly purpose:string;readonly sourceId:string;readonly enrollmentDigest:string;readonly instanceId:string;
 readonly generation:number;readonly minimumSequence:number;readonly minimumFloor:number;readonly subjectOwner:string;
 readonly selection:OriginalAuthSourceV2Selection;readonly issuedAtMs:number;readonly expiresAtMs:number;
}
/** Verified enrollment DATA only. No profile, subject permission, issuer or
 * Native admission is created by this independently framed verification. */
export interface OriginalAuthSourceV2EnrollmentData {
 readonly root:OriginalAuthSourceV2Root;readonly enrollment:OriginalAuthSourceV2Enrollment;
 readonly enrollmentBinding:OriginalAuthSourceV2Context;
 readonly executionHeight:string;readonly dataOnly:true;readonly nativeAdmission:false;
}
export interface OriginalAuthSourceV2ProfileData {
 readonly root:OriginalAuthSourceV2Root;readonly enrollment:OriginalAuthSourceV2Enrollment;readonly profile:OriginalAuthSourceV2Profile;
 /** Current observed H, distinct from immutable credential signing heights. */
 readonly executionHeight:string;
 readonly credentialIssuedHeights:Readonly<{enrollment:string;profile:string}>;
 readonly subjectKeyVersion:string;readonly dataOnly:true;readonly nativeAdmission:false;
}
export interface OriginalAuthSourceV2Previous {
 readonly sequence:number;readonly floor:number;readonly head:string;readonly timeFloor:number;
 /** Required retained last observed H; Native initializes to '0', never default
  * a missing field or accept a renderer replacement. Reject observation rollback. */
 readonly executionHeight:string;
}
export interface OriginalAuthSourceV2CurrentData extends OriginalAuthSourceV2Previous {
 readonly selection:OriginalAuthSourceV2Selection;readonly principalId:string;readonly subjectOwner:string;readonly subjectKeyVersion:string;
 readonly generation:number;readonly status:'active';readonly expiresAtMs:number;
 readonly profileDigest:string;readonly sourceId:string;readonly instanceId:string;readonly executionHeight:string;
 readonly dataOnly:true;readonly nativeAdmission:false;
}
/** DATA framing only; no Root/issuer/registration/permission is constructed. */
export function encodeOriginalAuthSourceStatementV2(role:OriginalAuthSourceV2Role,originalReleasedFrame:string,binding:OriginalAuthSourceV2Context,canonicalOriginalBody:string):Uint8Array;
export function canonicalOriginalAuthSourceEnvelopeV2(role:OriginalAuthSourceV2Role,binding:OriginalAuthSourceV2Context,canonicalOriginalBody:string,memberWire:Uint8Array):string;
/** Must be applied by the real Native entry to old as well as new credentials.
 * This result alone does not enforce policy in an installed Native component. */
export function selectOriginalAuthSourceAlgorithm(subject:PQAuthorizationSnapshot,credentialVersion:1|2):Readonly<({algorithmVersion:'YNX-BATCH/v0.1';keyVersion:string}|{algorithmVersion:'ed25519';keyVersion:null}) & {dataOnly:true;nativeAdmission:false}>;
/** atMs is the original safe-integer clock observation, distinct from full U64
 * execution heights and key versions. Native provenance remains separate. */
export function verifyOriginalAuthSourceEnrollmentV2(rootRaw:string,enrollmentRaw:string,policy:OriginalAuthSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,atMs:number):Readonly<OriginalAuthSourceV2EnrollmentData>;
export function verifyOriginalAuthSourceProfileV2(rootRaw:string,enrollmentRaw:string,profileRaw:string,policy:OriginalAuthSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,atMs:number):Readonly<OriginalAuthSourceV2ProfileData>;
export function verifyOriginalAuthSourceCurrentV2(rootRaw:string,enrollmentRaw:string,profileRaw:string,currentRaw:string,policy:OriginalAuthSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,expectedNonce:string,previous:OriginalAuthSourceV2Previous,atMs:number):Readonly<OriginalAuthSourceV2CurrentData>;

/** Historical baseline DATA only; expired/terminal heads never grant current
 * admission. Native retains terminal status and must fetch fresh nonce current.
 * Pass only the five Previous fields onward, retaining observed H separately
 * from the historical signed statementExecutionHeight. */
export interface OriginalAuthSourceV2TransitionData extends Omit<OriginalAuthSourceV2CurrentData,'status'> {
 readonly status:'active'|'revoked'|'retired';readonly historical:true;
 readonly statementExecutionHeight:string;
}
export function verifyOriginalAuthSourceTransitionV2(rootRaw:string,enrollmentRaw:string,profileRaw:string,currentRaw:string,policy:OriginalAuthSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,expectedNonce:string,previous:OriginalAuthSourceV2Previous,atMs:number):Readonly<OriginalAuthSourceV2TransitionData>;

/** Dedicated Pay body DATA under original SourceV2 frames, before role key use. */
export function inspectOriginalPayCloudBillSourceIssuanceBodyDATA(role:'enrollment'|'profile',rootRaw:string,enrollmentRaw:string,bodyRaw:string,policy:import('./original-pay-cloud-bill-source-contract.mjs').OriginalPayCloudBillSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,atMs:number):Readonly<{role:'enrollment'|'profile';bodySHA256:string;effectExpiresAtMs:number;dataOnly:true;authorized:false;nativeAdmission:false}>;
