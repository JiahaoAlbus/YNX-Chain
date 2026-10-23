import type {PQAuthorizationSnapshot} from '../src/pq-wallet-policy.js';
export const AUTH_SOURCE_V2:'YNX-AUTH-SOURCE/v2';
export const AUTH_SOURCE_DOMAIN_V2:'YNX/AUTH/SOURCE-ORIGINAL/V2';
export const AUTH_SOURCE_STATEMENT_CAP:393216;
export type OriginalAuthSourceV2Role='enrollment'|'profile'|'current';
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
}
/** Four separately branded snapshots. Parsing alone does not authenticate their
 * origin. Native must supply/recheck genuine current registrations around use. */
export interface OriginalAuthSourceV2Registrations {
 readonly root:PQAuthorizationSnapshot;readonly profile:PQAuthorizationSnapshot;
 readonly current:PQAuthorizationSnapshot;readonly subject:PQAuthorizationSnapshot;
}
export interface OriginalAuthSourceV2Selection {
 readonly [key:string]:OriginalAuthSourceJSON;
 readonly association:Readonly<{account:string;clientId:string;productId:'developer';platform:'macos';applicationId:'com.ynxweb4.developer.testnetpreview';deviceId:string}>;
 readonly expectedRequest:Readonly<Record<string,OriginalAuthSourceJSON>>;
 readonly originalHostStatePath:string;readonly originalHostTerminalDirectory:string;
}
export interface OriginalAuthSourceV2Root {
 readonly version:2;readonly algorithmVersion:'YNX-BATCH/v0.1';
 readonly purpose:string;readonly rootId:string;readonly networkId:string;readonly rootOwner:string;
}
/** Signed enrollment DATA only. The original verifier binds the service and
 * exact operation tuple to the independently admitted purpose; types do not. */
export type OriginalAuthSourceV2Service='wallet-product-session-v2'|'ide-contract-relay-v1'|'ide-project-authority-v1';
export type OriginalAuthSourceV2Operations=
 readonly ['beginYNX','handleReturn','restore','disconnect']|
 readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal']|
 readonly ['CurrentProject','CurrentPublisher','RecheckProject'];
export interface OriginalAuthSourceV2Enrollment {
 readonly version:2;readonly purpose:string;readonly rootId:string;readonly rootOwner:string;
 readonly sourceId:string;readonly service:OriginalAuthSourceV2Service;readonly productId:'developer';readonly platform:'macos';
 readonly applicationId:'com.ynxweb4.developer.testnetpreview';readonly gatewayOrigin:'https://wallet-auth.ynxweb4.com';
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
