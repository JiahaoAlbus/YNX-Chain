export const ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_NAMESPACE:'wallet-product-session-v2-admission-publication-metadata/v1';
export const ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_MAX_BYTES:65536;
/** Public identity captured by A's actual independently authenticated role loader,
 * not a renderer DTO or an authority supplied by this metadata codec. */
export interface OriginalServiceAdmissionRoleSource {rootDigest:string;roleDigest:string;rootId:string;rootKeyId:string;rootPublicKey:string;keyId:string;holderPublicKey:string;registryDigest:string;registrationNonce:string;issuedAtMs:number;expiresAtMs:number}
export interface OriginalServiceAdmissionPublicationInput {enrollmentOperationId:string;registrationNonce:string;requestNonce:string;requestRaw:string;reviewDigest:string;roleSource:OriginalServiceAdmissionRoleSource;runtimeRaw:string}
export interface OriginalServiceAdmissionPublicationRecord extends OriginalServiceAdmissionPublicationInput {state:'pending'|'UNKNOWN'|'signed';signedRaw:string|null}
/** Only SAME original Vault encrypted catalog schema6 candidate metadata. */
export interface OriginalServiceAdmissionPublicationState {version:1;purpose:typeof ORIGINAL_WALLET_SERVICE_ADMISSION_PUBLICATION_NAMESPACE;records:OriginalServiceAdmissionPublicationRecord[]}
export interface OriginalServiceAdmissionPublicationMutation {state:OriginalServiceAdmissionPublicationState;record:OriginalServiceAdmissionPublicationRecord;readOnly:boolean}
export function emptyOriginalWalletServiceAdmissionPublicationState():OriginalServiceAdmissionPublicationState;
export function parseOriginalWalletServiceAdmissionPublicationState(raw:unknown):OriginalServiceAdmissionPublicationState;
export function reserveOriginalWalletServiceAdmissionPublication(state:unknown,input:unknown):OriginalServiceAdmissionPublicationMutation;
export function markOriginalWalletServiceAdmissionPublicationUnknown(state:unknown,requestNonce:string):OriginalServiceAdmissionPublicationMutation;
/** Metadata association only; caller must authenticate exact signedRaw under the
 * original publisher and same Vault lease. Never IPC/permission capability. */
export function recordOriginalWalletServiceAdmissionPublicationSigned(state:unknown,requestNonce:string,signedRaw:string):OriginalServiceAdmissionPublicationMutation;
export function readOriginalWalletServiceAdmissionPublication(state:unknown,requestNonce:string):{record:OriginalServiceAdmissionPublicationRecord;readOnly:true};
/** Mandatory on every same-catalog rewrite. Prefix/history immutable; only
 * pending→UNKNOWN→signed; new records only pending, no unresolved bypass.
 * Returns void as a structural retention assertion, never authority. */
export function assertOriginalWalletServiceAdmissionPublicationRetention(previous:unknown,next:unknown):void;
