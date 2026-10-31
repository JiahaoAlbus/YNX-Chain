import type{LegacyGrantRefV1,GrantBindV1,GrantStepBindingV1}from'./bound-grant.js';
export const TASK_AUTHORITY_RESPONSE_PURPOSE:'YNX-OPEN/TASK-AUTHORITY-RESPONSE/1';
export const TASK_AUTHORITY_WHOLE_MAX_BYTES:1048576;
export const TASK_AUTHORITY_PAYLOAD_MAX_BYTES:65536;
export interface TaskAuthorityFullRefDATA {readonly realm:string;readonly tenant:string;readonly kind:string;readonly id:string;readonly rev:string}
export interface TaskAuthorityProofDATA {readonly purpose:string;readonly payloadOriginal:Uint8Array;readonly wireOriginal:Uint8Array}
export interface TaskAuthorityRequestInputDATA {readonly version:'1';readonly nonce:string;readonly account:string;readonly currentTaskRevision:string;readonly currentGeneration:string;readonly sourceExpires:string;readonly originalBody:Uint8Array}
export interface TaskAuthorityFalseAuthorityDATA {readonly dataOnly:true;readonly signatureVerified:false;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly operationVerified:false}
export interface TaskAuthorityResponseCallDATA {readonly grantRef:LegacyGrantRefV1;readonly grantPayload:GrantBindV1;readonly grantWire:GrantBindV1;readonly holderPayload:GrantBindV1;readonly holderWire:GrantBindV1;readonly issuer:LegacyGrantRefV1;readonly holder:LegacyGrantRefV1;readonly issuerEpoch:string;readonly holderEpoch:string;readonly binding:GrantStepBindingV1;readonly requestBinding:GrantBindV1}
export interface TaskAuthorityTransportDATA {readonly action:'effect'|'query';readonly method:'POST';readonly path:string;readonly service:string;readonly origin:string;readonly contentType:'application/json';readonly statusCode:200|409}
export interface TaskAuthorityDeclaredSourceDATA {readonly resource:LegacyGrantRefV1;readonly fields:readonly string[];readonly label:'PUBLIC'|'TENANT'|'RESTRICTED'|'VAULT';readonly binding:GrantBindV1}
export interface TaskAuthorityResponseResourceDATA {readonly operationID:string;readonly remoteRef:string;readonly authScope:'egress-only-read-fence';readonly source:TaskAuthorityDeclaredSourceDATA;readonly responseBinding:GrantBindV1}
export interface TaskAuthorityResponsePayloadDATA {
 readonly version:'1';readonly purpose:typeof TASK_AUTHORITY_RESPONSE_PURPOSE;readonly realm:string;readonly tenant:string;readonly authority:string;readonly account:string;
 readonly currentTaskRevision:string;readonly currentGeneration:string;readonly sourceExpires:string;readonly responseIssuer:TaskAuthorityFullRefDATA;readonly issuerEpoch:string;readonly policyRevision:string;readonly height:string;readonly chainID:string;
 readonly call:TaskAuthorityResponseCallDATA;readonly transport:TaskAuthorityTransportDATA;readonly operationID:string;readonly state:'COMMITTED'|'FAILED'|'UNKNOWN';
 readonly opaqueOriginalBinding:GrantBindV1;readonly wholeServiceResponseBinding:GrantBindV1;readonly wholeRequestBinding:GrantBindV1;readonly resource:TaskAuthorityResponseResourceDATA|null;readonly nonce:string;readonly issuedAt:string;readonly expires:string;
}
export interface TaskAuthorityWholeResponseInputDATA {readonly version:'1';readonly originalBody:Uint8Array;readonly proof:TaskAuthorityProofDATA}
export interface TaskAuthorityActualResourceDATA {readonly operationID:string;readonly remoteRef:string;readonly authScope:'egress-only-read-fence';readonly source:TaskAuthorityDeclaredSourceDATA;readonly responseOriginal:Uint8Array;readonly sourceBytes:Uint8Array}
export interface TaskAuthorityOriginalCallDATA {readonly grantRef:LegacyGrantRefV1;readonly grant:TaskAuthorityProofDATA;readonly holder:TaskAuthorityProofDATA;readonly rawInput:Uint8Array;readonly originalOperation:string}
export interface TaskAuthorityRegisteredIssuerDATA {readonly principal:TaskAuthorityFullRefDATA;readonly issuerEpoch:string;readonly policyRevision:string;readonly height:string;readonly chainID:string;readonly expires:string}
/** All values must come independently from the selected original call/current
 * profile and actual Node result. Passing them is DATA, never Source supply. */
export interface TaskAuthorityWholeExpectedDATA {
 readonly maxResponseBytes:number;readonly requestOriginal:Uint8Array;readonly call:TaskAuthorityOriginalCallDATA;readonly transport:TaskAuthorityTransportDATA;readonly issuer:TaskAuthorityRegisteredIssuerDATA;
 readonly realm:string;readonly tenant:string;readonly authority:string;readonly account:string;readonly currentTaskRevision:string;readonly currentGeneration:string;readonly sourceExpires:string;readonly operationID:string;readonly state:'COMMITTED'|'FAILED'|'UNKNOWN';readonly opaqueOriginal:string;readonly resource:TaskAuthorityActualResourceDATA|null;readonly at:string;
}
export function encodeTaskAuthorityFullRefDATA(value:TaskAuthorityFullRefDATA):Uint8Array;
export function encodeTaskAuthorityRequestDATA(input:TaskAuthorityRequestInputDATA):Uint8Array;
export function decodeTaskAuthorityRequestDATA(original:Uint8Array):Readonly<TaskAuthorityRequestInputDATA&TaskAuthorityFalseAuthorityDATA>;
export function encodeTaskAuthorityResponsePayloadDATA(input:TaskAuthorityResponsePayloadDATA):Uint8Array;
export function decodeTaskAuthorityResponsePayloadDATA(original:Uint8Array):Readonly<TaskAuthorityResponsePayloadDATA>;
export function encodeTaskAuthorityWholeResponseDATA(input:TaskAuthorityWholeResponseInputDATA,maxResponseBytes:number):Uint8Array;
export function decodeTaskAuthorityWholeResponseDATA(original:Uint8Array,maxResponseBytes:number):Readonly<TaskAuthorityWholeResponseInputDATA&TaskAuthorityFalseAuthorityDATA>;
export function assertTaskAuthorityWholeResponseBindingDATA(original:Uint8Array,expected:TaskAuthorityWholeExpectedDATA):Readonly<{payload:TaskAuthorityResponsePayloadDATA;responseOriginal:Uint8Array;proof:TaskAuthorityProofDATA}&TaskAuthorityFalseAuthorityDATA>;
