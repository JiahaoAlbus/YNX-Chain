import type {PQAuthorizationSnapshot} from './pq-wallet-policy.js';
import type {PQPublicBinding} from './pq-wallet-contract.js';
import type {OriginalAuthIdentityRequest,OriginalAuthIdentityPurpose} from '../native/original-auth-identity-v2-contract.mjs';
import type {PQRegisteredDataResult} from './pq-registered-member.js';
export interface OriginalAuthIdentityVerificationData {
 readonly body:Readonly<OriginalAuthIdentityRequest>;readonly requestOriginalDigest:string;
 readonly verification:Readonly<PQRegisteredDataResult & {purpose:string;signatureVerified:true}>;
 readonly dataOnly:true;readonly authorized:false;
}
/** Auth-owned exact canonical request + registered dual math. No Source
 * provenance or authorization is granted by this DATA result. */
export function verifyOriginalAuthIdentityMemberData(snapshot:PQAuthorizationSnapshot,wire:Uint8Array,requestRaw:string,expectedRequestRaw:string,purpose:OriginalAuthIdentityPurpose,atMs:string):Readonly<OriginalAuthIdentityVerificationData>;
export function verifyOriginalAuthIdentityRecoveryData(snapshot:PQAuthorizationSnapshot,wire:Uint8Array,binding:PQPublicBinding,originalRequestRaw:string,recoveryRequestRaw:string,expectedRecoveryRequestRaw:string,atMs:string):Readonly<OriginalAuthIdentityVerificationData & {continuity:Readonly<{principalId:string;owner:string;dataOnly:true;authorized:false}>;registered:Readonly<PQRegisteredDataResult>}>;
